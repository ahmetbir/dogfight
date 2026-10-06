package sim

import (
	"testing"

	"playground/internal/geom"
	"playground/internal/maps"
)

func runwayWorld(k maps.Kind) *World {
	m := maps.Build(k, 1)
	return NewWorld(Config{Seed: 1, Terrain: m.Terrain, Map: m, Start: StartRunway})
}

func TestRunwaySpawnParksInHangars(t *testing.T) {
	w := runwayWorld(maps.Ada)
	w.AddPlane(1, TeamNATO, F16)
	w.AddPlane(2, TeamNATO, F15)
	w.AddPlane(3, TeamSoviet, MiG29)
	a, _ := w.Plane(1)
	b, _ := w.Plane(2)
	c, _ := w.Plane(3)
	for _, p := range []Plane{a, b, c} {
		if !p.Ground || !p.Gear || p.Vel.Len() != 0 || p.Throttle != 0 || !p.GroundProtect || !p.RunwayStart || p.Life != 1 {
			t.Fatalf("not parked: %+v", p)
		}
	}
	if a.Pos.Sub(b.Pos).Len() < 50 {
		t.Fatal("two NATO planes share a hangar")
	}
	m := w.cfg.Map
	if m.BaseAt(a.Pos.X, a.Pos.Z) != 0 || m.BaseAt(c.Pos.X, c.Pos.Z) != 1 {
		t.Fatal("wrong base")
	}
	for range 120 {
		w.Step(nil)
	}
	a2, _ := w.Plane(1)
	if !a2.Alive || a2.Pos != a.Pos || w.Tick() >= a2.ProtectUntil {
		t.Fatalf("parked plane must stay put and protected: %+v", a2)
	}
}

func TestLeftPlaneFreesHangar(t *testing.T) {
	w := runwayWorld(maps.Sehir)
	w.AddPlane(1, TeamNATO, F16)
	first, _ := w.Plane(1)
	w.AddPlane(2, TeamNATO, F16)
	w.RemovePlane(1)
	w.AddPlane(3, TeamNATO, F16)
	if p, _ := w.Plane(3); p.Pos != first.Pos {
		t.Fatalf("hangar 0 must be free again: %v vs %v", p.Pos, first.Pos)
	}
}

func TestAllHangarsTakenFallsBackToAir(t *testing.T) {
	w := runwayWorld(maps.Ada)
	for id := ID(1); id <= 7; id++ {
		w.AddPlane(id, TeamNATO, F16)
	}
	if p, _ := w.Plane(7); p.Ground || p.Pos.Y < 1500 {
		t.Fatalf("7th plane must spawn in the air: %+v", p.FlightState)
	}
}

func TestFFABaseByIDParity(t *testing.T) {
	w := runwayWorld(maps.Dag)
	w.AddPlane(1, TeamNone, F16)
	w.AddPlane(2, TeamNone, Su27)
	a, _ := w.Plane(1)
	b, _ := w.Plane(2)
	if w.cfg.Map.BaseAt(a.Pos.X, a.Pos.Z) != 1 || w.cfg.Map.BaseAt(b.Pos.X, b.Pos.Z) != 0 {
		t.Fatal("FFA: odd IDs at the Soviet base, even at NATO")
	}
}

func TestGroundProtectionEndsAfterLiftoff(t *testing.T) {
	w := runwayWorld(maps.Ada)
	w.AddPlane(1, TeamNATO, F16)
	p, _ := w.Plane(1)
	w.setFlight(1, FlightState{Pos: geom.V(p.Pos.X, 1500, p.Pos.Z), Rot: p.Rot, Vel: p.Rot.Forward().Scale(200), Throttle: 1})
	w.Step(nil)
	p, _ = w.Plane(1)
	if p.GroundProtect || p.ProtectUntil > w.Tick()+LiftoffProtectTicks {
		t.Fatalf("lift-off starts the 8 s countdown: %+v", p)
	}
	for range LiftoffProtectTicks + 1 {
		w.Step(nil)
	}
	if p, _ = w.Plane(1); w.Tick() < p.ProtectUntil {
		t.Fatal("protection must end 8 s after lift-off")
	}
}

func TestFiringOnGroundLimitsProtection(t *testing.T) {
	w := runwayWorld(maps.Ada)
	w.AddPlane(1, TeamNATO, F16)
	w.Step(map[ID]Input{1: {Fire: true, Gear: true}})
	p, _ := w.Plane(1)
	if p.GroundProtect || p.ProtectUntil > w.Tick()+FireProtectTicks {
		t.Fatalf("firing cuts protection to 2 s: %+v", p)
	}
}

func TestReseatKeepsLife(t *testing.T) {
	w := runwayWorld(maps.Ada)
	w.AddPlane(1, TeamNATO, F16)
	w.Reseat(1, F15)
	if p, _ := w.Plane(1); p.Life != 1 || p.Kind != F15 {
		t.Fatalf("reseat must keep the life: %+v", p)
	}
}

func TestTaxiOutOfEveryHangar(t *testing.T) {
	for _, k := range []maps.Kind{maps.Ada, maps.Sehir, maps.Col, maps.Dag} {
		w := runwayWorld(k)
		for id := ID(1); id <= 12; id++ {
			team := TeamNATO
			if id > 6 {
				team = TeamSoviet
			}
			w.AddPlane(id, team, F16)
		}
		start := map[ID]geom.Vec3{}
		in := map[ID]Input{}
		for id := ID(1); id <= 12; id++ {
			p, _ := w.Plane(id)
			start[id] = p.Pos
			in[id] = Input{Throttle: 0.1, Gear: true}
		}
		for range 600 {
			for _, e := range w.Step(in) {
				if e.Kind == EvKill {
					t.Fatalf("%v: plane %d died taxiing out of its hangar (weapon %d)", k, e.Plane, e.Weapon)
				}
			}
		}
		for id := ID(1); id <= 12; id++ {
			p, _ := w.Plane(id)
			if d := p.Pos.Sub(start[id]).Len(); !p.Ground || d < 30 || w.cfg.Map.SurfaceAt(p.Pos.X, p.Pos.Z) == maps.SurfNone {
				t.Fatalf("%v plane %d: ground %v moved %.1f m to %v", k, id, p.Ground, d, p.Pos)
			}
		}
	}
}
