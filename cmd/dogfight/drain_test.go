package main

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"testing"
	"time"

	"playground/internal/stats"
)

func TestAcquireStatsOpensAFreshDir(t *testing.T) {
	sl := stats.NewSlot()
	acquireStats(t.Context(), sl, t.TempDir(), time.Millisecond, time.Second)
	if !sl.Ready() {
		t.Fatal("a fresh dir opens")
	}
	sl.Close()
}

// A corrupt snapshot leaves stats off and the file untouched.
func TestAcquireStatsCorruptSnapshot(t *testing.T) {
	dir := t.TempDir()
	snap := filepath.Join(dir, "pilots.snap.json")
	junk := []byte("{not json")
	if err := os.WriteFile(snap, junk, 0o600); err != nil {
		t.Fatal(err)
	}
	sl := stats.NewSlot()
	acquireStats(t.Context(), sl, dir, time.Millisecond, time.Second)
	if sl.Ready() || sl.Record(stats.Delta{Pilot: "aa", Kills: 1}) {
		t.Fatal("a corrupt snapshot must disable stats (and not queue forever)")
	}
	if b, err := os.ReadFile(snap); err != nil || string(b) != string(junk) {
		t.Fatalf("snapshot changed or removed: %v %q", err, b)
	}
}

// The new server waits for the old server's lock and opens once it is
// released; never both at once.
func TestAcquireStatsWaitsForTheLock(t *testing.T) {
	dir := t.TempDir()
	old, err := stats.Open(dir, stats.Options{})
	if err != nil {
		t.Fatal(err)
	}
	sl := stats.NewSlot()
	done := make(chan struct{})
	go func() { acquireStats(t.Context(), sl, dir, 5*time.Millisecond, 5*time.Second); close(done) }()
	time.Sleep(50 * time.Millisecond)
	if sl.Ready() {
		t.Fatal("opened while the old store holds the lock")
	}
	old.Close()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("did not open after the handoff")
	}
	if !sl.Ready() {
		t.Fatal("not ready after the handoff")
	}
	sl.Close()
}

// Past the wait stats are off (logged), but the lock is still retried
// slowly: once the old store finally closes, stats come on.
func TestAcquireStatsKeepsRetryingAfterWait(t *testing.T) {
	dir := t.TempDir()
	old, err := stats.Open(dir, stats.Options{})
	if err != nil {
		t.Fatal(err)
	}
	sl := stats.NewSlot()
	done := make(chan struct{})
	go func() { acquireStats(t.Context(), sl, dir, 2*time.Millisecond, 20*time.Millisecond); close(done) }()
	time.Sleep(80 * time.Millisecond)
	if sl.Ready() {
		t.Fatal("ready while the old store holds the lock")
	}
	old.Close()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("did not open after the late release")
	}
	if !sl.Ready() {
		t.Fatal("stats not on after the late release")
	}
	sl.Close()
}

type fakeSrv struct {
	mu    sync.Mutex
	on    bool
	conns int
	flush func() // FlushStats: what the rooms would record
}

func (f *fakeSrv) FlushStats(context.Context) bool {
	if f.flush != nil {
		f.flush()
	}
	return true
}

func (f *fakeSrv) Drain(on bool) { f.mu.Lock(); f.on = on; f.mu.Unlock() }
func (f *fakeSrv) Conns() int    { f.mu.Lock(); defer f.mu.Unlock(); return f.conns }
func (f *fakeSrv) set(n int)     { f.mu.Lock(); f.conns = n; f.mu.Unlock() }
func (f *fakeSrv) draining() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.on
}

type drainRig struct {
	srv  *fakeSrv
	slot *stats.Slot
	dir  string
	sig  chan os.Signal
	quit chan struct{}
	done chan struct{}
}

func startDrainer(t *testing.T, conns int, max time.Duration) *drainRig {
	t.Helper()
	r := &drainRig{srv: &fakeSrv{conns: conns}, slot: stats.NewSlot(), dir: t.TempDir(),
		sig: make(chan os.Signal, 1), quit: make(chan struct{}), done: make(chan struct{})}
	d := drainer{
		srv: r.srv, slot: r.slot,
		acquire: func(ctx context.Context) { acquireStats(ctx, r.slot, r.dir, 5*time.Millisecond, 5*time.Second) },
		quit:    func() { close(r.quit) },
		every:   5 * time.Millisecond, max: max, now: time.Now,
	}
	go func() { d.run(t.Context(), r.sig); close(r.done) }()
	t.Cleanup(func() { r.slot.Close() })
	eventually(t, r.slot.Ready, "stats open at start")
	return r
}

