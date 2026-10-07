package sim

import (
	"math"

	"playground/internal/geom"
)

const (
	LockHalfAngle   = 10 * math.Pi / 180
	LockSeconds     = 1.0
	MissileSpeed    = 420.0
	MissileAccel    = 200.0
	MissileTurn     = 3.2 // rad/s
	MissileLife     = 7 * 60
	MissileFuse     = 12.0
	MissileDmg      = 70.0
	MissileCooldown = 60
	// MissileGroundLoseTicks: a tracked target on its wheels this long
	// (continuously) is lost for good; a brief touch-and-go keeps the track.
	MissileGroundLoseTicks = 90
)

const (
	launchForward = 6.0  // m ahead of the nose
	launchDrop    = 2.0  // m below the fuselage
	launchBoost   = 30.0 // m/s added along the nose
	minClosing    = 50.0 // floor for time-to-go speed
)

// angleBetween returns the angle between two vectors; zero vectors give π/2.
func angleBetween(a, b geom.Vec3) float64 {
	return math.Acos(max(-1, min(1, a.Norm().Dot(b.Norm()))))
}

// updateLock tracks the airborne hostile plane closest to the nose inside
// the lock cone and the longest range of the missiles left; holding it for
// the lock time of the kind the missile key would fire (lockKind) sets
// Locked and emits EvLock. A plane on its wheels cannot be locked. A picked
// kind (pickedKind) locks only at that kind's range and time.
func (w *World) updateLock(p *Plane, pick MissilePick, ev *[]Event) {
	if p.Missiles <= 0 && p.Radars <= 0 {
		p.LockTarget, p.LockTime, p.Locked, p.LockKind = 0, 0, false, MissileIR
		return
	}
	irRange := w.lockRange(p.Kind)
	picked, fixed := pickedKind(p, pick)
	lockRange := irRange
	if fixed && picked == MissileRadar || !fixed && p.Radars > 0 {
		lockRange *= RadarRangeMul
	}
	fwd := p.Rot.Forward()
	var cand ID
	best := LockHalfAngle
	for _, id := range w.order {
		o := w.planes[id]
		if o.ID == p.ID || !o.Alive || o.Ground || !Hostile(p.Team, o.Team, w.cfg.FriendlyFire) { // no lock on wheels (FB-A 8)
			continue
		}
		to := o.Pos.Sub(p.Pos)
		if to.Len() > lockRange {
			continue
		}
		if a := angleBetween(fwd, to); a <= best {
			cand, best = o.ID, a
		}
	}
	switch {
	case cand == 0:
		p.LockTarget, p.LockTime, p.Locked, p.LockKind = 0, 0, false, MissileIR
		return
	case cand == p.LockTarget:
		p.LockTime += Dt
	default:
		p.LockTarget, p.LockTime, p.Locked = cand, 0, false
	}
	if p.LockKind = picked; !fixed {
		p.LockKind = lockKind(p, w.planes[cand].Pos.Dist(p.Pos), irRange)
	}
	locked := p.LockTime >= p.LockKind.LockSeconds()-1e-9 // 120 × Dt sums to just under 2
	if locked && !p.Locked {
		*ev = append(*ev, Event{Kind: EvLock, Plane: p.ID, Other: p.LockTarget, Missile: p.LockKind})
	}
	p.Locked = locked
}

// fireMissile launches at the locked target when ready.
func (w *World) fireMissile(p *Plane, in Input, ev *[]Event) {
	if !in.Missile || !p.Locked || w.tick < p.MissileReadyTick {
		return
	}
	switch {
	case p.LockKind == MissileRadar && p.Radars > 0:
		p.Radars--
	case p.LockKind == MissileIR && p.Missiles > 0:
		p.Missiles--
	default:
		return
	}
	p.MissileReadyTick = w.tick + MissileCooldown
	fwd := p.Rot.Forward()
	w.nextMissile++
	m := &Missile{
		ID:         w.nextMissile,
		Owner:      p.ID,
		Target:     p.LockTarget,
		Team:       p.Team,
		Pos:        p.Pos.Add(fwd.Scale(launchForward)).Sub(p.Rot.Up().Scale(launchDrop)),
		Vel:        p.Vel.Add(fwd.Scale(launchBoost)),
		ExpireTick: w.tick + MissileLife,
		Kind:       p.LockKind,
	}
	w.missiles = append(w.missiles, m)
	w.endProtection(p)
	*ev = append(*ev, Event{Kind: EvMissileLaunch, Plane: m.ID, Other: m.Target, Pos: m.Pos, By: p.ID, Missile: m.Kind})
}

// stepMissiles guides, moves and detonates missiles.
func (w *World) stepMissiles(ev *[]Event) {
	kept := w.missiles[:0]
	for _, m := range w.missiles {
		if !w.stepMissile(m, ev) {
			kept = append(kept, m)
		}
	}
	clear(w.missiles[len(kept):])
	w.missiles = kept
}

