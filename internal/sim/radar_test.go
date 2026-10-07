package sim

import (
	"math"
	"testing"

	"playground/internal/geom"
	"playground/internal/terrain"
)

// Missile options ruling: IR = the aircraft's missiles, radar = max(1,
// ⌊n/2⌋), mixed = ⌊n/2⌋ IR + 1 radar; a spawn takes the next loadout.
func TestLoadoutCountsPerKind(t *testing.T) {
	want := map[Kind][3][2]int{
		F16:   {{5, 0}, {0, 2}, {2, 1}},
		F15:   {{6, 0}, {0, 3}, {3, 1}},
		MiG29: {{4, 0}, {0, 2}, {2, 1}},
		Su27:  {{5, 0}, {0, 2}, {2, 1}},
	}
	for k, rows := range want {
		for lo, c := range rows {
			if ir, rd := LoadoutCounts(k, Loadout(lo)); ir != c[0] || rd != c[1] {
				t.Errorf("%v %v: %d IR + %d radar, want %v", k, Loadout(lo), ir, rd, c)
			}
			w := newTestWorld()
			w.AddPlaneLoadout(1, TeamNATO, k, Loadout(lo))
			if p, _ := w.Plane(1); p.Missiles != c[0] || p.Radars != c[1] || p.Loadout != Loadout(lo) {
				t.Errorf("%v %v spawned with %d IR + %d radar (%v)", k, Loadout(lo), p.Missiles, p.Radars, p.Loadout)
			}
		}
	}
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F15)
	w.SetLoadout(1, LoadMixed)
	if p, _ := w.Plane(1); p.Loadout != LoadIR || p.Missiles != 6 {
		t.Fatal("SetLoadout must wait for the next spawn")
	}
	w.Reseat(1, F15)
	if p, _ := w.Plane(1); p.Loadout != LoadMixed || p.Missiles != 3 || p.Radars != 1 {
		t.Fatalf("reseat: %v %d+%d", p.Loadout, p.Missiles, p.Radars)
	}
	for _, s := range []string{"ir", "radar", "mixed"} {
		if l, ok := ParseLoadout(s); !ok || l.String() != s {
			t.Fatalf("parse %q", s)
		}
	}
	if _, ok := ParseLoadout("nuke"); ok {
		t.Fatal("unknown loadout parsed")
	}
}

// duelWorld puts shooter 1 (F-15, lo) at the origin nose -Z and target 2 dz
// ahead, both flying -Z; hold re-places them every tick.
func duelWorld(lo Loadout, dz float64) (w *World, hold func()) {
	w = newTestWorld()
	w.AddPlaneLoadout(1, TeamNATO, F15, lo)
	w.AddPlane(2, TeamSoviet, MiG29)
	w.clearProtection()
	hold = func() {
		w.setFlight(1, FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1})
		w.setFlight(2, FlightState{Pos: geom.V(0, 2000, dz), Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1})
	}
	return w, hold
}

// Radar: lock range ×2.2 and 2 s lock time; IR cannot lock that far.
func TestRadarLockRangeAndTime(t *testing.T) {
	far := -SpecOf(F15).LockRange * 2 // beyond IR, inside radar
	w, hold := duelWorld(LoadRadar, far)
	locked := -1
	for i := range 3 * 60 {
		hold()
		for _, e := range w.Step(nil) {
			if e.Kind == EvLock && e.Plane == 1 && locked < 0 {
				locked = i + 1
				if e.Missile != MissileRadar {
					t.Fatal("lock event must carry the radar kind")
				}
			}
		}
	}
	// The candidate is seen on tick 1 with LockTime 0, so the lock lands
	// RadarLockSeconds of ticks later.
	if want := int(math.Round(RadarLockSeconds/Dt)) + 1; locked != want {
		t.Fatalf("radar lock on tick %d, want %d", locked, want)
	}
	if p, _ := w.Plane(1); !p.Locked || p.LockKind != MissileRadar {
		t.Fatalf("locked %v kind %v", p.Locked, p.LockKind)
	}
	w, hold = duelWorld(LoadIR, far)
	for range 3 * 60 {
		hold()
		w.Step(nil)
	}
	if p, _ := w.Plane(1); p.Locked || p.LockTarget != 0 {
		t.Fatal("IR must not lock beyond its range")
	}
}

