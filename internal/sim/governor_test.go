package sim

import (
	"testing"

	"playground/internal/geom"
	"playground/internal/maps"
)

func TestFullThrottleTaxiHeldByGovernor(t *testing.T) {
	w := landingWorld(t)
	rot, ax := along(w)
	put(t, w, -500, 120, 0, geom.Vec3{}, rot, true, true) // parallel taxiway, heading along it
	for i := range 600 {
		for _, e := range w.Step(map[ID]Input{1: {Throttle: 1, AB: true, Gear: true}}) {
			if e.Kind == EvKill && e.Plane == 1 {
				t.Fatalf("tick %d: full throttle on the taxiway killed the plane", i)
			}
		}
		if p, _ := w.Plane(1); horizSpeed(p.Vel) > TaxiGovernor+1e-9 {
			t.Fatalf("tick %d: %.3f m/s above the taxi governor", i, horizSpeed(p.Vel))
		}
	}
	if p, _ := w.Plane(1); horizSpeed(p.Vel) < TaxiGovernor-0.5 || ax.Dot(p.Vel) <= 0 {
		t.Fatalf("plane should run along the taxiway at the governor: %v", p.Vel)
	}
}

func TestFastTurnOffStillCrashes(t *testing.T) {
	w := landingWorld(t)
	rot, ax := along(w)
	put(t, w, 0, 120, 0, ax.Scale(40), rot, true, true) // momentum from the runway onto the taxiway
	if !crashed(w, 30, Input{Throttle: 1, Gear: true}) {
		t.Fatal("40 m/s on the taxiway (momentum) must still crash")
	}
}

// Fix round 2 (found live): taxiing straight out of the hangar with full
// throttle and afterburner left the apron onto grass at the governor speed
// and died (28 m/s ≈ 101 km/h). Off the runway the governor caps all thrust
// at TaxiGovernor and the crash limit sits at 35 m/s, so on every map and
// base the plane rolls on alive and never faster than 28 m/s until it
// reaches the runway.
func TestAfterburnerTaxiOutOfHangarSurvives(t *testing.T) {
	for _, k := range []maps.Kind{maps.Ada, maps.Sehir, maps.Col, maps.Dag} {
		for _, team := range []Team{TeamNATO, TeamSoviet} {
			m := maps.Build(k, 1)
			w := NewWorld(Config{Seed: 1, Terrain: m.Terrain, Map: m, Start: StartRunway})
			w.AddPlane(1, team, F15)
			off := map[maps.Surface]bool{}
			for tick := 0; tick < 60*30; tick++ {
				for _, e := range w.Step(map[ID]Input{1: {Throttle: 1, AB: true, Gear: true}}) {
					if e.Kind == EvKill {
						t.Fatalf("%v %v: killed at tick %d (weapon %v)", k, team, tick, e.Weapon)
					}
				}
				p, _ := w.Plane(1)
				s := m.SurfaceAt(p.Pos.X, p.Pos.Z)
				if s == maps.SurfRunway {
					break
				}
				off[s] = true
				if v := horizSpeed(p.Vel); v > TaxiGovernor+1e-9 {
					t.Fatalf("%v %v: %.2f m/s on surface %v", k, team, v, s)
				}
			}
			if !off[maps.SurfTaxi] {
				t.Fatalf("%v %v: never taxied", k, team)
			}
		}
	}
}
