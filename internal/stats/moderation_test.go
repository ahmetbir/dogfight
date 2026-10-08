package stats

import (
	"strings"
	"testing"
	"time"
)

// hideX hides the made-up name "Xbad" (moderation's matcher in production).
func hideX(name string) bool { return strings.Contains(strings.ToLower(name), "xbad") }

// Hidden pilots leave the board in both periods and the board still fills
// up to n from the pilots below them.
func TestTopVisibleHidesAndFills(t *testing.T) {
	c := &clock{t0}
	s := open(t, t.TempDir(), c, Options{})
	defer s.Close()
	s.Record(Delta{Pilot: "p1", Name: "XBAD one", Kills: 9, Flight: minFlight})
	s.Record(Delta{Pilot: "p2", Name: "Ali", Kills: 5, Flight: minFlight})
	s.Record(Delta{Pilot: "p3", Name: "Ece", Kills: 3, Flight: minFlight})
	s.Record(Delta{Pilot: "p4", Name: "Can", Kills: 1, Flight: minFlight})
	for _, p := range Periods() {
		top, wk := s.TopVisible(p, 2, hideX)
		if wk == "" || len(top) != 2 || top[0].Name != "Ali" || top[1].Name != "Ece" {
			t.Fatalf("%s: %+v", p.Name(), top)
		}
		if top, _ := s.Top(p, 2); top[0].Name != "XBAD one" {
			t.Fatalf("%s: unfiltered %+v", p.Name(), top)
		}
	}
}

// Purge removes matching rows for good: not in memory, not after a reopen
// (the journal still held them; the compaction's snapshot does not).
func TestPurgeIsDurable(t *testing.T) {
	c := &clock{t0}
	dir := t.TempDir()
	s := open(t, dir, c, Options{})
	s.Record(Delta{Pilot: "p1", Name: "Xbad", Kills: 9, Flight: minFlight})
	s.Record(Delta{Pilot: "p2", Name: "Ali", Kills: 5, Flight: minFlight})
	s.Record(Delta{Pilot: "p3", Name: "x.bad", Kills: 1, Flight: minFlight})
	if f, ok := s.Find(hideX); !ok || len(f) != 1 || f[0].Pilot != "p1" || f[0].Name != "Xbad" || f[0].Kills != 9 || f[0].Seen != t0.Unix() {
		t.Fatalf("find %+v", f)
	}
	n, ok, err := s.Purge([]string{"p1", "p2", "nobody"}, hideX) // p2 listed by mistake: its name does not match
	if n != 1 || !ok || err != nil {
		t.Fatal(n, ok, err)
	}
	if _, ok := s.Me("p1"); ok {
		t.Fatal("purged pilot still known")
	}
	if n, _, _ := s.Purge([]string{"p1"}, hideX); n != 0 {
		t.Fatal("second purge")
	}
	s.crash() // no final snapshot: only the purge's compaction stands between p1 and a replay
	s = open(t, dir, c, Options{})
	defer s.Close()
	if _, ok := s.Me("p1"); ok {
		t.Fatal("purged pilot came back after a restart")
	}
	if _, ok := s.Me("p2"); !ok {
		t.Fatal("others kept")
	}
	// A name-only delta does not recreate a purged pilot.
	s.Record(Delta{Pilot: "p1", Name: "Fresh"})
	if _, ok := s.Me("p1"); ok {
		t.Fatal("name-only delta recreated the pilot")
	}
}

func TestSlotWithoutStore(t *testing.T) {
	sl := NewSlot()
	if _, ok := sl.Find(hideX); ok {
		t.Fatal("find without store")
	}
	if _, ok, _ := sl.Purge([]string{"p1"}, hideX); ok {
		t.Fatal("purge without store")
	}
	if top, wk := sl.TopVisible(All, 5, hideX); top != nil || wk != "" {
		t.Fatal("board without store")
	}
}

// Rename gives a known pilot its new name (journaled: it survives a
// restart), ignores unknown pilots (no record created) and costs no journal
// line when the name is unchanged.
func TestRename(t *testing.T) {
	c := &clock{t0}
	dir := t.TempDir()
	s := open(t, dir, c, Options{})
	s.Record(Delta{Pilot: "p1", Name: "Xbad", Kills: 2, Flight: minFlight})
	s.Rename("ghost", "Nobody")
	s.Rename("p1", "Ali")
	if p, ok := s.Me("p1"); !ok || p.Name != "Ali" || p.Kills != 2 {
		t.Fatalf("%+v", p)
	}
	if _, ok := s.Me("ghost"); ok {
		t.Fatal("rename created a pilot")
	}
	size := func() int64 {
		var n int64
		s.call(func(s *Store) (bool, error) { n = s.size; return false, nil })
		return n
	}
	before := size()
	s.Rename("p1", "Ali")
	if size() != before {
		t.Fatal("unchanged name journaled")
	}
	s.crash()
	s = open(t, dir, c, Options{})
	defer s.Close()
	if p, _ := s.Me("p1"); p.Name != "Ali" {
		t.Fatalf("rename lost on restart: %+v", p)
	}
	sl := NewSlot()
	sl.Rename("p1", "x") // waiting slot: dropped, nothing queued
	if len(sl.queue) != 0 {
		t.Fatal("rename queued")
	}
}

// OnRename hears a stored name change once it is journaled, not on replay.
func TestOnRename(t *testing.T) {
	c := &clock{t0}
	dir := t.TempDir()
	var got []string
	o := Options{OnRename: func(p, prev, name string) { got = append(got, p+":"+prev+">"+name) }}
	s := open(t, dir, c, o)
	s.Record(Delta{Pilot: "p1", Name: "Old", Flight: minFlight})
	s.Rename("p1", "New")
	s.Record(Delta{Pilot: "p1", Name: "New", Kills: 1})
	s.Record(Delta{Pilot: "p1", Name: "Third", Kills: 1})
	s.crash()
	s = open(t, dir, c, o)
	defer s.Close()
	s.Me("x") // barrier
	if strings.Join(got, ",") != "p1:Old>New,p1:New>Third" {
		t.Fatal(got)
	}
}

// A pilot still flying when purged: its end-of-match tally under the purged
// name is dropped (for a day); under a new name it starts a fresh row.
func TestPurgeIsFinalForPilotsMidMatch(t *testing.T) {
	c := &clock{t0}
	s := open(t, t.TempDir(), c, Options{})
	defer s.Close()
	s.Record(Delta{Pilot: "p1", Name: "Xbad", Kills: 9, Flight: minFlight})
	s.Purge([]string{"p1"}, hideX)
	s.Record(Delta{Pilot: "p1", Name: "Xbad", Kills: 3, Flight: minFlight}) // the match it was flying ends
	if _, ok := s.Me("p1"); ok {
		t.Fatal("late tally recreated the purged row")
	}
	s.Record(Delta{Pilot: "p1", Name: "Ali", Kills: 1, Flight: minFlight})
	if p, ok := s.Me("p1"); !ok || p.Name != "Ali" || p.Kills != 1 {
		t.Fatalf("new name: %+v", p)
	}
	c.now = c.now.Add(tombstoneFor + time.Minute)
	s.Record(Delta{Pilot: "p2", Name: "Xbad", Kills: 1, Flight: minFlight})
	s.Purge([]string{"p2"}, hideX)
	c.now = c.now.Add(tombstoneFor + time.Minute)
	s.Record(Delta{Pilot: "p2", Name: "Xbad", Kills: 1, Flight: minFlight})
	if _, ok := s.Me("p2"); !ok {
		t.Fatal("the tombstone expires")
	}
}
