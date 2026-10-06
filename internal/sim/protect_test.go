package sim

import (
	"testing"

	"playground/internal/geom"
	"playground/internal/maps"
)

// rampWorld puts plane 1 (still ground-protected from its hangar spawn)
// rolling along the NATO runway at u=0 and plane 2 touching down head-on
// 15 m ahead of it; both close at 90 m/s.
func rampWorld(t *testing.T, protect1 bool) *World {
	t.Helper()
	w := runwayWorld(maps.Ada)
	w.AddPlane(1, TeamNATO, F16)
	w.AddPlane(2, TeamSoviet, MiG29)
	b := w.cfg.Map.Bases[0]
	h := maps.HeadingOf(b.Axis)
	p1 := b.World(0, 0).Add(geom.V(0, GearHeight, 0))
	p2 := b.World(15, 0).Add(geom.V(0, GearHeight+0.01, 0))
	w.setFlight(1, FlightState{Pos: p1, Rot: YawPitch(h, 0), Vel: b.Axis.Scale(10), Gear: true, Ground: true})
	w.setFlight(2, FlightState{Pos: p2, Rot: YawPitch(h+3.141592653589793, 0), Vel: b.Axis.Scale(-80).Add(geom.V(0, -1, 0)), Gear: true})
	w.planes[2].ProtectUntil, w.planes[2].GroundProtect = 0, false
	if !protect1 {
		w.planes[1].ProtectUntil, w.planes[1].GroundProtect = 0, false
	}
	return w
}

func ramEvents(w *World, ticks int) (hits, kills int) {
	for range ticks {
		for _, e := range w.Step(map[ID]Input{1: {Gear: true}, 2: {Gear: true}}) {
			switch {
			case e.Kind == EvHit && e.Weapon == WRam:
				hits++
			case e.Kind == EvKill:
				kills++
			}
		}
	}
	return hits, kills
}

func TestProtectedPlaneNeitherRamsNorIsRammed(t *testing.T) {
	w := rampWorld(t, true)
	hits, kills := ramEvents(w, 20)
	a, _ := w.Plane(1)
	b, _ := w.Plane(2)
	if hits != 0 || kills != 0 || a.HP != SpecOf(F16).MaxHP || b.HP != SpecOf(MiG29).MaxHP || !a.Ground || !b.Ground {
		t.Fatalf("protected collision must harm nobody: hits %d kills %d, hp %v/%v", hits, kills, a.HP, b.HP)
	}
}

// I2 ruling: a pair with wheels on the ground never rams (no damage, no
// credit), protected or not.
func TestGroundPairNeverRams(t *testing.T) {
	w := rampWorld(t, false)
	hits, kills := ramEvents(w, 20)
	if hits != 0 || kills != 0 {
		t.Fatalf("ground collision must harm nobody: hits %d kills %d", hits, kills)
	}
}

func TestUnprotectedAirPairStillRams(t *testing.T) {
	w := rampWorld(t, false)
	b := w.cfg.Map.Bases[0]
	h := maps.HeadingOf(b.Axis)
	p1 := b.World(0, 0).Add(geom.V(0, 300, 0))
	w.setFlight(1, FlightState{Pos: p1, Rot: YawPitch(h, 0), Vel: b.Axis.Scale(100), Throttle: 0.5})
	w.setFlight(2, FlightState{Pos: p1.Add(b.Axis.Scale(15)), Rot: YawPitch(h+3.141592653589793, 0), Vel: b.Axis.Scale(-100), Throttle: 0.5})
	hits := 0
	for range 3 {
		for _, e := range w.Step(map[ID]Input{1: {Throttle: 0.5}, 2: {Throttle: 0.5}}) {
			if e.Kind == EvHit && e.Weapon == WRam {
				hits++
			}
		}
	}
	a, _ := w.Plane(1)
	c, _ := w.Plane(2)
	if hits < 2 || a.HP >= SpecOf(F16).MaxHP || c.HP >= SpecOf(MiG29).MaxHP {
		t.Fatalf("unprotected air ram must damage both: hits %d hp %v/%v", hits, a.HP, c.HP)
	}
}

func TestRunwaySwapOnlyOnGroundAtOwnBase(t *testing.T) {
	w := runwayWorld(maps.Ada)
	w.AddPlane(1, TeamNATO, F16)
	w.AddPlane(2, TeamNATO, F16)
	for range 30 {
		w.Step(nil)
	}
	if !w.CanSwap(1) {
		t.Fatal("parked in its hangar: swap allowed")
	}
	w.Reseat(1, F15)
	p, _ := w.Plane(1)
	if p.Kind != F15 || p.Life != 1 || !p.Ground || !p.GroundProtect || p.ProtectUntil != w.Tick()+LiftoffProtectTicks {
		t.Fatalf("swap must re-park with ground protection: %+v", p)
	}

	q, _ := w.Plane(2)
	w.setFlight(2, FlightState{Pos: geom.V(q.Pos.X, 1500, q.Pos.Z), Rot: q.Rot, Vel: q.Rot.Forward().Scale(200), Throttle: 1})
	w.Step(nil)
	if q, _ = w.Plane(2); w.Tick() >= q.ProtectUntil {
		t.Fatal("still inside the lift-off protection window")
	}
	if w.CanSwap(2) {
		t.Fatal("no swap after lift-off, even while protected")
	}
	b := w.cfg.Map.Bases[0]
	w.setFlight(2, FlightState{Pos: b.World(0, 0).Add(geom.V(0, GearHeight, 0)), Rot: q.Rot, Gear: true, Ground: true})
	if w.CanSwap(2) {
		t.Fatal("no swap after landing back either: the life has flown")
	}
}