// launchIn holds the duel until plane 1 launches and returns the launch.
func launchIn(t *testing.T, w *World, hold func()) Event {
	t.Helper()
	for range 4 * 60 {
		hold()
		for _, e := range w.Step(map[ID]Input{1: {Throttle: 1, Missile: true}}) {
			if e.Kind == EvMissileLaunch {
				return e
			}
		}
	}
	t.Fatal("no launch")
	return Event{}
}

// Karışık: the missile key fires radar when the lock is beyond IR range,
// otherwise IR; with the IR missiles gone a close lock fires radar, but
// never inside RadarMinRange.
func TestMixedSelection(t *testing.T) {
	irRange := SpecOf(F15).LockRange
	cases := []struct {
		name    string
		dz      float64
		noIR    bool
		kind    MissileKind
		ir, rad int
	}{
		{"far", -irRange * 1.8, false, MissileRadar, 3, 0},
		{"close", -irRange * 0.6, false, MissileIR, 2, 1},
		{"close, IR empty", -(RadarMinRange + 40), true, MissileRadar, 0, 0},
	}
	for _, c := range cases {
		w, hold := duelWorld(LoadMixed, c.dz)
		if c.noIR {
			w.planes[1].Missiles = 0
		}
		e := launchIn(t, w, hold)
		p, _ := w.Plane(1)
		if e.Missile != c.kind || w.missiles[0].Kind != c.kind || p.Missiles != c.ir || p.Radars != c.rad {
			t.Errorf("%s: fired %v (missile %v), left %d IR + %d radar", c.name, e.Missile, w.missiles[0].Kind, p.Missiles, p.Radars)
		}
	}
}

// A picked kind fires that kind while it lasts and the other one after,
// and locks only at its own range: picked IR does not lock beyond IR range.
func TestPickedKind(t *testing.T) {
	const noFire = MissileKind(255)
	irRange := SpecOf(F15).LockRange
	cases := []struct {
		name        string
		pick        MissilePick
		dz          float64
		noIR, noRad bool
		kind        MissileKind // fired; noFire: no lock at all
	}{
		{"IR close", PickIR, -irRange * 0.6, false, false, MissileIR},
		{"IR far", PickIR, -irRange * 1.8, false, false, noFire},
		{"radar close", PickRadar, -(RadarMinRange + 40), false, false, MissileRadar},
		{"radar inside its minimum range: IR", PickRadar, -irRange * 0.6, false, false, MissileIR},
		{"radar inside its minimum range, IR empty: no lock", PickRadar, -irRange * 0.6, true, false, noFire},
		{"auto inside the minimum range, IR empty: no lock", PickAuto, -irRange * 0.6, true, false, noFire},
		{"radar close, radar empty", PickRadar, -irRange * 0.6, false, true, MissileIR},
		{"IR far, IR empty", PickIR, -irRange * 1.8, true, false, MissileRadar},
	}
	for _, c := range cases {
		w, hold := duelWorld(LoadMixed, c.dz)
		if c.noIR {
			w.planes[1].Missiles = 0
		}
		if c.noRad {
			w.planes[1].Radars = 0
		}
		fired := noFire
		for i := 0; i < 4*60 && fired == noFire; i++ {
			hold()
			for _, e := range w.Step(map[ID]Input{1: {Throttle: 1, Missile: true, Pick: c.pick}}) {
				if e.Kind == EvMissileLaunch {
					fired = e.Missile
				}
			}
		}
		if fired != c.kind {
			t.Errorf("%s: fired %v, want %v", c.name, fired, c.kind)
		}
	}
	if (Input{Pick: 7}).Clamp().Pick != PickAuto {
		t.Fatal("an unknown pick must fall back to auto")
	}
}

// radarChase puts a radar missile of plane 1 behind plane 2 and steps n
// ticks; set places the planes before each tick.
func radarChase(kind MissileKind, set func(w *World)) (w *World, m *Missile) {
	w = newTestWorld()
	w.AddPlaneLoadout(1, TeamNATO, F15, LoadRadar)
	w.AddPlane(2, TeamSoviet, MiG29)
	w.clearProtection()
	set(w)
	w.addMissileForTest(1, 2, geom.V(0, 2000, -400), geom.V(0, 0, -300))
	m = w.missiles[0]
	m.Kind = kind
	return w, m
}

