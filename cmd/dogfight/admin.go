package main

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"playground/internal/audit"
	"playground/internal/moderation"
	"playground/internal/stats"
)

// Moderation admin: POST /admin/<verb> on the loopback metrics listener
// (never the public one), driven by `dogfight -admin "<verb> [arg]"` inside
// the container, which has no shell. The body is the argument.
const (
	adminArgMax  = 256 // bytes of an argument
	adminTimeout = 10 * time.Second
	hashShown    = 12 // hex digits of a pilot hash lookup and sessions print

	maxSessionRows = 1000
)

var adminVerbs = []string{"list", "block", "unblock", "lookup", "purge-name", "sessions"}

// ledger is the stats store as the admin sees it (*stats.Slot).
type ledger interface {
	Find(match func(name string) bool) ([]stats.Found, bool)
	Purge(match func(name string) bool) (int, bool, error)
}

type admin struct {
	names   *moderation.Names // nil: moderation off (no -data)
	ledger  ledger            // nil: stats off
	dataDir string            // the session audit lives under it
	audit   bool              // the session audit is on
	log     *slog.Logger
}

// metricsMux is the loopback listener's handler: /admin/ and the metrics.
func metricsMux(metrics http.Handler, a admin) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/admin/", a)
	mux.Handle("/", metrics)
	return mux
}

func (a admin) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !loopback(r.RemoteAddr) { // the listener may be bound wider by mistake: admin stays loopback-only
		http.NotFound(w, r)
		return
	}
	verb := strings.TrimPrefix(r.URL.Path, "/admin/")
	if !validVerb(verb) {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, adminArgMax+1))
	if err != nil || len(b) > adminArgMax {
		http.Error(w, "argument too long", http.StatusBadRequest)
		return
	}
	if a.names == nil {
		http.Error(w, "moderation is off: the server runs without -data", http.StatusServiceUnavailable)
		return
	}
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 1 && n <= maxSessionRows {
			limit = n
		}
	}
	status, body := a.do(verb, strings.TrimSpace(string(b)), limit)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	io.WriteString(w, body)
}

// do runs one verb. Logged with counts only: no names, IPs or tokens.
func (a admin) do(verb, arg string, limit int) (int, string) {
	if verb != "list" && arg == "" {
		return http.StatusBadRequest, verb + " needs an argument\n"
	}
	switch verb {
	case "list":
		ps := a.names.Patterns()
		if len(ps) == 0 {
			return http.StatusOK, "no blocked names\n"
		}
		var b strings.Builder
		for _, p := range ps {
			fmt.Fprintf(&b, "%q\n", p)
		}
		return http.StatusOK, b.String()
	case "block":
		added, err := a.names.Block(arg)
		if err != nil {
			return a.fail(verb, err)
		}
		a.log.Info("admin", "action", verb, "added", added, "patterns", len(a.names.Patterns()))
		msg := fmt.Sprintf("blocked %q (%d patterns)\n", arg, len(a.names.Patterns()))
		if !added {
			msg = fmt.Sprintf("already blocked: %q\n", arg)
		}
		if rows, ok := a.find(arg); ok {
			msg += fmt.Sprintf("%d ledger rows match: hidden from the leaderboard now; purge-name removes them\n", len(rows))
		}
		return http.StatusOK, msg
	case "unblock":
		removed, err := a.names.Unblock(arg)
		if err != nil {
			return a.fail(verb, err)
		}
		a.log.Info("admin", "action", verb, "removed", removed, "patterns", len(a.names.Patterns()))
		if !removed {
			return http.StatusOK, fmt.Sprintf("not blocked: %q\n", arg)
		}
		return http.StatusOK, fmt.Sprintf("unblocked %q (%d patterns)\n", arg, len(a.names.Patterns()))
	case "lookup":
		if _, err := moderation.Matcher(arg); err != nil {
			return a.fail(verb, err)
		}
		rows, ok := a.find(arg)
		if !ok {
			return noLedger()
		}
		a.log.Info("admin", "action", verb, "rows", len(rows))
		if len(rows) == 0 {
			return http.StatusOK, "no ledger rows match\n"
		}
		var b strings.Builder
		for _, f := range rows {
			fmt.Fprintf(&b, "%s  %q  kills=%d  seen=%s\n", f.Pilot[:min(hashShown, len(f.Pilot))], f.Name, f.Kills,
				time.Unix(f.Seen, 0).UTC().Format("2006-01-02 15:04Z"))
		}
		return http.StatusOK, b.String()
	case "purge-name":
		m, err := moderation.Matcher(arg)
		if err != nil {
			return a.fail(verb, err)
		}
		if a.ledger == nil {
			return noLedger()
		}
		n, ok, err := a.ledger.Purge(m)
		if !ok {
			return noLedger()
		}
		a.log.Info("admin", "action", verb, "rows", n, "ok", err == nil)
		if err != nil {
			return http.StatusInternalServerError, fmt.Sprintf("purged %d rows from memory, but the compaction failed (%v): they may come back on a restart; run it again\n", n, err)
		}
		return http.StatusOK, fmt.Sprintf("purged %d ledger rows\n", n)
	case "sessions":
		return a.sessions(arg, limit)
	}
	return http.StatusNotFound, "unknown command\n"
}

