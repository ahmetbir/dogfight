package bot

import (
	"math"

	"playground/internal/geom"
	"playground/internal/maps"
	"playground/internal/mode"
	"playground/internal/sim"
)

// Return to base (spec §7). Distances are along the runway from the
// threshold (negative = before it); heights are wheel heights above the runway.
const (
	rtbHPFrac    = 0.5
	rtbClear     = 2000.0 // m: no enemy this close
	approachDist = 2200.0 // m before the threshold: the outbound leg turns onto final here
	approachAGL  = 175.0  // m: height of that turn (inside the cleared corridor)
	outSlope     = 0.25   // outbound descent profile toward approachAGL
	latOut       = 200.0  // m: outbound leg offset from the centerline
	joinAhead    = 1200.0 // m: the outbound leg is joined at least this far before the turn
	joinReach    = 400.0  // m
	rtbSpeed     = 150.0
	outSpeed     = 130.0
	finalSpeed   = 100.0
	gearDist     = 3000.0
	glide        = 0.05 // ≈ 2.9°
	touchAlong   = 50.0 // m past the threshold: where the glide path meets the runway
	flareAGL     = 10.0
	terrainGap   = 120.0 // m above pathFloor away from the corridor
	maxGoArounds = 3     // per life (a rearm resets it); then no more returns, the bot fights on
)

// wantsRTB: out of missiles and below half health, or a bomber out of
// bombs (base attack), and no enemy within rtbClear.
func wantsRTB(self sim.Plane, planes []sim.Plane, bomber bool) bool {
	empty := self.Missiles+self.Radars == 0 && self.HP < rtbHPFrac*sim.SpecOf(self.Kind).MaxHP
	return (empty || bomber && self.Bombs == 0) && !enemyNear(self, planes)
}

// enemyNear: a live, airborne hostile within rtbClear. Planes on their
// wheels (parked, taxiing, rearming) never hold a return off (review I1:
// in FFA every plane at the home base is hostile).
func enemyNear(self sim.Plane, planes []sim.Plane) bool {
	for _, o := range planes {
		if o.ID != self.ID && o.Alive && !o.Ground && sim.Hostile(self.Team, o.Team, false) && o.Pos.Dist(self.Pos) < rtbClear {
			return true
		}
	}
	return false
}

// homeSide is the base a returning plane lands on: its team's, or the
// nearest one in FFA (any base rearms there).
func homeSide(self sim.Plane, m *maps.Map) int {
	switch self.Team {
	case sim.TeamNATO:
		return 0
	case sim.TeamSoviet:
		return 1
	}
	if m.Bases[1].Center.Dist(self.Pos) < m.Bases[0].Center.Dist(self.Pos) {
		return 1
	}
	return 0
}

// startRTB commits the plane to a return (X2: only an enemy within
// rtbClear cancels it, not missile regen).
func (b *Brain) startRTB(self sim.Plane, env *Env) {
	b.side, b.phase, b.outbound, b.missed = homeSide(self, env.Map), phRTB, false, false
	b.outSide = outboundSide(env.Terrain, runwayOf(env.Map.Bases[b.side]))
}

// land flies home, lands on the own runway and waits for the rearm.
func (b *Brain) land(s *sim.Snapshot, self sim.Plane, env *Env) sim.Input {
	base := env.Map.Bases[b.side]
	r := runwayOf(base)
	for range 3 { // a finished phase hands the tick to the next one
		switch b.phase {
		case phRTB:
			if in, ok := b.toFinal(self, r, env, s.Structures); ok {
				return in
			}
			b.phase = phFinal
		case phFinal:
			if self.Ground {
				b.phase = phRollout
				continue
			}
			if in, ok := b.final(s, self, r, env); ok {
				return in
			}
			if b.goArounds++; b.goArounds > maxGoArounds {
				b.phase = phAir
				return fly(self, self.Rot.Forward().Add(geom.V(0, 0.3, 0)), finalSpeed, false)
			}
			b.phase, b.outbound, b.missed = phRTB, false, true // go around
		case phRollout:
			if self.Vel.Len() > exitSpeed {
				u := self.Pos.Sub(base.Center).Dot(base.Axis)
				in := taxiInput(self, base.World(u+leadAhead, 0), 0)
				in.Throttle, in.Brake = 0, true
				return in
			}
			// clear the runway before the rearm (I2): taxi to the park spot
			b.route, b.wp, b.from, b.park, b.phase = exitRoute(base, self.Pos.Sub(base.Center).Dot(base.Axis)), 0, self.Pos, true, phTaxi
			in, _ := b.taxi(self, base)
			return in
		default:
			return b.rearm(self, base, env)
		}
	}
	return fly(self, self.Rot.Forward().Add(geom.V(0, 0.3, 0)), finalSpeed, false)
}

