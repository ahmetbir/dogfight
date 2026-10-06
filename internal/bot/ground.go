package bot

import (
	"math"

	"playground/internal/geom"
	"playground/internal/maps"
	"playground/internal/sim"
	"playground/internal/terrain"
)

type phase uint8

const (
	phAir phase = iota
	phTaxi
	phLineup
	phTakeoff
	phClimb
	phRTB
	phFinal
	phRollout
	phRearm
)

const (
	taxiSpeed    = 25.0  // m/s on straight taxiways (below the 30 m/s limit)
	turnSpeed    = 10.0  // m/s while turning hard (turn radius ≈ 23 m)
	wpReach      = 22.0  // m: next waypoint (≈ the turn radius at turnSpeed)
	taxiBrake    = 3.0   // m/s²: planned deceleration toward a corner
	runwaySpeed  = 45.0  // m/s: taxiing along the runway to the exit
	taxiOffTrack = 25.0  // m off the taxi leg: brake (spec §7)
	gearUpAGL    = 50.0  // m
	climbAGL     = 400.0 // m: hand over to the air logic
	climbClear   = 200.0 // m: ... once also this high above every peak within climbRadius
	climbRadius  = 2000.0
	leadAhead    = 150.0 // m: centerline lead point on the runway
)

func flat(v geom.Vec3) geom.Vec3 { return geom.V(v.X, 0, v.Z).Norm() }

// headingErr is the signed horizontal angle from fwd to to, + = to the right.
func headingErr(fwd, to geom.Vec3) float64 {
	f, d := flat(fwd), flat(to)
	return math.Atan2(f.X*d.Z-f.Z*d.X, f.X*d.X+f.Z*d.Z)
}

// crossTrack is the horizontal distance of p from the line through a and b.
func crossTrack(a, b, p geom.Vec3) float64 {
	d := geom.V(b.X-a.X, 0, b.Z-a.Z)
	ap := geom.V(p.X-a.X, 0, p.Z-a.Z)
	if d.Len() < 1e-6 {
		return ap.Len()
	}
	return math.Abs(d.Norm().Cross(ap).Y)
}

// taxiInput steers toward target at the given ground speed.
func taxiInput(self sim.Plane, target geom.Vec3, speed float64) sim.Input {
	e := headingErr(self.Rot.Forward(), target.Sub(self.Pos))
	want := speed
	if math.Abs(e) > 0.5 {
		want = turnSpeed
	}
	v := self.Vel.Len()
	return sim.Input{Yaw: clamp(2 * e), Throttle: math.Max(0, math.Min(0.5, (want-v)*0.15)), Brake: v > want+1, Gear: true}
}

// ground flies the runway phases; handled=false hands the tick to the air logic.
func (b *Brain) ground(s *sim.Snapshot, self sim.Plane, env *Env) (sim.Input, bool) {
	if env.Map == nil {
		return sim.Input{}, false
	}
	if b.phase == phAir {
		if !self.Ground {
			return sim.Input{}, false
		}
		b.startTaxi(self, env.Map) // just spawned in a hangar
	}
	base := env.Map.Bases[b.side]
	for { // a finished phase hands the same tick to the next one
		switch b.phase {
		case phTaxi:
			if b.wp == len(b.route)-1 && !b.park && !onRunway(base, self.Pos) && b.hold(s, self, base) {
				return sim.Input{Brake: true, Gear: true}, true // hold short
			}
			if in, ok := b.taxi(self, base); ok {
				return in, true
			}
			if b.park {
				b.park, b.phase = false, phRearm
				continue
			}
			b.phase = phLineup
		case phLineup:
			e := headingErr(self.Rot.Forward(), base.Axis.Scale(b.dir))
			if math.Abs(e) >= 0.05 {
				v := self.Vel.Len()
				return sim.Input{Yaw: clamp(3 * e), Throttle: math.Max(0, math.Min(0.3, (turnSpeed-v)*0.2)), Brake: v > turnSpeed+1, Gear: true}, true
			}
			if b.hold(s, self, base) {
				return sim.Input{Brake: true, Gear: true}, true // no takeoff roll into traffic
			}
			b.phase, b.holdStart = phTakeoff, 0
		case phTakeoff:
			if self.Ground {
				u := self.Pos.Sub(base.Center).Dot(base.Axis)
				in := taxiInput(self, base.World(u+b.dir*leadAhead, 0), 0)
				in.Throttle, in.AB, in.Brake = 1, true, false
				if self.Vel.Len() >= sim.SpecOf(self.Kind).RotateSpeed {
					in.Pitch = 1
				}
				return in, true
			}
			b.phase = phClimb
		case phClimb:
			agl := self.Pos.Y - env.Terrain.Ground(self.Pos.X, self.Pos.Z)
			if agl > climbAGL && s.Tick >= b.topTick { // the peaks around change slowly: sample twice a second
				b.top, b.topTick = terrainTop(env.Terrain, self.Pos, climbRadius), s.Tick+30
			}
			if agl > climbAGL && self.Pos.Y > b.top+climbClear {
				b.phase = phAir
				return sim.Input{}, false
			}
			aim := climbDir(self, base.Axis.Scale(b.dir), agl)
			if dir, ok := avoidTerrain(self, env.Terrain); ok && agl > gearUpAGL {
				aim = dir // valley walls (dag)
			} else if dir, ok := avoidSolids(self, env.Map, s.Structures); ok {
				aim = dir
			}
			in, inverted := upright(self)
			if !inverted {
				in = fly(self, aim, 0, false)
			}
			in.Throttle, in.AB, in.Gear = 1, true, agl < gearUpAGL
			return in, true
		case phRTB, phFinal, phRollout, phRearm:
			return b.land(s, self, env), true
		default:
			return sim.Input{}, false
		}
	}
}

