package game

import (
	"testing"

	"playground/internal/bot"
	"playground/internal/maps"
	"playground/internal/mode"
	"playground/internal/sim"
)

func TestBaseAttackRound(t *testing.T) {
	g := New(Settings{Mode: mode.Base, Size: 2, Difficulty: bot.Easy, Seed: 1, Map: maps.Ada, Start: sim.StartRunway})
	if len(g.Players()) != 4 || len(g.Snapshot().Structures) != 12 {
		t.Fatalf("players %d structures %d", len(g.Players()), len(g.Snapshot().Structures))
	}
	r := g.Round()
	if r.ObjNATO != 1950 || r.ObjSoviet != 1950 || r.TicksLeft != 10*60*60 {
		t.Fatalf("round %+v", r)
	}
	for _, p := range g.Snapshot().Planes {
		if p.Bombs != 2 {
			t.Fatalf("plane %d bombs %d", p.ID, p.Bombs)
		}
	}
	for i := range 6 { // as sim.damageStruct reports a kill: the hit, then the down
		g.board.Apply(sim.Event{Kind: sim.EvStructHit, Plane: sim.StructID(0, i), Value: 1e6}, g.teamOf)
		g.board.Apply(sim.Event{Kind: sim.EvStructDown, Plane: sim.StructID(0, i)}, g.teamOf)
	}
	g.Step(nil)
	if r := g.Round(); r.Phase != Ended || r.Winner != "Sovyet" || r.WinnerTeam != sim.TeamSoviet || r.ObjNATO != 0 {
		t.Fatalf("round %+v", r)
	}
}

func TestBaseTimeUpComparesObjective(t *testing.T) {
	g := New(Settings{Mode: mode.Base, Size: 1, Difficulty: bot.Easy, Seed: 2})
	g.board.Apply(sim.Event{Kind: sim.EvStructHit, Plane: sim.StructID(1, 0), Value: 100}, g.teamOf)
	g.roundEnd = g.tick + 1
	g.Step(nil)
	if r := g.Round(); r.Winner != "NATO" || r.WinnerTeam != sim.TeamNATO {
		t.Fatalf("round %+v", r)
	}
}

func TestFFAWinnerID(t *testing.T) {
	g := New(Settings{Mode: mode.FFA, Size: 2, Difficulty: bot.Normal, Seed: 6})
	ids := []sim.ID{g.Players()[0].ID, g.Players()[1].ID}
	for range 15 {
		g.board.Apply(sim.Event{Kind: sim.EvKill, Plane: ids[1], Other: ids[0]}, g.teamOf)
	}
	g.Step(nil)
	if r := g.Round(); r.WinnerID != ids[0] || r.WinnerTeam != sim.TeamNone {
		t.Fatalf("round %+v", r)
	}
}

// Structures and bombs exist only in base attack; the other modes keep the
// v2 world without targets, AA or bombs.
func TestNoTargetsOrBombsOutsideBase(t *testing.T) {
	for _, k := range []mode.Kind{mode.Team, mode.FFA} {
		g := New(Settings{Mode: k, Size: 2, Difficulty: bot.Easy, Seed: 3, Start: sim.StartRunway})
		c := g.worldConfig()
		if c.Structures || c.Bombs != 0 || len(g.Snapshot().Structures) != 0 || g.board.HasObjective() {
			t.Fatalf("%v: config %+v structures %d", k, c, len(g.Snapshot().Structures))
		}
		for _, p := range g.Snapshot().Planes {
			if p.Bombs != 0 {
				t.Fatalf("%v: plane %d bombs %d", k, p.ID, p.Bombs)
			}
		}
		if r := g.Round(); r.ObjNATO != 0 || r.ObjSoviet != 0 {
			t.Fatalf("%v: round %+v", k, r)
		}
	}
}

// A new round restores the objective and clears the last winner.
func TestBaseNewRoundResets(t *testing.T) {
	g := New(Settings{Mode: mode.Base, Size: 1, Difficulty: bot.Easy, Seed: 4})
	for i := range 6 {
		g.board.Apply(sim.Event{Kind: sim.EvStructHit, Plane: sim.StructID(1, i), Value: 1e6}, g.teamOf)
		g.board.Apply(sim.Event{Kind: sim.EvStructDown, Plane: sim.StructID(1, i)}, g.teamOf)
	}
	g.Step(nil)
	if r := g.Round(); r.Phase != Ended || r.WinnerTeam != sim.TeamNATO {
		t.Fatalf("round %+v", r)
	}
	for range EndedTicks {
		g.Step(nil)
	}
	if r := g.Round(); r.Phase != Playing || r.WinnerTeam != sim.TeamNone || r.ObjSoviet != 1950 {
		t.Fatalf("round %+v", r)
	}
}

// Review I1: the round ends on the tick the side's last target falls, even
// when the summed objective keeps a float residual.
func TestLastTargetDownEndsRoundSameTick(t *testing.T) {
	g := New(Settings{Mode: mode.Base, Size: 1, Difficulty: bot.Easy, Seed: 5})
	for i := range 6 {
		g.board.Apply(sim.Event{Kind: sim.EvStructHit, Plane: sim.StructID(1, i), Other: 1, Value: 1e-9}, g.teamOf)
		g.board.Apply(sim.Event{Kind: sim.EvStructDown, Plane: sim.StructID(1, i), Other: 1}, g.teamOf)
	}
	g.Step(nil)
	if r := g.Round(); r.Phase != Ended || r.WinnerTeam != sim.TeamNATO || r.ObjSoviet != 0 {
		t.Fatalf("round %+v", r)
	}
}

// Review m2: equal objective HP at time-up is a draw.
func TestBaseTimeUpEqualIsDraw(t *testing.T) {
	g := New(Settings{Mode: mode.Base, Size: 1, Difficulty: bot.Easy, Seed: 2})
	g.board.Apply(sim.Event{Kind: sim.EvStructHit, Plane: sim.StructID(0, 0), Value: 100}, g.teamOf)
	g.board.Apply(sim.Event{Kind: sim.EvStructHit, Plane: sim.StructID(1, 3), Value: 100}, g.teamOf)
	g.roundEnd = g.tick + 1
	g.Step(nil)
	if r := g.Round(); r.Phase != Ended || r.Winner != drawWinner || r.WinnerTeam != sim.TeamNone {
		t.Fatalf("round %+v", r)
	}
}
