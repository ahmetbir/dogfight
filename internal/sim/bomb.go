package sim

import (
	"math"

	"playground/internal/geom"
	"playground/internal/maps"
)

const (
	BombRadius    = 40.0
	BombStructDmg = 260.0
	BombPlaneDmg  = 80.0
	BombCooldown  = 30 // ticks
	BombLife      = 30 * 60

	bombIDBase ID = 1 << 25
)

// Bomb is a free-falling bomb: gravity only, no drag or wind.
type Bomb struct {
	ID, Owner  ID
	Team       Team
	Pos, Vel   geom.Vec3
	ExpireTick int
}

// dropBomb releases one bomb below p when asked, loaded and ready.
func (w *World) dropBomb(p *Plane, in Input, ev *[]Event) {
	if !in.Bomb || p.Bombs <= 0 || w.tick < p.BombReadyTick {
		return
	}
	p.Bombs--
	p.BombReadyTick = w.tick + BombCooldown
	w.nextBomb++
	bm := &Bomb{ID: bombIDBase + w.nextBomb, Owner: p.ID, Team: p.Team,
		Pos: p.Pos.Sub(p.Rot.Up().Scale(2)), Vel: p.Vel.Add(geom.V(0, -2, 0)), ExpireTick: w.tick + BombLife}
	w.bombs = append(w.bombs, bm)
	w.endProtection(p)
	*ev = append(*ev, Event{Kind: EvBombDrop, Plane: bm.ID, By: p.ID, Pos: bm.Pos, Vel: bm.Vel})
}

// stepBombs moves every bomb one tick; a bomb that meets a building, a live
// target or the ground, or runs out of time, explodes.
func (w *World) stepBombs(ev *[]Event) {
	kept := w.bombs[:0]
	for _, bm := range w.bombs {
		start := bm.Pos
		bm.Vel.Y -= Gravity * Dt
		end := bm.Pos.Add(bm.Vel.Scale(Dt))
		t, hit := math.Inf(1), false
		if w.cfg.Map != nil {
			t, _, hit = w.cfg.Map.Solids.Sweep(start, end, 0)
		}
		if ts, _, ok := w.structSweep(start, end, 0, anyStruct); ok && (!hit || ts < t) {
			t, hit = ts, true
		}
		at := end
		if hit {
			at = start.Lerp(end, t)
		} else if g := w.cfg.Terrain.Ground(end.X, end.Z); end.Y <= g {
			at, hit = geom.V(end.X, g, end.Z), true
		}
		if hit || w.tick >= bm.ExpireTick {
			w.explode(bm, at, ev)
			continue
		}
		bm.Pos = end
		kept = append(kept, bm)
	}
	clear(w.bombs[len(kept):])
	w.bombs = kept
}

// boxDist is the distance from p to box b, 0 inside.
func boxDist(p geom.Vec3, b maps.Box) float64 {
	c := geom.V(math.Max(b.Min.X, math.Min(p.X, b.Max.X)), math.Max(b.Min.Y, math.Min(p.Y, b.Max.Y)), math.Max(b.Min.Z, math.Min(p.Z, b.Max.Z)))
	return c.Dist(p)
}

// explode emits EvBombHit and applies blast damage, falling off linearly to
// 0 at BombRadius, to hostile live targets and hostile planes.
func (w *World) explode(bm *Bomb, at geom.Vec3, ev *[]Event) {
	*ev = append(*ev, Event{Kind: EvBombHit, Plane: bm.ID, By: bm.Owner, Pos: at})
	for i, s := range w.structs {
		if !s.Alive || !Hostile(bm.Team, structTeam(s), false) {
			continue
		}
		if d := boxDist(at, w.cfg.Map.Structures[i].Box); d < BombRadius {
			w.damageStruct(i, bm.Owner, BombStructDmg*(1-d/BombRadius), WBomb, at, ev)
		}
	}
	for _, id := range w.order {
		p := w.planes[id]
		if !p.Alive || p.ID == bm.Owner || !Hostile(bm.Team, p.Team, w.cfg.FriendlyFire) {
			continue
		}
		if d := p.Pos.Dist(at); d < BombRadius {
			w.damage(p, bm.Owner, BombPlaneDmg*(1-d/BombRadius), WBomb, ev)
		}
	}
}
