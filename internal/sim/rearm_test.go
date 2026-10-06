package sim

import (
	"testing"

	"playground/internal/geom"
	"playground/internal/maps"
)

func drain(w *World, id ID) {
	p := w.planes[id]
	p.HP, p.Missiles, p.Flares = 10, 0, 0
}

// parkAt moves plane id onto hangar 0 of side, on its wheels and stopped.
func parkAt(w *World, id ID, side int) {
	pos := w.cfg.Map.Bases[side].Hangars[0].Spawn
	pos.Y += GearHeight
	fs := w.planes[id].FlightState
	fs.Pos = pos
	w.setFlight(id, fs)
}

func TestRearmAfterThreeSeconds(t *testing.T) {
	w := runwayWorld(maps.Ada)
	w.AddPlane(1, TeamNATO, F16)
	drain(w, 1)
	for range RearmTicks - 1 {
		if hasEvent(w.Step(nil), EvRearm, 1) {
			t.Fatal("too early")
		}
	}
	if !hasEvent(w.Step(nil), EvRearm, 1) {
		t.Fatal("rearm after 3 s parked at the own base")
	}
	p, _ := w.Plane(1)
	s := SpecOf(F16)
	if p.HP != s.MaxHP || p.Missiles != s.Missiles || p.Flares != s.Flares || p.RearmTicks != 0 {
		t.Fatalf("not refilled: %+v", p)
	}
	for range 2 * RearmTicks {
		if hasEvent(w.Step(nil), EvRearm, 1) {
			t.Fatal("a full plane must not rearm again")
		}
	}
}

func TestNoRearmAtEnemyBase(t *testing.T) {
	w := runwayWorld(maps.Ada)
	w.AddPlane(1, TeamNATO, F16)
	parkAt(w, 1, 1) // Soviet base
	drain(w, 1)
	for range RearmTicks + 10 {
		if hasEvent(w.Step(nil), EvRearm, 1) {
			t.Fatal("team mode: no rearm at the enemy base")
		}
	}
	if p, _ := w.Plane(1); !p.Alive || !p.Ground || p.RearmTicks != 0 {
		t.Fatalf("must sit parked at the enemy base without counting: %+v", p)
	}
}

// TestFFARearmsAtAnyBase parks the same even-ID FFA plane at its parity base
// (NATO) and then at the other one (Soviet): both rearm.
func TestFFARearmsAtAnyBase(t *testing.T) {
	for _, side := range []int{0, 1} {
		w := runwayWorld(maps.Ada)
		w.AddPlane(2, TeamNone, F16) // even ID: parked at the NATO base
		parkAt(w, 2, side)
		if got := w.cfg.Map.BaseAt(w.planes[2].Pos.X, w.planes[2].Pos.Z); got != side {
			t.Fatalf("parked at base %d, want %d", got, side)
		}
		drain(w, 2)
		found := false
		for range RearmTicks + 1 {
			found = found || hasEvent(w.Step(nil), EvRearm, 2)
		}
		if !found {
			t.Fatalf("FFA rearms at any base (side %d)", side)
		}
	}
}

// firstRearm steps until plane id rearms and returns that tick (0 if not
// within limit). in is applied on tick shotAt only; hold, when set, runs
// before every step.
func firstRearm(w *World, id ID, in Input, shotAt, limit int, hold func()) (tick int, shot bool) {
	for range limit {
		if hold != nil {
			hold()
		}
		var inputs map[ID]Input
		if w.tick+1 == shotAt {
			inputs = map[ID]Input{id: in}
		}
		evs := w.Step(inputs)
		for _, e := range evs {
			switch {
			case e.Kind == EvFire && e.Plane == id, e.Kind == EvFlare && e.Plane == id, e.Kind == EvMissileLaunch && e.By == id:
				shot = true
			}
		}
		if hasEvent(evs, EvRearm, id) {
			return w.tick, shot
		}
	}
	return 0, shot
}

