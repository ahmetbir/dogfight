package sim

const (
	LiftoffProtectTicks = 8 * 60 // protection after the wheels leave the ground
	FireProtectTicks    = 2 * 60 // a runway life that fires keeps at most this
)

// groundProtect keeps a runway spawn protected while it is on its wheels
// inside its own base; lift-off starts the LiftoffProtectTicks countdown and
// rolling out of the base ends protection at the boundary.
func (w *World) groundProtect(p *Plane) {
	if !p.GroundProtect {
		return
	}
	switch {
	case !p.Ground:
		p.GroundProtect = false
	case w.atOwnBase(p):
		p.ProtectUntil = w.tick + LiftoffProtectTicks
	default:
		p.GroundProtect = false
		p.ProtectUntil = min(p.ProtectUntil, w.tick)
	}
}

// atOwnBase reports whether p is inside its own base's footprint.
func (w *World) atOwnBase(p *Plane) bool {
	return w.cfg.Map != nil && w.cfg.Map.BaseAt(p.Pos.X, p.Pos.Z) == w.baseSide(p)
}

// CanSwap reports whether plane id may use its instant aircraft swap
// (Reseat): a runway life only while it has never left the ground and sits
// at its own base, an air life only while spawn-protected.
func (w *World) CanSwap(id ID) bool {
	p, ok := w.planes[id]
	if !ok || !p.Alive {
		return false
	}
	if p.RunwayStart {
		return p.GroundProtect && p.Ground && w.atOwnBase(p)
	}
	return w.tick < p.ProtectUntil
}

// protected reports spawn or ground protection.
func (w *World) protected(p *Plane) bool {
	return p.GroundProtect || w.tick < p.ProtectUntil
}

// endProtection runs when p fires: an air spawn loses protection at once
// (v1), a runway spawn keeps at most FireProtectTicks.
func (w *World) endProtection(p *Plane) {
	if !p.RunwayStart {
		p.ProtectUntil = 0
		return
	}
	p.GroundProtect = false
	p.ProtectUntil = min(p.ProtectUntil, w.tick+FireProtectTicks)
}
