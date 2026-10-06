package stats

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"
)

var t0 = time.Date(2026, 10, 7, 20, 0, 0, 0, time.UTC)

type clock struct{ now time.Time }

func (c *clock) Now() time.Time { return c.now }

func open(t *testing.T, dir string, c *clock, o Options) *Store {
	t.Helper()
	o.Now = c.Now
	if o.Log == nil {
		o.Log = slog.New(slog.DiscardHandler) // failure-path tests log on purpose
	}
	s, err := Open(dir, o)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestRecordAndQuery(t *testing.T) {
	c := &clock{t0}
	s := open(t, t.TempDir(), c, Options{})
	defer s.Close()
	s.Record(Delta{Pilot: "aa", Name: "Maverick", Kills: 3, Deaths: 1, Matches: 1, Wins: 1, Flight: minFlight, Kinds: map[string]int{"f16": 500, "mig29": 100}})
	s.Record(Delta{Pilot: "bb", Name: "Veli", Kills: 5, Flight: minFlight})
	s.Record(Delta{Pilot: "aa", Kills: 1, Flight: minFlight})
	p, ok := s.Me("aa")
	if !ok || p.Name != "Maverick" || p.Kills != 4 || p.WeekKills != 4 || p.Favorite() != "f16" || p.Week != "2026-W41" {
		t.Fatalf("me %+v", p)
	}
	top, week := s.Top(All, 20)
	if week != "2026-W41" || len(top) != 2 || top[0].Name != "Veli" || top[1].Kills != 4 {
		t.Fatalf("top %+v", top)
	}
	if _, ok := s.Me("zz"); ok {
		t.Fatal("unknown pilot")
	}
}

func TestReopenKeepsEverythingAndPerms(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	s := open(t, dir, c, Options{})
	s.Record(Delta{Pilot: "aa", Name: "A", Kills: 2, Flight: minFlight})
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"pilots.snap.json", "pilots.jsonl"} {
		st, err := os.Stat(filepath.Join(dir, name))
		if err != nil || st.Mode().Perm() != 0o600 {
			t.Fatalf("%s: %v %v", name, err, st)
		}
	}
	s = open(t, dir, c, Options{})
	defer s.Close()
	if p, _ := s.Me("aa"); p.Kills != 2 {
		t.Fatalf("after reopen %+v", p)
	}
}

func TestRecoverTruncatedJournal(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	s := open(t, dir, c, Options{})
	s.Record(Delta{Pilot: "aa", Name: "A", Kills: 1, Flight: minFlight})
	s.Record(Delta{Pilot: "aa", Kills: 1, Flight: minFlight})
	s.crash() // power loss: journal flushed, no snapshot
	f, _ := os.OpenFile(filepath.Join(dir, "pilots.jsonl"), os.O_APPEND|os.O_WRONLY, 0o600)
	f.WriteString(`{"seq":3,"at":1,"d":{"p":"aa","k":`)
	f.Close()
	s = open(t, dir, c, Options{})
	if p, _ := s.Me("aa"); p.Kills != 2 {
		t.Fatalf("recovered %+v", p)
	}
	s.Record(Delta{Pilot: "aa", Kills: 1, Flight: minFlight}) // written after the torn line
	s.crash()
	s = open(t, dir, c, Options{})
	defer s.Close()
	if p, _ := s.Me("aa"); p.Kills != 3 {
		t.Fatalf("the record after a torn line was lost: %+v", p)
	}
}

func TestNoDoubleCountAfterCrashBetweenRenameAndTruncate(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	s := open(t, dir, c, Options{})
	s.Record(Delta{Pilot: "aa", Name: "A", Kills: 3, Flight: minFlight})
	s.snapshotOnly() // snapshot renamed into place, journal not yet truncated
	s.crash()
	s = open(t, dir, c, Options{})
	defer s.Close()
	if p, _ := s.Me("aa"); p.Kills != 3 {
		t.Fatalf("double counted: %+v", p)
	}
}

func TestWeekRollover(t *testing.T) {
	c := &clock{t0}
	s := open(t, t.TempDir(), c, Options{})
	defer s.Close()
	s.Record(Delta{Pilot: "aa", Name: "A", Kills: 5, Flight: minFlight})
	c.now = t0.Add(8 * 24 * time.Hour)
	s.Record(Delta{Pilot: "aa", Kills: 1, Flight: minFlight})
	week, w := s.Top(Week, 20)
	all, _ := s.Top(All, 20)
	if w != "2026-W42" || len(week) != 1 || week[0].Kills != 1 || all[0].Kills != 6 {
		t.Fatalf("week %+v all %+v", week, all)
	}
}

func TestCapAndPrune(t *testing.T) {
	c := &clock{t0}
	s := open(t, t.TempDir(), c, Options{MaxPilots: 2, MaxIdle: 24 * time.Hour})
	defer s.Close()
	s.Record(Delta{Pilot: "old", Kills: 1, Flight: minFlight})
	c.now = t0.Add(time.Hour)
	s.Record(Delta{Pilot: "mid", Kills: 1, Flight: minFlight})
	c.now = t0.Add(2 * time.Hour)
	s.Record(Delta{Pilot: "new", Kills: 1, Flight: minFlight})
	if _, ok := s.Me("old"); ok {
		t.Fatal("cap evicts the least recently seen")
	}
	c.now = t0.Add(25*time.Hour + 30*time.Minute) // cut-off t0+1h30: "mid" (t0+1h) goes, "new" (t0+2h) stays
	s.compactNow()
	if _, ok := s.Me("mid"); ok {
		t.Fatal("idle pilots are pruned at compaction")
	}
	if _, ok := s.Me("new"); !ok {
		t.Fatal("recent pilot kept")
	}
}

func TestRecordNeverBlocks(t *testing.T) {
	s := &Store{in: make(chan any, 1)}
	if !s.Record(Delta{Pilot: "a"}) || s.Record(Delta{Pilot: "b"}) || s.Dropped() != 1 {
		t.Fatal("a full buffer drops and counts")
	}
}
