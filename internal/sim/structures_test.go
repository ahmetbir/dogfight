package sim

import (
	"testing"

	"playground/internal/geom"
	"playground/internal/maps"
)

func baseWorld() *World {
	m := maps.Build(maps.Ada, 1)
	return NewWorld(Config{Seed: 1, Terrain: m.Terrain, Map: m, Start: StartRunway, Structures: true, Bombs: 2})
}

func TestStructuresInSnapshotAndTeam(t *testing.T) {
	w := baseWorld()
	s := w.Snapshot().Structures
	if len(s) != 12 || !s[0].Alive || s[0].HP != 400 || s[0].ID != StructID(0, 0) {
		t.Fatalf("structures %+v", s)
	}
	if tm, ok := StructTeam(StructID(1, 3)); !ok || tm != TeamSoviet {
		t.Fatal("StructTeam")
	}
	if _, ok := StructTeam(5); ok {
		t.Fatal("a plane ID is no structure")
	}
	if len(NewWorld(Config{Seed: 1, Terrain: w.cfg.Terrain, Map: w.cfg.Map}).Snapshot().Structures) != 0 {
		t.Fatal("no structures outside base attack")
	}
}

func TestCannonDamagesEnemyStructure(t *testing.T) {
	w := baseWorld()
	w.AddPlane(1, TeamNATO, F16)
	w.clearProtection()
	m := w.cfg.Map
	fuel := m.Structures[6+2] // Soviet fuel tank A
	b := m.Bases[1]
	c := fuel.Box.Min.Add(fuel.Box.Max).Scale(0.5)
	from := c.Sub(b.Axis.Scale(250))
	rot := YawPitch(maps.HeadingOf(b.Axis), 0)
	hits := 0
	for range 60 {
		w.setFlight(1, FlightState{Pos: from, Rot: rot, Vel: b.Axis.Scale(80), Throttle: 0.5})
		for _, e := range w.Step(map[ID]Input{1: {Fire: true, Throttle: 0.5}}) {
			if e.Kind == EvStructHit && e.Plane == StructID(1, 2) && e.Other == 1 && e.Value == BulletDmg*StructCannonMul {
				hits++
			}
		}
	}
	if hits == 0 {
		t.Fatal("cannon must chip the enemy fuel tank")
	}
	w.structs[8].HP = 1
	var down bool
	for range 30 {
		w.setFlight(1, FlightState{Pos: from, Rot: rot, Vel: b.Axis.Scale(80), Throttle: 0.5})
		down = down || hasEvent(w.Step(map[ID]Input{1: {Fire: true, Throttle: 0.5}}), EvStructDown, StructID(1, 2))
	}
	if !down || w.Snapshot().Structures[8].Alive {
		t.Fatal("tank must go down at 0 HP")
	}
	w.ResetAll()
	if s := w.Snapshot().Structures[8]; !s.Alive || s.HP != 250 {
		t.Fatal("a new round restores the targets")
	}
}

func TestDestroyedHangarClosesSlot(t *testing.T) {
	w := baseWorld()
	w.structs[0].HP, w.structs[0].Alive = 0, false // NATO hangar 0
	w.AddPlane(1, TeamNATO, F16)
	p, _ := w.Plane(1)
	h0 := w.cfg.Map.Bases[0].Hangars[0].Spawn
	if p.Pos.Sub(h0.Add(geom.V(0, GearHeight, 0))).Len() < 1 {
		t.Fatal("must not spawn in a destroyed hangar")
	}
}

func TestResetRepairsBeforeRespawn(t *testing.T) {
	w := baseWorld()
	w.structs[0].HP, w.structs[0].Alive = 0, false // NATO hangar 0 closed
	w.AddPlane(1, TeamNATO, F16)
	w.ResetAll()
	p, _ := w.Plane(1)
	h0 := w.cfg.Map.Bases[0].Hangars[0].Spawn.Add(geom.V(0, GearHeight, 0))
	if p.Pos.Dist(h0) > 1e-9 {
		t.Fatalf("a new round must reopen hangar 0 before respawning: %v", p.Pos)
	}
}

