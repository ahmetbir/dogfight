package sim

import (
	"math"

	"playground/internal/geom"
)

const (
	PickupRadius    = 30.0
	PowerupRespawn  = 1200 // ticks (20 s)
	powerupSpots    = 8
	powerupHover    = 500.0 // m above ground
	missilesRefill  = 2
	repairHP        = 50.0
	turboTicks      = 600 // 10 s
	innerSpotRadius = 1800.0
	outerSpotRadius = 2600.0
)

// powerupCycle is the kind rotation over the spots. The shield was removed
// (FB-A 7); PUShield stays in the enum for the wire but never spawns.
var powerupCycle = [...]PowerupKind{PUMissiles, PURepair, PUTurbo}

// initPowerups places the 8 fixed crates: alternating inner/outer ring every
// 45°, kinds cycling powerupCycle (3 missiles, 3 repair, 2 turbo).
func (w *World) initPowerups() {
	w.powerups = make([]Powerup, powerupSpots)
	for i := range powerupSpots {
		r := outerSpotRadius
		if i%2 == 0 {
			r = innerSpotRadius
		}
		a := float64(i) * math.Pi / 4
		x, z := r*math.Cos(a), r*math.Sin(a)
		w.powerups[i] = Powerup{
			Spot:   i,
			Kind:   powerupCycle[i%len(powerupCycle)],
			Pos:    geom.V(x, w.cfg.Terrain.Ground(x, z)+powerupHover, z),
			Active: true,
		}
	}
}

// stepPowerups reactivates due crates and hands active ones to the first
// live plane (ID order) whose path this tick passed within PickupRadius.
func (w *World) stepPowerups(ev *[]Event) {
	for i := range w.powerups {
		u := &w.powerups[i]
		if !u.Active {
			if w.tick < u.RespawnTick {
				continue
			}
			u.Active = true
		}
		for _, id := range w.order {
			p := w.planes[id]
			if !p.Alive || !segmentHitsSphere(w.prev[id], p.Pos, u.Pos, PickupRadius) {
				continue
			}
			w.applyPowerup(p, u.Kind)
			u.Active = false
			u.RespawnTick = w.tick + PowerupRespawn
			*ev = append(*ev, Event{Kind: EvPickup, Plane: p.ID, Item: u.Kind, Pos: u.Pos, Value: float64(u.Spot)})
			break
		}
	}
}

func (w *World) applyPowerup(p *Plane, k PowerupKind) {
	switch k {
	case PUMissiles:
		ir, radar := p.loadout()
		n := SpecOf(p.Kind).Missiles
		p.Missiles = min(ir, p.Missiles+missileRefill(ir, n))
		p.Radars = min(radar, p.Radars+missileRefill(radar, n))
		p.MissileRegenAt, p.RadarRegenAt = 0, 0 // spec §3.2: the pickup restarts the regen interval
	case PURepair:
		p.HP = math.Min(SpecOf(p.Kind).MaxHP, p.HP+repairHP)
		p.Damage = Damage{}
	case PUTurbo:
		p.TurboUntil = w.tick + turboTicks
	}
}
