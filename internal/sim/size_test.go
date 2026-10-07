package sim

import (
	"math"
	"testing"

	"playground/internal/geom"
	"playground/internal/maps"
	"playground/internal/terrain"
)

// Every kind carries its airframe; the spheres follow one rule.
func TestSizesDerivedFromAirframe(t *testing.T) {
	for _, k := range Kinds() {
		s := SpecOf(k)
		if !(s.Length > 5 && s.Span > 5 && s.Nose > s.Length/4 && s.Nose < s.Length) {
			t.Fatalf("%v: airframe %v × %v, nose %v: missing or implausible", k, s.Length, s.Span, s.Nose)
		}
		far := math.Max(math.Max(s.Nose, s.Length-s.Nose), s.Span/2)
		if s.HitRadius() != far || s.RamRadius() != 1.2*far || s.WallRadius() != min(s.Span/2, MaxWallRadius) || s.Muzzle() != s.Nose+MuzzleLead {
			t.Fatalf("%v: derived sizes off the rule: hit %v ram %v wall %v muzzle %v", k, s.HitRadius(), s.RamRadius(), s.WallRadius(), s.Muzzle())
		}
	}
	// The F-16 keeps about v1's spheres (hit 7, ram 9, wall 5, muzzle 8).
	f := SpecOf(F16)
	for _, c := range []struct {
		name      string
		got, want float64
	}{{"hit", f.HitRadius(), 7}, {"ram", f.RamRadius(), 9}, {"wall", f.WallRadius(), 5}, {"muzzle", f.Muzzle(), 8}} {
		if math.Abs(c.got-c.want) > 0.65 {
			t.Errorf("F-16 %s radius %v, v1 had %v", c.name, c.got, c.want)
		}
	}
}

// crossingHit fires one round across target's axis at along metres ahead of
// its origin (negative: behind) and reports whether it hit.
func crossingHit(t *testing.T, target Kind, along float64) bool {
	t.Helper()
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F16)
	w.AddPlane(2, TeamSoviet, target)
	w.clearProtection()
	w.setFlight(1, FlightState{Pos: geom.V(0, 2000, 3000), Rot: geom.Identity(), Vel: geom.V(0, 0, -200)})
	w.setFlight(2, FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, 0)})
	w.bullets = append(w.bullets, Bullet{Owner: 1, Team: TeamNATO, Pos: geom.V(-60, 2000, -along), Vel: geom.V(BulletSpeed, 0, 0),
		ExpireTick: w.tick + BulletLife, Dmg: BulletDmg, Weapon: WCannon})
	var ev []Event
	for range 10 {
		w.stepBullets(&ev)
	}
	for _, e := range ev {
		if e.Kind == EvHit && e.Plane == 2 {
			return true
		}
	}
	return false
}

// A round through a Su-27's nose or tail counts; v1's 7 m sphere missed both.
func TestSu27NoseAndTailHitsCount(t *testing.T) {
	for _, along := range []float64{10, -10} {
		if !crossingHit(t, Su27, along) {
			t.Errorf("round %v m along a Su-27 missed (hit radius %v)", along, SpecOf(Su27).HitRadius())
		}
		if crossingHit(t, F16, along) {
			t.Errorf("round %v m along an F-16 hit: past its %v m nose/tail", along, SpecOf(F16).Nose)
		}
	}
}

// Two closing planes ram inside the sum of their radii, not a fixed 18 m.
func TestRamReachFollowsBothKinds(t *testing.T) {
	ram := func(a, b Kind, gap float64) bool {
		w := newTestWorld()
		w.AddPlane(1, TeamNATO, a)
		w.AddPlane(2, TeamSoviet, b)
		w.clearProtection()
		w.setFlight(1, FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -100)})
		w.setFlight(2, FlightState{Pos: geom.V(0, 2000, -gap), Rot: geom.Identity(), Vel: geom.V(0, 0, 100)})
		var ev []Event
		w.hazards(&ev)
		for _, e := range ev {
			if e.Kind == EvHit && e.Weapon == WRam {
				return true
			}
		}
		return false
	}
	gap := SpecOf(Su27).RamRadius() + SpecOf(F16).RamRadius() - 0.5
	if !ram(Su27, F16, gap) {
		t.Fatalf("Su-27 and F-16 %v m apart did not ram", gap)
	}
	if ram(F16, F16, gap) {
		t.Fatalf("two F-16s %v m apart rammed (reach %v)", gap, 2*SpecOf(F16).RamRadius())
	}
}

// Every kind parks in every hangar and taxis out along the route without its
// wall sphere touching a wall, roof, building or solid target.
func TestWallRadiusFitsHangar(t *testing.T) {
	for _, mk := range []maps.Kind{maps.Ada, maps.Sehir, maps.Col, maps.Dag} {
		m := maps.Build(mk, 1)
		for _, k := range Kinds() {
			r := SpecOf(k).WallRadius()
			for side, b := range m.Bases {
				for i, h := range b.Hangars {
					up := geom.V(0, GearHeight, 0)
					path := append([]geom.Vec3{h.Spawn}, b.Waypoints(i)...)
					for j := 1; j < len(path); j++ {
						a, c := path[j-1].Add(up), path[j].Add(up)
						a.Y = m.Terrain.Ground(a.X, a.Z) + GearHeight
						c.Y = m.Terrain.Ground(c.X, c.Z) + GearHeight
						if _, _, hit := m.Solids.Sweep(a, c, r); hit {
							t.Fatalf("%v: %v (wall radius %v) hits a solid in base %d hangar %d, leg %d", mk, k, r, side, i, j)
						}
						g := geom.V(r, r, r)
						for _, s := range m.Structures {
							if s.Kind == maps.StructHangar {
								continue
							}
							if _, ok := maps.SegBox(a, c.Sub(a), s.Box.Min.Sub(g), s.Box.Max.Add(g)); ok {
								t.Fatalf("%v: %v (wall radius %v) hits a %v target from base %d hangar %d, leg %d", mk, k, r, s.Kind, side, i, j)
							}
						}
					}
				}
			}
		}
	}
}

// Teammates fly through each other (loose formations with the big jets'
// spheres); with friendly fire on, and between enemies or in FFA, they ram.
func TestTeammatesDoNotRam(t *testing.T) {
	ram := func(ta, tb Team, ff bool) bool {
		w := NewWorld(Config{Seed: 1, Terrain: terrain.Generate(1), FriendlyFire: ff})
		w.AddPlane(1, ta, Su30)
		w.AddPlane(2, tb, MiG31)
		w.clearProtection()
		w.setFlight(1, FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -100)})
		w.setFlight(2, FlightState{Pos: geom.V(0, 2000, -15), Rot: geom.Identity(), Vel: geom.V(0, 0, 100)})
		var ev []Event
		w.hazards(&ev)
		for _, e := range ev {
			if e.Weapon == WRam {
				return true
			}
		}
		return false
	}
	if ram(TeamSoviet, TeamSoviet, false) {
		t.Fatal("teammates rammed without friendly fire")
	}
	if !ram(TeamSoviet, TeamSoviet, true) || !ram(TeamNATO, TeamSoviet, false) || !ram(TeamNone, TeamNone, false) {
		t.Fatal("friendly fire, enemies and FFA must still ram")
	}
}
