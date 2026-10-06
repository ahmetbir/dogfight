package game

import (
	"testing"

	"playground/internal/bot"
	"playground/internal/mode"
	"playground/internal/sim"
)

// The pick's loadout spawns with the first plane, applies at once through
// a protected respawning pick, and otherwise waits for the next spawn.
func TestPickLoadout(t *testing.T) {
	g := New(Settings{Mode: mode.FFA, Size: 2, Difficulty: bot.Easy, Seed: 8})
	id, err := g.AddHuman("x")
	if err != nil {
		t.Fatal(err)
	}
	g.SetLoadout(id, sim.LoadMixed)
	if err := g.Pick(id, sim.F15); err != nil {
		t.Fatal(err)
	}
	if p, _ := findPlane(g.Snapshot().Planes, id); p.Loadout != sim.LoadMixed || p.Missiles != 3 || p.Radars != 1 {
		t.Fatalf("first spawn: %v %d+%d", p.Loadout, p.Missiles, p.Radars)
	}
	g.Step(nil)
	g.SetLoadout(id, sim.LoadRadar)
	_ = g.Pick(id, sim.F15) // still protected: respawns with the radar load
	if p, _ := findPlane(g.Snapshot().Planes, id); p.Loadout != sim.LoadRadar || p.Missiles != 0 || p.Radars != 3 {
		t.Fatalf("protected pick: %v %d+%d", p.Loadout, p.Missiles, p.Radars)
	}
	g.SetLoadout(id, sim.LoadIR)
	_ = g.Pick(id, sim.F15) // same aircraft, still protected: re-armed in place
	if p, _ := findPlane(g.Snapshot().Planes, id); p.Loadout != sim.LoadIR || p.Missiles != 6 || p.Radars != 0 {
		t.Fatalf("protected loadout-only pick: %v %d+%d", p.Loadout, p.Missiles, p.Radars)
	}
	g.world.Edit(id, func(p *sim.Plane) { p.ProtectUntil = 0 })
	g.SetLoadout(id, sim.LoadMixed)
	_ = g.Pick(id, sim.F15) // unprotected: next spawn
	if p, _ := findPlane(g.Snapshot().Planes, id); p.Loadout != sim.LoadIR || p.NextLoadout != sim.LoadMixed {
		t.Fatalf("unprotected pick: %v next %v", p.Loadout, p.NextLoadout)
	}
}

// Review fix round: in spawn protection a loadout change and an aircraft
// change both apply, in either order; the loadout-only pick re-arms in place
// and leaves the once-per-life respawn for the aircraft.
func TestProtectedLoadoutAndAircraftBothApply(t *testing.T) {
	for _, loadoutFirst := range []bool{true, false} {
		g := New(Settings{Mode: mode.FFA, Size: 2, Difficulty: bot.Easy, Seed: 8})
		id := spawnHuman(t, g, "x", sim.F15)
		g.Step(nil)
		p0, _ := findPlane(g.Snapshot().Planes, id)
		loadout := func() {
			g.SetLoadout(id, sim.LoadRadar)
			cur, _ := findPlane(g.Snapshot().Planes, id)
			_ = g.Pick(id, cur.Kind)
			if p, _ := findPlane(g.Snapshot().Planes, id); p.Pos != cur.Pos || p.ProtectUntil != p0.ProtectUntil {
				t.Fatalf("loadout-only pick moved the plane or touched protection: %+v", p)
			}
		}
		if loadoutFirst {
			loadout()
			_ = g.Pick(id, sim.MiG29)
		} else {
			_ = g.Pick(id, sim.MiG29)
			loadout()
		}
		p, _ := findPlane(g.Snapshot().Planes, id)
		if p.Kind != sim.MiG29 || p.Loadout != sim.LoadRadar || p.Radars != 2 || p.Missiles != 0 || p.ProtectUntil != p0.ProtectUntil {
			t.Fatalf("loadout first %v: %v %v %d+%d protect %d", loadoutFirst, p.Kind, p.Loadout, p.Missiles, p.Radars, p.ProtectUntil)
		}
	}
}

// Bots fly their difficulty's loadout.
func TestBotLoadouts(t *testing.T) {
	for d, want := range map[bot.Difficulty]sim.Loadout{bot.Easy: sim.LoadIR, bot.Normal: sim.LoadMixed, bot.Hard: sim.LoadMixed} {
		g := New(Settings{Mode: mode.Team, Size: 4, Difficulty: d, Seed: 3})
		for _, p := range g.Snapshot().Planes {
			if p.Loadout != want {
				t.Fatalf("difficulty %v: bot %d flies %v, want %v", d, p.ID, p.Loadout, want)
			}
		}
	}
}