// sessions is "sessions name <text> | ip <addr or prefix> | pilot <hash
// prefix>": the newest limit audit events, newest first, full addresses
// (the owner's own tool, inside the container). Read straight from the
// files, so either colour answers for both.
func (a admin) sessions(arg string, limit int) (int, string) {
	if !a.audit {
		return http.StatusServiceUnavailable, "the session audit is off on this server\n"
	}
	by, q, _ := strings.Cut(arg, " ")
	q = strings.TrimSpace(q)
	var f audit.Filter
	var err error
	switch by {
	case "name":
		f, err = audit.ByName(q, moderation.Normalize)
	case "ip":
		f, err = audit.ByIP(q)
	case "pilot":
		f, err = audit.ByPilot(q)
	default:
		return http.StatusBadRequest, "sessions name <text> | ip <addr or prefix> | pilot <hash prefix>\n"
	}
	if err != nil {
		return http.StatusBadRequest, err.Error() + "\n"
	}
	evs, err := audit.Query(a.dataDir, f, limit)
	if err != nil {
		return a.fail("sessions", err)
	}
	a.log.Info("admin", "action", "sessions", "by", by, "rows", len(evs))
	if len(evs) == 0 {
		return http.StatusOK, "no sessions match\n"
	}
	var b strings.Builder
	for _, e := range evs {
		fmt.Fprintf(&b, "%s  %-12s  pilot=%s  ip=%s  room=%s  name=%q", e.T.UTC().Format("2006-01-02 15:04:05Z"), e.Event,
			orDash(e.Pilot[:min(hashShown, len(e.Pilot))]), orDash(e.IP), orDash(e.Room), e.Name)
		if e.Accepted != "" {
			fmt.Fprintf(&b, "  accepted=%q", e.Accepted)
		}
		if e.Prev != "" {
			fmt.Fprintf(&b, "  prev=%q", e.Prev)
		}
		b.WriteByte('\n')
	}
	return http.StatusOK, b.String()
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

// find is the ledger rows matching arg by the block's rule; ok false when
// the arg is no valid pattern or this server does not hold the ledger.
func (a admin) find(arg string) ([]stats.Found, bool) {
	m, err := moderation.Matcher(arg)
	if err != nil || a.ledger == nil {
		return nil, false
	}
	return a.ledger.Find(m)
}

func (a admin) fail(verb string, err error) (int, string) {
	a.log.Error("admin", "action", verb, "err", err)
	if errors.Is(err, moderation.ErrPattern) {
		return http.StatusBadRequest, err.Error() + "\n"
	}
	return http.StatusInternalServerError, err.Error() + "\n"
}

// noLedger: during a blue/green handover only one colour holds the stats
// store (its lock); the other cannot read or purge it.
func noLedger() (int, string) {
	return http.StatusConflict, "this server does not hold the stats ledger (stats off, or the other colour has it): run the command on the live colour\n"
}

func validVerb(v string) bool {
	for _, x := range adminVerbs {
		if v == x {
			return true
		}
	}
	return false
}

func loopback(remote string) bool {
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		host = remote
	}
	a, err := netip.ParseAddr(host)
	return err == nil && a.Unmap().IsLoopback()
}

// adminCLI is -admin: it sends "<verb> [arg]" to the loopback listener at
// addr and prints the answer (limit: rows of a sessions query). Exit code 0
// on 200, 1 on a refusal or an unreachable server, 2 on a bad command.
func adminCLI(addr, command string, limit int, out, errw io.Writer) int {
	verb, arg, _ := strings.Cut(strings.TrimSpace(command), " ")
	if !validVerb(verb) {
		fmt.Fprintf(errw, "-admin: unknown command %q; one of: %s\n", verb, strings.Join(adminVerbs, ", "))
		return 2
	}
	c := http.Client{Timeout: adminTimeout}
	res, err := c.Post("http://"+addr+"/admin/"+verb+"?limit="+strconv.Itoa(limit), "text/plain; charset=utf-8", strings.NewReader(strings.TrimSpace(arg)))
	if err != nil {
		fmt.Fprintln(errw, err)
		return 1
	}
	defer res.Body.Close()
	w := out
	if res.StatusCode != http.StatusOK {
		w = errw
		fmt.Fprintln(errw, res.Status)
	}
	io.Copy(w, io.LimitReader(res.Body, fetchLimit))
	if res.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
