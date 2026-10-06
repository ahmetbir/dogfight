package bot

import (
	"math"

	"playground/internal/geom"
	"playground/internal/maps"
	"playground/internal/mode"
	"playground/internal/sim"
)

const (
	bombAGL       = 600.0 // m: level bombing run height (spec §7)
	bombRelease   = 30.0  // m: release when the predicted impact is this close
	bombRunIn     = 800.0 // m of straight run before the release point
	bombThrottle  = 0.6
	bombRidgeLook = 3000.0 // m of the way ahead kept bombRidgeGap clear
	bombRidgeGap  = 300.0
	// maxBombGoArounds runs without a drop per sortie; then the bomber
	// fights (escorts) until its next rearm or life
	maxBombGoArounds = 3
	bombTurnLook     = 2000.0 // m checked along a new heading before turning onto it
	bombLineHalf     = 600.0  // m: a run this far off its approach line starts over
	bombStartReach   = 400.0  // m from the run-in start that counts as there
)

// bombImpact is where a bomb released at pos with the plane's vel meets
// height groundY: release velocity vel + (0,−2,0), gravity only (spec §3.10).
func bombImpact(pos, vel geom.Vec3, groundY float64) geom.Vec3 {
	vy := vel.Y - 2
	h := pos.Y - groundY
	t := (vy + math.Sqrt(math.Max(0, vy*vy+2*sim.Gravity*h))) / sim.Gravity
	return geom.V(pos.X+vel.X*t, groundY, pos.Z+vel.Z*t)
}

// isBomber: in base attack every other plane of a team (by ID rank within
// the team: 1st, 3rd, 5th) is a bomber, so both sides bomb whatever the
// seating order of the room.
func isBomber(self sim.Plane, planes []sim.Plane, k mode.Kind) bool {
	if k != mode.Base {
		return false
	}
	rank := 0
	for _, p := range planes {
		if p.Team == self.Team && p.ID < self.ID {
			rank++
		}
	}
	return rank%2 == 0
}

// nearestTarget is the closest live enemy structure (s.Structures is in
// m.Structures order).
func nearestTarget(self sim.Plane, s *sim.Snapshot, m *maps.Map) (maps.StructDef, bool) {
	var best maps.StructDef
	bestD, found := math.Inf(1), false
	for i, st := range s.Structures {
		if i >= len(m.Structures) {
			break
		}
		d := m.Structures[i]
		if !st.Alive || !sim.Hostile(self.Team, sim.Team(d.Side+1), false) {
			continue
		}
		if dist := boxCenter(d.Box).Dist(self.Pos); dist < bestD {
			best, bestD, found = d, dist, true
		}
	}
	return best, found
}

func boxCenter(b maps.Box) geom.Vec3 { return b.Min.Add(b.Max).Scale(0.5) }