// fireAt flies plane 1 at from along dir with the trigger held for n ticks.
func fireAt(w *World, from, dir geom.Vec3, n int) []Event {
	var evs []Event
	for range n {
		w.setFlight(1, FlightState{Pos: from, Rot: YawPitch(maps.HeadingOf(dir), 0), Vel: dir.Scale(80), Throttle: 0.5})
		evs = append(evs, w.Step(map[ID]Input{1: {Fire: true, Throttle: 0.5}})...)
	}
	return evs
}

func TestCannonHitsHangarTargetThroughWall(t *testing.T) {
	w := baseWorld()
	w.AddPlane(1, TeamNATO, F16)
	w.clearProtection()
	h := w.cfg.Map.Structures[6] // Soviet hangar 0, struck on its side wall
	b := w.cfg.Map.Bases[1]
	c := h.Box.Min.Add(h.Box.Max).Scale(0.5)
	if !hasEvent(fireAt(w, c.Sub(b.Axis.Scale(200)), b.Axis, 30), EvStructHit, StructID(1, 0)) {
		t.Fatal("the hangar target must take rounds that strike its wall")
	}
}

func TestOwnStructuresTakeNoCannon(t *testing.T) {
	w := baseWorld()
	w.AddPlane(1, TeamNATO, F16)
	w.clearProtection()
	fuel := w.cfg.Map.Structures[2] // NATO fuel tank A
	b := w.cfg.Map.Bases[0]
	c := fuel.Box.Min.Add(fuel.Box.Max).Scale(0.5)
	for _, e := range fireAt(w, c.Sub(b.Axis.Scale(250)), b.Axis, 60) {
		if e.Kind == EvStructHit {
			t.Fatalf("own target hit: %+v", e)
		}
	}
}

func TestPlaneCrashesIntoTargetUntilDestroyed(t *testing.T) {
	for _, alive := range []bool{true, false} {
		w := baseWorld()
		w.AddPlane(1, TeamNATO, F16)
		w.clearProtection()
		w.structs[2].Alive = alive // NATO fuel tank A
		fuel := w.cfg.Map.Structures[2]
		b := w.cfg.Map.Bases[0]
		c := fuel.Box.Min.Add(fuel.Box.Max).Scale(0.5)
		w.Edit(1, func(p *Plane) {
			p.FlightState = FlightState{Pos: c.Sub(b.Axis.Scale(30)), Rot: YawPitch(maps.HeadingOf(b.Axis), 0), Vel: b.Axis.Scale(100), Throttle: 0.5}
		})
		var evs []Event
		for range 30 { // 15 m to the grown box at 100 m/s
			evs = append(evs, w.Step(nil)...)
		}
		crashed := false
		for _, e := range evs {
			crashed = crashed || (e.Kind == EvKill && e.Plane == 1 && e.Weapon == WCrash)
		}
		if crashed != alive {
			t.Fatalf("alive target %v: crashed %v", alive, crashed)
		}
	}
}

func TestMissileBurstsOnTargetWithoutDamage(t *testing.T) {
	w := baseWorld()
	w.AddPlane(1, TeamNATO, F16)
	fuel := w.cfg.Map.Structures[8] // Soviet fuel tank A
	b := w.cfg.Map.Bases[1]
	c := fuel.Box.Min.Add(fuel.Box.Max).Scale(0.5)
	w.addMissileForTest(1, 0, c.Sub(b.Axis.Scale(60)), b.Axis.Scale(400))
	var evs []Event
	for range 20 {
		evs = append(evs, w.Step(nil)...)
	}
	if !hasEvent(evs, EvMissileGone, w.nextMissile) || hasEvent(evs, EvStructHit, StructID(1, 2)) || w.structs[8].HP != fuel.MaxHP {
		t.Fatalf("missile must burst on the tank, harmlessly: %+v", evs)
	}
}

// An overkill hit reports only the HP it took, so the hits of a target sum
// to its MaxHP and the side's objective reaches 0 only with every target down.
func TestStructHitReportsHPTaken(t *testing.T) {
	w := baseWorld()
	w.structs[8].HP = 10
	var evs []Event
	w.damageStruct(8, 1, 260, WBomb, geom.Vec3{}, &evs)
	if len(evs) != 2 || evs[0].Kind != EvStructHit || evs[0].Value != 10 || evs[1].Kind != EvStructDown {
		t.Fatalf("%+v", evs)
	}
}
