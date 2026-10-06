package sim

import (
	"math"
	"testing"

	"playground/internal/geom"
	"playground/internal/maps"
)

func TestBombFallsBallistically(t *testing.T) {
	w := baseWorld()
	w.AddPlane(1, TeamNATO, F16)
	w.clearProtection()
	b := w.cfg.Map.Bases[0]
	start := b.World(-900, 0) // 500 m over the flat runway; the bomb lands ~1250 m on
	start.Y = b.Center.Y + 500
	rot := YawPitch(maps.HeadingOf(b.Axis), 0)
	w.setFlight(1, FlightState{Pos: start, Rot: rot, Vel: b.Axis.Scale(150), Throttle: 1})
	evs := w.Step(map[ID]Input{1: {Bomb: true, Throttle: 1}})
	var drop *Event
	for _, e := range evs {
		if e.Kind == EvBombDrop {
			drop = &e
		}
	}
	if drop == nil || drop.By != 1 {
		t.Fatalf("drop event %+v", evs)
	}
	if p, _ := w.Plane(1); p.Bombs != 1 {
		t.Fatalf("bombs left %d", p.Bombs)
	}
	for tick := 1; tick < 12*60; tick++ {
		for _, e := range w.Step(nil) {
			if e.Kind == EvBombHit && e.Plane == drop.Plane {
				dt := float64(tick) / 60
				d := e.Pos.Sub(drop.Pos)
				if dt < 7.5 || dt > 9 || math.Abs(geom.V(d.X, 0, d.Z).Len()-150*dt) > 30 {
					t.Fatalf("impact after %.2f s at %v m", dt, geom.V(d.X, 0, d.Z).Len())
				}
				return
			}
		}
	}
	t.Fatal("no impact")
}

func TestBombDestroysTankAndHurtsPlanes(t *testing.T) {
	w := baseWorld()
	w.AddPlane(1, TeamNATO, F16)
	w.AddPlane(2, TeamSoviet, MiG29)
	w.clearProtection()
	tank := w.cfg.Map.Structures[8] // Soviet fuel A
	top := tank.Box.Min.Add(tank.Box.Max).Scale(0.5)
	top.Y = tank.Box.Max.Y + 5
	p2, _ := w.Plane(2)
	w.Edit(2, func(p *Plane) { p.Pos = top.Add(geom.V(0, -3, 25)); p.FlightState.Ground = false })
	w.bombs = append(w.bombs, &Bomb{ID: bombIDBase + 1, Owner: 1, Team: TeamNATO, Pos: top, Vel: geom.V(0, -50, 0), ExpireTick: w.tick + BombLife})
	var evs []Event
	for range 30 {
		evs = append(evs, w.Step(map[ID]Input{2: {Throttle: p2.Throttle}})...)
	}
	if !hasEvent(evs, EvStructDown, StructID(1, 2)) {
		t.Fatalf("direct hit must destroy the 250 HP tank: %+v", evs)
	}
	if p, _ := w.Plane(2); p.HP >= SpecOf(MiG29).MaxHP {
		t.Fatal("an enemy plane 25 m away must be hurt")
	}
}

func TestBombCountAndCooldown(t *testing.T) {
	w := baseWorld()
	w.AddPlane(1, TeamNATO, F16)
	w.clearProtection()
	drops := 0
	for range 120 {
		p, _ := w.Plane(1)
		w.setFlight(1, FlightState{Pos: geom.V(p.Pos.X, 1500, p.Pos.Z), Rot: geom.Identity(), Vel: geom.V(0, 0, -150), Throttle: 1})
		for _, e := range w.Step(map[ID]Input{1: {Bomb: true, Throttle: 1}}) {
			if e.Kind == EvBombDrop {
				drops++
			}
		}
	}
	if drops != 2 {
		t.Fatalf("2 bombs per sortie, dropped %d", drops)
	}
}

func TestRearmRefillsBombsOnly(t *testing.T) {
	w := baseWorld()
	w.AddPlane(1, TeamNATO, F16)
	w.planes[1].Bombs = 0 // empty racks are the only shortage
	var rearmed bool
	for range RearmTicks {
		rearmed = rearmed || hasEvent(w.Step(nil), EvRearm, 1)
	}
	if p, _ := w.Plane(1); !rearmed || p.Bombs != 2 {
		t.Fatalf("bombs must refill on a rearm: %+v", p)
	}
	w.planes[1].Bombs = 1
	for range RearmTicks - 2 { // one tick short of the next rearm
		w.Step(nil)
	}
	w.Step(map[ID]Input{1: {Bomb: true}}) // the drop restarts the count
	if p, _ := w.Plane(1); p.Bombs != 0 || p.RearmTicks != 0 {
		t.Fatalf("a drop must restart the rearm count: %+v", p)
	}
}

func TestNoBombsOutsideBaseAttack(t *testing.T) {
	w := runwayWorld(maps.Ada)
	w.AddPlane(1, TeamNATO, F16)
	for range 40 {
		if hasEvent(w.Step(map[ID]Input{1: {Bomb: true}}), EvBombDrop, bombIDBase+1) {
			t.Fatal("no bombs outside base attack")
		}
	}
}

func TestBombsGoWithOwnerAndRound(t *testing.T) {
	w := baseWorld()
	w.AddPlane(1, TeamNATO, F16)
	w.AddPlane(2, TeamNATO, F16)
	for _, id := range []ID{1, 2} {
		w.bombs = append(w.bombs, &Bomb{ID: bombIDBase + id, Owner: id, Team: TeamNATO, Pos: geom.V(0, 3000, 0), ExpireTick: w.tick + BombLife})
	}
	w.RemovePlane(1)
	if s := w.Snapshot().Bombs; len(s) != 1 || s[0].Owner != 2 {
		t.Fatalf("bombs after leave %+v", s)
	}
	w.ResetAll()
	if len(w.Snapshot().Bombs) != 0 {
		t.Fatal("a new round clears bombs")
	}
}
