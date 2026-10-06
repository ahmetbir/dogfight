package room

import (
	"context"
	"testing"
	"time"

	"playground/internal/game"
)

// FlushStats (blue/green drain) hands every session's open tally to the
// sink as a leave would, a played round counting as a match, while the
// players stay seated; nothing is counted twice afterwards.
func TestFlushStatsCountsOpenTallies(t *testing.T) {
	sk := &sink{}
	r := New("FLSH", ffa4, Options{Stats: sk})
	a := seatCounted(t, r, "a")
	a.roundTicks, a.airborne = MatchTicks, true
	a.tally.Kills, a.tally.Fired = 2, 3
	b := seatCounted(t, r, "b") // nothing to flush
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	go r.Run(ctx)

	fctx, fcancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer fcancel()
	if !r.FlushStats(fctx) {
		t.Fatal("flush not acknowledged")
	}
	got := sk.all()
	if len(got) != 1 || got[0].Pilot != "pa" || got[0].Kills != 2 || got[0].Matches != 1 {
		t.Fatalf("flushed %+v", got)
	}
	if !r.FlushStats(fctx) {
		t.Fatal("second flush not acknowledged")
	}
	if got := sk.all(); len(got) != 1 {
		t.Fatalf("flushed twice: %+v", got)
	}
	_ = b
	cancel()
	<-r.Done()
	if !r.FlushStats(fctx) {
		t.Fatal("a stopped room has nothing left to flush: done")
	}
}

// After a drain flush and an undrain, the same round's end credits the win
// but no second match; the next round counts normally.
func TestUndrainAfterFlushCountsOneMatch(t *testing.T) {
	sk := &sink{}
	r := New("UNDR", ffa4, Options{Stats: sk})
	a := seatCounted(t, r, "a")
	a.roundTicks, a.airborne = MatchTicks, true
	a.tally.Kills = 1
	r.flushAll()
	a.roundTicks += MatchTicks // played on after the undrain
	r.roundOver(game.Round{Phase: game.Ended, WinnerID: a.id})
	var m, w int
	for _, d := range sk.all() {
		m, w = m+d.Matches, w+d.Wins
	}
	if m != 1 || w != 1 {
		t.Fatalf("matches %d wins %d, want 1 1: %+v", m, w, sk.all())
	}
	a.roundTicks, a.airborne = MatchTicks, true
	r.roundOver(game.Round{Phase: game.Ended})
	if got := sk.all(); got[len(got)-1].Matches != 1 {
		t.Fatalf("next round: %+v", got)
	}
}
