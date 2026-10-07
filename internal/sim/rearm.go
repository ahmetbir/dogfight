package sim

import "math"

const (
	RearmTicks    = 3 * 60 // stopped this long on the own base: full rearm and repair
	RearmMaxSpeed = 3.0    // m/s
)

// needsRearm reports anything below full: HP, missiles of either kind, flares, bombs, or gun heat.
func (w *World) needsRearm(p *Plane) bool {
	s := SpecOf(p.Kind)
	ir, radar := p.loadout()
	return p.HP < s.MaxHP || p.Missiles < ir || p.Radars < radar || p.Flares < s.Flares || p.Bombs < w.cfg.Bombs || p.Heat > 0
}

// rearm counts ticks stopped on the own base (any base in FFA) and refills
// everything once RearmTicks pass. Step restarts the count on every shot and
// kill restarts it on death.
func (w *World) rearm(p *Plane, ev *[]Event) {
	side := -1
	if w.cfg.Map != nil {
		side = w.cfg.Map.BaseAt(p.Pos.X, p.Pos.Z)
	}
	own := side >= 0 && (p.Team == TeamNone || side == w.baseSide(p))
	if !p.Ground || math.Hypot(p.Vel.X, p.Vel.Z) >= RearmMaxSpeed || !own || !w.needsRearm(p) {
		p.RearmTicks = 0
		return
	}
	if p.RearmTicks++; p.RearmTicks < RearmTicks {
		return
	}
	s := SpecOf(p.Kind)
	p.RearmTicks = 0
	p.HP, p.Flares, p.Bombs = s.MaxHP, s.Flares, w.cfg.Bombs
	p.Missiles, p.Radars = p.loadout()
	p.Heat, p.OverheatUntil = 0, 0
	p.Damage = Damage{}
	p.MissileRegenAt, p.RadarRegenAt, p.FlareRegenAt = 0, 0, 0
	*ev = append(*ev, Event{Kind: EvRearm, Plane: p.ID, Pos: p.Pos})
}

// weaponClocks are p's weapon cooldowns; each shot moves one of them, so a
// change within a tick means p fired or dropped.
func weaponClocks(p *Plane) [4]int {
	return [4]int{p.GunReadyTick, p.MissileReadyTick, p.FlareReadyTick, p.BombReadyTick}
}
