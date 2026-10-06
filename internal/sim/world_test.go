package sim

import (
	"math"
	"reflect"
	"testing"

	"playground/internal/geom"
	"playground/internal/terrain"
)

func newTestWorld() *World {
	return NewWorld(Config{Seed: 1, Terrain: terrain.Generate(1)})
}

func TestSpawnSidesAndFacing(t *testing.T) {
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F16)
	w.AddPlane(2, TeamSoviet, Su27)
	a, _ := w.Plane(1)
	b, _ := w.Plane(2)
	if a.Pos.X > -2700 || b.Pos.X < 2700 {
		t.Fatalf("spawn x: %v %v", a.Pos.X, b.Pos.X)
	}
	if a.Rot.Forward().X <= 0 || b.Rot.Forward().X >= 0 {
		t.Fatal("planes must face the center")
	}
	if !a.Alive || a.HP != SpecOf(F16).MaxHP || a.Missiles != SpecOf(F16).Missiles {
		t.Fatalf("bad spawn state %+v", a)
	}
}

func TestCrashIntoSeaKillsAndRespawns(t *testing.T) {
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F16)
	// Y=1 (plan had 3): one tick sinks 0.87 m, so 3 ends at 2.13, above the Ground+2 crash line (ruling C1).
	w.setFlight(1, FlightState{Pos: geom.V(4500, 1, 4500), Rot: geom.AxisAngle(geom.V(1, 0, 0), -0.5), Vel: geom.V(0, -50, -200)})
	evs := w.Step(nil)
	if !hasEvent(evs, EvKill, 1) {
		t.Fatalf("expected crash kill, got %+v", evs)
	}
	for range RespawnTicks {
		evs = w.Step(nil)
	}
	if !hasEvent(evs, EvSpawn, 1) {
		t.Fatal("expected respawn")
	}
}

func TestRamDamagesBoth(t *testing.T) {
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F15)
	w.AddPlane(2, TeamSoviet, Su27)
	w.setFlight(1, FlightState{Pos: geom.V(0, 2000, 5), Rot: geom.Identity(), Vel: geom.V(0, 0, -200)})
	w.setFlight(2, FlightState{Pos: geom.V(0, 2000, -5), Rot: geom.AxisAngle(geom.V(0, 1, 0), 3.14159), Vel: geom.V(0, 0, 200)})
	w.clearProtection()
	evs := w.Step(nil)
	if !hasEvent(evs, EvKill, 1) || !hasEvent(evs, EvKill, 2) {
		t.Fatalf("head-on ram at 400 m/s must kill both: %+v", evs)
	}
}

func TestOutOfBoundsDamage(t *testing.T) {
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F15)
	w.setFlight(1, FlightState{Pos: geom.V(4100, 2000, 0), Rot: geom.AxisAngle(geom.V(0, 1, 0), -1.5708), Vel: geom.V(30, 0, 0)})
	w.clearProtection()
	for range 60 * 6 {
		w.Step(map[ID]Input{1: {Throttle: 0}})
	}
	p, _ := w.Plane(1)
	if p.HP >= SpecOf(F15).MaxHP {
		t.Fatal("out of bounds for 6s should hurt")
	}
}

func TestSnapshotIsCopy(t *testing.T) {
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F16)
	s := w.Snapshot()
	s.Planes[0].HP = -1
	if p, _ := w.Plane(1); p.HP < 0 {
		t.Fatal("snapshot must not alias world state")
	}
}

func hasEvent(evs []Event, k EventKind, plane ID) bool {
	for _, e := range evs {
		if e.Kind == k && e.Plane == plane {
			return true
		}
	}
	return false
}

// TestDeterministic runs two worlds with the same seed and scripted inputs and
// requires identical events and snapshots on every tick.
func TestDeterministic(t *testing.T) {
	run := func() ([][]Event, []Snapshot) {
		w := NewWorld(Config{Seed: 42, Terrain: terrain.Generate(3)})
		w.AddPlane(1, TeamNone, F16)
		w.AddPlane(2, TeamNone, MiG29)
		w.AddPlane(3, TeamNone, Su27)
		var evs [][]Event
		var snaps []Snapshot
		for i := range 60 * 20 {
			in := map[ID]Input{
				1: {Pitch: 0.3, Roll: float64(i%120)/60 - 1, Throttle: 1, Fire: i%3 == 0, Missile: i%90 == 0, Flare: i%200 == 0},
				2: {Pitch: -0.2, Yaw: 0.5, Throttle: 0.7, AB: i%2 == 0, Fire: true, Flare: i%61 == 0},
				// plane 3 sends no input: neutral controls, last throttle
			}
			if i == 600 {
				w.RemovePlane(2)
				w.AddPlane(4, TeamNone, F15)
			}
			evs = append(evs, w.Step(in))
			snaps = append(snaps, w.Snapshot())
		}
		return evs, snaps
	}
	e1, s1 := run()
	e2, s2 := run()
	if !reflect.DeepEqual(e1, e2) || !reflect.DeepEqual(s1, s2) {
		t.Fatal("same seed and inputs produced different worlds")
	}
}