// Semi-active: the launcher must keep the target within 60° of its nose.
func TestSemiActiveLostOutsideLeash(t *testing.T) {
	for _, c := range []struct {
		deg  float64
		kept bool
	}{{50, true}, {70, false}} {
		set := func(w *World) {
			w.setFlight(1, FlightState{Pos: geom.V(0, 2000, 0), Rot: YawPitch(c.deg*math.Pi/180, 0), Vel: geom.V(0, 0, -200), Throttle: 1})
			w.setFlight(2, FlightState{Pos: geom.V(0, 2000, -2000), Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1})
		}
		w, m := radarChase(MissileRadar, set)
		for range 5 {
			set(w)
			w.Step(nil)
		}
		if (m.Target == 2) != c.kept {
			t.Errorf("target %v° off the launcher's nose: tracking %v, want %v", c.deg, m.Target == 2, c.kept)
		}
	}
	// The launcher dying ends the guidance too.
	set := func(w *World) {
		w.setFlight(2, FlightState{Pos: geom.V(0, 2000, -2000), Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1})
	}
	w, m := radarChase(MissileRadar, func(w *World) {
		set(w)
		w.setFlight(1, FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1})
	})
	var evs []Event
	w.kill(w.planes[1], 0, WCrash, &evs)
	set(w)
	w.Step(nil)
	if m.Target != 0 {
		t.Fatal("a dead launcher must leave its radar missile unguided")
	}
}

// Beaming: the target's speed along the missile's line of sight under
// RadarBeamSpeed for RadarBeamTicks breaks a radar track; IR ignores it,
// and running away (dragging) does not break it.
func TestBeamingBreaksRadarTrack(t *testing.T) {
	beam := func(m *Missile) func(w *World) {
		return func(w *World) {
			w.setFlight(1, FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1})
			pos := geom.V(0, 2000, -1600)
			los := geom.V(0, 0, 1)
			if m != nil {
				los = m.Pos.Sub(pos).Norm()
			}
			side := los.Cross(geom.V(0, 1, 0)).Norm()
			w.setFlight(2, FlightState{Pos: pos, Rot: geom.LookRotation(side, geom.V(0, 1, 0)), Vel: side.Scale(200), Throttle: 1})
		}
	}
	w, m := radarChase(MissileRadar, beam(nil))
	for range RadarBeamTicks - 1 {
		beam(m)(w)
		w.Step(nil)
	}
	if m.Target != 2 {
		t.Fatalf("lost after %d beaming ticks, before %d", m.BeamTicks, RadarBeamTicks)
	}
	beam(m)(w)
	evaded := false
	for _, e := range w.Step(nil) {
		evaded = evaded || e.Kind == EvDecoy && e.Plane == m.ID && e.Other == 2 && e.By == 1
	}
	if m.Target != 0 {
		t.Fatalf("still tracking after %d beaming ticks", RadarBeamTicks)
	}
	if !evaded {
		t.Fatal("a broken radar track must tell the target it evaded (EvDecoy)")
	}
	w, m = radarChase(MissileIR, beam(nil))
	for range RadarBeamTicks + 30 {
		beam(m)(w)
		w.Step(nil)
	}
	if m.Target != 2 {
		t.Fatal("beaming must not break an IR missile")
	}
	drag := func(w *World) {
		w.setFlight(1, FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1})
		w.setFlight(2, FlightState{Pos: geom.V(0, 2000, -1600), Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1})
	}
	w, m = radarChase(MissileRadar, drag)
	for range RadarBeamTicks + 30 {
		drag(w)
		w.Step(nil)
	}
	if m.Target != 2 || m.BeamTicks != 0 {
		t.Fatalf("dragging broke the radar track (beam ticks %d)", m.BeamTicks)
	}
}

// The beam window: 15° off square still beams at 200 m/s (closing 52 m/s
// under RadarBeamSpeed), 30° off does not (100 m/s).
func TestBeamTolerance(t *testing.T) {
	for _, c := range []struct {
		offDeg float64
		breaks bool
	}{{15, true}, {30, false}} {
		var m *Missile
		set := func(w *World) {
			w.setFlight(1, FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1})
			pos := geom.V(0, 2000, -1600)
			los := geom.V(0, 0, 1)
			if m != nil {
				los = m.Pos.Sub(pos).Norm()
			}
			side := los.Cross(geom.V(0, 1, 0)).Norm()
			a := c.offDeg * math.Pi / 180 // tilt the beam toward the missile
			dir := side.Scale(math.Cos(a)).Add(los.Scale(math.Sin(a)))
			w.setFlight(2, FlightState{Pos: pos, Rot: geom.LookRotation(dir, geom.V(0, 1, 0)), Vel: dir.Scale(200), Throttle: 1})
		}
		var w *World
		w, m = radarChase(MissileRadar, set)
		for range RadarBeamTicks + 5 {
			set(w)
			w.Step(nil)
		}
		if broke := m.Target == 0; broke != c.breaks {
			t.Errorf("%v° off square: track broken %v, want %v", c.offDeg, broke, c.breaks)
		}
	}
}

