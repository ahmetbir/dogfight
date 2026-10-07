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

// A plane has no cap of its own: every flare it drops burns its full life,
// however fast they leave.
func TestFlareNoPlaneCap(t *testing.T) {
	w := NewWorld(Config{Seed: 1, Terrain: terrain.Generate(1)})
	w.AddPlane(1, TeamNone, F16)
	w.Edit(1, func(p *Plane) { p.Flares = 10 })
	for range 10 {
		w.Edit(1, func(p *Plane) { p.FlareReadyTick = 0 }) // no cooldown
		w.Step(map[ID]Input{1: {Throttle: 0.6, Flare: true}})
	}
	if own, _ := liveFlares(w, 1); own != 10 {
		t.Fatalf("plane 1 has %d flares burning, want all 10 it dropped", own)
	}
}

// At most MaxRoomFlares burn per room whatever the cooldown; a new flare
// burns the room's oldest out.
func TestFlareRoomCap(t *testing.T) {
	if MaxRoomFlares < 12*((FlareLife+FlareCooldown-1)/FlareCooldown) {
		t.Fatalf("MaxRoomFlares %d < 12 planes × %d: the room cap now bites in normal play", MaxRoomFlares, (FlareLife+FlareCooldown-1)/FlareCooldown)
	}
	w := NewWorld(Config{Seed: 1, Terrain: terrain.Generate(1)})
	const n = 14
	in := map[ID]Input{}
	for i := range n {
		id := ID(i + 1)
		w.AddPlane(id, TeamNone, F16)
		in[id] = Input{Throttle: 0.6, Flare: true}
	}
	var first ID
	for tick := range MaxRoomFlares/n + 3 {
		for i := range n {
			w.Edit(ID(i+1), func(p *Plane) { p.FlareReadyTick, p.Flares = 0, 8 }) // no cooldown, never empty
		}
		w.Step(in)
		if tick == 0 {
			first = w.Snapshot().Flares[0].ID
		}
		if _, all := liveFlares(w, 1); all > MaxRoomFlares {
			t.Fatalf("tick %d: room has %d flares (cap %d)", tick, all, MaxRoomFlares)
		}
	}
	if w.flare(first) != nil {
		t.Fatal("the oldest flare must burn out first")
	}
	if _, all := liveFlares(w, 1); all != MaxRoomFlares {
		t.Fatalf("room holds %d flares, want the cap %d", all, MaxRoomFlares)
	}
}
