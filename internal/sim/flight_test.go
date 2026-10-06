package sim

import (
	"math"
	"testing"

	"playground/internal/geom"
)

func level(speed float64) FlightState {
	return FlightState{Pos: geom.V(0, 1500, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -speed), Throttle: 1}
}

func run(fs FlightState, in Input, s Spec, ticks int) FlightState {
	for range ticks {
		fs = StepFlight(fs, in, s, FlightMods{})
	}
	return fs
}

func TestFullThrottleConvergesToMaxSpeed(t *testing.T) {
	s := SpecOf(F16)
	fs := run(level(150), Input{Throttle: 1}, s, 60*40)
	if v := fs.Vel.Len(); math.Abs(v-s.MaxSpeed) > 8 {
		t.Fatalf("speed %v, want ~%v", v, s.MaxSpeed)
	}
}

func TestAfterburnerFaster(t *testing.T) {
	s := SpecOf(F15)
	fs := run(level(200), Input{Throttle: 1, AB: true}, s, 60*40)
	if v := fs.Vel.Len(); v < s.MaxSpeed+30 {
		t.Fatalf("AB speed %v", v)
	}
}

func TestClimbSlowsDiveSpeeds(t *testing.T) {
	s := SpecOf(F16)
	climb := FlightState{Pos: geom.V(0, 1000, 0), Rot: geom.AxisAngle(geom.V(1, 0, 0), 1.2), Vel: geom.V(0, 0, -200), Throttle: 0.5}
	dive := FlightState{Pos: geom.V(0, 2500, 0), Rot: geom.AxisAngle(geom.V(1, 0, 0), -1.2), Vel: geom.V(0, 0, -200), Throttle: 0.5}
	if run(climb, Input{Throttle: 0.5}, s, 120).Vel.Len() >= run(dive, Input{Throttle: 0.5}, s, 120).Vel.Len() {
		t.Fatal("climb should be slower than dive")
	}
}

func TestPitchInputRaisesNose(t *testing.T) {
	fs := run(level(170), Input{Pitch: 1, Throttle: 1}, SpecOf(MiG29), 30)
	if fs.Rot.Forward().Y < 0.3 {
		t.Fatalf("nose Y %v after pull", fs.Rot.Forward().Y)
	}
}

func TestStallDropsNose(t *testing.T) {
	fs := level(60)
	fs.Rot = geom.AxisAngle(geom.V(1, 0, 0), 0.6) // nose up, too slow
	fs.Throttle = 0
	fs = run(fs, Input{}, SpecOf(F16), 120)
	if fs.Rot.Forward().Y > 0 {
		t.Fatalf("stalled nose should fall, forward.Y=%v", fs.Rot.Forward().Y)
	}
}

func TestCeilingClamps(t *testing.T) {
	fs := FlightState{Pos: geom.V(0, Ceiling-1, 0), Rot: geom.AxisAngle(geom.V(1, 0, 0), 1.4), Vel: geom.V(0, 250, -10), Throttle: 1}
	fs = run(fs, Input{Throttle: 1}, SpecOf(F16), 60)
	if fs.Pos.Y > Ceiling {
		t.Fatalf("above ceiling: %v", fs.Pos.Y)
	}
}

func TestAuthorityShape(t *testing.T) {
	s := SpecOf(F16)
	if Authority(s.CornerSpeed, s) != 1 || Authority(50, s) != 0.3 || Authority(s.MaxSpeedAB, s) > 0.61 {
		t.Fatal("authority curve wrong")
	}
}

func TestRollAndYawSigns(t *testing.T) {
	s := SpecOf(F16)
	if r := run(level(200), Input{Roll: 1, Throttle: 1}, s, 10).Rot.Right(); r.Y >= 0 {
		t.Fatalf("+roll must drop the right wing, right=%v", r)
	}
	if f := run(level(200), Input{Yaw: 1, Throttle: 1}, s, 10).Rot.Forward(); f.X <= 0 {
		t.Fatalf("+yaw must turn the nose right, forward=%v", f)
	}
}