// stepMissile advances m one tick and reports whether it is gone.
func (w *World) stepMissile(m *Missile, ev *[]Event) bool {
	if w.tick >= m.ExpireTick {
		*ev = append(*ev, Event{Kind: EvMissileGone, Plane: m.ID, Pos: m.Pos})
		return true
	}
	tgt, ok := w.planes[m.Target]
	if !ok || !tgt.Alive || tgt.WheelsTicks >= MissileGroundLoseTicks { // FB-A 8 + fix ruling: 1.5 s on the wheels
		m.Target, tgt = 0, nil
	}
	if tgt != nil && m.Kind == MissileRadar && !w.radarTrack(m, tgt) { // semi-active leash or beaming: lost for good
		m.Target, tgt = 0, nil
	}
	var decoy *Flare
	if m.Decoy != 0 {
		if decoy = w.flare(m.Decoy); decoy == nil { // the flare burned out: self-destruct, no damage
			*ev = append(*ev, Event{Kind: EvMissileGone, Plane: m.ID, Pos: m.Pos})
			return true
		}
	}
	speed := m.Vel.Len()
	dir := m.Vel.Norm()
	switch {
	case decoy != nil:
		dir = turnToward(dir, decoy.Pos.Sub(m.Pos).Norm(), MissileTurn*Dt)
	case tgt != nil:
		tgo := tgt.Pos.Dist(m.Pos) / max(minClosing, speed)
		aim := tgt.Pos.Add(tgt.Vel.Scale(tgo))
		dir = turnToward(dir, aim.Sub(m.Pos).Norm(), MissileTurn*Dt)
	}
	speed = min(MissileSpeed, speed+MissileAccel*Dt)
	start := m.Pos
	m.Vel = dir.Scale(speed)
	m.Pos = m.Pos.Add(m.Vel.Scale(Dt))
	if tb, ok := w.missileSolid(start, m.Pos); ok {
		hitFirst := tgt != nil && segmentHitsSphere(start, start.Add(m.Pos.Sub(start).Scale(tb)), tgt.Pos, MissileFuse)
		if !hitFirst { // explode at the wall entry, not up to a tick's travel inside it
			*ev = append(*ev, Event{Kind: EvMissileGone, Plane: m.ID, Pos: start.Add(m.Pos.Sub(start).Scale(tb))})
			return true
		}
	}
	if decoy != nil && segmentHitsSphere(start, m.Pos, decoy.Pos, MissileFuse) { // reached the flare: no damage
		*ev = append(*ev, Event{Kind: EvMissileGone, Plane: m.ID, Pos: m.Pos})
		return true
	}
	if tgt != nil && segmentHitsSphere(start, m.Pos, tgt.Pos, MissileFuse) {
		w.damage(tgt, m.Owner, m.Kind.Damage(), WMissile, ev)
		*ev = append(*ev, Event{Kind: EvMissileGone, Plane: m.ID, Pos: m.Pos})
		return true
	}
	if m.Pos.Y < w.cfg.Terrain.Ground(m.Pos.X, m.Pos.Z) {
		*ev = append(*ev, Event{Kind: EvMissileGone, Plane: m.ID, Pos: m.Pos})
		return true
	}
	return false
}

// missileSolid is the first building, hangar wall or live target (base
// attack; missiles explode on them without damage) on a→b.
func (w *World) missileSolid(a, b geom.Vec3) (float64, bool) {
	if w.cfg.Map == nil {
		return 0, false
	}
	t, _, ok := w.cfg.Map.Solids.Sweep(a, b, 0)
	if w.structs != nil {
		if ts, _, sok := w.structSweep(a, b, 0, anyStruct); sok && (!ok || ts < t) {
			t, ok = ts, true
		}
	}
	return t, ok
}

// turnToward rotates unit vector cur toward unit vector want by at most maxAngle.
func turnToward(cur, want geom.Vec3, maxAngle float64) geom.Vec3 {
	if cur == (geom.Vec3{}) {
		return want
	}
	if want == (geom.Vec3{}) {
		return cur
	}
	angle := math.Acos(max(-1, min(1, cur.Dot(want))))
	axis := cur.Cross(want)
	if axis.Len() < 1e-9 {
		if angle < math.Pi/2 {
			return want // already aligned
		}
		axis = cur.Cross(geom.V(0, 1, 0)) // opposite: turn about any perpendicular
		if axis.Len() < 1e-9 {
			axis = cur.Cross(geom.V(1, 0, 0))
		}
	}
	return geom.AxisAngle(axis, min(angle, maxAngle)).Rotate(cur).Norm()
}

// lockRange is the aircraft's lock range scaled by the weather.
func (w *World) lockRange(k Kind) float64 {
	m := w.cfg.LockRangeMul
	if m <= 0 {
		m = 1
	}
	return SpecOf(k).LockRange * m
}
