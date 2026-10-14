package sim

import (
	"math"
	"testing"

	"playground/internal/geom"
)

func angleOf(a, b geom.Vec3) float64 {
	return math.Acos(math.Max(-1, math.Min(1, a.Norm().Dot(b.Norm()))))
}

// A climb into the ceiling levels off at a bounded rate: the flight path
// never turns faster than the sim's own pitch limits allow plus the
// cushion's CeilingBend, the speed is not cut (only drag takes it), the nose
// does not stay pointed up while the path runs along the lid, and the plane
// stays under it (the hard clamp used to turn the path up to 88° in one
// tick and leave the nose at up to 152° angle of attack).
func TestCeilingCushionLevelsClimbSmoothly(t *testing.T) {
	cases := []struct {
		name  string
		kind  Kind
		alt   float64
		pitch float64 // nose above the horizon, rad
		speed float64
		in    Input
	}{
		{"mig29-45deg-ab", MiG29, 2400, math.Pi / 4, 250, Input{Throttle: 1, AB: true}},
		{"f16-vertical", F16, 2300, math.Pi / 2 * 0.98, 220, Input{Throttle: 1}},
		{"a10-zoom-full-pull", A10, 2700, 1.0, 140, Input{Throttle: 1, Pitch: 1}},
		{"f22-pull-ab", F22, 2500, 0.6, 300, Input{Throttle: 1, Pitch: 1, AB: true}},
		{"su27-pull-roll", Su27, 2600, 0.8, 180, Input{Throttle: 1, Pitch: 1, Roll: 0.3}},
	}
	for _, c := range cases {
		s := SpecOf(c.kind)
		rot := geom.AxisAngle(geom.V(1, 0, 0), c.pitch)
		fs := FlightState{Pos: geom.V(0, c.alt, 0), Rot: rot, Vel: rot.Forward().Scale(c.speed), Throttle: 1}
		worstTurn, worstDrop, worstAoA, top := 0.0, 0.0, 0.0, 0.0
		for range 60 * 20 {
			prev := fs
			fs = StepFlight(fs, c.in, s, FlightMods{})
			v0, v1 := prev.Vel.Len(), fs.Vel.Len()
			worstTurn = math.Max(worstTurn, angleOf(prev.Vel, fs.Vel)/Dt)
			worstDrop = math.Max(worstDrop, v0-v1)
			worstAoA = math.Max(worstAoA, angleOf(fs.Rot.Forward(), fs.Vel))
			top = math.Max(top, fs.Pos.Y)
		}
		// The fastest pitch cap is 1.75 rad/s, the cushion's pull-over
		// CeilingBend. The clamp alone turned the path up to 88° in a tick.
		if worstTurn > 2.0 {
			t.Errorf("%s: path turned %.0f°/s in one tick", c.name, worstTurn*180/math.Pi)
		}
		// Induced drag at a full pull with the afterburner takes up to
		// ~2 m/s a tick; the clamp alone took 76-198 m/s.
		if worstDrop > 3 {
			t.Errorf("%s: speed dropped %.1f m/s in one tick", c.name, worstDrop)
		}
		if worstAoA > 0.65 {
			t.Errorf("%s: angle of attack reached %.0f°", c.name, worstAoA*180/math.Pi)
		}
		if top > Ceiling {
			t.Errorf("%s: climbed to %.2f m", c.name, top)
		}
	}
}

// The cushion leaves a climb alone while a CeilingBend pull-over can still
// level it below the ceiling; past that it bends path and nose by the same
// angle down to that limit, keeping speed, heading and angle of attack.
func TestCeilingCushionHoldsPathAngle(t *testing.T) {
	rot := geom.AxisAngle(geom.V(1, 0, 0), 0.7).Mul(geom.AxisAngle(geom.V(0, 0, 1), 0.3))
	vel := geom.AxisAngle(geom.V(0, 1, 0), 0.4).Rotate(geom.V(0, 0.45, -1).Norm().Scale(220))
	far := FlightState{Pos: geom.V(0, Ceiling-300, 0), Rot: rot, Vel: vel}
	if got := ceilingCushion(far); got != far {
		t.Fatalf("cushion acted 300 m under the ceiling: %+v", got)
	}
	near := far
	near.Pos.Y = Ceiling - 10
	got := ceilingCushion(near)
	r, b := 10*CeilingBend/220, CeilingBend*Dt
	if want := math.Acos((1-r)/math.Sqrt(1+b*b)) - math.Atan(b); math.Abs(math.Asin(got.Vel.Y/got.Vel.Len())-want) > 1e-9 {
		t.Errorf("path angle %.6f, want %.6f", math.Asin(got.Vel.Y/got.Vel.Len()), want)
	}
	if math.Abs(got.Vel.Len()-vel.Len()) > 1e-9 {
		t.Errorf("speed %.6f, want %.6f", got.Vel.Len(), vel.Len())
	}
	if a0, a1 := angleOf(rot.Forward(), vel), angleOf(got.Rot.Forward(), got.Vel); math.Abs(a0-a1) > 1e-9 {
		t.Errorf("angle of attack %.6f, was %.6f", a1, a0)
	}
	if h0, h1 := math.Atan2(vel.X, vel.Z), math.Atan2(got.Vel.X, got.Vel.Z); math.Abs(h0-h1) > 1e-9 {
		t.Errorf("heading %.6f, was %.6f", h1, h0)
	}
}
