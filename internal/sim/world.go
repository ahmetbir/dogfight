package sim

import (
	"slices"

	"playground/internal/geom"
	"playground/internal/maps"
	"playground/internal/terrain"
)

const (
	RespawnTicks = 180 // 3 s
	ProtectTicks = 120 // 2 s spawn protection
	PlaneRadius  = 9.0 // plane-plane collision sphere
	HitRadius    = 7.0 // bullet hit sphere
)

// missileIDBase keeps missile IDs disjoint from player IDs.
const missileIDBase ID = 1 << 24

type Config struct {
	Seed         int64
	Terrain      *terrain.Map // required
	FriendlyFire bool         // false in team mode
	LockRangeMul float64      // weather scale on every lock range; 0 means 1
	Map          *maps.Map    // optional: bases, solids, structures; nil keeps v1 behavior
	Start        StartMode    // StartRunway needs Map; zero = StartAir
	Wind         geom.Vec3    // base wind (weather); zero keeps v1 flight
	Gust         float64      // gust amplitude around Wind, m/s
	Structures   bool         // base attack: targets (and AA) active; needs Map
	Bombs        int          // bombs per sortie (base attack); refilled only by a rearm
}

type StartMode uint8

const (
	StartAir    StartMode = iota + 1 // spawn at altitude (v1); the zero Config value means this too
	StartRunway                      // spawn parked in a hangar
)

// World is the authoritative, deterministic simulation of one room.
// It is not safe for concurrent use; the room actor owns it.
type World struct {
	cfg         Config
	tick        int
	rng         *RNG
	planes      map[ID]*Plane
	order       []ID // sorted plane IDs; all iteration goes through it
	prev        map[ID]geom.Vec3
	bullets     []Bullet
	missiles    []*Missile
	powerups    []Powerup
	nextMissile ID
	pending     []Event     // events raised outside Step, delivered by the next Step
	wind        geom.Vec3   // WindAt(cfg.Wind, cfg.Gust, tick) of the current tick
	structs     []Structure // base attack targets, Map.Structures order; nil outside base attack
	bombs       []*Bomb
	nextBomb    ID
	aaReady     []int // per structure: first tick its AA site may fire again
	flares      []*Flare
	nextFlare   ID
}

func NewWorld(cfg Config) *World {
	w := &World{
		cfg:         cfg,
		rng:         NewRNG(cfg.Seed),
		planes:      map[ID]*Plane{},
		prev:        map[ID]geom.Vec3{},
		nextMissile: missileIDBase,
	}
	w.initPowerups()
	w.initStructures()
	return w
}

func (w *World) Tick() int             { return w.tick }
func (w *World) Terrain() *terrain.Map { return w.cfg.Terrain }

// Hostile reports whether team a may damage team b. TeamNone (FFA) is
// hostile to everyone.
func Hostile(a, b Team, friendlyFire bool) bool {
	return a == TeamNone || b == TeamNone || friendlyFire || a != b
}

// AddPlane spawns the plane immediately; its EvSpawn is returned by the next Step.
func (w *World) AddPlane(id ID, team Team, kind Kind) { w.AddPlaneLoadout(id, team, kind, LoadIR) }

// insert registers a new plane in ID order.
func (w *World) insert(p *Plane) {
	w.planes[p.ID] = p
	i, _ := slices.BinarySearch(w.order, p.ID)
	w.order = slices.Insert(w.order, i, p.ID)
}

// RemovePlane deletes the plane with its bullets and missiles; the missiles
// end with EvMissileGone on the next Step.
func (w *World) RemovePlane(id ID) {
	if _, ok := w.planes[id]; !ok {
		return
	}
	delete(w.planes, id)
	delete(w.prev, id)
	w.order = slices.DeleteFunc(w.order, func(o ID) bool { return o == id })
	w.bullets = slices.DeleteFunc(w.bullets, func(b Bullet) bool { return b.Owner == id })
	w.bombs = slices.DeleteFunc(w.bombs, func(b *Bomb) bool { return b.Owner == id })
	w.flares = slices.DeleteFunc(w.flares, func(f *Flare) bool { return f.Owner == id })
	w.missiles = slices.DeleteFunc(w.missiles, func(m *Missile) bool {
		if m.Owner != id {
			return false
		}
		w.pending = append(w.pending, Event{Kind: EvMissileGone, Plane: m.ID, Pos: m.Pos})
		return true
	})
	for _, m := range w.missiles {
		if m.Target == id {
			m.Target = 0
		}
	}
	for _, oid := range w.order {
		if p := w.planes[oid]; p.LockTarget == id {
			p.LockTarget, p.LockTime, p.Locked = 0, 0, false
		}
	}
}

// SetKind changes the aircraft used from the plane's next respawn.
func (w *World) SetKind(id ID, kind Kind) {
	if p, ok := w.planes[id]; ok {
		p.NextKind = kind
	}
}

