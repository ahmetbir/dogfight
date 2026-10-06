package sim

import (
	"math"
	"testing"

	"playground/internal/geom"
	"playground/internal/maps"
	"playground/internal/terrain"
)

// slopeWorld: water west of x = -1000, flat land at 50 m to x = 1000, then a
// slope rising east at slopeDeg.
func slopeWorld(slopeDeg float64) *World {
	raw := make([]float64, terrain.Res*terrain.Res)
	for zi := range terrain.Res {
		for xi := range terrain.Res {
			x, h := terrain.NodeCoord(xi), 50.0
			switch {
			case x < -1000:
				h = -20
			case x > 1000:
				h = 50 + (x-1000)*math.Tan(slopeDeg*math.Pi/180)
			}
			raw[zi*terrain.Res+xi] = h
		}
	}
	return NewWorld(Config{Seed: 1, Terrain: terrain.FromRaw(raw)})
}

func rollAt(w *World, x, z, speed float64) bool {
	w.AddPlane(1, TeamNATO, F16)
	w.clearProtection()
	g := w.cfg.Terrain.Ground(x, z)
	w.setFlight(1, FlightState{Pos: geom.V(x, g+GearHeight, z), Rot: YawPitch(math.Pi/2, 0), Vel: geom.V(0, 0, -speed),
		Gear: true, Ground: true})
	return crashed(w, 60, Input{Gear: true, Throttle: 0.2})
}

// FB-A 5: wheels survive dry ground up to GrassMaxSlope; steeper ground and
// water are crashes at any speed.
func TestRoughGroundSlopeAndWater(t *testing.T) {
	for _, c := range []struct {
		name    string
		slope   float64
		x       float64
		crashed bool
	}{
		{"flat", 20, 0, false},
		{"8° slope", 8, 1600, false},
		{"20° slope", 20, 1600, true},
		{"water", 8, -2000, true},
	} {
		if got := rollAt(slopeWorld(c.slope), c.x, 0, 15); got != c.crashed {
			t.Errorf("%s: crashed=%v, want %v", c.name, got, c.crashed)
		}
	}
}

// Grass rolls 4x heavier than pavement and bobs the nose gently (bounded
// by GrassBump) while the wheels' height stays smooth.
func TestGrassRollResistanceAndBumps(t *testing.T) {
	s := SpecOf(F16)
	grass := FlightMods{Ground: GroundSample{H: 50, Surf: maps.SurfNone}}
	paved := FlightMods{Ground: GroundSample{H: 50, Surf: maps.SurfRunway}}
	start := FlightState{Pos: geom.V(0, 50+GearHeight, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -30), Gear: true, Ground: true}
	g, p := start, start
	lo, hi := math.Inf(1), math.Inf(-1)
	for range 120 {
		g = StepFlight(g, Input{Gear: true}, s, grass)
		p = StepFlight(p, Input{Gear: true}, s, paved)
		_, pitch := headingPitch(g.Rot)
		lo, hi = math.Min(lo, pitch), math.Max(hi, pitch)
		if g.Pos.Y != 50+GearHeight || !g.Ground {
			t.Fatalf("wheels left the smooth ground: y %v ground %v", g.Pos.Y, g.Ground)
		}
	}
	// 2 s: the extra rolling resistance is (GrassRoll−1)·RollDecel·2 = 2.4 m/s.
	if extra := p.Vel.Len() - g.Vel.Len(); math.Abs(extra-(GrassRoll-1)*RollDecel*2) > 0.3 {
		t.Fatalf("grass lost %v m/s more than pavement", extra)
	}
	if hi-lo < 0.005 || lo < -GrassBump-1e-9 || hi > GrassBump+1e-9 {
		t.Fatalf("nose bob %v..%v rad", lo, hi)
	}
}
