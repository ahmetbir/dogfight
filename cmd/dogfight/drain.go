package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"syscall"
	"time"

	"playground/internal/stats"
)

// Blue/green handover (scripts/deploy.sh): the new version starts while the
// old one still serves; nginx is switched to the new one; then the old one
// gets SIGUSR1 (drain). A draining server keeps its players, refuses
// everyone else (WebSocket close 1012, /api 503), closes its stats store at
// once (final snapshot, lock released, so the new server's store opens)
// and exits when its last game socket closes or after drainMax. SIGUSR2
// (rollback to this server) undoes a drain or a release: it serves again
// and waits for the stats lock. SIGWINCH (legacy rollback) only releases the
// stats store (flush, final snapshot, lock free) and keeps serving: another
// server may then open the volume while this one still answers nginx.
const (
	drainEvery     = time.Second
	flushWait      = 2 * time.Second // a stuck room must not hold the stats handoff
	statsRetry     = time.Second
	defaultDrain   = 30 * time.Minute
	defaultStatsWt = 40 * time.Minute // > drainMax: a draining legacy server may hold the lock that long
)

// drainable is the server side of a drain (*server.Server).
type drainable interface {
	Drain(on bool)
	Conns() int
	FlushStats(ctx context.Context) bool // rooms hand over their open tallies
}

type drainer struct {
	srv     drainable
	slot    *stats.Slot               // nil = stats off
	acquire func(ctx context.Context) // opens the store into slot; returns when done or ctx ends
	quit    func()                    // starts the normal shutdown
	every   time.Duration
	max     time.Duration
	now     func() time.Time
}

// run is the drain actor: it owns the drain state until ctx ends or it quits.
func (d drainer) run(ctx context.Context, sig <-chan os.Signal) {
	stopAcquire := d.startAcquire(ctx)
	defer func() { stopAcquire() }()
	t := time.NewTicker(d.every)
	defer t.Stop()
	var since time.Time // zero = not draining
	released := false   // the stats store was handed off (SIGWINCH or SIGUSR1)
	release := func() {
		if !released {
			released = true
			stopAcquire()
			d.flushRooms(ctx)
			d.closeStats()
		}
	}
	for {
		select {
		case <-ctx.Done():
			return
		case s := <-sig:
			switch {
			case s == syscall.SIGWINCH && since.IsZero() && !released:
				release()
				slog.Info("stats released: serving on")
			case s == syscall.SIGUSR1 && since.IsZero():
				since = d.now()
				d.srv.Drain(true)
				release()
				slog.Info("draining", "conns", d.srv.Conns(), "max", d.max.String())
			case s == syscall.SIGUSR2 && (!since.IsZero() || released):
				since, released = time.Time{}, false
				d.srv.Drain(false)
				if d.slot != nil {
					d.slot.Reopen()
				}
				stopAcquire = d.startAcquire(ctx)
				slog.Info("drain undone: serving")
			}
		case <-t.C:
			if since.IsZero() {
				continue
			}
			n := d.srv.Conns()
			if n == 0 || d.now().Sub(since) >= d.max {
				slog.Info("drained: stopping", "conns", n, "after", d.now().Sub(since).Round(time.Second).String())
				d.quit()
				return
			}
		}
	}
}

// startAcquire opens the stats store in the background; the returned func
// stops a wait that is still going (and is safe to call twice).
func (d drainer) startAcquire(ctx context.Context) func() {
	if d.slot == nil {
		return func() {}
	}
	actx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() { defer close(done); d.acquire(actx) }()
	return func() { cancel(); <-done }
}

// flushRooms has every room record its players' open tallies (as a leave)
// while the store is still open: Store.Record and Close share the store's
// FIFO, so they land before the final snapshot.
func (d drainer) flushRooms(ctx context.Context) {
	if d.slot == nil {
		return
	}
	fctx, cancel := context.WithTimeout(ctx, flushWait)
	defer cancel()
	if !d.srv.FlushStats(fctx) {
		slog.Error("stats flush", "err", "a room did not flush in time; its open tallies are lost")
	}
}

func (d drainer) closeStats() {
	if d.slot == nil {
		return
	}
	if err := d.slot.Close(); err != nil {
		slog.Error("stats close", "err", err)
	}
	slog.Info("stats handed off")
}

// acquireStats opens the store under dir into slot. While another server
// holds the directory's lock it retries every retry. After wait it logs
// "stats disabled" (scripts/deploy.sh greps for it) but keeps retrying, 30×
// slower, so stats come on whenever the lock is finally released (e.g. an
// operator stopped a stuck old server); the slot keeps queueing meanwhile.
// A store that cannot open for another reason (corrupt snapshot, unwritable
// dir) leaves stats off for good: logged, the slot is closed, the game runs.
func acquireStats(ctx context.Context, slot *stats.Slot, dir string, retry, wait time.Duration) {
	deadline := time.Now().Add(wait)
	waiting, late := false, false
	for {
		st, err := stats.Open(dir, stats.Options{})
		if err == nil {
			if slot.Set(st) {
				slog.Info("stats opened", "dir", dir)
			}
			return
		}
		if !errors.Is(err, stats.ErrLocked) {
			slog.Error("stats disabled", "err", err)
			slot.Close()
			return
		}
		if !waiting {
			waiting = true
			slog.Info("stats waiting for handoff", "dir", dir, "max", wait.String())
		}
		if !late && time.Now().After(deadline) {
			late = true
			retry *= 30
			slog.Error("stats disabled", "err", err, "retry", retry.String())
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(retry):
		}
	}
}
