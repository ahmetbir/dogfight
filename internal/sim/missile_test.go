package sim

import (
	"testing"

	"playground/internal/geom"
	"playground/internal/terrain"
)

func TestLockThenMissileKills(t *testing.T) {
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F15)
	w.AddPlane(2, TeamSoviet, MiG29)
	w.clearProtection()
	w.setFlight(1, FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -150)})
	w.setFlight(2, FlightState{Pos: geom.V(0, 2000, -700), Rot: geom.Identity(), Vel: geom.V(0, 0, -150)})
	var locked, missileHit bool
	for i := range 60 * 8 {
		in := map[ID]Input{1: {Throttle: 0.5, Missile: i > 70}, 2: {Throttle: 0.5}}
		for _, e := range w.Step(in) {
			locked = locked || (e.Kind == EvLock && e.Plane == 1 && e.Other == 2)
			missileHit = missileHit || (e.Kind == EvHit && e.Plane == 2 && e.Weapon == WMissile)
		}
	}
	if !locked || !missileHit {
		t.Fatalf("locked=%v missileHit=%v", locked, missileHit)
	}
}

func TestNoLockOutsideCone(t *testing.T) {
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F15)
	w.AddPlane(2, TeamSoviet, MiG29)
	w.setFlight(1, FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -150)})
	w.setFlight(2, FlightState{Pos: geom.V(400, 2000, -400), Rot: geom.Identity(), Vel: geom.V(0, 0, -150)}) // 45° off
	for range 120 {
		for _, e := range w.Step(map[ID]Input{1: {Throttle: 0.5}, 2: {Throttle: 0.5}}) {
			if e.Kind == EvLock {
				t.Fatal("locked outside cone")
			}
		}
	}
}

func TestFlaresDecoySome(t *testing.T) {
	decoyed := 0
	for seed := range int64(40) {
		w := NewWorld(Config{Seed: seed, Terrain: terrain.Generate(1)})
		w.AddPlane(2, TeamSoviet, MiG29)
		w.setFlight(2, FlightState{Pos: geom.V(0, 2000, -300), Rot: geom.Identity(), Vel: geom.V(0, 0, -150)})
		w.addMissileForTest(1, 2, geom.V(0, 2000, 0), geom.V(0, 0, -300))
		w.Step(map[ID]Input{2: {Flare: true, Throttle: 0.5}})
		if w.missiles[0].Target == 0 {
			decoyed++
		}
	}
	if decoyed < 15 || decoyed > 38 {
		t.Fatalf("decoyed %d/40, want ~65%%", decoyed)
	}
}

func TestLaunchOwnerAndLockRangeMul(t *testing.T) {
	w := NewWorld(Config{Seed: 1, Terrain: terrain.Generate(1), LockRangeMul: 0.6})
	w.AddPlane(1, TeamNATO, F16)
	w.AddPlane(2, TeamSoviet, MiG29)
	w.clearProtection()
	fly := func(dz float64) {
		w.setFlight(1, FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1})
		w.setFlight(2, FlightState{Pos: geom.V(0, 2000, dz), Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1})
	}
	for range 90 { // 700 m: inside 900, outside 900*0.6 = 540
		fly(-700)
		w.Step(nil)
	}
	if p, _ := w.Plane(1); p.Locked || p.LockTarget != 0 {
		t.Fatal("700 m must be beyond the scaled lock range")
	}
	var launch *Event
	for i := 0; i < 120 && launch == nil; i++ {
		fly(-450)
		for _, e := range w.Step(map[ID]Input{1: {Throttle: 1, Missile: true}}) {
			if e.Kind == EvMissileLaunch {
				launch = &e
			}
		}
	}
	if launch == nil || launch.By != 1 || launch.Other != 2 {
		t.Fatalf("launch event %+v", launch)
	}
}

// FB-A 8 ("yerdeyken füze yiyoz"): a plane on its wheels cannot be locked;
// the same plane just above the runway can.
func TestNoLockOnPlaneOnWheels(t *testing.T) {
	lockOn := func(ground bool) bool {
		w := landingWorld(t)
		w.AddPlane(2, TeamSoviet, Su27)
		w.clearProtection()
		rot, _ := along(w)
		h, vel := 0.0, geom.Vec3{}
		if !ground {
			h, vel = 30, rot.Forward().Scale(150)
		}
		from := w.cfg.Map.Bases[0].World(-700, 0).Add(geom.V(0, 150, 0))
		for range 120 {
			put(t, w, 0, 0, h, vel, rot, true, ground)
			aim := w.planes[1].Pos.Sub(from).Norm()
			w.setFlight(2, FlightState{Pos: from, Rot: geom.LookRotation(aim, geom.V(0, 1, 0)), Vel: aim.Scale(150), Throttle: 1})
			w.Step(map[ID]Input{1: {Gear: true, Brake: ground, Throttle: 1}, 2: {Throttle: 1}})
			if p, _ := w.Plane(2); p.Locked && p.LockTarget == 1 {
				return true
			}
		}
		return false
	}
	if lockOn(true) {
		t.Fatal("locked a plane on its wheels")
	}
	if !lockOn(false) {
		t.Fatal("control: the airborne plane must be lockable")
	}
}

// FB-A 8 with the fix-round ruling (touch-and-go exploit): a missile keeps
// a target that touches the wheels down briefly and lifts off again; one
// that stays on its wheels MissileGroundLoseTicks (1.5 s) is lost for good,
// and the missile flies on unguided.
func TestMissileLosesTargetAfterWheelsDown(t *testing.T) {
	w := landingWorld(t)
	w.AddPlane(2, TeamSoviet, Su27)
	w.clearProtection()
	rot, ax := along(w)
	ground := func() { put(t, w, 0, 0, 0, geom.Vec3{}, rot, true, true) }
	air := func() { put(t, w, 0, 0, 200, ax.Scale(150), rot, false, false) }
	step := func(set func(), n int) {
		for range n {
			set()
			w.Step(map[ID]Input{1: {Gear: true, Brake: true, Throttle: 0.5}})
		}
	}
	air()
	w.addMissileForTest(2, 1, w.planes[1].Pos.Add(geom.V(0, 2000, 0)).Sub(ax.Scale(1500)), geom.V(0, 0, 0))
	m := w.missiles[0]
	m.ExpireTick = w.Tick() + 100*60        // keep it alive for the whole test
	step(ground, MissileGroundLoseTicks-10) // touch ...
	step(air, 5)                            // ... and go
	step(ground, MissileGroundLoseTicks-10)
	if m.Target != 1 {
		t.Fatal("a brief touch-and-go must keep the track")
	}
	step(ground, 10)
	if m.Target != 0 || w.planes[1].WheelsTicks < MissileGroundLoseTicks {
		t.Fatalf("after %d ticks on the wheels the missile still tracks %d", w.planes[1].WheelsTicks, m.Target)
	}
	dir := m.Vel.Norm()
	step(air, 10) // lifting off again does not bring the track back
	if len(w.missiles) != 1 || w.missiles[0] != m {
		t.Fatal("the missile must still be flying (test geometry)")
	}
	if m.Target != 0 || m.Vel.Norm().Dot(dir) < 0.9999 {
		t.Fatal("a lost missile must stay unguided and fly straight")
	}
}
