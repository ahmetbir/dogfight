package sim

import (
	"math"

	"playground/internal/geom"
	"playground/internal/maps"
)

const (
	spawnAlt    = 1500.0
	spawnAGL    = 600.0
	spawnSpeed  = 200.0
	spawnThrott = 0.8
	ffaRadius   = 3000.0
	teamSpawnX  = 3200.0 // m: each team's air spawn zone center, on its side of the map (FB-A 9)
	teamSpawnDX = 150.0  // m: depth jitter around teamSpawnX
	teamSpawnDZ = 1200.0 // m: lateral spread
	hangarClear = 25.0   // m: a live plane this close (horizontally) takes the hangar
	// An air spawn flies its nose toward the center: when the ground on that
	// path comes closer than spawnPathClear, the spawn rises to its top + spawnPathRaise.
	spawnPathClear = 150.0
	spawnPathRaise = 300.0
)

// pathTop is the highest ground on the straight line from (x, z) to the map center.
func (w *World) pathTop(x, z float64) float64 {
	d := math.Hypot(x, z)
	top := w.cfg.Terrain.Ground(x, z)
	for s := 25.0; s < d; s += 25 {
		f := 1 - s/d
		top = math.Max(top, w.cfg.Terrain.Ground(x*f, z*f))
	}
	return max(top, w.cfg.Terrain.Ground(0, 0))
}

// spawnPoint picks a team-side (or FFA ring) position from the world PRNG:
// the teams at opposite ends (NATO west, Soviet east), spread laterally.
func (w *World) spawnPoint(team Team) (x, z float64) {
	switch team {
	case TeamNATO, TeamSoviet:
		x = -teamSpawnX + (w.rng.Float64()*2-1)*teamSpawnDX
		z = (w.rng.Float64()*2 - 1) * teamSpawnDZ
		if team == TeamSoviet {
			x = -x
		}
		return x, z
	default:
		a := w.rng.Float64() * 2 * math.Pi
		return ffaRadius * math.Cos(a), ffaRadius * math.Sin(a)
	}
}

// spawn starts p's next life and emits EvSpawn: parked in a free hangar of
// its base on a runway start (in the air over the base when all are taken),
// otherwise in the air at its team's spawn zone.
func (w *World) spawn(p *Plane, ev *[]Event) {
	if w.cfg.Start == StartRunway && w.cfg.Map != nil {
		side := w.baseSide(p)
		if h, ok := w.freeHangar(p, side); ok {
			w.spawnParked(p, h, ev)
			return
		}
		c := w.cfg.Map.Bases[side].Center
		w.spawnAir(p, c.X, c.Z, ev)
		return
	}
	x, z := w.spawnPoint(p.Team)
	w.spawnAir(p, x, z, ev)
}

// baseSide is p's home base: NATO 0, Soviet 1, FFA by ID parity.
func (w *World) baseSide(p *Plane) int {
	switch p.Team {
	case TeamNATO:
		return 0
	case TeamSoviet:
		return 1
	}
	return int(p.ID % 2)
}

// freeHangar is the first open hangar of side with no other live plane
// within hangarClear of its spawn point.
func (w *World) freeHangar(p *Plane, side int) (maps.Hangar, bool) {
	for i, h := range w.cfg.Map.Bases[side].Hangars {
		if w.hangarClosed(side, i) {
			continue
		}
		taken := false
		for _, id := range w.order {
			q := w.planes[id]
			if q.ID != p.ID && q.Alive && math.Hypot(q.Pos.X-h.Spawn.X, q.Pos.Z-h.Spawn.Z) < hangarClear {
				taken = true
				break
			}
		}
		if !taken {
			return h, true
		}
	}
	return maps.Hangar{}, false
}

// hangarClosed reports whether the hangar target covering slot of side is destroyed.
func (w *World) hangarClosed(side, slot int) bool {
	if w.structs == nil {
		return false
	}
	for i, d := range w.cfg.Map.Structures {
		if d.Side == side && d.Hangar == slot && !w.structs[i].Alive {
			return true
		}
	}
	return false
}

// fresh is p's next life: full health and its next loadout, nothing else.
func (w *World) fresh(p *Plane) Plane {
	s := SpecOf(p.NextKind)
	ir, radar := LoadoutCounts(p.NextKind, p.NextLoadout)
	return Plane{ID: p.ID, Kind: p.NextKind, NextKind: p.NextKind, Team: p.Team, HP: s.MaxHP, Alive: true,
		Missiles: ir, Radars: radar, Flares: s.Flares, Life: p.Life + 1, Bombs: w.sortieBombs(p.NextKind),
		Loadout: p.NextLoadout, NextLoadout: p.NextLoadout}
}

// spawnAir puts p at altitude over (x, z), nose toward the map center.
func (w *World) spawnAir(p *Plane, x, z float64, ev *[]Event) {
	alt := math.Max(spawnAlt, w.cfg.Terrain.Ground(x, z)+spawnAGL)
	if top := w.pathTop(x, z); alt < top+spawnPathClear { // a ridge between the spawn and the center (dag)
		alt = math.Min(Ceiling-100, top+spawnPathRaise)
	}
	pos := geom.V(x, alt, z)
	rot := geom.Identity()
	if toCenter := geom.V(-x, 0, -z); toCenter.Len() > 1e-6 { // horizontal, never ∥ up
		rot = geom.LookRotation(toCenter, geom.V(0, 1, 0))
	}
	*p = w.fresh(p)
	p.FlightState = FlightState{Pos: pos, Rot: rot, Vel: rot.Forward().Scale(spawnSpeed), Throttle: spawnThrott}
	p.ProtectUntil = w.tick + ProtectTicks
	w.prev[p.ID] = pos
	*ev = append(*ev, Event{Kind: EvSpawn, Plane: p.ID, Pos: pos, Vel: p.Vel})
}

// spawnParked puts p on its wheels in hangar h, facing out, engine idle,
// parking brake set (see parkingBrake).
func (w *World) spawnParked(p *Plane, h maps.Hangar, ev *[]Event) {
	pos := h.Spawn.Add(geom.V(0, GearHeight, 0))
	*p = w.fresh(p)
	p.FlightState = FlightState{Pos: pos, Rot: YawPitch(h.Heading, 0), Gear: true, Ground: true}
	p.RunwayStart, p.GroundProtect = true, true
	p.Parked, p.ParkedTick = true, w.tick
	p.ProtectUntil = w.tick + LiftoffProtectTicks
	w.prev[p.ID] = pos
	*ev = append(*ev, Event{Kind: EvSpawn, Plane: p.ID, Pos: pos})
}

// ParkGraceTicks is how long a fresh parking brake ignores thrust requests:
// inputs sent before the client saw the spawn still carry the last life's
// throttle.
const ParkGraceTicks = 30

// parkingBrake holds a parked plane (throttle 0, no afterburner, brakes on)
// until its pilot asks for thrust after ParkGraceTicks; then it is released
// for the rest of the life.
func (w *World) parkingBrake(p *Plane, in Input) Input {
	if !p.Parked || !p.Ground { // a parked plane is on its wheels; anything else is released
		p.Parked = false
		return in
	}
	if (in.Throttle > 0 || in.AB) && w.tick-p.ParkedTick >= ParkGraceTicks {
		p.Parked = false
		return in
	}
	in.Throttle, in.AB, in.Brake = 0, false, true
	return in
}
