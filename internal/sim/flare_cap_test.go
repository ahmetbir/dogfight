package sim

import (
	"testing"

	"playground/internal/geom"
	"playground/internal/terrain"
)

// A dropper that is already dead (killed earlier in the tick) gives no roll,
// no EvDecoy and no PRNG draw: there is nobody left to evade.
func TestNoDecoyRollForDeadTarget(t *testing.T) {
	tm := terrain.Generate(1)
	for seed := range int64(20) {
		w := newFlareWorld(tm, seed, 1500)
		w.Step(map[ID]Input{2: {Throttle: 0.5, Flare: true}}) // missile 1500 m out: no roll yet
		// Killed this tick (before stepFlares), with the missile already inside FlareRange.
		w.Edit(2, func(p *Plane) { p.Alive, p.HP, p.RespawnTick = false, 0, w.Tick()+1000 })
		w.missiles[0].Pos = w.flares[0].Pos.Add(geom.V(0, 0, -500))
		before := *w.rng
		for range FlareLife {
			for _, e := range w.Step(nil) {
				if e.Kind == EvDecoy {
					t.Fatalf("seed %d: decoy event for a dead target: %+v", seed, e)
				}
			}
		}
		if n := draws(before, w.rng); n != 0 {
			t.Fatalf("seed %d: %d PRNG draws for a dead target", seed, n)
		}
	}
}

func liveFlares(w *World, owner ID) (own, all int) {
	for _, f := range w.Snapshot().Flares {
		all++
		if f.Owner == owner {
			own++
		}
	}
	return own, all
}

// At most MaxPlaneFlares burn per plane and MaxRoomFlares per room whatever
// the cooldown; a new flare burns the oldest out (the plane's own first).
func TestFlareCaps(t *testing.T) {
	if FlareLife > MaxPlaneFlares*FlareCooldown {
		t.Fatalf("FlareLife %d > %d × FlareCooldown %d: the per-plane cap now bites in normal play", FlareLife, MaxPlaneFlares, FlareCooldown)
	}
	w := NewWorld(Config{Seed: 1, Terrain: terrain.Generate(1)})
	n := MaxRoomFlares/MaxPlaneFlares + 2 // more planes than the room cap covers
	in := map[ID]Input{}
	for i := range n {
		id := ID(i + 1)
		w.AddPlane(id, TeamNone, F16)
		in[id] = Input{Throttle: 0.6, Flare: true}
	}
	var firstOfPlane1 ID
	for tick := range 20 {
		for i := range n {
			w.Edit(ID(i+1), func(p *Plane) { p.FlareReadyTick, p.Flares = 0, 8 }) // no cooldown, never empty
		}
		w.Step(in)
		if tick == 0 {
			for _, f := range w.Snapshot().Flares {
				if f.Owner == 1 {
					firstOfPlane1 = f.ID
				}
			}
		}
		own, all := liveFlares(w, 1)
		if own > MaxPlaneFlares || all > MaxRoomFlares {
			t.Fatalf("tick %d: plane 1 has %d, room %d flares (caps %d, %d)", tick, own, all, MaxPlaneFlares, MaxRoomFlares)
		}
	}
	if w.flare(firstOfPlane1) != nil {
		t.Fatal("the oldest flare must burn out first")
	}
	if _, all := liveFlares(w, 1); all != MaxRoomFlares {
		t.Fatalf("room holds %d flares, want the cap %d", all, MaxRoomFlares)
	}
}
