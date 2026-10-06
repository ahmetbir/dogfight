package sim

import (
	"math"

	"playground/internal/geom"
	"playground/internal/maps"
)

// Ground model constants (spec §3.4). client/src/sim/ground.ts mirrors them.
const (
	GearHeight     = 2.5   // m: origin above the ground on the wheels
	GearDrag       = 0.8   // extra drag factor with the gear down
	GearMaxDeploy  = 140.0 // m/s: the gear cannot be lowered faster
	GearMaxSpeed   = 160.0 // m/s: airborne, the gear is forced up above this
	GroundThrust   = 0.3   // thrust scale while rolling
	RollDecel      = 0.4   // m/s²
	BrakeDecel     = 8.0   // m/s²
	SteerMax       = 0.7   // rad/s
	SteerRadius    = 20.0  // m: turn rate <= speed / SteerRadius
	SteerFadeSpeed = 80.0  // m/s: steering authority 1 → 0.15
	RotateRate     = 0.25  // rad/s nose-up at full pitch input
	MaxGroundPitch = 0.26  // rad
	LiftoffPitch   = 0.09  // rad
	MaxSinkRate    = 6.0   // m/s at touchdown
	MaxTouchBank   = 20 * math.Pi / 180
	TaxiMaxSpeed   = 35.0 // m/s on taxiways, apron and hangar floors (= GrassMaxSpeed; fix round 2: was 30)
	TaxiGovernor   = 28.0 // m/s: thrust (afterburner included) alone cannot push a plane past this off the runway
	// Rough ground (FB-A 5): unpaved terrain is survivable on the wheels
	// (landing.go judges speed and slope); it rolls heavier and bumps.
	GrassRoll     = 4.0   // rolling resistance × RollDecel off the pavement
	GrassBump     = 0.012 // rad: nose bob amplitude at GrassMaxSpeed
	GrassMaxSpeed = 35.0  // m/s: faster on unpaved ground is a crash
)

// grassBump is the deterministic small nose-pitch offset of rough ground at
// (x, z), growing with speed up to GrassMaxSpeed. It bobs the attitude, not
// the height, so the wheels' path stays smooth for prediction and drawing.
func grassBump(x, z, speed float64) float64 {
	return GrassBump * min(1, speed/GrassMaxSpeed) * math.Sin(0.9*x+0.4*z) * math.Cos(0.5*x-0.8*z)
}

// GroundSample is the terrain under a plane: height and paved surface.
type GroundSample struct {
	H    float64
	Surf maps.Surface
}

// gearState applies the gear rules (spec §3.3) to the desired state in.Gear.
func gearState(fs FlightState, in Input, speed float64) bool {
	switch {
	case fs.Ground:
		return true
	case fs.Gear && speed > GearMaxSpeed:
		return false
	case !in.Gear:
		return false
	case !fs.Gear && speed <= GearMaxDeploy:
		return true
	}
	return fs.Gear
}

// YawPitch is the wings-level orientation with the given heading and nose pitch.
func YawPitch(heading, pitch float64) geom.Quat {
	return geom.AxisAngle(geom.V(0, 1, 0), heading).Mul(geom.AxisAngle(geom.V(1, 0, 0), pitch)).Norm()
}

func headingPitch(q geom.Quat) (float64, float64) {
	f := q.Forward()
	return math.Atan2(-f.X, -f.Z), math.Asin(max(-1, min(1, f.Y)))
}

// stepGround rolls a plane on its wheels (spec §3.4). in is already clamped.
func stepGround(fs FlightState, in Input, s Spec, m FlightMods, speed float64) FlightState {
	heading, pitch := headingPitch(fs.Rot)
	rough := m.Ground.Surf == maps.SurfNone
	if rough { // take off last tick's bump (drawn at this position and speed)
		pitch -= grassBump(fs.Pos.X, fs.Pos.Z, speed)
	}
	fs.W = geom.Vec3{}
	k, thrust := thrustOf(s, fs.Throttle, in.AB, m.Turbo)
	thrust *= GroundThrust
	decel := RollDecel
	if rough {
		decel *= GrassRoll
	}
	if in.Brake {
		decel += BrakeDecel
	}
	coast := max(0, speed+(-k*(1+GearDrag)*speed*speed-decel)*Dt)
	speed = max(0, speed+(thrust-k*(1+GearDrag)*speed*speed-decel)*Dt)
	if m.Ground.Surf != maps.SurfRunway {
		// Taxi governor on taxi surfaces and rough ground: total thrust
		// (afterburner included) is cut at TaxiGovernor, so only momentum (a
		// fast turn-off from the runway) can exceed the 35 m/s crash limit.
		speed = max(coast, min(speed, TaxiGovernor))
	}
	steer := max(-1, min(1, in.Yaw+in.Roll))
	heading -= steer * min(SteerMax, speed/SteerRadius) * max(0.15, 1-speed/SteerFadeSpeed) * Dt
	if speed >= s.RotateSpeed && in.Pitch > 0 {
		pitch = min(MaxGroundPitch, pitch+RotateRate*in.Pitch*Dt)
	} else {
		pitch = max(0, pitch-RotateRate*Dt)
	}
	fs.Rot = YawPitch(heading, pitch)
	if speed >= s.RotateSpeed && pitch >= LiftoffPitch { // lift-off
		fs.Ground = false
		fs.Vel = fs.Rot.Forward().Scale(speed)
		fs.Pos = fs.Pos.Add(fs.Vel.Scale(Dt))
		return fs
	}
	fs.Vel = geom.V(-math.Sin(heading), 0, -math.Cos(heading)).Scale(speed)
	fs.Pos = fs.Pos.Add(fs.Vel.Scale(Dt))
	fs.Pos.Y = m.Ground.H + GearHeight
	if rough {
		fs.Rot = YawPitch(heading, pitch+grassBump(fs.Pos.X, fs.Pos.Z, speed))
	}
	return fs
}

// settle puts an airborne plane on its wheels (any ground; landing.go judges it): wings level, nose clipped to
// LiftoffPitch/2 (no bounce), horizontal velocity.
func settle(fs FlightState, g GroundSample) FlightState {
	heading, pitch := headingPitch(fs.Rot)
	h := math.Sqrt(fs.Vel.X*fs.Vel.X + fs.Vel.Z*fs.Vel.Z)
	fs.Rot = YawPitch(heading, max(0, min(LiftoffPitch/2, pitch)))
	fs.Vel = geom.V(-math.Sin(heading), 0, -math.Cos(heading)).Scale(h)
	fs.Pos.Y = g.H + GearHeight
	fs.Ground = true
	fs.W = geom.Vec3{}
	return fs
}
