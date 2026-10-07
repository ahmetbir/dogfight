package sim

import (
	"slices"

	"playground/internal/geom"
)

const (
	FlareCooldown = 15          // ticks between drops (0.25 s: three in half a second)
	FlareLife     = 150         // ticks a flare burns (2.5 s)
	FlareRange    = 900.0       // m: a missile this close to a burning flare gets its decoy roll
	FlareChance   = 0.65        // decoy probability per (missile, flare) pair
	FlareWarn     = 800.0       // m: a tracking missile this close calls for a flare (HUD cue, bots)
	FlareDrag     = 1.5         // 1/s: exponential slow-down of the launch velocity
	MaxRoomFlares = 120         // burning flares per room (12 planes × FlareLife/FlareCooldown); bounds the snapshot, not reached in play
	flareIDBase   = ID(1 << 26) // keeps flare IDs apart from missiles (1<<24) and bombs (1<<25)
)

// Flare is a burning decoy: it leaves the plane with its velocity, slows
// down, falls and burns out at ExpireTick. Every missile tracking Owner
// that comes within FlareRange gets one decoy roll against it.
type Flare struct {
	ID, Owner  ID
	Pos, Vel   geom.Vec3
	ExpireTick int
	rolled     []ID // missiles that already had their roll against this flare
}

// dropFlare releases a flare at p when asked, loaded and ready; its decoy
// rolls happen in stepFlares from this tick on.
func (w *World) dropFlare(p *Plane, in Input, ev *[]Event) {
	if !in.Flare || p.Flares <= 0 || w.tick < p.FlareReadyTick {
		return
	}
	p.Flares--
	p.FlareReadyTick = w.tick + FlareCooldown
	w.capFlares()
	w.nextFlare++
	w.flares = append(w.flares, &Flare{ID: flareIDBase + w.nextFlare, Owner: p.ID, Pos: p.Pos, Vel: p.Vel, ExpireTick: w.tick + FlareLife})
	*ev = append(*ev, Event{Kind: EvFlare, Plane: p.ID, Pos: p.Pos})
}

// capFlares makes room for one more flare: past MaxRoomFlares the room's
// oldest (drop order) burns out. A plane has no cap of its own. A missile
// chasing a removed flare self-destructs on its next step.
func (w *World) capFlares() {
	if len(w.flares) >= MaxRoomFlares {
		w.flares = slices.Delete(w.flares, 0, 1)
	}
}

// stepFlares burns out expired flares, moves the rest (drag, gravity, resting
// on the ground) and rolls the decoys (IR missiles only; radar ignores flares): flares in drop order, missiles in
// launch order, one roll per (missile, flare) pair, world PRNG; a decoy
// emits EvDecoy (the missile's later EvMissileGone is its harmless pop).
func (w *World) stepFlares(ev *[]Event) {
	kept := w.flares[:0]
	for _, f := range w.flares {
		if w.tick >= f.ExpireTick {
			continue
		}
		f.Vel = f.Vel.Scale(1 - FlareDrag*Dt)
		f.Vel.Y -= Gravity * Dt
		f.Pos = f.Pos.Add(f.Vel.Scale(Dt))
		if g := w.cfg.Terrain.Ground(f.Pos.X, f.Pos.Z); f.Pos.Y < g {
			f.Pos.Y, f.Vel = g, geom.Vec3{}
		}
		kept = append(kept, f)
	}
	clear(w.flares[len(kept):])
	w.flares = kept
	for _, f := range w.flares {
		if p, ok := w.planes[f.Owner]; !ok || !p.Alive { // killed earlier this tick: nobody left to evade
			continue
		}
		for _, m := range w.missiles {
			if m.Target != f.Owner || m.Kind == MissileRadar || m.Decoy != 0 || m.Pos.Dist(f.Pos) > FlareRange || slices.Contains(f.rolled, m.ID) {
				continue
			}
			f.rolled = append(f.rolled, m.ID)
			if w.rng.Float64() < FlareChance {
				*ev = append(*ev, Event{Kind: EvDecoy, Plane: m.ID, Other: m.Target, By: m.Owner, Pos: f.Pos})
				m.Target, m.Decoy = 0, f.ID
			}
		}
	}
}

// flare returns the burning flare id, nil once it is out.
func (w *World) flare(id ID) *Flare {
	for _, f := range w.flares {
		if f.ID == id {
			return f
		}
	}
	return nil
}