// climbDir climbs at 0.35 rad along the runway, steeper above climbAGL
// (clearing a mountain valley), turning for the map center near the edge.
func climbDir(self sim.Plane, axis geom.Vec3, agl float64) geom.Vec3 {
	h := axis
	if dir, ok := boundary(self, boundsLimit-500); ok {
		h = dir
	}
	if agl > climbAGL {
		return h.Add(geom.V(0, 1, 0))
	}
	return h.Add(geom.V(0, 0.35, 0))
}

// terrainTop is the highest ground within r of p (sampled every 200 m).
func terrainTop(t *terrain.Map, p geom.Vec3, r float64) float64 {
	top := math.Inf(-1)
	for dz := -r; dz <= r; dz += 200 {
		for dx := -r; dx <= r; dx += 200 {
			if dx*dx+dz*dz <= r*r {
				top = math.Max(top, t.Ground(p.X+dx, p.Z+dz))
			}
		}
	}
	return top
}

// taxi follows the route; ok=false once the last waypoint is reached.
func (b *Brain) taxi(self sim.Plane, base maps.Base) (sim.Input, bool) {
	if b.wp < len(b.route) && b.route[b.wp].Sub(self.Pos).Len() < wpReach {
		b.from = b.route[b.wp]
		b.wp++
	}
	if b.wp >= len(b.route) {
		return sim.Input{}, false
	}
	in := taxiInput(self, b.route[b.wp], b.legSpeed(self, onRunway(base, self.Pos) && onRunway(base, b.route[b.wp])))
	if crossTrack(b.from, b.route[b.wp], self.Pos) > taxiOffTrack && self.Vel.Len() > turnSpeed {
		in.Throttle, in.Brake = 0, true
	}
	return in, true
}

// legSpeed is taxiSpeed (runwaySpeed along the runway, which has no taxi
// limit), slowed so the plane reaches a corner at turnSpeed. The last
// waypoint is always a corner: the turn onto the runway follows.
func (b *Brain) legSpeed(self sim.Plane, runway bool) float64 {
	top := taxiSpeed
	if runway {
		top = runwaySpeed
	}
	wp := b.route[b.wp]
	if b.wp+1 < len(b.route) && math.Abs(headingErr(wp.Sub(b.from), b.route[b.wp+1].Sub(wp))) < 0.5 {
		return top
	}
	d := math.Max(0, geom.V(wp.X-self.Pos.X, 0, wp.Z-self.Pos.Z).Len()-wpReach)
	return math.Min(top, math.Sqrt(turnSpeed*turnSpeed+2*taxiBrake*d))
}

// startTaxi picks the base and hangar the plane sits in and its route out.
func (b *Brain) startTaxi(self sim.Plane, m *maps.Map) {
	if b.side = m.BaseAt(self.Pos.X, self.Pos.Z); b.side < 0 {
		b.side = homeSide(self, m)
	}
	base := m.Bases[b.side]
	best, bestD := 0, math.Inf(1)
	for i, h := range base.Hangars {
		if d := h.Spawn.Sub(self.Pos).Len(); d < bestD {
			best, bestD = i, d
		}
	}
	b.route, b.wp, b.from, b.dir, b.phase = base.Waypoints(best), 0, self.Pos, 1, phTaxi
}