// At the ceiling a nose-up plane cannot keep climbing: vertical speed is
// cut, so it bleeds speed instead (soft ceiling).
func TestCeilingCutsClimb(t *testing.T) {
	fs := FlightState{Pos: geom.V(0, Ceiling-1, 0), Rot: geom.AxisAngle(geom.V(1, 0, 0), 1.4), Vel: geom.V(0, 250, -10), Throttle: 1}
	fs = StepFlight(fs, Input{Throttle: 1}, SpecOf(F16), FlightMods{})
	if fs.Pos.Y > Ceiling || fs.Vel.Y > 0 {
		t.Fatalf("at ceiling: y=%v vy=%v", fs.Pos.Y, fs.Vel.Y)
	}
}

// FB-A 3: a 5 s max-rate turn (83° bank, full pull) from corner speed bleeds
// 20-35 m/s at full throttle; the afterburner roughly holds it (< 12 m/s).
// The feedback asked for ~25-35; the controller ruling (fix round 1)
// accepted InducedDrag 0.2 with a 20-35 band: MiG-29's low corner speed
// (150 m/s) gives a small n−1, so it loses ~20 m/s, and a larger k would
// cost the others the "holds with AB" criterion.
func TestInducedDragBleedsSustainedTurn(t *testing.T) {
	turn := func(k Kind, ab bool) float64 {
		s := SpecOf(k)
		fs := FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.AxisAngle(geom.V(0, 0, 1), -1.45), Vel: geom.V(0, 0, -s.CornerSpeed), Throttle: 1}
		fs = run(fs, Input{Pitch: 1, Throttle: 1, AB: ab}, s, 5*60)
		return s.CornerSpeed - fs.Vel.Len()
	}
	for _, k := range Kinds() {
		dry, wet := turn(k, false), turn(k, true)
		t.Logf("%v: loses %.1f m/s, with AB %.1f", k, dry, wet)
		const dryMin, dryMax, wetMax = 20, 35, 12 // ruled band, see above
		if dry < dryMin || dry > dryMax || wet > wetMax {
			t.Errorf("%v: loses %.1f m/s (want 20-35), with AB %.1f (want < 12)", k, dry, wet)
		}
	}
	// Flying straight there is no induced drag: full throttle accelerates.
	if fs := run(level(170), Input{Throttle: 1}, SpecOf(F16), 60); fs.Vel.Len() <= 170 {
		t.Fatalf("level flight slowed to %v", fs.Vel.Len())
	}
}

// FB-A 4: 15 s of afterburner heats it to 1 and locks it out; held on, it
// stays off until the heat cools to 0.3 (17.5 s), then burns again.
func TestAfterburnerHeatLockout(t *testing.T) {
	s := SpecOf(F15)
	fs := level(250)
	ab := Input{Throttle: 1, AB: true}
	fs = run(fs, ab, s, 15*60-2)
	if fs.ABLock || fs.ABHeat < 0.99 {
		t.Fatalf("after ~15 s: heat %v lock %v", fs.ABHeat, fs.ABLock)
	}
	fs = run(fs, ab, s, 3)
	if !fs.ABLock {
		t.Fatalf("heat %v: not locked out", fs.ABHeat)
	}
	locked := run(fs, ab, s, 60)
	dry := run(fs, Input{Throttle: 1}, s, 60)
	if locked.Vel.Len() != dry.Vel.Len() {
		t.Fatalf("locked AB still burns: %v vs %v", locked.Vel.Len(), dry.Vel.Len())
	}
	n := 0
	for fs.ABLock {
		fs = StepFlight(fs, ab, s, FlightMods{})
		n++
	}
	if want := int((1 - ABUnlock) / ABHeatCool * 60); n < want-3 || n > want+3 {
		t.Fatalf("unlocked after %d ticks, want ~%d", n, want)
	}
	if h := StepFlight(fs, ab, s, FlightMods{}).ABHeat; h <= fs.ABHeat {
		t.Fatal("unlocked AB does not burn")
	}
}
