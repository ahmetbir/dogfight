package sim

import (
	"testing"

	"playground/internal/geom"
)

func TestCannonHitsTargetAhead(t *testing.T) {
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F16)
	w.AddPlane(2, TeamSoviet, MiG29)
	w.clearProtection()
	w.setFlight(1, FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200)})
	w.setFlight(2, FlightState{Pos: geom.V(0, 2000, -300), Rot: geom.Identity(), Vel: geom.V(0, 0, -200)})
	hit := false
	for range 60 {
		for _, e := range w.Step(map[ID]Input{1: {Fire: true, Throttle: 1}, 2: {Throttle: 1}}) {
			hit = hit || (e.Kind == EvHit && e.Plane == 2 && e.Other == 1)
		}
	}
	if !hit {
		t.Fatal("expected a cannon hit on plane 2")
	}
}

func TestSweptHitAtHighSpeed(t *testing.T) {
	if !segmentHitsSphere(geom.V(0, 0, 0), geom.V(0, 0, -20), geom.V(0, 3, -10), HitRadius) {
		t.Fatal("segment passing 3 m from center must hit")
	}
	if segmentHitsSphere(geom.V(0, 0, 0), geom.V(0, 0, -20), geom.V(0, 30, -10), HitRadius) {
		t.Fatal("far miss reported as hit")
	}
}

func TestOverheat(t *testing.T) {
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F16)
	fires := 0
	for range 60 * 5 {
		for _, e := range w.Step(map[ID]Input{1: {Fire: true, Throttle: 1}}) {
			if e.Kind == EvFire {
				fires++
			}
		}
	}
	if fires >= 15*5 {
		t.Fatalf("gun never overheated: %d shots", fires)
	}
}

func TestNoFriendlyFireInTeams(t *testing.T) {
	if Hostile(TeamNATO, TeamNATO, false) || !Hostile(TeamNATO, TeamSoviet, false) || !Hostile(TeamNone, TeamNone, false) {
		t.Fatal("Hostile wrong")
	}
}

// With two hostiles inside one bullet segment, the nearer one takes the hit
// even when it has the higher ID.
func TestBulletHitsNearestPlane(t *testing.T) {
	w := newTestWorld()
	w.AddPlane(1, TeamNone, F16)
	w.AddPlane(2, TeamNone, MiG29) // farther along the path
	w.AddPlane(3, TeamNone, Su27)  // nearer
	w.clearProtection()
	for id, z := range map[ID]float64{1: 500, 2: -12, 3: -4} {
		w.setFlight(id, FlightState{Pos: geom.V(0, 2000, z), Rot: geom.Identity(), Vel: geom.V(0, 0, -1)})
	}
	w.bullets = append(w.bullets, Bullet{Owner: 1, Team: TeamNone, Pos: geom.V(0, 2000, 0), Vel: geom.V(0, 0, -900), ExpireTick: w.tick + 60, Dmg: BulletDmg, Weapon: WCannon})
	var hit []ID
	var evs []Event
	w.stepBullets(&evs)
	for _, e := range evs {
		if e.Kind == EvHit {
			hit = append(hit, e.Plane)
		}
	}
	if len(hit) != 1 || hit[0] != 3 {
		t.Fatalf("hits %v, want only the nearer plane 3", hit)
	}
}
