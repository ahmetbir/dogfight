package sim

import (
	"math"
	"testing"

	"playground/internal/geom"
	"playground/internal/maps"
)

var (
	runwayG = GroundSample{H: 10, Surf: maps.SurfRunway}
	taxiG   = GroundSample{H: 10, Surf: maps.SurfTaxi}
)

func onGround(speed float64) FlightState {
	return FlightState{Pos: geom.V(0, 10+GearHeight, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -speed), Gear: true, Ground: true}
}

func roll(fs FlightState, in Input, k Kind, g GroundSample, ticks int) FlightState {
	for range ticks {
		fs = StepFlight(fs, in, SpecOf(k), FlightMods{Ground: g})
	}
	return fs
}

func TestRotateSpeeds(t *testing.T) {
	want := map[Kind]float64{F16: 78, F15: 82, MiG29: 75, Su27: 85}
	for k, v := range want {
		if SpecOf(k).RotateSpeed != v {
			t.Fatalf("%v rotate %v", k, SpecOf(k).RotateSpeed)
		}
	}
}

func TestParkedStaysPut(t *testing.T) {
	fs := roll(onGround(0), Input{Gear: true}, F16, runwayG, 300)
	if !fs.Ground || fs.Pos != geom.V(0, 10+GearHeight, 0) || fs.Vel.Len() != 0 {
		t.Fatalf("parked plane moved: %+v", fs)
	}
}

func TestTakeoffRoll(t *testing.T) {
	fs := onGround(0)
	lift := -1
	for i := range 720 {
		fs = StepFlight(fs, Input{Throttle: 1, Pitch: 1}, SpecOf(F16), FlightMods{Ground: runwayG})
		if !fs.Ground {
			lift = i
			break
		}
	}
	if lift < 300 || lift > 700 {
		t.Fatalf("lift-off at tick %d, want 300..700", lift)
	}
	if d := -fs.Pos.Z; d < 250 || d > 900 {
		t.Fatalf("takeoff roll %v m", d)
	}
	y0 := fs.Pos.Y
	fs = roll(fs, Input{Throttle: 1, Pitch: 1}, F16, runwayG, 60)
	if fs.Ground || fs.Pos.Y < y0+5 || fs.Gear {
		t.Fatalf("must climb with the gear up: %+v", fs)
	}
}

func TestNoLiftoffWithoutPitchOrBelowRotate(t *testing.T) {
	fs := roll(onGround(0), Input{Throttle: 1, Gear: true}, F16, runwayG, 720)
	if !fs.Ground || fs.Vel.Len() < SpecOf(F16).RotateSpeed {
		t.Fatalf("no pitch input: stays rolling above rotate speed: %+v", fs)
	}
	fs = roll(onGround(40), Input{Pitch: 1, Gear: true}, F16, runwayG, 60)
	if !fs.Ground {
		t.Fatal("below rotate speed the nose stays down")
	}
}

func TestBrakesStop(t *testing.T) {
	fs := roll(onGround(60), Input{Brake: true, Gear: true}, Su27, runwayG, 480)
	if fs.Vel.Len() != 0 {
		t.Fatalf("braked from 60 m/s for 8 s: %v", fs.Vel.Len())
	}
	if roll(onGround(60), Input{Gear: true}, Su27, runwayG, 480).Vel.Len() < 5 {
		t.Fatal("without brakes it must still roll")
	}
}

func TestNoseWheelSteering(t *testing.T) {
	fs := roll(onGround(10), Input{Yaw: 1, Throttle: 0.1, Gear: true}, F16, taxiG, 60)
	if f := fs.Rot.Forward(); f.X < 0.2 || fs.Pos.Y != 10+GearHeight || math.Abs(f.Y) > 1e-9 {
		t.Fatalf("right steer must turn right on the level: fwd %v y %v", f, fs.Pos.Y)
	}
	if f := roll(onGround(0), Input{Roll: 1, Gear: true}, F16, taxiG, 60).Rot.Forward(); math.Abs(f.X) > 1e-9 {
		t.Fatal("no turning at a standstill")
	}
}

func TestGearRules(t *testing.T) {
	air := FlightState{Gear: false}
	if gearState(air, Input{Gear: true}, 150) {
		t.Fatal("cannot lower above 140")
	}
	if !gearState(air, Input{Gear: true}, 130) {
		t.Fatal("lowers at 130")
	}
	if gearState(FlightState{Gear: true}, Input{Gear: true}, 165) {
		t.Fatal("forced up above 160")
	}
	if !gearState(FlightState{Gear: true, Ground: true}, Input{Gear: false}, 50) {
		t.Fatal("no retraction on the ground")
	}
	if gearState(FlightState{Gear: true}, Input{Gear: false}, 100) {
		t.Fatal("retracts on request")
	}
}

func TestGearDragSlows(t *testing.T) {
	up := FlightState{Pos: geom.V(0, 1500, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -150)}
	down := up
	down.Gear = true
	s := SpecOf(F16)
	for range 60 {
		up = StepFlight(up, Input{Throttle: 1}, s, FlightMods{})
		down = StepFlight(down, Input{Throttle: 1, Gear: true}, s, FlightMods{})
	}
	if down.Vel.Len() >= up.Vel.Len() {
		t.Fatalf("gear drag: %v >= %v", down.Vel.Len(), up.Vel.Len())
	}
}

func TestTouchdownSettles(t *testing.T) {
	fs := FlightState{Pos: geom.V(0, 10+GearHeight+0.5, 0), Rot: geom.Identity(), Vel: geom.V(0, -3, -90), Gear: true, Throttle: 0.3}
	fs = roll(fs, Input{Throttle: 0.3, Gear: true}, F16, runwayG, 30)
	if !fs.Ground || fs.Pos.Y != 10+GearHeight || fs.Vel.Y != 0 {
		t.Fatalf("must settle on the wheels: %+v", fs)
	}
}

func TestAirborneIgnoresGroundSampleAndWindDrifts(t *testing.T) {
	a := FlightState{Pos: geom.V(0, 1500, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1}
	b, c := a, a
	s := SpecOf(F16)
	in := Input{Pitch: 0.2, Roll: 0.3, Throttle: 1}
	for range 60 {
		a = StepFlight(a, in, s, FlightMods{})
		b = StepFlight(b, in, s, FlightMods{Ground: runwayG})
		c = StepFlight(c, in, s, FlightMods{Wind: geom.V(6, 0, 0)})
	}
	if a != b {
		t.Fatal("a ground sample must not change airborne flight with the gear up")
	}
	if c.Vel != a.Vel || c.Rot != a.Rot || math.Abs(c.Pos.X-a.Pos.X-6) > 1e-9 {
		t.Fatalf("wind must only move the plane: dx %v", c.Pos.X-a.Pos.X)
	}
}
