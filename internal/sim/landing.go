package sim

import (
	"math"

	"playground/internal/geom"
	"playground/internal/maps"
	"playground/internal/terrain"
)

// GrassMaxSlope is the steepest unpaved ground the wheels survive.
const GrassMaxSlope = 12 * math.Pi / 180

// bank is the roll angle of q: 0 wings level, sign = right wing down.
func bank(q geom.Quat) float64 {
	r, u := q.Right(), q.Up()
	return math.Atan2(r.Y, u.Y)
}

func horizSpeed(v geom.Vec3) float64 { return math.Sqrt(v.X*v.X + v.Z*v.Z) }

// LandingOK judges a touchdown from the state of the tick before contact
// on surf; rough reports whether unpaved ground there is fit for wheels
// (dry, slope <= GrassMaxSlope).
func LandingOK(before FlightState, surf maps.Surface, rough bool) bool {
	if !(before.Vel.Y >= -MaxSinkRate) || math.Abs(bank(before.Rot)) > MaxTouchBank {
		return false
	}
	switch surf {
	case maps.SurfRunway:
		return true
	case maps.SurfTaxi:
		return horizSpeed(before.Vel) <= TaxiMaxSpeed
	}
	return rough && horizSpeed(before.Vel) <= GrassMaxSpeed
}

// roughOK: the terrain at (x, z) is dry land no steeper than GrassMaxSlope.
func (w *World) roughOK(x, z float64) bool {
	t := w.cfg.Terrain
	if !(t.Height(x, z) >= terrain.WaterLevel) {
		return false
	}
	const d = 2.0 // m: central difference step
	gx := (t.Ground(x+d, z) - t.Ground(x-d, z)) / (2 * d)
	gz := (t.Ground(x, z+d) - t.Ground(x, z-d)) / (2 * d)
	return math.Atan(math.Sqrt(gx*gx+gz*gz)) <= GrassMaxSlope
}

// landing kills a plane that touched down badly, rolled onto unfit or fast
// unpaved ground, or raced on a taxiway (crashes ignore protection).
func (w *World) landing(p *Plane, before FlightState, ev *[]Event) {
	if !p.Ground {
		return
	}
	if !before.Ground {
		x, z := before.Pos.X, before.Pos.Z
		if !LandingOK(before, w.groundAt(x, z).Surf, w.roughOK(x, z)) {
			w.kill(p, 0, WCrash, ev)
		}
		return
	}
	switch s, v := w.groundAt(p.Pos.X, p.Pos.Z).Surf, p.Vel.Len(); {
	case s == maps.SurfNone && (v > GrassMaxSpeed || !w.roughOK(p.Pos.X, p.Pos.Z)),
		s == maps.SurfTaxi && v > TaxiMaxSpeed:
		w.kill(p, 0, WCrash, ev)
	}
}