// bomberRole flies a level run at bombAGL over the nearest live enemy
// target and releases when the ballistic impact point is on it and the fall
// clears the terrain. A run that passes the release point without a drop
// extends out along the base's approach corridor (low ground, spec §4.3)
// and comes back up it; every run is flown up that corridor, never across
// the ridges around a base (dag valleys); after maxBombGoArounds such runs in a sortie the
// bomber fights instead. True when it set the aim this decision.
func (b *Brain) bomberRole(s *sim.Snapshot, self sim.Plane, env *Env) bool {
	if env.Map == nil || self.Bombs <= 0 || b.bombMisses >= maxBombGoArounds || !isBomber(self, s.Planes, env.Mode) {
		b.extend = false
		return false
	}
	tg, ok := nearestTarget(self, s, env.Map)
	if !ok {
		b.extend = false
		return false
	}
	c := boxCenter(tg.Box)
	ground := env.Terrain.Ground(c.X, c.Z)
	imp := bombImpact(self.Pos, self.Vel, ground)
	// the throw of a level release at bombAGL: where the run starts and ends,
	// whatever height the plane is at now
	lvl := bombImpact(geom.V(0, bombAGL, 0), geom.V(self.Vel.X, 0, self.Vel.Z), 0)
	throw := math.Hypot(lvl.X, lvl.Z)
	axis := env.Map.Bases[tg.Side].Axis
	start := c.Sub(axis.Scale(throw + bombRunIn + 200)) // the run-in starts here
	rel := geom.V(self.Pos.X-c.X, 0, self.Pos.Z-c.Z)
	onLine := rel.Dot(axis) < -throw/2 && rel.Sub(axis.Scale(rel.Dot(axis))).Len() < bombLineHalf
	switch {
	case b.extend && math.Hypot(start.X-self.Pos.X, start.Z-self.Pos.Z) < bombStartReach:
		b.extend = false
	case !b.extend && overshot(self, imp, c, throw):
		b.extend = true // the impact point passed the target: go around
		if !b.runDrop {
			b.bombMisses++ // a run without a drop
		}
		b.runDrop = false
	case !b.extend && !onLine:
		b.extend = true // off the approach line: fly to the run-in start first
	}
	goal := c
	if b.extend {
		goal = start
	}
	to := geom.V(goal.X-self.Pos.X, 0, goal.Z-self.Pos.Z)
	want := ground + bombAGL
	for d := lookStep; d < math.Min(to.Len(), bombRidgeLook); d += lookStep { // ridges on the way stay well below
		q := self.Pos.Add(to.Norm().Scale(d))
		want = math.Max(want, env.Terrain.Ground(q.X, q.Z)+bombRidgeGap)
	}
	to = to.Norm()
	dive := -0.3
	if !b.extend && self.Pos.Y-want > 300 {
		dive = -0.6 // high on the run-in (it crossed ridges to get here): get down to the run height
	}
	climb := math.Max(dive, math.Min(0.6, (want-self.Pos.Y)/400)) // climbs steeper: ridges
	if math.Abs(headingErr(self.Rot.Forward(), to)) > 0.5 {       // a hard turn
		climb = math.Max(climb, 0.05) // no descent: the pull dives the nose into valley walls
		if needGrad(self.Pos, to, bombTurnLook, terrainMargin, env.Terrain) > maxClimbGrad/2 {
			to = flat(self.Rot.Forward()) // a wall that way: climb out ahead before turning
			climb = 0.5
		}
	}
	b.aim = turnBehind(self, geom.V(to.X, climb, to.Z))
	b.throttle = bombThrottle
	if climb > 0.05 {
		b.throttle = 1
	}
	b.bomb = !b.extend && geom.V(imp.X-c.X, 0, imp.Z-c.Z).Len() < bombRelease && fallClear(self, imp, env)
	b.runDrop = b.runDrop || b.bomb
	return b.bombMisses < maxBombGoArounds
}

// overshot: heading at c, the impact point is already past it, or the
// plane is nearly over it.
func overshot(self sim.Plane, imp, c geom.Vec3, throw float64) bool {
	u := geom.V(c.X-self.Pos.X, 0, c.Z-self.Pos.Z)
	if u.Len() < throw/3 {
		return true
	}
	u = u.Norm()
	toward := flat(self.Vel).Dot(u) > math.Cos(0.5)
	return toward && imp.Sub(c).Dot(u) > 2*bombRelease
}

// fallClear: the bomb's fall from self toward impact stays above the
// terrain until its last bombRelease·2 m (a ridge on the way would catch it).
func fallClear(self sim.Plane, imp geom.Vec3, env *Env) bool {
	vy := self.Vel.Y - 2
	for t := 0.25; ; t += 0.25 {
		p := self.Pos.Add(geom.V(self.Vel.X*t, vy*t-0.5*sim.Gravity*t*t, self.Vel.Z*t))
		if math.Hypot(imp.X-p.X, imp.Z-p.Z) < 2*bombRelease || p.Y < imp.Y {
			return true
		}
		if p.Y < env.Terrain.Ground(p.X, p.Z)+5 {
			return false
		}
	}
}
