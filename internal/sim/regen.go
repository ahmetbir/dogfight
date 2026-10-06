package sim

const (
	MissileRegenTicks = 45 * 60 // +1 missile every 45 s in flight, up to half the loadout (FB-A 6)
	FlareRegenTicks   = 20 * 60 // +1 flare every 20 s below the loadout
)

// missileRegenCap is the in-flight regen ceiling of one missile kind:
// ceil(loadout/2), per kind (IR and radar on their own timers). Above
// it only a landing rearm or a missile power-up adds missiles (both capped
// at the loadout).
func missileRegenCap(loadout int) int { return (loadout + 1) / 2 }

// regen adds one to *count every `every` ticks while it is below limit. The
// timer starts on the first tick the count is seen below the limit and
// idles (0) once full.
func regen(count *int, limit int, at *int, tick, every int) {
	switch {
	case *count >= limit:
		*at = 0
	case *at == 0:
		*at = tick + every
	case tick >= *at:
		*count++
		*at = 0
		if *count < limit {
			*at = tick + every
		}
	}
}

func (w *World) regenAmmo(p *Plane) {
	s := SpecOf(p.Kind)
	ir, radar := p.loadout()
	regen(&p.Missiles, missileRegenCap(ir), &p.MissileRegenAt, w.tick, MissileRegenTicks)
	regen(&p.Radars, missileRegenCap(radar), &p.RadarRegenAt, w.tick, MissileRegenTicks)
	regen(&p.Flares, s.Flares, &p.FlareRegenAt, w.tick, FlareRegenTicks)
}
