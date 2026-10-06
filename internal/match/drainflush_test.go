package match

import (
	"context"
	"testing"
	"time"

	"github.com/ahmetbir/roomkit/room"
	"playground/internal/game"
)

// FlushStats (blue/green drain) through the room hands every seated pilot's
// open tally to the sink as a leave would, a played round counting as a
// match, while the players stay seated; nothing is counted twice afterwards.
func TestFlushStatsCountsOpenTallies(t *testing.T) {
	sk := &sink{}
	m := New(ffa4, sk)
	a := seatCounted(t, m, "a")
	a.roundTicks, a.airborne = MatchTicks, true
	a.tally.Kills, a.tally.Fired = 2, 3
	b := seatCounted(t, m, "b") // nothing to flush
	r := room.New("FLSH", m, room.Options{})
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
	m := New(ffa4, sk)
	a := seatCounted(t, m, "a")
	a.roundTicks, a.airborne = MatchTicks, true
	a.tally.Kills = 1
	m.FlushStats()
	a.roundTicks += MatchTicks // played on after the undrain
	m.roundOver(game.Round{Phase: game.Ended, WinnerID: a.id})
	var n, w int
	for _, d := range sk.all() {
		n, w = n+d.Matches, w+d.Wins
	}
	if n != 1 || w != 1 {
		t.Fatalf("matches %d wins %d, want 1 1: %+v", n, w, sk.all())
	}
	a.roundTicks, a.airborne = MatchTicks, true
	m.roundOver(game.Round{Phase: game.Ended})
	if got := sk.all(); got[len(got)-1].Matches != 1 {
		t.Fatalf("next round: %+v", got)
	}
}
