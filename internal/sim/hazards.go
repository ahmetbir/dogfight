package sim

import (
	"math"

	"playground/internal/terrain"
)

const (
	crashClearance   = 2.0
	boundsGraceTicks = 5 * 60 // ticks outside before damage
	boundsDPS        = 10.0   // damage per second after grace, applied once per second
	ramFactor        = 0.5    // damage = ramFactor * |relative velocity|
)

// damage applies dmg unless protected; emits EvHit and, at 0 HP, EvKill.
func (w *World) damage(p *Plane, by ID, dmg float64, weapon Weapon, ev *[]Event) {
	if !p.Alive || !(dmg > 0) || w.tick < p.ProtectUntil { // !(>) also rejects NaN
		return
	}
	zone := w.hitZone(weapon)
	if zone == ZoneCrit {
		dmg = p.HP // goes down whatever it had left
	}
	p.Damage.add(zone)
	p.HP -= dmg
	*ev = append(*ev, Event{Kind: EvHit, Plane: p.ID, Other: by, Pos: p.Pos, Value: dmg, Weapon: weapon, Zone: zone})
	if p.HP <= 0 {
		w.kill(p, by, weapon, ev)
	}
}

// kill ends p's life unconditionally and schedules its respawn.
func (w *World) kill(p *Plane, by ID, weapon Weapon, ev *[]Event) {
	p.HP = 0
	p.Alive = false
	p.RespawnTick = w.tick + RespawnTicks
	p.RearmTicks = 0
	p.LockTarget, p.LockTime, p.Locked = 0, 0, false
	*ev = append(*ev, Event{Kind: EvKill, Plane: p.ID, Other: by, Pos: p.Pos, Weapon: weapon})
}

// hazards applies terrain crashes, out-of-bounds damage and plane-plane rams.
func (w *World) hazards(ev *[]Event) {
	for _, id := range w.order {
		p := w.planes[id]
		if !p.Alive {
			continue
		}
		// Positive form: a non-finite position also counts as a crash, so a
		// corrupted plane is killed and respawned instead of lingering.
		if !(p.Pos.Y > w.cfg.Terrain.Ground(p.Pos.X, p.Pos.Z)+crashClearance) {
			w.kill(p, 0, WCrash, ev) // crashes ignore protection
			continue
		}
		wall := SpecOf(p.Kind).WallRadius()
		if w.cfg.Map != nil {
			if _, _, hit := w.cfg.Map.Solids.Sweep(w.prev[id], p.Pos, wall); hit {
				w.kill(p, 0, WCrash, ev)
				continue
			}
		}
		if w.structs != nil { // hangar targets stay hollow: their walls are solids already
			if _, _, hit := w.structSweep(w.prev[id], p.Pos, wall, w.solidStruct); hit {
				w.kill(p, 0, WCrash, ev)
				continue
			}
		}
		if math.Abs(p.Pos.X) > terrain.PlayHalf || math.Abs(p.Pos.Z) > terrain.PlayHalf {
			p.OutOfBounds += Dt
			// One hit per whole second past the grace period (not per tick):
			// counted in ticks so float accumulation cannot skip a second.
			if n := int(math.Round(p.OutOfBounds / Dt)); n > boundsGraceTicks && n%60 == 0 {
				w.damage(p, 0, boundsDPS, WBounds, ev)
			}
		} else {
			p.OutOfBounds = 0
		}
	}
	for i, ia := range w.order {
		for _, ib := range w.order[i+1:] {
			a, b := w.planes[ia], w.planes[ib]
			if !a.Alive || !b.Alive || w.protected(a) || w.protected(b) || a.Ground || b.Ground {
				continue // protected or on its wheels: neither rams nor is rammed
			}
			if !Hostile(a.Team, b.Team, w.cfg.FriendlyFire) {
				continue // teammates fly through each other unless friendly fire is on (loose formations with the big jets' spheres)
			}
			rel, relV := b.Pos.Sub(a.Pos), b.Vel.Sub(a.Vel)
			reach := SpecOf(a.Kind).RamRadius() + SpecOf(b.Kind).RamRadius()
			if !(rel.Len() < reach && rel.Dot(relV) < 0) { // positive form: NaN never rams
				continue
			}
			dmg := ramFactor * relV.Len()
			w.damage(a, b.ID, dmg, WRam, ev)
			w.damage(b, a.ID, dmg, WRam, ev)
		}
	}
}
