package bot

import (
	"math"

	"playground/internal/geom"
	"playground/internal/maps"
	"playground/internal/sim"
	"playground/internal/terrain"
)

const (
	terrainMargin  = 150.0  // m above ground the path must keep
	terrainHorizon = 8.0    // s of path checked (scaled with speed)
	terrainMinLook = 1500.0 // m: shortest look-ahead
	lookStep       = 100.0  // m between path samples
	maxClimbGrad   = 0.6    // steeper ridges are turned away from, not climbed head-on
	avoidSlack     = 0.1    // gradient shortfall that takes over the stick
	avoidCommit    = 60     // ticks an escape heading is kept while the threat lasts (no flip-flop)
	aimMargin      = 80.0   // m: clearance of an aim while the path is fine
	aimHorizon     = 5.0    // s
	aimMinLook     = 1000.0 // m
)

// escapeTurns are the heading offsets (rad) tried when a ridge is too steep
// to climb, smallest turn first.
var escapeTurns = [...]float64{0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.2, -2.2, math.Pi}

// avoidTerrain compares the plane's flight path angle (velocity and nose, so
// a turn or pull in progress is seen) with the gradient needed to stay
// terrainMargin above the ground over the next terrainHorizon seconds. When
// the path falls short it climbs on the current heading, or, when the
// ground ahead needs more than maxClimbGrad (dag ridges), climbs while
// turning toward the heading that needs the least.
func avoidTerrain(self sim.Plane, t *terrain.Map) (geom.Vec3, bool) {
	look := lookAhead(self)
	fwd := self.Rot.Forward()
	nose, vel := flat(fwd), flat(self.Vel)
	if nose == (geom.Vec3{}) {
		nose = vel
	}
	need := math.Max(needGrad(self.Pos, vel, look, terrainMargin, t), needGrad(self.Pos, nose, look, terrainMargin, t))
	if math.Min(grad(self.Vel), grad(fwd)) >= need-avoidSlack {
		return geom.Vec3{}, false
	}
	if fwd.Y < -0.2 { // diving: pull straight up, a turn would roll the lift away
		return geom.V(nose.X, 1, nose.Z).Norm(), true
	}
	if need <= maxClimbGrad { // climbable: climb on the nose heading (inbound when outside the bounds)
		h := nose
		if dir, ok := boundary(self, boundsLimit); ok {
			h = flat(turnBehind(self, dir))
		}
		return geom.V(h.X, need+0.25, h.Z).Norm(), true
	}
	best := nose
	for _, a := range escapeTurns[1:] {
		h := geom.AxisAngle(geom.V(0, 1, 0), a).Rotate(nose)
		if n := needGrad(self.Pos, h, look, terrainMargin, t); n < need-0.05 {
			best, need = h, n
		}
	}
	up := math.Max(0.3, math.Min(1.2, need+0.25))
	return geom.V(best.X, up, best.Z).Norm(), true
}

// safeAim raises an aim whose path would come closer than aimMargin to the
// ground ahead, so an attack, evasion or patrol never flies the plane into a
// slope it cannot pull out of (avoidTerrain handles a path already short).
func safeAim(self sim.Plane, aim geom.Vec3, t *terrain.Map) geom.Vec3 {
	h := flat(aim)
	if h == (geom.Vec3{}) {
		return aim
	}
	need := needGrad(self.Pos, h, math.Max(aimMinLook, self.Vel.Len()*aimHorizon), aimMargin, t)
	if grad(aim) >= need {
		return aim
	}
	return geom.V(h.X, math.Min(1.2, need+0.15), h.Z).Norm()
}

// turnBehind replaces an aim behind the plane with a level-ish 70° turn
// toward its side: Steer pushes the nose down for a target straight behind,
// which near the ground fights avoidTerrain and flies the plane out of bounds.
func turnBehind(self sim.Plane, aim geom.Vec3) geom.Vec3 {
	fwd, h := flat(self.Rot.Forward()), flat(aim)
	if fwd == (geom.Vec3{}) || fwd.Dot(h) > -0.3 {
		return aim
	}
	right := geom.V(-fwd.Z, 0, fwd.X)
	side := 1.0
	if right.Dot(h) < 0 {
		side = -1
	}
	t := fwd.Scale(math.Cos(1.2)).Add(right.Scale(side * math.Sin(1.2)))
	return geom.V(t.X, math.Max(0, aim.Norm().Y), t.Z).Norm()
}

func lookAhead(self sim.Plane) float64 {
	return math.Max(terrainMinLook, self.Vel.Len()*terrainHorizon)
}

// needGrad is the climb gradient from p along horizontal dir that keeps
// margin over every ground sample within look.
func needGrad(p, dir geom.Vec3, look, margin float64, t *terrain.Map) float64 {
	worst := math.Inf(-1)
	for d := lookStep; d <= look; d += lookStep {
		q := p.Add(dir.Scale(d))
		worst = math.Max(worst, (t.Ground(q.X, q.Z)+margin-p.Y)/d)
	}
	return worst
}

// grad is the climb gradient of v (rise over horizontal run).
func grad(v geom.Vec3) float64 {
	return v.Y / math.Max(1e-6, math.Hypot(v.X, v.Z))
}

const (
	solidHorizon = 2.0  // s of path checked against buildings
	solidMargin  = 30.0 // m clearance kept from buildings and hangars
)

// avoidSolids pulls up when the next solidHorizon seconds of straight flight
// pass within solidMargin of a building, a hangar or a live base attack
// target (live: the snapshot's structures, in m.Structures order).
func avoidSolids(self sim.Plane, m *maps.Map, live []sim.Structure) (geom.Vec3, bool) {
	end := self.Pos.Add(self.Vel.Scale(solidHorizon))
	if _, _, hit := m.Solids.Sweep(self.Pos, end, solidMargin); !hit && !targetAhead(self.Pos, end, m, live) {
		return geom.Vec3{}, false
	}
	fwd := self.Rot.Forward()
	return geom.V(fwd.X, 0.7, fwd.Z).Norm(), true
}

// targetAhead: segment a→b passes within solidMargin of a live target.
func targetAhead(a, b geom.Vec3, m *maps.Map, live []sim.Structure) bool {
	g := geom.V(solidMargin, solidMargin, solidMargin)
	for i, st := range live {
		if !st.Alive || i >= len(m.Structures) {
			continue
		}
		bx := m.Structures[i].Box
		if _, hit := maps.SegBox(a, b.Sub(a), bx.Min.Sub(g), bx.Max.Add(g)); hit {
			return true
		}
	}
	return false
}