// Flares never decoy a radar missile.
func TestRadarMissileIgnoresFlares(t *testing.T) {
	for seed := range int64(40) {
		w := NewWorld(Config{Seed: seed, Terrain: terrain.Generate(1)})
		w.AddPlaneLoadout(1, TeamNATO, F15, LoadRadar)
		w.AddPlane(2, TeamSoviet, MiG29)
		w.setFlight(1, FlightState{Pos: geom.V(0, 2000, 300), Rot: geom.Identity(), Vel: geom.V(0, 0, -200)})
		w.setFlight(2, FlightState{Pos: geom.V(0, 2000, -300), Rot: geom.Identity(), Vel: geom.V(0, 0, -150)})
		w.addMissileForTest(1, 2, geom.V(0, 2000, 0), geom.V(0, 0, -300))
		w.missiles[0].Kind = MissileRadar
		for _, e := range w.Step(map[ID]Input{2: {Flare: true, Throttle: 0.5}}) {
			if e.Kind == EvDecoy {
				t.Fatalf("seed %d: a flare decoyed a radar missile", seed)
			}
		}
		if w.missiles[0].Target != 2 {
			t.Fatalf("seed %d: radar missile lost its target to a flare", seed)
		}
	}
}

// Regen per kind: each kind regenerates to ⌈full/2⌉ on its own timer.
func TestRegenPerKind(t *testing.T) {
	for _, lo := range []Loadout{LoadIR, LoadRadar, LoadMixed} {
		for _, k := range Kinds() {
			w := newTestWorld()
			w.AddPlaneLoadout(1, TeamNATO, k, lo)
			p := w.planes[1]
			p.Missiles, p.Radars = 0, 0
			for range 10 * MissileRegenTicks {
				w.setFlight(1, FlightState{Pos: geom.V(0, 2500, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1})
				w.Step(nil)
			}
			ir, rd := LoadoutCounts(k, lo)
			if p.Missiles != (ir+1)/2 || p.Radars != (rd+1)/2 || p.RadarRegenAt != 0 || p.MissileRegenAt != 0 {
				t.Errorf("%v %v: regen to %d IR + %d radar, want %d + %d", k, lo, p.Missiles, p.Radars, (ir+1)/2, (rd+1)/2)
			}
		}
	}
	// One period lands one of each kind that is below its cap.
	w := newTestWorld()
	w.AddPlaneLoadout(1, TeamNATO, F15, LoadMixed)
	w.Step(nil)
	p := w.planes[1]
	p.Missiles, p.Radars = 0, 0
	for range MissileRegenTicks + 1 {
		w.setFlight(1, FlightState{Pos: geom.V(0, 2500, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1})
		w.Step(nil)
	}
	if p.Missiles != 1 || p.Radars != 1 {
		t.Fatalf("after 45 s: %d IR + %d radar, want 1 + 1", p.Missiles, p.Radars)
	}
}

// A missile power-up refills each kind by its share; a rearm fills both.
func TestPickupAndRearmPerKind(t *testing.T) {
	for _, c := range []struct {
		lo      Loadout
		ir, rad int // after a pickup from empty (F-15: 6 missiles)
	}{{LoadIR, 2, 0}, {LoadRadar, 0, 1}, {LoadMixed, 1, 1}} {
		w := newTestWorld()
		w.AddPlaneLoadout(1, TeamNATO, F15, c.lo)
		p := w.planes[1]
		p.Missiles, p.Radars = 0, 0
		w.applyPowerup(p, PUMissiles)
		if p.Missiles != c.ir || p.Radars != c.rad || p.RadarRegenAt != 0 {
			t.Errorf("%v pickup: %d IR + %d radar, want %d + %d", c.lo, p.Missiles, p.Radars, c.ir, c.rad)
		}
		if ir, rd := LoadoutCounts(F15, c.lo); !w.needsRearm(p) || ir+rd == 0 {
			t.Errorf("%v: below the load must need a rearm", c.lo)
		}
	}
}
