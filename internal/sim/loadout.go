package sim

// Loadout is a sortie's missile mix, chosen on the pick screen.
type Loadout uint8

const (
	LoadIR    Loadout = iota // short range heat seekers (the zero value: v1/v2 missiles)
	LoadRadar                // medium range semi-active radar missiles, half the count
	LoadMixed                // half the IR missiles plus one radar missile
)

// MissileKind is a missile's seeker.
type MissileKind uint8

const (
	MissileIR    MissileKind = iota // fire-and-forget heat seeker; flares decoy it
	MissileRadar                    // semi-active: the launcher keeps the target in its nose; beaming breaks it
)

var loadoutKeys = [...]string{LoadIR: "ir", LoadRadar: "radar", LoadMixed: "mixed"}

func (l Loadout) String() string {
	if int(l) >= len(loadoutKeys) {
		return "unknown"
	}
	return loadoutKeys[l]
}

// ParseLoadout maps a wire name (ir|radar|mixed) to a loadout.
func ParseLoadout(s string) (Loadout, bool) {
	for l, k := range loadoutKeys {
		if k == s {
			return Loadout(l), true
		}
	}
	return LoadIR, false
}

// LoadoutCounts is the full (IR, radar) missile load of aircraft k with lo:
// IR = the aircraft's missiles, radar = max(1, ⌊missiles/2⌋), mixed =
// ⌊missiles/2⌋ IR + 1 radar. An unknown loadout counts as IR.
func LoadoutCounts(k Kind, lo Loadout) (ir, radar int) {
	n := SpecOf(k).Missiles
	switch lo {
	case LoadRadar:
		return 0, max(1, n/2)
	case LoadMixed:
		return n / 2, 1
	}
	return n, 0
}

// loadout is p's full (IR, radar) load this sortie.
func (p *Plane) loadout() (ir, radar int) { return LoadoutCounts(p.Kind, p.Loadout) }

// missileRefill is what a missile power-up adds to a kind whose full load
// is full: missilesRefill scaled by the kind's share of the aircraft's IR
// load, rounded up (IR loadout +2; a lone radar missile +1).
func missileRefill(full, aircraft int) int {
	if full <= 0 {
		return 0
	}
	return (missilesRefill*full + aircraft - 1) / max(1, aircraft)
}

// SetLoadout sets the loadout the plane's next spawn (or Reseat) takes; an
// unknown value is ignored.
func (w *World) SetLoadout(id ID, lo Loadout) {
	if p, ok := w.planes[id]; ok && int(lo) < len(loadoutKeys) {
		p.NextLoadout = lo
	}
}

// AddPlaneLoadout is AddPlane with the first sortie's loadout.
func (w *World) AddPlaneLoadout(id ID, team Team, kind Kind, lo Loadout) {
	if int(lo) >= len(loadoutKeys) {
		lo = LoadIR
	}
	if _, ok := w.planes[id]; ok {
		w.RemovePlane(id)
	}
	p := &Plane{ID: id, Team: team, NextKind: kind, NextLoadout: lo}
	w.insert(p)
	w.spawn(p, &w.pending)
}

// Refit re-arms a live plane in place with its next loadout (same aircraft,
// position, protection and life): both kinds full, regen timers idle, lock
// dropped. Used for a loadout-only pick during spawn protection.
func (w *World) Refit(id ID) {
	p, ok := w.planes[id]
	if !ok || !p.Alive {
		return
	}
	p.Loadout = p.NextLoadout
	p.Missiles, p.Radars = p.loadout()
	p.MissileRegenAt, p.RadarRegenAt = 0, 0
	p.LockTarget, p.LockTime, p.Locked, p.LockKind = 0, 0, false, MissileIR
}