// TestShotsRestartRearm: a parked plane that fires is not a self-reloading
// gun position; any shot restarts the 3 s count.
func TestShotsRestartRearm(t *testing.T) {
	const shotAt = RearmTicks - 10
	for _, tc := range []struct {
		name string
		in   Input
	}{
		{"cannon", Input{Fire: true}},
		{"missile", Input{Missile: true}},
		{"flare", Input{Flare: true}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := runwayWorld(maps.Ada)
			w.AddPlane(1, TeamNATO, F16)
			w.AddPlane(3, TeamSoviet, MiG29)
			p := w.planes[1]
			p.HP = 10 // missiles and flares stay loaded so every weapon can fire
			fwd := p.Rot.Forward()
			ahead := p.Pos.Add(fwd.Scale(500)).Add(geom.V(0, 50, 0))
			hold := func() { // a target in the lock cone for the missile case
				w.setFlight(3, FlightState{Pos: ahead, Rot: p.Rot, Vel: fwd.Scale(150), Throttle: 0.5})
			}
			in := tc.in
			in.Gear = true
			tick, shot := firstRearm(w, 1, in, shotAt, 2*RearmTicks, hold)
			if !shot {
				t.Fatal("no shot: vacuous")
			}
			if tick != shotAt+RearmTicks {
				t.Fatalf("rearm at tick %d, want %d (count restarts at the shot)", tick, shotAt+RearmTicks)
			}
		})
	}
}

func TestRearmCountBreaks(t *testing.T) {
	setup := func() (*World, *Plane) {
		w := runwayWorld(maps.Ada)
		w.AddPlane(1, TeamNATO, F16)
		drain(w, 1)
		for range 100 {
			w.Step(nil)
		}
		p := w.planes[1]
		if p.RearmTicks != 100 {
			t.Fatalf("counting: %d", p.RearmTicks)
		}
		return w, p
	}
	t.Run("rolling at 3 m/s or more", func(t *testing.T) {
		w, p := setup()
		fs := p.FlightState
		fs.Vel = p.Rot.Forward().Scale(5)
		w.setFlight(1, fs)
		w.Step(nil)
		if !p.Ground || p.RearmTicks != 0 {
			t.Fatalf("still counting while rolling: %+v", p)
		}
	})
	t.Run("leaving the ground", func(t *testing.T) {
		w, p := setup()
		w.setFlight(1, FlightState{Pos: p.Pos.Add(geom.V(0, 300, 0)), Rot: p.Rot, Vel: p.Rot.Forward().Scale(200), Throttle: 1})
		w.Step(nil)
		if p.Ground || !p.Alive || p.RearmTicks != 0 {
			t.Fatalf("still counting in the air: %+v", p)
		}
	})
	t.Run("off the base bounds", func(t *testing.T) {
		w, p := setup()
		p.Pos = geom.V(0, p.Pos.Y, 0) // map center: no base (direct call, a live plane cannot taxi there)
		if w.cfg.Map.BaseAt(p.Pos.X, p.Pos.Z) != -1 {
			t.Fatal("center is on a base")
		}
		var evs []Event
		w.rearm(p, &evs)
		if p.RearmTicks != 0 || len(evs) != 0 {
			t.Fatalf("counting off base: %d", p.RearmTicks)
		}
	})
	t.Run("death", func(t *testing.T) {
		w, p := setup()
		var evs []Event
		w.kill(p, 0, WCrash, &evs)
		if p.RearmTicks != 0 {
			t.Fatalf("dead plane keeps its count: %d", p.RearmTicks)
		}
	})
}

// TestHeatOnlyRearm: a full plane with a hot gun still rearms (heat lasts
// longer than the count) and comes out cold.
func TestHeatOnlyRearm(t *testing.T) {
	w := runwayWorld(maps.Ada)
	w.AddPlane(1, TeamNATO, F16)
	p := w.planes[1]
	p.Heat, p.OverheatUntil = 1, OverheatTicks
	tick, _ := firstRearm(w, 1, Input{}, -1, 2*RearmTicks, nil)
	if tick != RearmTicks || p.Heat != 0 || p.OverheatUntil != 0 {
		t.Fatalf("heat-only rearm at %d: heat %v until %d", tick, p.Heat, p.OverheatUntil)
	}
}
