package game

import (
	"testing"
	"time"

	"playground/internal/bot"
	"playground/internal/mode"
)

// Players must cost O(roster), not O(joins ever): every join/leave cycle
// burns IDs, and a public room code lets anyone cycle.
func TestPlayersFollowsRosterNotIDHistory(t *testing.T) {
	g := New(Settings{Mode: mode.FFA, Size: 4, Difficulty: bot.Easy, Seed: 1})
	for range 1000 {
		id, err := g.AddHuman("x")
		if err != nil {
			t.Fatal(err)
		}
		g.RemoveHuman(id)
	}
	g.nextID += 1 << 27 // as after ~67M cycles: the old ID walk takes ~1 s
	start := time.Now()
	ps := g.Players()
	if d := time.Since(start); d > 50*time.Millisecond {
		t.Fatalf("Players took %v with %d players", d, len(ps))
	}
	if len(ps) != 4 {
		t.Fatalf("got %d players", len(ps))
	}
	for i := 1; i < len(ps); i++ {
		if ps[i-1].ID >= ps[i].ID {
			t.Fatalf("not ordered by ID: %+v", ps)
		}
	}
}