func TestRunwaySwapNotAtEnemyBase(t *testing.T) {
	w := runwayWorld(maps.Ada)
	w.AddPlane(1, TeamNATO, F16)
	p, _ := w.Plane(1)
	b := w.cfg.Map.Bases[1]
	w.setFlight(1, FlightState{Pos: b.World(0, 0).Add(geom.V(0, GearHeight, 0)), Rot: p.Rot, Gear: true, Ground: true})
	if w.CanSwap(1) {
		t.Fatal("on the ground at the enemy base: no swap")
	}
}

// taxiOut rolls protected runway plane 1 from inside its base past the base
// edge on its wheels; it returns on the first tick outside.
func taxiOut(t *testing.T, w *World) {
	t.Helper()
	b := w.cfg.Map.Bases[0]
	h := maps.HeadingOf(b.Axis)
	w.setFlight(1, FlightState{Pos: b.World(980, 0).Add(geom.V(0, GearHeight, 0)), Rot: YawPitch(h, 0), Vel: b.Axis.Scale(15), Gear: true, Ground: true, Throttle: 0.2})
	for range 600 {
		w.Step(map[ID]Input{1: {Gear: true, Throttle: 0.2}, 2: {Gear: true}})
		p, _ := w.Plane(1)
		if !p.Alive || !p.Ground {
			t.Fatalf("taxi out must stay alive on the wheels: %+v", p)
		}
		if w.cfg.Map.BaseAt(p.Pos.X, p.Pos.Z) != 0 {
			return
		}
		if !w.protected(w.planes[1]) {
			t.Fatal("on the wheels inside its own base: still protected")
		}
	}
	t.Fatal("never left the base")
}

// I1 ruling: ground protection holds only on the wheels inside the plane's
// own base; rolling out of it ends protection at the boundary.
func TestGroundProtectionEndsOutsideOwnBase(t *testing.T) {
	newOut := func(t *testing.T) (*World, *Plane) {
		w := runwayWorld(maps.Ada)
		w.AddPlane(1, TeamNATO, F16)
		w.AddPlane(2, TeamSoviet, MiG29)
		w.Step(nil)
		if p := w.planes[1]; !p.GroundProtect || !w.protected(p) {
			t.Fatalf("parked runway spawn must start protected: %+v", *p)
		}
		taxiOut(t, w)
		p := w.planes[1]
		if p.GroundProtect || w.protected(p) || w.CanSwap(1) {
			t.Fatalf("outside its own base on the wheels: protection must end at the boundary: %+v", *p)
		}
		return w, p
	}
	hit := func(w *World, ticks int, weapon Weapon) bool {
		for range ticks {
			for _, e := range w.Step(map[ID]Input{1: {Gear: true}, 2: {Gear: true}}) {
				if e.Kind == EvHit && e.Plane == 1 && e.Weapon == weapon {
					return true
				}
			}
		}
		return false
	}

	t.Run("cannon", func(t *testing.T) {
		w, p := newOut(t)
		from := p.Pos.Add(geom.V(0, 20, 0))
		w.bullets = append(w.bullets, Bullet{Owner: 2, Team: TeamSoviet, Pos: from, Vel: p.Pos.Sub(from).Norm().Scale(BulletSpeed), ExpireTick: w.tick + BulletLife, Dmg: BulletDmg, Weapon: WCannon})
		if !hit(w, 10, WCannon) {
			t.Fatal("cannon must hit a ground plane outside its base")
		}
	})
	t.Run("missile", func(t *testing.T) {
		w, p := newOut(t)
		p.WheelsTicks = 0 // a missile already tracking it; locks on wheels stay barred (FB-A 8)
		w.addMissileForTest(2, 1, p.Pos.Add(geom.V(0, 40, 0)), geom.V(0, -300, 0))
		if !hit(w, 30, WMissile) {
			t.Fatal("missile must hit a ground plane outside its base")
		}
	})
	t.Run("bomb", func(t *testing.T) {
		w, p := newOut(t)
		w.nextBomb++
		w.bombs = append(w.bombs, &Bomb{ID: w.nextBomb, Owner: 2, Team: TeamSoviet, Pos: p.Pos.Add(geom.V(0, 3, 0)), ExpireTick: w.tick + 600})
		if !hit(w, 60, WBomb) {
			t.Fatal("bomb must hit a ground plane outside its base")
		}
	})
}

// A ground swap that finds no free hangar falls back to an air spawn with
// the air spawn's 2 s protection, not the 8 s lift-off window.
func TestSwapAirFallbackKeepsAirProtection(t *testing.T) {
	w := runwayWorld(maps.Ada)
	w.AddPlane(1, TeamNATO, F16)
	b := w.cfg.Map.Bases[0]
	q, _ := w.Plane(1)
	w.setFlight(1, FlightState{Pos: b.World(0, 0).Add(geom.V(0, GearHeight, 0)), Rot: q.Rot, Gear: true, Ground: true})
	w.Step(nil)
	for id := ID(2); id <= 7; id++ {
		w.AddPlane(id, TeamNATO, F16)
	}
	if !w.CanSwap(1) {
		t.Fatal("on the wheels at its own base: swap allowed")
	}
	w.Reseat(1, F15)
	p, _ := w.Plane(1)
	if p.Ground || p.Kind != F15 || p.ProtectUntil > w.Tick()+ProtectTicks {
		t.Fatalf("air fallback must keep at most %d ticks of protection: until %d at tick %d, ground %v", ProtectTicks, p.ProtectUntil, w.Tick(), p.Ground)
	}
}
