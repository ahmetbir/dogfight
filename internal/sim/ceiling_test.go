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
		worstTurn, worstDrop, worstAoA, top, worstNose := 0.0, 0.0, 0.0, 0.0, 0.0
		for range 60 * 20 {
			prev := fs
			fs = StepFlight(fs, c.in, s, FlightMods{})
			v0, v1 := prev.Vel.Len(), fs.Vel.Len()
			worstTurn = math.Max(worstTurn, angleOf(prev.Vel, fs.Vel)/Dt)
			worstDrop = math.Max(worstDrop, v0-v1)
			worstAoA = math.Max(worstAoA, angleOf(fs.Rot.Forward(), fs.Vel))
			top = math.Max(top, fs.Pos.Y)
			worstNose = math.Max(worstNose, angleOf(prev.Rot.Forward(), fs.Rot.Forward())/Dt)
		}
		// The nose never turns faster than the pilot's own pitch and yaw
		// rates allow (roll does not move it).
		if own := math.Hypot(s.PitchRate, s.YawRate); worstNose > own+1e-6 {
			t.Errorf("%s: nose turned %.0f°/s, own cap %.0f°/s", c.name, worstNose*180/math.Pi, own*180/math.Pi)
		}
		// The pilot's own path turn stays under ~1.75 rad/s and the cushion
		// adds at most CeilingBend; 2 rad/s is the bound, deliberately
		// tighter than their sum so retuning CeilingBend shows up here. The
		// clamp alone turned the path up to 88° in a tick.
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
	if got := ceilingCushion(far, rot.Forward(), 10); got != far {
		t.Fatalf("cushion acted 300 m under the ceiling: %+v", got)
	}
	near := far
	near.Pos.Y = Ceiling - 10
	got := ceilingCushion(near, rot.Forward(), 10)
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

// The cushion never moves the nose faster than the pitch cap, or than the
// pilot already moved it this tick: the path still bends in full.
func TestCeilingCushionCapsNoseTurn(t *testing.T) {
	rot := geom.AxisAngle(geom.V(1, 0, 0), 0.9)
	vel := rot.Forward().Scale(200)
	fs := FlightState{Pos: geom.V(0, Ceiling-2, 0), Rot: rot, Vel: vel}
	const capRate = 0.5
	got := ceilingCushion(fs, rot.Forward(), capRate)
	if a := angleOf(rot.Forward(), got.Rot.Forward()); a > capRate*Dt+1e-9 {
		t.Errorf("nose turned %.5f rad in a tick, cap %.5f", a, capRate*Dt)
	}
	b := CeilingBend * Dt
	r := 2 * CeilingBend / 200
	if want := math.Acos((1-r)/math.Sqrt(1+b*b)) - math.Atan(b); math.Abs(math.Asin(got.Vel.Y/got.Vel.Len())-want) > 1e-9 {
		t.Errorf("path angle %.6f, want %.6f", math.Asin(got.Vel.Y/got.Vel.Len()), want)
	}
	// A pilot already turning the nose faster keeps that much room.
	pulled := rot.Mul(geom.AxisAngle(geom.V(1, 0, 0), 0.04))
	fs.Rot = pulled
	got = ceilingCushion(fs, rot.Forward(), capRate)
	if a := angleOf(rot.Forward(), got.Rot.Forward()); a > angleOf(rot.Forward(), pulled.Forward())+1e-9 {
		t.Errorf("nose turned %.5f rad, pilot's own %.5f", a, angleOf(rot.Forward(), pulled.Forward()))
	}
}

// A straight-up climb, and one within verticalPath of it, bends over the
// nose's right wing; just outside it the path's own heading decides.
func TestCeilingCushionVerticalAxis(t *testing.T) {
	rot := geom.AxisAngle(geom.V(0, 1, 0), 0.6).Mul(geom.AxisAngle(geom.V(1, 0, 0), math.Pi/2))
	right := rot.Right()
	for _, hx := range []float64{0, 0.5e-6 * 250} {
		fs := FlightState{Pos: geom.V(0, Ceiling-10, 0), Rot: rot, Vel: geom.V(hx, 250, 0)}
		got := ceilingCushion(fs, rot.Forward(), 10)
		h := geom.V(got.Vel.X, 0, got.Vel.Z)
		if math.Abs(h.Dot(right)) > 1e-6*h.Len() {
			t.Errorf("hx %g: bent toward %v, not across the right wing %v", hx, h, right)
		}
	}
	fs := FlightState{Pos: geom.V(0, Ceiling-10, 0), Rot: rot, Vel: geom.V(2e-6*250, 250, 0)}
	got := ceilingCushion(fs, rot.Forward(), 10)
	if got.Vel.X <= 0 || math.Abs(got.Vel.Z) > 1e-9 {
		t.Errorf("outside the threshold the path should keep its +X heading: %v", got.Vel)
	}
}
