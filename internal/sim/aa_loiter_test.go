package sim_test

import (
	"math"
	"testing"

	"playground/internal/bot"
	"playground/internal/geom"
	"playground/internal/maps"
	"playground/internal/sim"
)

// loiterLoss flies one plane in a circle of radius r at agl around the
// enemy AA site of m for 20 s and returns the HP fraction the AA took, and
// false when the loiter is not possible within AA range or the plane hit
// the ground first (dag ridges: not the AA's work).
func loiterLoss(m *maps.Map, wind geom.Vec3, r, agl float64, seed int64) (float64, bool) {
	w := sim.NewWorld(sim.Config{Seed: seed, Terrain: m.Terrain, Map: m, Structures: true, Bombs: 2, Wind: wind})
	w.AddPlane(1, sim.TeamNATO, sim.F16)
	aa := m.Structures[6+5].Box // Soviet AA site
	c := aa.Min.Add(aa.Max).Scale(0.5)
	a0 := float64(seed) * 2.399 // golden-angle spread of start points
	h := c.Y + agl
	for i := range 72 { // clear the ridges around the circle (dag valleys)
		a := float64(i) * math.Pi / 36
		for _, rr := range []float64{r - 200, r, r + 200} {
			h = math.Max(h, m.Terrain.Ground(c.X+rr*math.Cos(a), c.Z+rr*math.Sin(a))+150)
		}
	}
	if math.Hypot(r, h-c.Y) > 1450 {
		return 0, false // not within AA range of the site
	}
	pos := geom.V(c.X+r*math.Cos(a0), h, c.Z+r*math.Sin(a0))
	tan := geom.V(-math.Sin(a0), 0, math.Cos(a0)) // counter-clockwise
	vel := tan.Scale(200)
	w.PlaceForTest(1, sim.FlightState{Pos: pos, Rot: sim.YawPitch(maps.HeadingOf(tan), 0), Vel: vel, Throttle: 0.7})
	w.UnprotectForTest()
	maxHP := sim.SpecOf(sim.F16).MaxHP
	dmg := 0.0
	for range 20 * 60 {
		s := w.Snapshot()
		p := s.Planes[0]
		if !p.Alive {
			if p.HP > 0 || dmg < maxHP {
				return 0, false
			}
			break
		}
		rad := geom.V(p.Pos.X-c.X, 0, p.Pos.Z-c.Z)
		d := rad.Len()
		rad = rad.Norm()
		t := geom.V(-rad.Z, 0, rad.X)
		dir := t.Add(rad.Scale((r - d) / 300)).Norm()
		dir.Y = math.Max(-0.3, math.Min(0.3, (h-p.Pos.Y)/200))
		pitch, roll, yaw := bot.Steer(p.Rot, p.W, dir)
		for _, e := range w.Step(map[sim.ID]sim.Input{1: {Pitch: pitch, Roll: roll, Yaw: yaw, Throttle: 0.7}}) {
			if e.Kind == sim.EvHit && e.Plane == 1 && e.Weapon == sim.WAA {
				dmg += e.Value
			}
		}
	}
	return math.Min(1, dmg/maxHP), true
}

// A plane loitering within 1.5 km of a live AA site for 20 s loses about
// 30-50 % of its HP on average (controller ruling, fix round 1).
func TestAALoiterThreat(t *testing.T) {
	sum, n, skipped := 0.0, 0, 0
	for _, k := range []maps.Kind{maps.Ada, maps.Sehir, maps.Col, maps.Dag} {
		m := maps.Build(k, 1)
		ms, mn := sum, n
		for _, wind := range []geom.Vec3{{}, geom.V(9, 0, -9)} {
			for _, r := range []float64{500, 900, 1200} {
				for _, agl := range []float64{300, 600} {
					for seed := int64(1); seed <= 3; seed++ {
						l, ok := loiterLoss(m, wind, r, agl, seed)
						if !ok {
							skipped++
							continue
						}
						sum += l
						n++
					}
				}
			}
		}
		if n > mn {
			t.Logf("%v: mean loss %.3f over %d", k, (sum-ms)/float64(n-mn), n-mn)
		}
	}
	mean := sum / float64(n)
	t.Logf("mean HP loss %.3f over %d loiters (%d skipped: out of range over the ridges or crashed)", mean, n, skipped)
	if mean < 0.3 || mean > 0.5 {
		t.Fatalf("mean HP loss %.3f, want 0.30-0.50", mean)
	}
}
