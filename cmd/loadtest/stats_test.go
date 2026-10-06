package main

import (
	"context"
	"testing"
	"time"
)

func TestRoomCPU(t *testing.T) {
	// 10 us per tick, 2 us per snapshot build, 12 encodes of 5 us per snapshot:
	// 60*10 + 30*(2 + 12*5) = 2460 us per second = 0.246 %.
	r := benchResult{ticks: 100, step: 1000 * time.Microsecond, snaps: 50, snapBuild: 100 * time.Microsecond,
		marshals: 600, marshal: 3000 * time.Microsecond}
	if got := r.roomCPU(); got < 0.002459 || got > 0.002461 {
		t.Errorf("roomCPU = %v, want 0.00246", got)
	}
	if (benchResult{}).roomCPU() != 0 {
		t.Error("empty bench should cost 0")
	}
}

func TestRoomCodeHandsOverOnce(t *testing.T) {
	c := newRoomCode()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if _, ok := c.wait(ctx); ok {
		t.Fatal("wait returned before set")
	}
	c.set("ABCD")
	c.set("ZZZZ")
	if code, ok := c.wait(context.Background()); !ok || code != "ABCD" {
		t.Errorf("wait = %q, %v; want ABCD", code, ok)
	}
}
