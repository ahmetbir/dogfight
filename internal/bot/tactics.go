package bot

import (
	"math"

	"playground/internal/geom"
	"playground/internal/sim"
	"playground/internal/terrain"
)

const (
	boundsLimit     = 3500.0 // |x| or |z| beyond which the bot turns home
	threatRange     = 1200.0 // m: missiles closer than this are evaded
	collectHPFrac   = 0.4
	gunRange        = 800.0
	abRange         = 1500.0
	abSaveHeat      = 0.7 // afterburner heat above which an attack stops burning
	keepTargetRatio = 1.3
	patrolAlt       = 1200.0
	patrolClear     = 400.0 // m above the highest ground within 1.5 km
	patrolRadius    = 500.0 // m: inside this horizontal radius the bot circles
	collideHorizon  = 1.0   // s of look-ahead for plane-plane collisions
	collideMiss     = 40.0  // m: predicted miss distance that triggers a break
)

// boundary returns a horizontal heading toward the map center once the plane
// strays past limit on either axis.
func boundary(self sim.Plane, limit float64) (geom.Vec3, bool) {
	if math.Abs(self.Pos.X) <= limit && math.Abs(self.Pos.Z) <= limit {
		return geom.Vec3{}, false
	}
	return geom.V(-self.Pos.X, 0, -self.Pos.Z).Norm(), true
}

// threat returns the closest missile tracking self within the threat
// range of its kind (radar farther out).
func threat(self sim.Plane, missiles []sim.Missile) (sim.Missile, bool) {
	var best sim.Missile
	bestD := math.Inf(1)
	found := false
	for _, m := range missiles {
		if d := m.Pos.Dist(self.Pos); m.Target == self.ID && d < threatRangeOf(m.Kind) && d < bestD {
			best, bestD, found = m, d, true
		}
	}
	return best, found
}

// evadeDir is a break turn perpendicular to the missile's path, on the side
// closer to the current nose so the turn is short.
func evadeDir(self sim.Plane, m sim.Missile) geom.Vec3 {
	md := m.Vel.Norm()
	if md == (geom.Vec3{}) {
		md = self.Pos.Sub(m.Pos).Norm()
	}
	d := md.Cross(geom.V(0, 1, 0)).Norm()
	if d == (geom.Vec3{}) { // missile climbing/diving vertically
		d = self.Rot.Right()
	}
	if d.Dot(self.Rot.Forward()) < 0 {
		d = d.Scale(-1)
	}
	return d
}

// collect returns the direction to the nearest active power-up that fixes
// what the plane lacks: repair when HP is low, missiles when out.
func collect(self sim.Plane, pus []sim.Powerup) (geom.Vec3, bool) {
	needRepair := self.HP < collectHPFrac*sim.SpecOf(self.Kind).MaxHP
	needMissiles := self.Missiles+self.Radars == 0
	var best geom.Vec3
	bestD := math.Inf(1)
	for _, u := range pus {
		want := (u.Kind == sim.PURepair && needRepair) || (u.Kind == sim.PUMissiles && needMissiles)
		if d := u.Pos.Dist(self.Pos); u.Active && want && d < bestD {
			best, bestD = u.Pos, d
		}
	}
	if math.IsInf(bestD, 1) {
		return geom.Vec3{}, false
	}
	return best.Sub(self.Pos), true
}

// pickTarget returns the nearest live hostile plane; the current target is
// kept unless it is more than keepTargetRatio times farther (no flip-flop).
func pickTarget(self sim.Plane, planes []sim.Plane, current sim.ID) (sim.Plane, bool) {
	var near, cur sim.Plane
	nearD, curD := math.Inf(1), math.Inf(1)
	for _, o := range planes {
		if o.ID == self.ID || !o.Alive || !sim.Hostile(self.Team, o.Team, false) {
			continue
		}
		d := o.Pos.Dist(self.Pos)
		if d < nearD {
			near, nearD = o, d
		}
		if o.ID == current {
			cur, curD = o, d
		}
	}
	switch {
	case math.IsInf(nearD, 1):
		return sim.Plane{}, false
	case current != 0 && curD <= keepTargetRatio*nearD:
		return cur, true
	}
	return near, true
}

// leadPoint is where a bullet fired now meets the target, at constant velocity.
func leadPoint(self, target sim.Plane) geom.Vec3 {
	tof := target.Pos.Dist(self.Pos) / (sim.BulletSpeed + self.Vel.Len())
	return target.Pos.Add(target.Vel.Scale(tof))
}

// patrolDir heads for the map center at patrol altitude (at least
// patrolClear above the ground around, for the dag ridges), circling near it.
func patrolDir(self sim.Plane, t *terrain.Map) geom.Vec3 {
	to := geom.V(-self.Pos.X, 0, -self.Pos.Z)
	if to.Len() < patrolRadius {
		fwd := self.Rot.Forward()
		to = geom.V(fwd.X, 0, fwd.Z).Add(fwd.Cross(geom.V(0, 1, 0)).Scale(0.5))
		if to.Len() < 1e-6 {
			to = self.Rot.Right()
		}
	}
	to = to.Norm()
	alt := math.Max(patrolAlt, terrainTop(t, self.Pos, 1500)+patrolClear)
	return geom.V(to.X, math.Max(-0.4, math.Min(0.4, (alt-self.Pos.Y)/1000)), to.Z)
}

// avoidCollision breaks right (and away from the closest-approach point)
// when another plane will pass within collideMiss inside collideHorizon.
// Breaking right on both sides separates a head-on pair.
func avoidCollision(self sim.Plane, planes []sim.Plane) (geom.Vec3, bool) {
	for _, o := range planes {
		if o.ID == self.ID || !o.Alive {
			continue
		}
		rel, relV := o.Pos.Sub(self.Pos), o.Vel.Sub(self.Vel)
		v2 := relV.Dot(relV)
		if v2 < 1e-6 || rel.Dot(relV) >= 0 {
			continue
		}
		tca := -rel.Dot(relV) / v2
		miss := rel.Add(relV.Scale(tca))
		if tca > collideHorizon || miss.Len() > collideMiss {
			continue
		}
		return self.Rot.Forward().Add(self.Rot.Right()).Sub(miss.Norm()).Norm(), true
	}
	return geom.Vec3{}, false
}
