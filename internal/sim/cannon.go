package sim

import (
	"math"

	"playground/internal/geom"
)

const (
	GunInterval   = 4 // ticks → 15 rounds/s
	BulletSpeed   = 900.0
	BulletLife    = 72 // ticks (1.2 s)
	BulletDmg     = 6.0
	HeatPerShot   = 0.04
	HeatCool      = 0.25 // per second
	OverheatTicks = 120
)

const (
	muzzleOffset = 8.0
	gunSpread    = 0.004 // rad, max deviation per axis
)

// fireCannon spawns a bullet when the trigger is held and the gun is ready.
func (w *World) fireCannon(p *Plane, in Input, ev *[]Event) {
	if !in.Fire || w.tick < p.GunReadyTick || w.tick < p.OverheatUntil {
		return
	}
	fwd := p.Rot.Forward()
	yaw := (w.rng.Float64()*2 - 1) * gunSpread
	pitch := (w.rng.Float64()*2 - 1) * gunSpread
	dir := geom.AxisAngle(p.Rot.Up(), yaw).Mul(geom.AxisAngle(p.Rot.Right(), pitch)).Rotate(fwd)
	b := Bullet{
		Owner:      p.ID,
		Team:       p.Team,
		Pos:        p.Pos.Add(fwd.Scale(muzzleOffset)),
		Vel:        p.Vel.Add(dir.Scale(BulletSpeed)),
		ExpireTick: w.tick + BulletLife,
		Dmg:        BulletDmg,
		Weapon:     WCannon,
	}
	w.bullets = append(w.bullets, b)
	p.GunReadyTick = w.tick + GunInterval
	if w.tick >= p.TurboUntil {
		p.Heat += HeatPerShot
		if p.Heat >= 1 {
			p.Heat = 1
			p.OverheatUntil = w.tick + OverheatTicks
		}
	}
	w.endProtection(p)
	*ev = append(*ev, Event{Kind: EvFire, Plane: p.ID, Pos: b.Pos, Vel: b.Vel})
}

// stepBullets moves bullets one tick, applying swept hits against hostile
// planes; bullets that hit, hit the ground or expire are removed.
func (w *World) stepBullets(ev *[]Event) {
	kept := w.bullets[:0]
	for i := range w.bullets {
		if !w.stepBullet(&w.bullets[i], ev) {
			kept = append(kept, w.bullets[i])
		}
	}
	clear(w.bullets[len(kept):])
	w.bullets = kept
}

// stepBullet advances b in place and reports whether it is spent.
func (w *World) stepBullet(b *Bullet, ev *[]Event) bool {
	if w.tick >= b.ExpireTick {
		return true
	}
	end := b.Pos.Add(b.Vel.Scale(Dt))
	var hit *Plane
	best := math.Inf(1)
	for _, id := range w.order { // the nearest plane along the segment takes the hit
		p := w.planes[id]
		if !p.Alive || p.ID == b.Owner || !Hostile(b.Team, p.Team, w.cfg.FriendlyFire) {
			continue
		}
		if t, ok := segmentSphereT(b.Pos, end, p.Pos, HitRadius); ok && t < best {
			hit, best = p, t
		}
	}
	tb := math.Inf(1)
	if w.cfg.Map != nil {
		if t, _, ok := w.cfg.Map.Solids.Sweep(b.Pos, end, 0); ok {
			tb = t
		}
	}
	if w.structs != nil {
		// A target box wins ties: a hangar target shares its faces with the hangar walls.
		hostile := func(i int) bool { return Hostile(b.Team, structTeam(w.structs[i]), false) }
		if ts, i, ok := w.structSweep(b.Pos, end, 0, hostile); ok && ts < best && ts <= tb {
			dmg := b.Dmg
			if b.Weapon == WCannon {
				dmg *= StructCannonMul
			}
			w.damageStruct(i, b.Owner, dmg, b.Weapon, b.Pos.Lerp(end, ts), ev)
			return true
		}
	}
	if tb < best {
		return true // the building takes the round
	}
	if hit != nil {
		w.damage(hit, b.Owner, b.Dmg, b.Weapon, ev)
		return true
	}
	if end.Y < w.cfg.Terrain.Ground(end.X, end.Z) {
		return true
	}
	b.Pos = end
	return false
}

// segmentHitsSphere reports whether segment ab passes within r of c.
func segmentHitsSphere(a, b, c geom.Vec3, r float64) bool {
	_, ok := segmentSphereT(a, b, c, r)
	return ok
}

// segmentSphereT returns the segment parameter (0..1) of ab's closest
// approach to c, and whether that approach is within r.
func segmentSphereT(a, b, c geom.Vec3, r float64) (float64, bool) {
	ab := b.Sub(a)
	t := 0.0
	if l2 := ab.Dot(ab); l2 > 0 {
		t = math.Max(0, math.Min(1, c.Sub(a).Dot(ab)/l2))
	}
	return t, a.Add(ab.Scale(t)).Dist(c) <= r
}
