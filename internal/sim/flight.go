package sim

import (
	"math"

	"playground/internal/geom"
)

type FlightState struct {
	Pos      geom.Vec3
	Rot      geom.Quat
	Vel      geom.Vec3 // air-relative; the ground track adds the wind
	Throttle float64
	Gear     bool      // landing gear down
	Ground   bool      // rolling on the wheels
	W        geom.Vec3 // body angular rate (X pitch, Y yaw, Z roll), rad/s; zero on the wheels
	ABHeat   float64   // afterburner heat 0..1
	ABLock   bool      // afterburner locked out (heat reached 1, until it cools to ABUnlock)
}

// Afterburner budget (spec §3.0): heat rises ABHeatRise per second while the
// afterburner burns and falls ABHeatCool per second otherwise; at 1 the
// afterburner locks out until the heat is down to ABUnlock.
const (
	ABHeatRise = 1.0 / 15
	ABHeatCool = 1.0 / 25
	ABUnlock   = 0.3
)

// abHeat applies one tick of the afterburner budget; it returns whether the
// afterburner burns this tick (wanted and not locked at the tick start).
func abHeat(fs *FlightState, want bool) bool {
	ab := want && !fs.ABLock
	if ab {
		fs.ABHeat = min(1, fs.ABHeat+ABHeatRise*Dt)
	} else {
		fs.ABHeat = max(0, fs.ABHeat-ABHeatCool*Dt)
	}
	if fs.ABHeat >= 1 {
		fs.ABLock = true
	} else if fs.ABLock && fs.ABHeat <= ABUnlock {
		fs.ABLock = false
	}
	return ab
}

// Control inertia (spec §3.0): the stick sets a target rate per axis and
// the rate moves toward it at most Accel × the aircraft's max rate per
// second. Pushing (nose down) reaches PushRatio of the pull rate.
const (
	PushRatio  = 0.55
	PitchAccel = 2.5
	YawAccel   = 2.5
	RollAccel  = 3.0
)

// InducedDrag bleeds energy in turns: extra deceleration InducedDrag·(n−1)²
// with n − 1 = speed·|W pitch, yaw|/Gravity (spec §3.0). A 5 s max-rate
// turn from corner speed loses 20-30 m/s at full throttle and 5-11 m/s
// with the afterburner.
const InducedDrag = 0.2

// approach moves cur toward target by at most step.
func approach(cur, target, step float64) float64 {
	return cur + max(-step, min(step, target-cur))
}

type FlightMods struct {
	Turbo  bool
	Wind   geom.Vec3    // moves an airborne plane, never one on the ground
	Ground GroundSample // terrain under the plane at the start of the tick
}

// Authority scales control rates: 0.3 below stall, 1.0 at corner speed,
// falling linearly to 0.6 at afterburner top speed.
func Authority(speed float64, s Spec) float64 {
	switch {
	case speed < StallSpeed:
		return 0.3
	case speed < s.CornerSpeed:
		return 0.3 + 0.7*(speed-StallSpeed)/(s.CornerSpeed-StallSpeed)
	default:
		return 1 - 0.4*math.Min(1, (speed-s.CornerSpeed)/(s.MaxSpeedAB-s.CornerSpeed))
	}
}

// thrustOf returns the drag coefficient k (full throttle settles at MaxSpeed)
// and the engine thrust for throttle, afterburner and turbo. Shared by the
// air and ground steps; client/src/sim/thrust.ts mirrors it.
func thrustOf(s Spec, throttle float64, ab, turbo bool) (k, thrust float64) {
	k = s.Accel / (s.MaxSpeed * s.MaxSpeed)
	thrust = s.Accel * throttle
	if ab {
		thrust = k * s.MaxSpeedAB * s.MaxSpeedAB
	}
	if turbo {
		thrust *= 1.69 // equilibrium speed x1.3
	}
	return k, thrust
}

// StepFlight advances one fixed tick. Keep the operation order identical to
// client/src/sim/flight.ts; testdata/vectors/flight.json pins it.
func StepFlight(fs FlightState, in Input, s Spec, m FlightMods) FlightState {
	in = in.Clamp()
	in.AB = abHeat(&fs, in.AB)
	fs.Throttle = in.Throttle
	speed := fs.Vel.Len()
	fs.Gear = gearState(fs, in, speed)
	if fs.Ground {
		return stepGround(fs, in, s, m, speed)
	}
	fwd := fs.Rot.Forward()

	k, thrust := thrustOf(s, fs.Throttle, in.AB, m.Turbo)
	lf := speed * math.Sqrt(fs.W.X*fs.W.X+fs.W.Y*fs.W.Y) / Gravity // load factor n − 1
	induced := InducedDrag * lf * lf
	if fs.Gear {
		speed += (thrust - k*(1+GearDrag)*speed*speed - Gravity*fwd.Y - induced) * Dt
	} else {
		speed += (thrust - k*speed*speed - Gravity*fwd.Y - induced) * Dt
	}
	speed = math.Max(speed, 20)

	auth := Authority(speed, s)
	pitch := in.Pitch * s.PitchRate * auth
	if in.Pitch < 0 {
		pitch *= PushRatio
	}
	fs.W = geom.V(
		approach(fs.W.X, pitch, PitchAccel*s.PitchRate*Dt),
		approach(fs.W.Y, -in.Yaw*s.YawRate*auth, YawAccel*s.YawRate*Dt),
		approach(fs.W.Z, -in.Roll*s.RollRate*math.Max(auth, 0.5), RollAccel*s.RollRate*Dt))
	w := fs.W
	if a := w.Len() * Dt; a > 0 {
		fs.Rot = fs.Rot.Mul(geom.AxisAngle(w, a))
	}
	if speed < StallSpeed { // nose falls toward the ground
		fwd = fs.Rot.Forward()
		axis := fwd.Cross(geom.V(0, -1, 0))
		if axis.Len() > 1e-6 {
			drop := (StallSpeed - speed) / StallSpeed * 1.2 * Dt
			fs.Rot = geom.AxisAngle(axis, drop).Mul(fs.Rot)
		}
	}
	fs.Rot = fs.Rot.Norm()

	dir := fs.Vel.Norm()
	if dir == (geom.Vec3{}) {
		dir = fs.Rot.Forward()
	}
	dir = dir.Lerp(fs.Rot.Forward(), math.Min(1, Slip*Dt)).Norm()
	fs.Vel = dir.Scale(speed)
	if m.Wind == (geom.Vec3{}) { // keep the v1 expression bit-for-bit without wind
		fs.Pos = fs.Pos.Add(fs.Vel.Scale(Dt))
	} else {
		fs.Pos = fs.Pos.Add(fs.Vel.Add(m.Wind).Scale(Dt))
	}
	if fs.Pos.Y > Ceiling {
		fs.Pos.Y = Ceiling
		fs.Vel.Y = math.Min(fs.Vel.Y, 0)
	}
	if fs.Gear && fs.Pos.Y <= m.Ground.H+GearHeight { // touchdown, paved or not
		fs = settle(fs, m.Ground)
	}
	return fs
}