// toFinal flies to the outbound leg (lat = outSide·latOut, heading −u) and
// down it; ok=false once it is time to turn onto final.
func (b *Brain) toFinal(self sim.Plane, r rwy, env *Env, live []sim.Structure) (sim.Input, bool) {
	along, lat, h := r.at(self.Pos)
	if !b.missed && canFinal(along, lat, h, flat(self.Rot.Forward()).Dot(r.axis)) {
		return sim.Input{}, false
	}
	lo := b.outSide * latOut
	floor := pathFloor(env.Terrain, self, env.Wind) - r.th.Y - sim.GearHeight + terrainGap
	v := self.Vel.Len()
	if !b.outbound {
		j := math.Max(-approachDist+joinAhead, math.Min(300, along))
		jp := r.point(j, lo)
		to := geom.V(jp.X-self.Pos.X, 0, jp.Z-self.Pos.Z)
		if to.Len() > joinReach {
			vz := towardH(math.Max(outH(j), floor), h, v)
			aim := to.Norm().Scale(math.Sqrt(v*v - vz*vz))
			aim.Y = vz
			return transit(self, aim, vz, rtbSpeed, env, live), true
		}
		b.outbound = true
	}
	if along < -approachDist {
		b.outbound, b.missed = false, false
		return sim.Input{}, false
	}
	vz := towardH(math.Max(outH(along), floor), h, v)
	pref := r.inner.Scale(lo - lat)
	if math.Abs(lo-lat) < 30 {
		pref = r.inner.Scale(-lo) // on the leg: reverse toward the centerline
	}
	aim := trackAim(self, r.point(0, lo), r.axis.Scale(-1), 500, 1.0, v, vz, env.Wind, pref)
	return transit(self, aim, vz, outSpeed, env, live), true
}

// towardH is the vertical speed toward height hT: dives up to 0.7·v and
// climbs up to 0.8·v (mountain ridges on dag).
func towardH(hT, h, v float64) float64 {
	return math.Max(-0.7*v, math.Min(0.8*v, 0.5*(hT-h)))
}

// transit flies aim with afterburner on steep climbs and pulls up hard when
// the next seconds of straight flight pass close to the ground or to a
// building, hangar or live target (review m1).
func transit(self sim.Plane, aim geom.Vec3, vz, speed float64, env *Env, live []sim.Structure) sim.Input {
	if _, solid := avoidSolids(self, env.Map, live); solid || terrainAhead(self, env) {
		fwd := self.Rot.Forward()
		aim, vz = geom.V(fwd.X, 0.9, fwd.Z), speed
	}
	in := fly(self, aim, speed, false)
	if vz > 0.3*self.Vel.Len() {
		in.Throttle, in.AB = 1, true
	}
	return in
}

// terrainAhead: the next 4 s of flight (with the wind) pass within 60 m of the ground.
func terrainAhead(self sim.Plane, env *Env) bool {
	gv := self.Vel.Add(geom.V(env.Wind.X, 0, env.Wind.Z))
	for s := 0.5; s <= 4; s += 0.5 {
		p := self.Pos.Add(gv.Scale(s))
		if p.Y < env.Terrain.Ground(p.X, p.Z)+60 {
			return true
		}
	}
	return false
}

func outH(along float64) float64 {
	return approachAGL + outSlope*math.Max(0, along+approachDist)
}

// canFinal: heading within 45° of the runway, far enough out and close
// enough to the centerline and glide path to intercept both.
func canFinal(along, lat, h, cosHdg float64) bool {
	out := -along - 900
	return cosHdg > 0.7 && along > -approachDist-400 && along < -1500 &&
		math.Abs(lat) < 0.5*out && h < glideH(along)+0.25*out && h > glideH(along)-40
}

func glideH(along float64) float64 { return glide * (touchAlong - along) }

// final flies the centerline and the glide path, crabbed into the base
// wind, flares at flareAGL; ok=false asks for a go-around.
func (b *Brain) final(s *sim.Snapshot, self sim.Plane, r rwy, env *Env) (sim.Input, bool) {
	along, lat, h := r.at(self.Pos)
	v := self.Vel.Len()
	hdg := flat(self.Rot.Forward()).Dot(r.axis)
	hG := glideH(along)
	if along > -600 && h > 3 && (math.Abs(lat) > 12 || h-hG > 25 || hG-h > 15 || hdg < 0.97) {
		return sim.Input{}, false
	}
	if along > -1500 && h > 3 && zoneBusy(s, self, env.Map.Bases[b.side]) {
		return sim.Input{}, false // someone on the runway where we would touch down (I2)
	}
	sink := 0.3 // steep capture far out, a stable glide close in
	if along < -1000 {
		sink = 0.6
	}
	vz := math.Max(-sink*v, math.Min(0.15*v, -glide*v+0.4*(hG-h)))
	if hdg < 0.5 { // still turning onto final: hold height
		vz = math.Max(-0.1*v, math.Min(0.15*v, 0.5*(math.Max(h, hG)-h)))
	}
	if h < flareAGL {
		vz = -(2 + 0.3*h)
	}
	look, cut := 400.0, 0.8
	if along > -1200 {
		look, cut = 300, 0.35
	}
	aim := trackAim(self, r.th, r.axis, look, cut, v, vz, env.Wind, r.inner.Scale(-lat))
	in := fly(self, aim, finalSpeed, along > -gearDist)
	if h < 30 { // wings level near the ground; the rudder steers
		in.Roll = clamp(2 * self.Rot.Right().Y)
	}
	return in, true
}

// rearm holds the brakes on the park spot until the plane is full, then
// taxis to the lineup.
func (b *Brain) rearm(self sim.Plane, base maps.Base, env *Env) sim.Input {
	if self.RearmTicks == 0 && !needsAmmo(self, env) {
		b.route, b.wp, b.from, b.dir, b.phase, b.goArounds = lineupRoute(base), 0, self.Pos, 1, phTaxi, 0
		b.bombMisses = 0 // a new sortie
	}
	return sim.Input{Brake: true, Gear: true}
}

// needsAmmo: the rearm is not complete yet; in base attack it also waits
// for the bombs.
func needsAmmo(p sim.Plane, env *Env) bool {
	s := sim.SpecOf(p.Kind)
	ir, radar := sim.LoadoutCounts(p.Kind, p.Loadout)
	return p.HP < s.MaxHP || p.Missiles < ir || p.Radars < radar || env.Mode == mode.Base && p.Bombs < 2+s.ExtraBombs
}