// Ruling C41: bounds damage lands once per whole second after the 5 s grace.
func TestOutOfBoundsOncePerSecond(t *testing.T) {
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F15)
	w.setFlight(1, FlightState{Pos: geom.V(4100, 2000, 0), Rot: geom.AxisAngle(geom.V(0, 1, 0), -1.5708), Vel: geom.V(200, 0, 0), Throttle: 1})
	w.clearProtection()
	var hits []int
	for range 60*7 + 30 {
		for _, e := range w.Step(map[ID]Input{1: {Throttle: 1}}) {
			if e.Kind == EvHit && e.Weapon == WBounds {
				if e.Value != 10 {
					t.Fatalf("bounds hit %v, want 10", e.Value)
				}
				hits = append(hits, w.Tick())
			}
		}
	}
	if len(hits) != 2 || hits[0] != 360 || hits[1] != 420 {
		t.Fatalf("bounds hits at ticks %v, want [360 420]", hits)
	}
}

// Review fix: non-finite input must not corrupt the world. Clamp maps NaN/±Inf
// to 0, so a hostile input must behave exactly like the zero input.
func TestNonFiniteInputIsNeutralized(t *testing.T) {
	nan, inf := math.NaN(), math.Inf(1)
	bad := Input{Pitch: nan, Roll: inf, Yaw: -inf, Throttle: nan, Fire: true}
	run := func(in Input) []Snapshot {
		w := NewWorld(Config{Seed: 7, Terrain: terrain.Generate(1)})
		w.AddPlane(1, TeamNone, F16)
		w.AddPlane(2, TeamNone, MiG29)
		w.AddPlane(3, TeamNone, Su27)
		var snaps []Snapshot
		for range 300 {
			w.Step(map[ID]Input{1: in, 2: {Throttle: 1}, 3: {Throttle: 0.5}})
			snaps = append(snaps, w.Snapshot())
		}
		return snaps
	}
	got := run(bad)
	for _, s := range got {
		for _, p := range s.Planes {
			for _, v := range []float64{p.HP, p.Pos.X, p.Pos.Y, p.Pos.Z, p.Vel.X, p.Vel.Y, p.Vel.Z, p.Throttle, p.Heat, p.Rot.W, p.Rot.X, p.Rot.Y, p.Rot.Z} {
				if math.IsNaN(v) || math.IsInf(v, 0) {
					t.Fatalf("tick %d plane %d has non-finite state %+v", s.Tick, p.ID, p)
				}
			}
		}
	}
	if !reflect.DeepEqual(got, run(Input{Fire: true})) {
		t.Fatal("non-finite input must behave like the zero input")
	}
}

func TestClampNonFinite(t *testing.T) {
	in := Input{Pitch: math.NaN(), Roll: math.Inf(1), Yaw: math.Inf(-1), Throttle: math.NaN()}.Clamp()
	if in != (Input{}) {
		t.Fatalf("Clamp = %+v, want zero", in)
	}
}

func TestDamageIgnoresNaN(t *testing.T) {
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F15)
	w.clearProtection()
	var evs []Event
	w.damage(w.planes[1], 0, math.NaN(), WRam, &evs)
	if p, _ := w.Plane(1); p.HP != SpecOf(F15).MaxHP || len(evs) != 0 {
		t.Fatalf("NaN damage applied: hp=%v evs=%v", p.HP, evs)
	}
}

func TestRamIgnoresNaNPlane(t *testing.T) {
	w := newTestWorld()
	w.AddPlane(1, TeamNone, F15)
	w.AddPlane(2, TeamNone, Su27)
	w.clearProtection()
	nan := math.NaN()
	w.planes[1].Pos = geom.V(nan, nan, nan)
	var evs []Event
	w.hazards(&evs)
	if p, _ := w.Plane(2); p.HP != SpecOf(Su27).MaxHP {
		t.Fatalf("NaN plane rammed a plane 6 km away: hp=%v", p.HP)
	}
}

func TestReseatKeepsProtection(t *testing.T) {
	w := NewWorld(Config{Seed: 1, Terrain: terrain.Generate(1)})
	w.AddPlane(1, TeamNone, F16)
	w.Step(nil)
	before, _ := w.Plane(1)
	w.Reseat(1, Su27)
	after, _ := w.Plane(1)
	if after.Kind != Su27 || after.ProtectUntil != before.ProtectUntil || !after.Alive {
		t.Fatalf("reseat: %+v", after)
	}
}

// A departing owner's missiles detonate on the next Step instead of
// silently vanishing from the snapshot.
func TestRemovePlaneEndsItsMissilesWithEvent(t *testing.T) {
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F16)
	w.AddPlane(2, TeamSoviet, MiG29)
	w.Step(nil)
	w.addMissileForTest(1, 2, geom.V(0, 2000, 0), geom.V(0, 0, -300))
	id := w.missiles[0].ID
	w.RemovePlane(1)
	gone := false
	for _, e := range w.Step(nil) {
		gone = gone || (e.Kind == EvMissileGone && e.Plane == id)
	}
	if !gone || len(w.Snapshot().Missiles) != 0 {
		t.Fatalf("gone event=%v missiles=%d", gone, len(w.Snapshot().Missiles))
	}
}
