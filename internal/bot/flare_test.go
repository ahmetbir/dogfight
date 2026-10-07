package bot

import (
	"testing"

	"playground/internal/geom"
	"playground/internal/sim"
	"playground/internal/terrain"
)

// A hard bot flares only inside FlareWarn, then once per botFlareGap for as
// long as the missile keeps tracking it.
func TestBrainFlaresInsideWarnRangeEverySecond(t *testing.T) {
	m := terrain.Generate(1)
	self := sim.Plane{ID: 1, Team: sim.TeamNATO, Kind: sim.F16, Alive: true, HP: 90, Missiles: 2, Flares: 8,
		FlightState: sim.FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200)}}
	missile := sim.Missile{ID: 1 << 24, Owner: 2, Target: 1, Vel: geom.V(0, 0, -400)}
	run := func(b *Brain, dist float64, from, ticks int) (drops int) {
		missile.Pos = geom.V(0, 2000, dist)
		for tick := from; tick < from+ticks; tick++ {
			snap := &sim.Snapshot{Tick: tick, Planes: []sim.Plane{self}, Missiles: []sim.Missile{missile}}
			if b.Think(snap, &Env{Terrain: m}).Flare {
				drops++
				self.Flares--
				self.FlareReadyTick = tick + 1 + sim.FlareCooldown // what the sim does
			}
		}
		return drops
	}
	b := New(1, Hard, 1)
	if n := run(b, sim.FlareWarn+100, 0, 120); n != 0 {
		t.Fatalf("%d flares with the missile beyond %v m", n, sim.FlareWarn)
	}
	if n := run(b, sim.FlareWarn-100, 120, 3*60); n < 2 || n > 3 {
		t.Fatalf("%d flares in 3 s inside %v m, want one per second", n, sim.FlareWarn)
	}
}
