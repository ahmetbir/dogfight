package bot

import (
	"testing"

	"playground/internal/geom"
	"playground/internal/maps"
	"playground/internal/mode"
	"playground/internal/sim"
)

// takeoffWithParked lets bot 1 taxi out of its hangar and take off while
// plane 2 stands braked on the runway at u. It returns the seconds bot 1
// stood still waiting for the runway and when it got
// airborne (0: not within 150 s).
func takeoffWithParked(t *testing.T, u float64) (held, airborne float64) {
	t.Helper()
	m := maps.Build(maps.Ada, 1)
	w := sim.NewWorld(sim.Config{Seed: 1, Terrain: m.Terrain, Map: m, Start: sim.StartRunway})
	w.AddPlane(1, sim.TeamNATO, sim.F16)
	w.AddPlane(2, sim.TeamNATO, sim.F16)
	b := m.Bases[0]
	w.Edit(2, func(p *sim.Plane) {
		p.FlightState = sim.FlightState{Pos: b.World(u, 0).Add(geom.V(0, sim.GearHeight, 0)), Rot: sim.YawPitch(maps.HeadingOf(b.Axis), 0), Gear: true, Ground: true}
	})
	br := New(1, Normal, 1)
	env := &Env{Terrain: m.Terrain, Map: m, Mode: mode.Team}
	for tick := range 150 * 60 {
		snap := w.Snapshot()
		for _, e := range w.Step(map[sim.ID]sim.Input{1: br.Think(&snap, env), 2: {Gear: true, Brake: true}}) {
			if e.Kind == sim.EvKill || e.Kind == sim.EvHit {
				t.Fatalf("event %d on plane %d (%v)", e.Kind, e.Plane, e.Weapon)
			}
		}
		p, _ := w.Plane(1)
		if br.holdStart != 0 && p.Vel.Len() < 1 {
			held += 1.0 / 60
		}
		if !p.Ground {
			return held, float64(tick) / 60
		}
	}
	return held, 0
}

// Review: a plane standing at the far end, beyond any takeoff roll, does
// not hold the runway.
func TestParkedAtFarEndDoesNotBlock(t *testing.T) {
	held, up := takeoffWithParked(t, 880)
	if held > 0 || up == 0 || up > 60 {
		t.Fatalf("held %.1f s, airborne at %.1f s", held, up)
	}
}

// Review: a plane standing in the roll path holds the bot for at most
// holdTimeout; then it rolls past (no ram on wheels).
func TestParkedInRollPathHoldsAtMostTimeout(t *testing.T) {
	held, up := takeoffWithParked(t, -300)
	limit := float64(holdTimeout) / 60 // the wait includes braking to a stop
	if held < limit-5 || held > limit || up == 0 {
		t.Fatalf("held %.1f s (want %.0f-%.0f), airborne at %.1f s", held, limit-5, limit, up)
	}
}

// Review minor: the go-around cap is hard for the life; RTB does not
// re-latch (and reset it) the next tick, a new life clears it.
func TestGoAroundCapIsHard(t *testing.T) {
	m := maps.Build(maps.Ada, 1)
	env := &Env{Terrain: m.Terrain, Map: m, Mode: mode.Team}
	self := sim.Plane{ID: 1, Team: sim.TeamNATO, Kind: sim.F16, Alive: true, HP: 30, Life: 1,
		FlightState: sim.FlightState{Pos: geom.V(0, 1500, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -150)}}
	b := New(1, Normal, 1)
	b.Think(&sim.Snapshot{Planes: []sim.Plane{self}}, env)
	b.phase, b.goArounds = phAir, maxGoArounds+1 // just gave up
	b.Think(&sim.Snapshot{Tick: 1, Planes: []sim.Plane{self}}, env)
	if b.phase != phAir || b.goArounds != maxGoArounds+1 {
		t.Fatalf("re-latched after giving up: phase %d go-arounds %d", b.phase, b.goArounds)
	}
	self.Life = 2
	b.Think(&sim.Snapshot{Tick: 2, Planes: []sim.Plane{self}}, env)
	if b.phase != phRTB {
		t.Fatalf("a new life may return again: phase %d", b.phase)
	}
}

func TestExitRouteSkipsConnectorBehind(t *testing.T) {
	b := maps.Build(maps.Ada, 1).Bases[0]
	if r := exitRoute(b, 400); len(r) != 4 || r[0] != b.World(700, 0) {
		t.Fatalf("stopped before the connector: route %v", r)
	}
	if r := exitRoute(b, 850); len(r) != 3 || r[0] != b.World(700, 60) {
		t.Fatalf("stopped past the connector: route starts %v, want the taxiway", r[0])
	}
}
