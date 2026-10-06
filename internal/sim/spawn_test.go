package sim

import (
	"math"
	"testing"

	"playground/internal/geom"
	"playground/internal/maps"
)

// FB-A 9: in team modes the air spawns sit at opposite ends (~3.2 km from
// the center on each side) at 1500 m, spread laterally, noses toward the
// center; FFA spawns on the 3 km ring facing the center.
func TestAirSpawnsFaceEachOther(t *testing.T) {
	w := newTestWorld()
	zs := map[Team][]float64{}
	for i := range 40 {
		team := []Team{TeamNATO, TeamSoviet, TeamNone}[i%3]
		id := ID(i + 1)
		w.AddPlane(id, team, F16)
		p, _ := w.Plane(id)
		toCenter := geom.V(-p.Pos.X, 0, -p.Pos.Z).Norm()
		if p.Pos.Y < spawnAlt || p.Rot.Forward().Dot(toCenter) < 0.999 {
			t.Fatalf("%v plane at %v: alt or heading wrong (fwd %v)", team, p.Pos, p.Rot.Forward())
		}
		switch team {
		case TeamNATO:
			if p.Pos.X < -3400 || p.Pos.X > -3000 {
				t.Fatalf("NATO spawn x %v", p.Pos.X)
			}
		case TeamSoviet:
			if p.Pos.X < 3000 || p.Pos.X > 3400 {
				t.Fatalf("Soviet spawn x %v", p.Pos.X)
			}
		default:
			if r := math.Hypot(p.Pos.X, p.Pos.Z); math.Abs(r-ffaRadius) > 1e-6 {
				t.Fatalf("FFA spawn radius %v", r)
			}
		}
		if team != TeamNone {
			if math.Abs(p.Pos.Z) > teamSpawnDZ {
				t.Fatalf("lateral spread %v", p.Pos.Z)
			}
			zs[team] = append(zs[team], p.Pos.Z)
		}
	}
	for team, z := range zs {
		lo, hi := math.Inf(1), math.Inf(-1)
		for _, v := range z {
			lo, hi = math.Min(lo, v), math.Max(hi, v)
		}
		if hi-lo < 800 {
			t.Fatalf("%v spawns not spread laterally: %v..%v", team, lo, hi)
		}
	}
}

// Fix round 1: on every map (4 kinds × seeds 1-5) the straight path from
// each air spawn to the map center, at the spawn altitude, clears the
// terrain by at least 150 m (dag's ridges included).
func TestAirSpawnPathToCenterClearsTerrain(t *testing.T) {
	for _, k := range []maps.Kind{maps.Ada, maps.Sehir, maps.Col, maps.Dag} {
		for seed := int64(1); seed <= 5; seed++ {
			m := maps.Build(k, seed)
			w := NewWorld(Config{Seed: seed, Terrain: m.Terrain, Map: m, Start: StartAir})
			for i := range 30 {
				id := ID(i + 1)
				w.AddPlane(id, []Team{TeamNATO, TeamSoviet, TeamNone}[i%3], F16)
				p, _ := w.Plane(id)
				d := math.Hypot(p.Pos.X, p.Pos.Z)
				for s := 0.0; s <= d; s += 25 {
					x, z := p.Pos.X*(1-s/d), p.Pos.Z*(1-s/d)
					if g := m.Terrain.Ground(x, z); p.Pos.Y-g < 150 {
						t.Fatalf("%v seed %d: spawn %v (team %v) passes %.0f m over the ground at (%.0f, %.0f)",
							k, seed, p.Pos, p.Team, p.Pos.Y-g, x, z)
					}
				}
			}
		}
	}
}
