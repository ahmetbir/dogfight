package sim

import (
	"testing"

	"playground/internal/geom"
)

func TestPickupRepairs(t *testing.T) {
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F15)
	spot := w.powerups[1] // Repair
	w.planes[1].HP = 20
	w.setFlight(1, FlightState{Pos: spot.Pos.Add(geom.V(0, 0, 10)), Rot: geom.Identity(), Vel: geom.V(0, 0, -200)})
	evs := w.Step(map[ID]Input{1: {Throttle: 1}})
	p, _ := w.Plane(1)
	if !hasEvent(evs, EvPickup, 1) || p.HP != 70 {
		t.Fatalf("hp=%v events=%+v", p.HP, evs)
	}
	if w.powerups[1].Active {
		t.Fatal("picked powerup must deactivate")
	}
}

// Ruling C2: a terrain crash kills even through spawn protection.
func TestCrashIgnoresProtection(t *testing.T) {
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F16)
	w.setFlight(1, FlightState{Pos: geom.V(4500, 1, 4500), Rot: geom.AxisAngle(geom.V(1, 0, 0), -0.5), Vel: geom.V(0, -50, -200)})
	if !hasEvent(w.Step(nil), EvKill, 1) {
		t.Fatal("crash must kill a protected plane")
	}
}

func TestPowerupRespawnsAfter20s(t *testing.T) {
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F15)
	spot := w.powerups[0] // Missiles
	// the refill lands one below the loadout
	w.planes[1].Missiles = SpecOf(F15).Missiles - 1 - missilesRefill
	w.setFlight(1, FlightState{Pos: spot.Pos.Add(geom.V(0, 0, 10)), Rot: geom.Identity(), Vel: geom.V(0, 0, -200)})
	w.Step(map[ID]Input{1: {Throttle: 1}})
	if p, _ := w.Plane(1); p.Missiles != SpecOf(F15).Missiles-1 || w.powerups[0].Active {
		t.Fatalf("missiles=%d active=%v", p.Missiles, w.powerups[0].Active)
	}
	for range 1200 {
		w.Step(nil)
	}
	if !w.powerups[0].Active {
		t.Fatal("powerup must respawn after 1200 ticks")
	}
}

func TestTurboGunDoesNotHeat(t *testing.T) {
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F16)
	w.planes[1].TurboUntil = w.Tick() + turboTicks
	for range 120 {
		w.Step(map[ID]Input{1: {Fire: true, Throttle: 1}})
	}
	if p, _ := w.Plane(1); p.Heat != 0 {
		t.Fatalf("heat %v under turbo", p.Heat)
	}
}

// FB-A 7: the shield never spawns; its slots went to the other kinds.
func TestPowerupRotationHasNoShield(t *testing.T) {
	w := newTestWorld()
	n := map[PowerupKind]int{}
	for _, u := range w.powerups {
		n[u.Kind]++
	}
	if n[PUShield] != 0 || n[PUMissiles] != 3 || n[PURepair] != 3 || n[PUTurbo] != 2 {
		t.Fatalf("rotation %v", n)
	}
}
