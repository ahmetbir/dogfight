package game

import (
	"testing"

	"playground/internal/bot"
	"playground/internal/mode"
	"playground/internal/sim"
)

func spawnsOf(evs []sim.Event, id sim.ID) int {
	n := 0
	for _, e := range evs {
		if e.Kind == sim.EvSpawn && e.Plane == id {
			n++
		}
	}
	return n
}

// runUntilPlaying steps through the round-over phase and returns the spawn
// events id got on the way.
func runUntilPlaying(t *testing.T, g *Game, id sim.ID) int {
	t.Helper()
	n := 0
	for range EndedTicks + 1 {
		n += spawnsOf(g.Step(nil), id)
		if g.Round().Phase == Playing {
			return n
		}
	}
	t.Fatal("round never restarted")
	return n
}

// A waiting human that picks during the round-over scoreboard joins the
// next round with exactly one spawn, not a plane in the frozen world.
func TestPickDuringRoundOverSpawnsOnceAtNewRound(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 21})
	id, _ := g.AddHuman("a")
	g.Step(nil)
	g.finish(drawWinner)
	kind := teamKinds(player(t, g, id).Team)[1]
	if err := g.Pick(id, kind); err != nil {
		t.Fatal(err)
	}
	g.Step(nil)
	if _, ok := findPlane(g.Snapshot().Planes, id); ok || !g.Waiting(id) {
		t.Fatalf("plane in the frozen world (waiting=%v)", g.Waiting(id))
	}
	if n := runUntilPlaying(t, g, id); n != 1 {
		t.Fatalf("spawn events at round start = %d, want 1", n)
	}
	p, ok := findPlane(g.Snapshot().Planes, id)
	if !ok || !p.Alive || p.Kind != kind || g.Waiting(id) {
		t.Fatalf("after restart: ok=%v alive=%v kind=%v waiting=%v", ok, p.Alive, p.Kind, g.Waiting(id))
	}
}

func TestPickTimeoutDuringRoundOverSpawnsOnceAtNewRound(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 22})
	id, _ := g.AddHuman("a")
	g.finish(drawWinner)
	g.pending[id] = g.tick + 2 // runs out mid-scoreboard
	if n := runUntilPlaying(t, g, id); n != 1 {
		t.Fatalf("spawn events = %d, want 1", n)
	}
	if _, ok := findPlane(g.Snapshot().Planes, id); !ok || g.Waiting(id) {
		t.Fatal("overdue human did not spawn at round start")
	}
}

func TestRoundRestartKeepsHumanWaiting(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 23})
	id, _ := g.AddHuman("a")
	g.finish(drawWinner)
	runUntilPlaying(t, g, id)
	if _, ok := findPlane(g.Snapshot().Planes, id); ok || !g.Waiting(id) {
		t.Fatal("round restart spawned a human that has not picked")
	}
}

func TestLeaveWhileWaitingRefillsSeat(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 24})
	id, _ := g.AddHuman("a")
	team := player(t, g, id).Team
	g.RemoveHuman(id)
	if g.Waiting(id) || g.Humans() != 0 || len(g.Players()) != 4 || len(g.Snapshot().Planes) != 4 {
		t.Fatalf("waiting=%v humans=%d players=%d planes=%d", g.Waiting(id), g.Humans(), len(g.Players()), len(g.Snapshot().Planes))
	}
	n := 0
	for _, p := range g.Players() {
		if p.Team == team {
			n++
		}
	}
	if n != 2 {
		t.Fatalf("team %v has %d seats, want 2", team, n)
	}
	for range PickTimeoutTicks + 1 {
		g.Step(nil)
	}
	if _, ok := findPlane(g.Snapshot().Planes, id); ok {
		t.Fatal("departed human spawned on timeout")
	}
}

func TestDisallowedPickKeepsWaiting(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 25})
	id, _ := g.AddHuman("a")
	other := sim.MiG29
	if player(t, g, id).Team == sim.TeamSoviet {
		other = sim.F16
	}
	if err := g.Pick(id, other); err != ErrBadKind {
		t.Fatalf("Pick other team's kind = %v, want ErrBadKind", err)
	}
	g.Step(nil)
	if _, ok := findPlane(g.Snapshot().Planes, id); ok || !g.Waiting(id) {
		t.Fatal("disallowed pick spawned the human")
	}
}

func TestPickSpamWhileWaitingSwapsOnce(t *testing.T) {
	g := New(Settings{Mode: mode.FFA, Size: 4, Difficulty: bot.Easy, Seed: 26})
	id, _ := g.AddHuman("a")
	for _, k := range []sim.Kind{sim.F15, sim.Su27, sim.MiG29, sim.F16} {
		if err := g.Pick(id, k); err != nil {
			t.Fatal(err)
		}
	}
	// The first pick spawns, the second uses the one instant swap of this
	// life, the rest only set the next kind.
	if n := spawnsOf(g.Step(nil), id); n != 2 {
		t.Fatalf("spawn events = %d, want 2", n)
	}
	p, _ := findPlane(g.Snapshot().Planes, id)
	if p.Kind != sim.Su27 || p.NextKind != sim.F16 {
		t.Fatalf("kind = %v next %v, want Su27 next F16", p.Kind, p.NextKind)
	}
}
