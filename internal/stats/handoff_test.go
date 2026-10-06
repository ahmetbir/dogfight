package stats

import (
	"errors"
	"testing"
)

// Two stores never write one directory at once: the second Open is refused
// until the first has closed (blue/green handoff, deploy/compose.yml).
func TestOpenRefusesALockedDir(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	a := open(t, dir, c, Options{})
	if _, err := Open(dir, Options{Now: c.Now}); !errors.Is(err, ErrLocked) {
		t.Fatalf("second open: %v, want ErrLocked", err)
	}
	a.Record(Delta{Pilot: "aa", Name: "Maverick", Kills: 2, Flight: minFlight})
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	b := open(t, dir, c, Options{})
	defer b.Close()
	if p, ok := b.Me("aa"); !ok || p.Kills != 2 {
		t.Fatalf("handed-off store lost the first store's record: %+v %v", p, ok)
	}
}

// A store that dies without Close (power loss) releases the lock too.
func TestCrashReleasesTheLock(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	a := open(t, dir, c, Options{})
	a.crash()
	b := open(t, dir, c, Options{})
	b.Close()
}

func TestSlotQueuesUntilSetThenForwards(t *testing.T) {
	c := &clock{t0}
	sl := NewSlot()
	if sl.Ready() {
		t.Fatal("ready before a store is set")
	}
	if !sl.Record(Delta{Pilot: "aa", Name: "Maverick", Kills: 1, Flight: minFlight}) {
		t.Fatal("a waiting slot must queue")
	}
	if _, ok := sl.Me("aa"); ok {
		t.Fatal("Me answered before a store is set")
	}
	st := open(t, t.TempDir(), c, Options{})
	if !sl.Set(st) {
		t.Fatal("Set on a waiting slot")
	}
	if !sl.Ready() {
		t.Fatal("not ready after Set")
	}
	sl.Record(Delta{Pilot: "aa", Kills: 2, Flight: minFlight})
	if p, ok := sl.Me("aa"); !ok || p.Kills != 3 {
		t.Fatalf("queued + forwarded kills: %+v %v", p, ok)
	}
	if top, _ := sl.Top(All, 5); len(top) != 1 {
		t.Fatalf("top %+v", top)
	}
	if err := sl.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestSlotQueueIsBounded(t *testing.T) {
	sl := NewSlot()
	for range slotQueue {
		sl.Record(Delta{Pilot: "aa", Kills: 1})
	}
	if sl.Record(Delta{Pilot: "aa", Kills: 1}) {
		t.Fatal("record past the queue bound was accepted")
	}
	if sl.Dropped() != 1 {
		t.Fatalf("dropped %d, want 1", sl.Dropped())
	}
}

// Close releases the store (and its lock); a store that opens after Close
// is closed at once; Reopen starts waiting again.
func TestSlotCloseAndReopen(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	sl := NewSlot()
	sl.Set(open(t, dir, c, Options{}))
	if err := sl.Close(); err != nil {
		t.Fatal(err)
	}
	if sl.Ready() || sl.Record(Delta{Pilot: "aa", Kills: 1}) {
		t.Fatal("closed slot is ready or takes records")
	}
	late := open(t, dir, c, Options{}) // the lock was released by Close
	if sl.Set(late) {
		t.Fatal("Set on a closed slot must refuse (and close the store)")
	}
	again := open(t, dir, c, Options{}) // late's lock is gone too
	again.Close()

	sl.Reopen()
	if !sl.Record(Delta{Pilot: "bb", Name: "Veli", Kills: 4, Flight: minFlight}) {
		t.Fatal("reopened slot must queue")
	}
	sl.Set(open(t, dir, c, Options{}))
	defer sl.Close()
	if p, ok := sl.Me("bb"); !ok || p.Kills != 4 {
		t.Fatalf("after reopen: %+v %v", p, ok)
	}
}
