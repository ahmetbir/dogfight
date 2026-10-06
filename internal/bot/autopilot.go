// Package bot flies AI pilots: an autopilot that turns a desired direction
// into stick input, and a per-plane state-machine brain.
package bot

import (
	"math"

	"playground/internal/geom"
)

// Autopilot gains (stick per rad): proportional on the angle to the aim,
// derivative on the plane's own roll rate (sim.FlightState.W, stick per
// rad/s) against roll overshoot under the control inertia. Pitch and yaw
// damping were measured and only slowed the nose (FB-A report).
const (
	gainFine  = 8.0 // nose within 0.08 rad: pitch and yaw
	gainPull  = 3.5
	gainRoll  = 2.0
	gainDRoll = 0.1
)

// Steer returns stick input that turns an aircraft with orientation rot and
// body angular rate w toward the world direction dir: roll to put the target
// above the canopy, then pull. Ported to client/src/sim/autopilot.ts for
// mouse aim.
func Steer(rot geom.Quat, w, dir geom.Vec3) (pitch, roll, yaw float64) {
	l := rot.Conj().Rotate(dir.Norm()) // local: forward = -Z
	off := math.Acos(math.Max(-1, math.Min(1, -l.Z)))
	if off < 0.08 { // nearly on the nose: fine-tune with pitch and yaw, keep wings level
		return clamp(l.Y * gainFine), 0, clamp(l.X * gainFine)
	}
	bank := math.Atan2(l.X, l.Y) // 0 = target straight "above" the canopy
	if math.Abs(bank) > 2.4 {    // target below: push instead of rolling inverted
		return clamp(-off * 2), clamp((bank-math.Copysign(math.Pi, bank))*gainRoll + w.Z*gainDRoll), 0
	}
	pull := off * gainPull
	if math.Abs(bank) > 0.6 {
		pull *= 0.3 // roll first, then pull
	}
	return clamp(pull), clamp(bank*gainRoll + w.Z*gainDRoll), 0
}

func clamp(x float64) float64 { return math.Max(-1, math.Min(1, x)) }
