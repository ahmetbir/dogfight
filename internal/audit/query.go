//go:build unix

package audit

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net/netip"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// DefaultRetention is how long session files are kept (-audit-retention).
const DefaultRetention = 365 * 24 * time.Hour

const maxMatches = 100_000 // a query holds at most this many matches before it keeps the newest

var monthFile = regexp.MustCompile(`^sessions-(\d{4}-\d{2})\.jsonl$`)

// Prune deletes the month files whose whole month ended before now-keep.
// Only files named sessions-YYYY-MM.jsonl are touched, one by one.
func Prune(dataDir string, keep time.Duration, now time.Time) (removed int, err error) {
	dir := filepath.Join(dataDir, Dir)
	ents, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	cut := now.Add(-keep)
	for _, e := range ents {
		m := monthFile.FindStringSubmatch(e.Name())
		if m == nil || e.IsDir() {
			continue
		}
		start, perr := time.Parse("2006-01", m[1])
		if perr != nil {
			continue
		}
		if end := start.AddDate(0, 1, 0); end.Before(cut) {
			if rerr := os.Remove(filepath.Join(dir, e.Name())); rerr != nil {
				err = errors.Join(err, rerr)
				continue
			}
			removed++
		}
	}
	return removed, err
}

// Retain prunes at once and then daily until ctx ends; failures are logged
// (counts and errors only).
func (l *Log) Retain(ctx context.Context, dataDir string, keep time.Duration) {
	prune := func() {
		n, err := Prune(dataDir, keep, l.now())
		if err != nil {
			l.log.Error("audit: retention", "err", err)
		}
		if n > 0 {
			l.log.Info("audit: retention removed old files", "files", n)
		}
	}
	prune()
	t := time.NewTicker(24 * time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			prune()
		}
	}
}

// Filter selects events.
type Filter func(Event) bool

// ByName matches the entered or accepted name: fold is the caller's name
// normaliser (moderation.Normalize), so spacing, case and look-alikes do not hide one.
func ByName(text string, fold func(string) string) (Filter, error) {
	q := fold(text)
	if q == "" {
		return nil, errors.New("audit: empty name")
	}
	return func(e Event) bool {
		return strings.Contains(fold(e.Name), q) || strings.Contains(fold(e.Accepted), q) || strings.Contains(fold(e.Prev), q)
	}, nil
}

// ByIP matches one address, or every address in a prefix ("2001:db8::/64").
func ByIP(s string) (Filter, error) {
	var p netip.Prefix
	if strings.Contains(s, "/") {
		var err error
		if p, err = netip.ParsePrefix(s); err != nil {
			return nil, err
		}
		p = p.Masked()
	} else {
		a, err := netip.ParseAddr(s)
		if err != nil {
			return nil, err
		}
		a = a.Unmap()
		p = netip.PrefixFrom(a, a.BitLen())
	}
	return func(e Event) bool {
		a, err := netip.ParseAddr(e.IP)
		return err == nil && p.Contains(a.Unmap())
	}, nil
}

var hexPrefix = regexp.MustCompile(`^[0-9a-f]{8,64}$`)

// ByPilot matches a pilot hash or a prefix of at least 8 hex digits (lookup prints 12).
func ByPilot(s string) (Filter, error) {
	s = strings.ToLower(s)
	if !hexPrefix.MatchString(s) {
		return nil, errors.New("audit: a pilot is 8 to 64 hex digits of its hash")
	}
	return func(e Event) bool { return strings.HasPrefix(e.Pilot, s) }, nil
}

// Query returns the newest limit events that f accepts, newest first,
// reading every month file under dataDir.
func Query(dataDir string, f Filter, limit int) ([]Event, error) {
	dir := filepath.Join(dataDir, Dir)
	ents, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []Event
	trim := func() {
		sort.SliceStable(out, func(i, j int) bool { return out[i].T.After(out[j].T) })
		if len(out) > limit {
			out = out[:limit]
		}
	}
	for _, e := range ents {
		if !monthFile.MatchString(e.Name()) {
			continue
		}
		if err := scan(filepath.Join(dir, e.Name()), func(ev Event) {
			if f(ev) {
				out = append(out, ev)
				if len(out) >= maxMatches {
					trim()
				}
			}
		}); err != nil {
			return nil, err
		}
	}
	trim()
	return out, nil
}

// scan reads one file; torn or garbage lines are skipped.
func scan(path string, fn func(Event)) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, maxLine), maxLine)
	for sc.Scan() {
		var e Event
		if json.Unmarshal(sc.Bytes(), &e) == nil && e.Event != "" {
			fn(e)
		}
	}
	if errors.Is(sc.Err(), bufio.ErrTooLong) {
		return nil // only a corrupt file has a line this long; the rest is unreadable by line
	}
	return sc.Err()
}