// Reseat respawns a live plane with kind at a fresh spawn point and keeps its
// life. Re-parked in a hangar it gets fresh ground protection; in the air it
// keeps its ProtectUntil capped at an air spawn's ProtectTicks, so a kind swap
// never extends air protection and a ground swap falling back to the air
// does not carry the lift-off window.
func (w *World) Reseat(id ID, kind Kind) {
	p, ok := w.planes[id]
	if !ok || !p.Alive {
		return
	}
	until, life := p.ProtectUntil, p.Life
	p.NextKind = kind
	w.spawn(p, &w.pending)
	p.Life = life
	if !p.Ground {
		p.ProtectUntil = min(until, w.tick+ProtectTicks)
	}
}

// Edit changes a plane in place. For tests and tools only; the game never calls it.
func (w *World) Edit(id ID, f func(p *Plane)) {
	if p, ok := w.planes[id]; ok {
		f(p)
		w.prev[id] = p.Pos
	}
}

func (w *World) Plane(id ID) (Plane, bool) {
	p, ok := w.planes[id]
	if !ok {
		return Plane{}, false
	}
	return *p, true
}

// ResetAll starts a new round: the targets are repaired first (so the
// respawns see every hangar open), then every plane respawns at full HP and
// all projectiles in flight are cleared.
func (w *World) ResetAll() {
	w.bullets = nil
	w.missiles = nil
	w.bombs = nil
	w.flares = nil
	if w.structs != nil {
		w.resetStructures()
	}
	for _, id := range w.order {
		w.spawn(w.planes[id], &w.pending)
	}
}

// Step advances one fixed tick. A plane without an input keeps its last
// throttle and gear with all other controls neutral.
func (w *World) Step(inputs map[ID]Input) []Event {
	evs := w.pending
	w.pending = nil
	w.tick++
	w.wind = WindAt(w.cfg.Wind, w.cfg.Gust, w.tick)

	for _, id := range w.order {
		if p := w.planes[id]; !p.Alive && w.tick >= p.RespawnTick {
			w.spawn(p, &evs)
		}
	}
	for _, id := range w.order {
		p := w.planes[id]
		if !p.Alive {
			continue
		}
		in, ok := inputs[id]
		if !ok {
			in = Input{Throttle: p.Throttle, Gear: p.Gear}
		}
		in = w.parkingBrake(p, in)
		p.AB = in.AB && !p.ABLock // what StepFlight burns this tick
		w.prev[id] = p.Pos
		before := p.FlightState
		p.FlightState = StepFlight(p.FlightState, in, SpecOf(p.Kind), w.mods(p))
		w.landing(p, before, &evs)
		if p.Ground {
			p.WheelsTicks++
		} else {
			p.WheelsTicks = 0
		}
		if !p.Alive {
			continue
		}
		w.rearm(p, &evs)
		w.groundProtect(p)
		p.Heat = max(0, p.Heat-HeatCool*Dt)
		ready := weaponClocks(p)
		w.fireCannon(p, in, &evs)
		w.updateLock(p, in.Pick, &evs)
		w.fireMissile(p, in, &evs)
		w.dropFlare(p, in, &evs)
		w.dropBomb(p, in, &evs)
		if weaponClocks(p) != ready { // a shot: rearm only while not firing
			p.RearmTicks = 0
		}
		w.regenAmmo(p)
	}
	if w.structs != nil {
		w.stepAA(&evs)
	}
	w.stepBullets(&evs)
	w.stepFlares(&evs)
	w.stepMissiles(&evs)
	w.stepBombs(&evs)
	w.hazards(&evs)
	w.stepPowerups(&evs)
	return evs
}

// groundAt samples the terrain height and paved surface at (x, z).
func (w *World) groundAt(x, z float64) GroundSample {
	g := GroundSample{H: w.cfg.Terrain.Ground(x, z)}
	if w.cfg.Map != nil {
		g.Surf = w.cfg.Map.SurfaceAt(x, z)
	}
	return g
}

// mods are p's flight modifiers at the start of the tick.
func (w *World) mods(p *Plane) FlightMods {
	return FlightMods{Turbo: w.tick < p.TurboUntil, Wind: w.wind, Ground: w.groundAt(p.Pos.X, p.Pos.Z)}
}

// Snapshot returns a deep copy of the world state, planes ordered by ID.
func (w *World) Snapshot() Snapshot {
	s := Snapshot{
		Tick:       w.tick,
		Planes:     make([]Plane, 0, len(w.order)),
		Missiles:   make([]Missile, 0, len(w.missiles)),
		Powerups:   slices.Clone(w.powerups),
		Structures: slices.Clone(w.structs),
	}
	for _, id := range w.order {
		s.Planes = append(s.Planes, *w.planes[id])
	}
	for _, m := range w.missiles {
		s.Missiles = append(s.Missiles, *m)
	}
	for _, b := range w.bombs {
		s.Bombs = append(s.Bombs, *b)
	}
	for _, f := range w.flares {
		c := *f
		c.rolled = nil // internal bookkeeping stays in the world
		s.Flares = append(s.Flares, c)
	}
	return s
}