func eventually(t *testing.T, ok func() bool, what string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatal(what)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

func closed(c <-chan struct{}) func() bool {
	return func() bool {
		select {
		case <-c:
			return true
		default:
			return false
		}
	}
}

// SIGUSR1: drain, hand the stats lock over at once, quit when the last
// socket closes.
func TestDrainHandsOffStatsAndQuitsWhenEmpty(t *testing.T) {
	r := startDrainer(t, 2, time.Hour)
	r.sig <- syscall.SIGUSR1
	eventually(t, r.srv.draining, "server not draining")
	eventually(t, func() bool { return !r.slot.Ready() }, "stats still open")
	var next *stats.Store // the new server's store: it opens once the drain released the lock
	eventually(t, func() bool { next, _ = stats.Open(r.dir, stats.Options{}); return next != nil }, "lock not released on drain")
	next.Close()
	time.Sleep(30 * time.Millisecond)
	if closed(r.quit)() {
		t.Fatal("quit with players still connected")
	}
	r.srv.set(0)
	eventually(t, closed(r.quit), "no quit after the last socket closed")
	eventually(t, closed(r.done), "drainer still running")
}

func TestDrainQuitsAfterMax(t *testing.T) {
	r := startDrainer(t, 3, 40*time.Millisecond)
	r.sig <- syscall.SIGUSR1
	eventually(t, closed(r.quit), "no quit after the drain max")
}

// SIGUSR2 undoes a drain: serving again, stats reopen (lock free again).
func TestUndrain(t *testing.T) {
	r := startDrainer(t, 1, time.Hour)
	r.sig <- syscall.SIGUSR1
	eventually(t, func() bool { return !r.slot.Ready() }, "stats still open")
	r.sig <- syscall.SIGUSR2
	eventually(t, func() bool { return !r.srv.draining() }, "still draining")
	eventually(t, r.slot.Ready, "stats not reopened")
	r.srv.set(0)
	time.Sleep(30 * time.Millisecond)
	if closed(r.quit)() {
		t.Fatal("an undrained server quit")
	}
}

// The rooms' open tallies are flushed into the store before the drain
// closes it: the next server's store has them.
func TestDrainFlushesTalliesBeforeHandoff(t *testing.T) {
	r := startDrainer(t, 1, time.Hour)
	r.srv.flush = func() { r.slot.Record(stats.Delta{Pilot: "aa", Name: "Ace", Kills: 3, Flight: 3600}) }
	r.sig <- syscall.SIGUSR1
	var next *stats.Store
	eventually(t, func() bool { next, _ = stats.Open(r.dir, stats.Options{}); return next != nil }, "lock not released on drain")
	defer next.Close()
	if p, ok := next.Me("aa"); !ok || p.Kills != 3 {
		t.Fatalf("flushed tally lost in the handoff: %+v %v", p, ok)
	}
}

// SIGWINCH releases the stats store (flushed, lock free for another
// server) but keeps serving and never quits; SIGUSR1 then drains as usual,
// SIGUSR2 takes the stats back.
func TestReleaseStatsKeepsServing(t *testing.T) {
	r := startDrainer(t, 0, time.Hour)
	r.srv.flush = func() { r.slot.Record(stats.Delta{Pilot: "aa", Name: "Ace", Kills: 1, Flight: 3600}) }
	r.sig <- syscall.SIGWINCH
	var other *stats.Store // e.g. the legacy server opening the same volume
	eventually(t, func() bool { other, _ = stats.Open(r.dir, stats.Options{}); return other != nil }, "lock not released")
	if p, ok := other.Me("aa"); !ok || p.Kills != 1 {
		t.Fatalf("release did not flush: %+v %v", p, ok)
	}
	time.Sleep(30 * time.Millisecond)
	if r.srv.draining() || closed(r.quit)() {
		t.Fatal("release must keep serving (no drain, no quit with 0 conns)")
	}
	other.Close()
	r.sig <- syscall.SIGUSR2
	eventually(t, r.slot.Ready, "stats not taken back after SIGUSR2")
	r.sig <- syscall.SIGWINCH
	eventually(t, func() bool { return !r.slot.Ready() }, "second release")
	r.sig <- syscall.SIGUSR1
	eventually(t, closed(r.quit), "drain after release must quit when empty")
}
