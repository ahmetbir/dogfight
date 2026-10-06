package sim

import (
	"testing"

	"playground/internal/geom"
	"playground/internal/maps"
)

// put places plane 1 of a runway world at local (u, v) of the NATO base,
// h meters above the wheels-on-ground height, heading along the runway.
func put(t *testing.T, w *World, u, v, h float64, vel geom.Vec3, rot geom.Quat, gear, ground bool) {
	t.Helper()
	b := w.cfg.Map.Bases[0]
	p := b.World(u, v)
	p.Y += GearHeight + h
	w.setFlight(1, FlightState{Pos: p, Rot: rot, Vel: vel, Gear: gear, Ground: ground})
}

func along(w *World) (geom.Quat, geom.Vec3) {
	b := w.cfg.Map.Bases[0]
	return YawPitch(maps.HeadingOf(b.Axis), 0), b.Axis
}

func crashed(w *World, ticks int, in Input) bool {
	for range ticks {
		for _, e := range w.Step(map[ID]Input{1: in}) {
			if e.Kind == EvKill && e.Plane == 1 && e.Weapon == WCrash {
				return true
			}
		}
	}
	return false
}

func landingWorld(t *testing.T) *World {
	w := runwayWorld(maps.Ada)
	w.AddPlane(1, TeamNATO, F16)
	w.clearProtection()
	return w
}

func TestGoodLandingRolls(t *testing.T) {
	w := landingWorld(t)
	rot, ax := along(w)
	put(t, w, -600, 0, 0.1, ax.Scale(95).Add(geom.V(0, -2, 0)), rot, true, false)
	if crashed(w, 30, Input{Gear: true}) {
		t.Fatal("gentle runway landing must not crash")
	}
	if p, _ := w.Plane(1); !p.Ground {
		t.Fatal("must be rolling")
	}
}

func TestHardLandingCrashes(t *testing.T) {
	w := landingWorld(t)
	rot, ax := along(w)
	put(t, w, -600, 0, 0.1, ax.Scale(95).Add(geom.V(0, -8, 0)), rot, true, false)
	if !crashed(w, 5, Input{Gear: true}) {
		t.Fatal("8 m/s sink must crash")
	}
}

func TestBankedLandingCrashes(t *testing.T) {
	w := landingWorld(t)
	rot, ax := along(w)
	banked := rot.Mul(geom.AxisAngle(geom.V(0, 0, -1), 0.6))
	put(t, w, -600, 0, 0.1, ax.Scale(95).Add(geom.V(0, -2, 0)), banked, true, false)
	if !crashed(w, 5, Input{Gear: true}) {
		t.Fatal("34° bank at touchdown must crash")
	}
}

func TestTaxiwayTouchdownSpeed(t *testing.T) {
	for _, c := range []struct {
		speed float64
		crash bool
	}{{60, true}, {25, false}} {
		w := landingWorld(t)
		rot, ax := along(w)
		// h = 0.01 (preflight N9): from 0.05 m at 1 m/s sink the plane is still airborne after 3 ticks.
		put(t, w, 0, 120, 0.01, ax.Scale(c.speed).Add(geom.V(0, -1, 0)), rot, true, false)
		if got := crashed(w, 3, Input{Gear: true}); got != c.crash {
			t.Fatalf("touchdown on the taxiway at %v m/s: crash=%v", c.speed, got)
		}
	}
}

// FB-A 5 (grass tolerance): rolling off the runway end onto grass crashes
// above GrassMaxSpeed and rolls on below it.
func TestRollOffRunwayEnd(t *testing.T) {
	for _, c := range []struct {
		speed float64
		crash bool
	}{{40, true}, {20, false}} {
		w := landingWorld(t)
		rot, ax := along(w)
		put(t, w, 880, 0, 0, ax.Scale(c.speed), rot, true, true)
		if got := crashed(w, 120, Input{Gear: true}); got != c.crash {
			t.Fatalf("off the runway end at %v m/s: crash=%v", c.speed, got)
		}
		if p, _ := w.Plane(1); !c.crash && (!p.Ground || w.cfg.Map.SurfaceAt(p.Pos.X, p.Pos.Z) != maps.SurfNone) {
			t.Fatalf("%v m/s: should roll on the grass: ground=%v surf=%v", c.speed, p.Ground, w.cfg.Map.SurfaceAt(p.Pos.X, p.Pos.Z))
		}
	}
}

// FB-A 5: a slow touchdown on flat grass beside the runway survives; above
// GrassMaxSpeed it crashes.
func TestGrassTouchdownSpeed(t *testing.T) {
	for _, c := range []struct {
		speed float64
		crash bool
	}{{45, true}, {30, false}} {
		w := landingWorld(t)
		rot, ax := along(w)
		put(t, w, 0, 60, 0.01, ax.Scale(c.speed).Add(geom.V(0, -1, 0)), rot, true, false)
		if got := crashed(w, 3, Input{Gear: true}); got != c.crash {
			t.Fatalf("touchdown on grass at %v m/s: crash=%v", c.speed, got)
		}
	}
}

func TestTaxiwaySpeedLimit(t *testing.T) {
	for _, c := range []struct {
		speed float64
		crash bool
	}{{40, true}, {33, false}, {25, false}} { // crash limit 35 (fix round 2: was 30)
		w := landingWorld(t)
		rot, ax := along(w)
		put(t, w, 0, 120, 0, ax.Scale(c.speed), rot, true, true)
		if got := crashed(w, 30, Input{Gear: true}); got != c.crash {
			t.Fatalf("taxiing at %v m/s: crash=%v", c.speed, got)
		}
	}
}

func TestBellyLandingCrashes(t *testing.T) {
	w := landingWorld(t)
	rot, ax := along(w)
	put(t, w, -600, 0, -0.4, ax.Scale(95).Add(geom.V(0, -3, 0)), rot, false, false)
	if !crashed(w, 5, Input{}) {
		t.Fatal("gear-up contact must crash")
	}
}
