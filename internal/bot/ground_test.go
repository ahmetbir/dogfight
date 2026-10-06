package bot

import (
	"math"
	"testing"

	"playground/internal/geom"
	"playground/internal/maps"
	"playground/internal/mode"
	"playground/internal/sim"
)

func TestHeadingErrSign(t *testing.T) {
	if e := headingErr(geom.V(0, 0, -1), geom.V(1, 0, 0)); math.Abs(e-math.Pi/2) > 1e-9 {
		t.Fatalf("target right: %v", e)
	}
	if e := headingErr(geom.V(0, 0, -1), geom.V(-1, 0, -1)); e >= 0 {
		t.Fatalf("target left: %v", e)
	}
}

// Spec §7: a taxiing bot more than 25 m off its leg brakes.
func TestTaxiBrakesOffTrack(t *testing.T) {
	b := &Brain{phase: phTaxi, route: []geom.Vec3{geom.V(0, 0, -500)}, from: geom.V(0, 0, 0)}
	on := sim.Plane{Alive: true, FlightState: sim.FlightState{Pos: geom.V(5, 2.5, -100), Rot: geom.Identity(), Vel: geom.V(0, 0, -12), Gear: true, Ground: true}}
	if in, _ := b.taxi(on, maps.Build(maps.Ada, 1).Bases[0]); in.Brake {
		t.Fatalf("on the leg at taxi speed: %+v", in)
	}
	off := on
	off.Pos.X = 30
	if in, _ := b.taxi(off, maps.Build(maps.Ada, 1).Bases[0]); !in.Brake || in.Throttle != 0 {
		t.Fatalf("30 m off the leg: %+v", in)
	}
}

func TestBotsTaxiAndTakeOff(t *testing.T) {
	for _, k := range []maps.Kind{maps.Ada, maps.Sehir, maps.Col, maps.Dag} {
		for seed := int64(1); seed <= 3; seed++ {
			m := maps.Build(k, seed)
			w := sim.NewWorld(sim.Config{Seed: seed, Terrain: m.Terrain, Map: m, Start: sim.StartRunway})
			w.AddPlane(1, sim.TeamNATO, sim.F16)
			w.AddPlane(2, sim.TeamSoviet, sim.MiG29)
			env := &Env{Terrain: m.Terrain, Map: m, Mode: mode.Team}
			brains := map[sim.ID]*Brain{1: New(1, Normal, seed), 2: New(2, Normal, seed+100)}
			up := map[sim.ID]bool{}
			for tick := 0; tick < 60*60 && len(up) < 2; tick++ {
				snap := w.Snapshot()
				in := map[sim.ID]sim.Input{}
				for id, b := range brains {
					in[id] = b.Think(&snap, env)
				}
				for _, e := range w.Step(in) {
					if e.Kind == sim.EvKill && !up[e.Plane] {
						t.Fatalf("%v seed %d: plane %d died on the way up (%v) in phase %d", k, seed, e.Plane, e.Weapon, brains[e.Plane].phase)
					}
				}
				for id := range brains {
					p, _ := w.Plane(id)
					if !p.Ground && p.Pos.Y-m.Terrain.Ground(p.Pos.X, p.Pos.Z) > 300 {
						up[id] = true
					}
				}
			}
			if len(up) < 2 {
				for id, b := range brains {
					p, _ := w.Plane(id)
					t.Logf("plane %d phase %d wp %d pos %v", id, b.phase, b.wp, p.Pos)
				}
				t.Fatalf("%v seed %d: airborne %v within 60 s", k, seed, up)
			}
		}
	}
}
