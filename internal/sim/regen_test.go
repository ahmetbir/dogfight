package sim

import (
	"testing"

	"playground/internal/geom"
)

func TestLoadoutsV2(t *testing.T) {
	want := map[Kind][2]int{F16: {5, 8}, F15: {6, 8}, MiG29: {4, 10}, Su27: {5, 8}}
	for k, w := range want {
		if s := SpecOf(k); s.Missiles != w[0] || s.Flares != w[1] {
			t.Fatalf("%v: %d/%d, want %v", k, s.Missiles, s.Flares, w)
		}
	}
}

func TestRegenHelper(t *testing.T) {
	n, at := 2, 0
	regen(&n, 4, &at, 100, 1200)
	if n != 2 || at != 1300 {
		t.Fatalf("timer start: n=%d at=%d", n, at)
	}
	regen(&n, 4, &at, 1299, 1200)
	if n != 2 {
		t.Fatal("early increment")
	}
	regen(&n, 4, &at, 1300, 1200)
	if n != 3 || at != 2500 {
		t.Fatalf("first: n=%d at=%d", n, at)
	}
	regen(&n, 4, &at, 2500, 1200)
	if n != 4 || at != 0 {
		t.Fatalf("full: n=%d at=%d", n, at)
	}
	regen(&n, 4, &at, 2501, 1200)
	if n != 4 || at != 0 {
		t.Fatal("must stay full and idle")
	}
}

func TestRegenInWorld(t *testing.T) {
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F16)
	w.Step(nil) // tick 1
	w.planes[1].Missiles, w.planes[1].Flares = 0, 0
	for range MissileRegenTicks + 1 { // ticks 2..1202
		w.setFlight(1, FlightState{Pos: geom.V(0, 2500, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1})
		w.Step(nil)
	}
	p, _ := w.Plane(1)
	if p.Missiles != 1 || p.Flares != 2 {
		t.Fatalf("after 45 s: missiles %d flares %d, want 1 and 2", p.Missiles, p.Flares)
	}
}

// Spec §3.2: a missile pickup resets the regen timer, so a +1 scheduled
// before the pickup cannot land early on top of the +2 refill.
func TestMissilePickupResetsRegenTimer(t *testing.T) {
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F15)
	spot := w.powerups[0] // Missiles
	full := SpecOf(F15).Missiles
	p := w.planes[1]
	p.Missiles = 0
	p.MissileRegenAt = w.Tick() + 2 // due on the tick right after the pickup
	w.setFlight(1, FlightState{Pos: spot.Pos.Add(geom.V(0, 0, 10)), Rot: geom.Identity(), Vel: geom.V(0, 0, -200)})
	w.Step(map[ID]Input{1: {Throttle: 1}}) // pickup tick T
	pickup := w.Tick()
	if p.Missiles != missilesRefill || w.powerups[0].Active {
		t.Fatalf("pickup: missiles %d active %v", p.Missiles, w.powerups[0].Active)
	}
	w.setFlight(1, FlightState{Pos: geom.V(0, 2500, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1})
	w.Step(nil) // T+1: the stale +1 would land here
	if p.Missiles != missilesRefill || p.MissileRegenAt != pickup+1+MissileRegenTicks || missilesRefill >= missileRegenCap(full) {
		t.Fatalf("after pickup: missiles %d regenAt %d, want %d and %d", p.Missiles, p.MissileRegenAt, missilesRefill, pickup+1+MissileRegenTicks)
	}
}

func TestRespawnResetsRegenTimers(t *testing.T) {
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F16)
	w.clearProtection()
	p := w.planes[1]
	p.Missiles, p.Flares = 1, 1
	w.setFlight(1, FlightState{Pos: geom.V(0, 2500, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1})
	w.Step(nil)
	if p.MissileRegenAt == 0 || p.FlareRegenAt == 0 {
		t.Fatal("timers must be running below the loadout")
	}
	var evs []Event
	w.kill(p, 0, WCrash, &evs)
	for range RespawnTicks {
		w.Step(nil)
	}
	s := SpecOf(F16)
	if !p.Alive || p.Missiles != s.Missiles || p.Flares != s.Flares || p.MissileRegenAt != 0 || p.FlareRegenAt != 0 {
		t.Fatalf("respawn: alive %v missiles %d flares %d regenAt %d/%d", p.Alive, p.Missiles, p.Flares, p.MissileRegenAt, p.FlareRegenAt)
	}
}

// FB-A 6: in flight missiles regenerate only up to ceil(loadout/2); flares
// to the full loadout.
func TestMissileRegenStopsAtHalfLoadout(t *testing.T) {
	for _, k := range Kinds() {
		w := newTestWorld()
		w.AddPlane(1, TeamNATO, k)
		p := w.planes[1]
		p.Missiles, p.Flares = 0, 0
		for range 10 * MissileRegenTicks {
			w.setFlight(1, FlightState{Pos: geom.V(0, 2500, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1})
			w.Step(nil)
		}
		s := SpecOf(k)
		if want := (s.Missiles + 1) / 2; p.Missiles != want || p.Flares != s.Flares || p.MissileRegenAt != 0 {
			t.Fatalf("%v: missiles %d (want %d) flares %d/%d regenAt %d", k, p.Missiles, want, p.Flares, s.Flares, p.MissileRegenAt)
		}
	}
}
