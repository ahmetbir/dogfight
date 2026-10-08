package main

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ahmetbir/roomkit/metrics"
	"playground/internal/audit"
	"playground/internal/moderation"
	"playground/internal/stats"
)

// Made-up names only; real entries live in the server's data dir.

type adminRig struct {
	url   string
	addr  string
	store *stats.Store
	dir   string
}

func newAdminRig(t *testing.T) adminRig {
	t.Helper()
	dir := t.TempDir()
	names, err := moderation.Open(dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	st, err := stats.Open(dir, stats.Options{})
	if err != nil {
		t.Fatal(err)
	}
	sl := stats.NewSlot()
	sl.Set(st)
	t.Cleanup(func() { sl.Close() })
	a := admin{names: names, ledger: sl, dataDir: dir, audit: true, log: slog.New(slog.DiscardHandler)}
	srv := httptest.NewServer(metricsMux(metrics.Handler(metrics.New("dogfight", nil)), a))
	t.Cleanup(srv.Close)
	return adminRig{srv.URL, strings.TrimPrefix(srv.URL, "http://"), st, dir}
}

func (r adminRig) run(t *testing.T, cmd string) (int, string, string) {
	t.Helper()
	var out, errw bytes.Buffer
	code := adminCLI(r.addr, cmd, 50, &out, &errw)
	return code, out.String(), errw.String()
}

// The CLI drives every command through the loopback listener.
func TestAdminCLIRoundTrip(t *testing.T) {
	r := newAdminRig(t)
	r.store.Record(stats.Delta{Pilot: strings.Repeat("ab", 32), Name: "Zorlu Kartal", Kills: 5, Flight: stats.MinFlightTicks})
	r.store.Record(stats.Delta{Pilot: strings.Repeat("cd", 32), Name: "Maverick", Kills: 3, Flight: stats.MinFlightTicks})
	r.store.Me("x") // barrier

	if code, out, _ := r.run(t, "list"); code != 0 || out != "no blocked names\n" {
		t.Fatalf("list: %d %q", code, out)
	}
	if code, out, _ := r.run(t, "block zorlu kartal"); code != 0 || !strings.Contains(out, `blocked "zorlu kartal"`) || !strings.Contains(out, "1 ledger rows match") {
		t.Fatalf("block: %d %q", code, out)
	}
	if code, out, _ := r.run(t, "list"); code != 0 || out != "\"zorlu kartal\"\n" {
		t.Fatalf("list: %d %q", code, out)
	}
	if code, out, _ := r.run(t, "lookup Z0RLU KARTAL"); code != 0 || !strings.HasPrefix(out, "abababababab  \"Zorlu Kartal\"  kills=5  seen=") {
		t.Fatalf("lookup: %d %q", code, out)
	}
	if code, out, _ := r.run(t, "purge-name zorlu kartal"); code != 0 || out != "purged 1 ledger rows\n" {
		t.Fatalf("purge: %d %q", code, out)
	}
	if _, ok := r.store.Me(strings.Repeat("ab", 32)); ok {
		t.Fatal("purged row still in the ledger")
	}
	if _, ok := r.store.Me(strings.Repeat("cd", 32)); !ok {
		t.Fatal("other row purged")
	}
	if code, out, _ := r.run(t, "unblock ZORLU KARTAL"); code != 0 || !strings.Contains(out, "unblocked") {
		t.Fatalf("unblock: %d %q", code, out)
	}
	if code, _, errw := r.run(t, "block ab"); code != 1 || !strings.Contains(errw, "400") {
		t.Fatalf("short pattern: %d %q", code, errw)
	}
	if code, _, errw := r.run(t, "lookup ab"); code != 1 || !strings.Contains(errw, "400") {
		t.Fatalf("short lookup: %d %q", code, errw)
	}
	if code, _, errw := r.run(t, "lookup"); code != 1 || !strings.Contains(errw, "needs an argument") {
		t.Fatalf("no arg: %d %q", code, errw)
	}
	if code, _, _ := r.run(t, "ban someone"); code != 2 {
		t.Fatal("unknown verb")
	}
	if code := adminCLI("127.0.0.1:1", "list", 50, &bytes.Buffer{}, &bytes.Buffer{}); code != 1 {
		t.Fatal("unreachable")
	}
}

func TestAdminSessions(t *testing.T) {
	r := newAdminRig(t)
	l, err := audit.Open(r.dir, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	t0 := time.Date(2026, 10, 8, 15, 0, 0, 0, time.UTC)
	pilot := strings.Repeat("ef", 32)
	l.Record(audit.Event{T: t0, Event: audit.Join, Pilot: pilot, Name: "Zorlu Kartal", Accepted: "Zorlu Kartal", IP: "192.0.2.7", Room: "ABCD"})
	l.Record(audit.Event{T: t0.Add(time.Minute), Event: audit.NameRefused, Pilot: pilot, Name: "z0rlu kartal", IP: "2001:db8::9"})
	l.Close()
	code, out, _ := r.run(t, "sessions name zorlu kartal")
	want := "2026-10-08 15:01:00Z  name_refused  pilot=efefefefefef  ip=2001:db8::9  room=-  name=\"z0rlu kartal\"\n" +
		"2026-10-08 15:00:00Z  join          pilot=efefefefefef  ip=192.0.2.7  room=ABCD  name=\"Zorlu Kartal\"  accepted=\"Zorlu Kartal\"\n"
	if code != 0 || out != want {
		t.Fatalf("%d\n%s\nwant\n%s", code, out, want)
	}
	if _, out, _ := r.run(t, "sessions ip 192.0.2.7"); strings.Count(out, "\n") != 1 {
		t.Fatalf("ip: %q", out)
	}
	if _, out, _ := r.run(t, "sessions pilot efefefefefef"); strings.Count(out, "\n") != 2 {
		t.Fatalf("pilot: %q", out)
	}
	var o bytes.Buffer
	if adminCLI(r.addr, "sessions name zorlu", 1, &o, &bytes.Buffer{}); strings.Count(o.String(), "\n") != 1 {
		t.Fatalf("limit: %q", o.String())
	}
	if code, _, errw := r.run(t, "sessions phone 123"); code != 1 || !strings.Contains(errw, "sessions name") {
		t.Fatalf("bad by: %d %q", code, errw)
	}
}

// Admin answers only loopback peers and only POST; the metrics stay served.
func TestAdminLoopbackOnlyAndMetricsKept(t *testing.T) {
	names, _ := moderation.Open(t.TempDir(), nil)
	h := metricsMux(metrics.Handler(metrics.New("dogfight", nil)), admin{names: names, log: slog.New(slog.DiscardHandler)})
	req := httptest.NewRequest(http.MethodPost, "/admin/list", nil)
	req.RemoteAddr = "203.0.113.5:4000"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("remote peer: %d", w.Code)
	}
	req = httptest.NewRequest(http.MethodGet, "/admin/list", nil)
	req.RemoteAddr = "127.0.0.1:4000"
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET: %d", w.Code)
	}
	req = httptest.NewRequest(http.MethodGet, "/metrics", nil)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "dogfight_") {
		t.Fatalf("metrics: %d", w.Code)
	}
}

// Without -data there is nothing to administer; without the ledger (the
// other colour holds it) lookup and purge say so.
func TestAdminOffAndNoLedger(t *testing.T) {
	off := admin{log: slog.New(slog.DiscardHandler)}
	req := httptest.NewRequest(http.MethodPost, "/admin/list", nil)
	req.RemoteAddr = "[::1]:4000"
	w := httptest.NewRecorder()
	off.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("off: %d", w.Code)
	}
	names, _ := moderation.Open(t.TempDir(), nil)
	a := admin{names: names, ledger: stats.NewSlot(), log: slog.New(slog.DiscardHandler)}
	for _, verb := range []string{"lookup", "purge-name"} {
		if code, _ := a.do(verb, "zorlu kartal", 50); code != http.StatusConflict {
			t.Fatalf("%s: %d", verb, code)
		}
	}
	if code, _ := a.do("sessions", "name x", 50); code != http.StatusServiceUnavailable {
		t.Fatal("audit off")
	}
}
