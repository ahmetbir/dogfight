package lobby

import (
	"context"
	"errors"
	"testing"
	"time"
)

// A draining lobby (blue/green deploy) starts no room and quick-picks none;
// running rooms go on. Undrain restores both.
func TestDrainRefusesNewRoomsAndQuick(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	l := New(ctx, Options{})
	listed := ffa
	listed.Listed = true
	r, err := l.Create(listed)
	if err != nil {
		t.Fatal(err)
	}
	l.Drain(true)
	if _, err := l.Create(ffa); !errors.Is(err, ErrDraining) {
		t.Fatalf("create while draining: %v, want ErrDraining", err)
	}
	if _, ok := l.Quick(); ok {
		t.Fatal("quick play picked a room while draining")
	}
	if got, ok := l.Get(r.Code()); !ok || got != r {
		t.Fatal("a running room vanished on drain")
	}
	l.Drain(false)
	if _, ok := l.Quick(); !ok {
		t.Fatal("quick play after undrain")
	}
	if _, err := l.Create(ffa); err != nil {
		t.Fatalf("create after undrain: %v", err)
	}
}

func TestFlushStatsReachesEveryRoom(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	l := New(ctx, Options{})
	for range 3 {
		if _, err := l.Create(ffa); err != nil {
			t.Fatal(err)
		}
	}
	fctx, fcancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer fcancel()
	if !l.FlushStats(fctx) {
		t.Fatal("rooms did not acknowledge the flush")
	}
}
