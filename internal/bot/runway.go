package bot

import (
	"math"

	"playground/internal/geom"
	"playground/internal/maps"
	"playground/internal/sim"
)

// Runway deconfliction (review I2): one plane at a time on the runway.
const (
	shortFinal  = 3000.0 // m before the threshold: an aligned plane below finalAGL is landing
	finalAGL    = 300.0
	zoneU       = 300.0   // runway u below which a plane on the ground blocks a landing
	exitSpeed   = 45.0    // m/s: the rollout turns into a taxi to the exit (no taxi limit on the runway)
	parkU       = 600.0   // taxiway spot (v = 120) where a landed plane rearms
	lineupU     = -700.0  // runway u of the lineup point
	rollDist    = 700.0   // m from the lineup a takeoff roll may use (worst lift-off ≈ 540 m)
	holdTimeout = 25 * 60 // ticks a bot waits for a busy runway before it goes anyway
)

// exitRoute leaves the runway at the u = +700 connector and parks on the
// taxiway clear of the hangar traffic. A rollout that stopped past the
// connector (runway u > 700) skips the centreline point behind it instead of
// turning around on the 45 m runway.
func exitRoute(b maps.Base, u float64) []geom.Vec3 {
	r := []geom.Vec3{b.World(700, 0), b.World(700, 60), b.World(700, 120), b.World(parkU, 120)}
	if u > 700 {
		return r[1:]
	}
	return r
}

// lineupRoute is the taxiway, the hold point and the lineup.
func lineupRoute(b maps.Base) []geom.Vec3 {
	return []geom.Vec3{b.World(-700, 120), b.World(-700, 40), b.World(-700, 0)}
}

func onRunway(b maps.Base, p geom.Vec3) bool { return b.Areas[0].Contains(p.X, p.Z) }

// runwayBusy: another live plane on the runway would meet our takeoff roll
// from the lineup (u = lineupU): one moving on it, or one standing within
// rollDist ahead of the lineup (alongside: the lower ID goes first); or a
// plane aligned on short final below finalAGL. A plane standing beyond the
// roll (e.g. parked at the far end) is not in the way.
func runwayBusy(s *sim.Snapshot, self sim.Plane, b maps.Base) bool {
	r := runwayOf(b)
	for _, o := range s.Planes {
		if o.ID == self.ID || !o.Alive {
			continue
		}
		if o.Ground {
			u := o.Pos.Sub(b.Center).Dot(b.Axis)
			moving := o.Vel.Len() > sim.RearmMaxSpeed
			inRoll := u < lineupU+rollDist && (u > lineupU+30 || (u > lineupU-30 && o.ID < self.ID))
			if onRunway(b, o.Pos) && (moving || inRoll) {
				return true
			}
			continue
		}
		along, lat, h := r.at(o.Pos)
		if along > -shortFinal && along < zoneU && h < finalAGL && math.Abs(lat) < 300 && flat(o.Rot.Forward()).Dot(r.axis) > 0.8 {
			return true
		}
	}
	return false
}

// hold reports whether to keep waiting for the runway: while it is busy,
// but at most holdTimeout; then the bot goes anyway (it rolls past a plane
// that stands still; planes on their wheels never ram).
func (b *Brain) hold(s *sim.Snapshot, self sim.Plane, base maps.Base) bool {
	if !runwayBusy(s, self, base) {
		b.holdStart = 0
		return false
	}
	if b.holdStart == 0 {
		b.holdStart = s.Tick + 1
	}
	return s.Tick+1-b.holdStart < holdTimeout
}

// zoneBusy: another plane stands or rolls on the runway before zoneU,
// where a landing would touch down and roll out.
func zoneBusy(s *sim.Snapshot, self sim.Plane, b maps.Base) bool {
	for _, o := range s.Planes {
		if o.ID != self.ID && o.Alive && o.Ground && onRunway(b, o.Pos) && o.Pos.Sub(b.Center).Dot(b.Axis) < zoneU {
			return true
		}
	}
	return false
}
