package sim

import (
	"reflect"
	"testing"

	"playground/internal/geom"
	"playground/internal/terrain"
)

const (
	flareSeeds  = 400
	closingRate = MissileSpeed + 150 // head-on: missile at full speed, target at 150 m/s
)

// flareRun is one head-on missile attack on plane 2, which drops flares on
// the given ticks.
type flareRun struct {
	w          *World
	hit        bool // the missile damaged plane 2
	gone       bool // the missile ended (hit, decoy burn-out, decoy reached)
	rolledTick int  // first tick the missile lost plane 2 while plane 2 was undamaged, 0 if never
	drawsAfter int  // world PRNG decoy draws from tick 2 until the missile ended (a hit's zone roll left out)
	decoyEvs   []Event
}

// newFlareWorld: plane 2 (target) at 2000 m flying −Z at 150 m/s; a missile
// owned by plane 1 comes head-on from dist at full speed.
func newFlareWorld(tm *terrain.Map, seed int64, dist float64) *World {
	w := NewWorld(Config{Seed: seed, Terrain: tm})
	w.AddPlane(1, TeamNATO, F15)
	w.AddPlane(2, TeamSoviet, MiG29)
	w.Step(nil) // deliver the spawn events
	w.clearProtection()
	w.setFlight(1, FlightState{Pos: geom.V(3000, 2500, 3000), Rot: geom.Identity(), Vel: geom.V(0, 0, -150), Throttle: 0.5})
	w.setFlight(2, FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -150), Throttle: 0.5})
	w.addMissileForTest(1, 2, geom.V(0, 2000, -dist), geom.V(0, 0, MissileSpeed))
	return w
}

func runFlares(tm *terrain.Map, seed int64, dist float64, dropTicks ...int) flareRun {
	r := flareRun{w: newFlareWorld(tm, seed, dist)}
	var rng RNG
	for i := 1; i <= 6*60 && !r.gone; i++ {
		if i == 2 {
			rng = *r.w.rng
		}
		in := Input{Throttle: 0.5}
		for _, d := range dropTicks {
			in.Flare = in.Flare || i == d
		}
		for _, e := range r.w.Step(map[ID]Input{2: in}) {
			r.hit = r.hit || (e.Kind == EvHit && e.Plane == 2 && e.Weapon == WMissile)
			r.gone = r.gone || e.Kind == EvMissileGone
			if e.Kind == EvDecoy {
				r.decoyEvs = append(r.decoyEvs, e)
			}
		}
		if r.rolledTick == 0 && !r.hit && (len(r.w.missiles) == 0 || r.w.missiles[0].Target != 2) {
			r.rolledTick = i
		}
	}
	r.drawsAfter = draws(rng, r.w.rng)
	if r.hit {
		r.drawsAfter-- // the hit's zone roll (damage.go), not a decoy roll
	}
	return r
}

// draws counts the Uint64 calls that take from to *to (splitmix64 state walks by a constant).
func draws(from RNG, to *RNG) int {
	for n := range 1000 {
		if from.s == to.s {
			return n
		}
		from.Uint64()
	}
	return -1
}

func decoyRate(t *testing.T, dist float64, check func(seed int64, r flareRun), dropTicks ...int) float64 {
	t.Helper()
	tm := terrain.Generate(1)
	decoyed := 0
	for seed := range int64(flareSeeds) {
		r := runFlares(tm, seed, dist, dropTicks...)
		if !r.gone {
			t.Fatalf("seed %d: missile still flying after 6 s", seed)
		}
		if !r.hit {
			decoyed++
		}
		// EvDecoy exactly once per decoyed missile, never for one that hit.
		if want := map[bool]int{true: 0, false: 1}[r.hit]; len(r.decoyEvs) != want {
			t.Fatalf("seed %d: %d decoy events (hit %v)", seed, len(r.decoyEvs), r.hit)
		}
		if len(r.decoyEvs) == 1 {
			if e := r.decoyEvs[0]; e.Plane != missileIDBase+1 || e.Other != 2 || e.By != 1 {
				t.Fatalf("seed %d: decoy event %+v", seed, e)
			}
		}
		if check != nil {
			check(seed, r)
		}
	}
	return float64(decoyed) / flareSeeds
}

// A flare 1.2 s before impact (the old mechanic's whole window) decoys at
// FlareChance; a decoyed missile never damages, even flying through the plane.
func TestFlareLateDropDecoys(t *testing.T) {
	dist := 1.2 * closingRate
	rate := decoyRate(t, dist, func(seed int64, r flareRun) {
		if !r.hit && r.rolledTick != 1 {
			t.Fatalf("seed %d: decoy decided on tick %d, want on the drop tick", seed, r.rolledTick)
		}
		if p, _ := r.w.Plane(2); !r.hit && p.HP != SpecOf(MiG29).MaxHP {
			t.Fatalf("seed %d: decoyed missile damaged the plane (hp %.1f)", seed, p.HP)
		}
	}, 1)
	t.Logf("1.2 s before impact: decoy rate %.3f over %d seeds", rate, flareSeeds)
	if rate < 0.58 || rate > 0.72 {
		t.Fatalf("decoy rate %.3f, want ~%.2f", rate, FlareChance)
	}
}

// A flare dropped with the missile 1500 m out burns on: the roll comes when
// the missile passes within FlareRange of it, not at the drop.
func TestFlareEarlyDropStillDecoys(t *testing.T) {
	rate := decoyRate(t, 1500, func(seed int64, r flareRun) {
		if r.rolledTick != 0 && r.rolledTick < 30 {
			t.Fatalf("seed %d: decoyed on tick %d, before the missile came within %v m", seed, r.rolledTick, FlareRange)
		}
	}, 1)
	t.Logf("drop at 1500 m: decoy rate %.3f over %d seeds", rate, flareSeeds)
	if rate < 0.58 || rate > 0.72 {
		t.Fatalf("decoy rate %.3f, want ~%.2f", rate, FlareChance)
	}
}

// One roll per (missile, flare) pair however long the missile stays in range.
func TestFlareOneRollPerPair(t *testing.T) {
	tm := terrain.Generate(1)
	for seed := range int64(40) {
		if r := runFlares(tm, seed, 1500, 1); r.drawsAfter != 1 {
			t.Fatalf("seed %d: %d PRNG draws after the drop, want exactly 1 roll", seed, r.drawsAfter)
		}
	}
}

// Two flares are two pairs: a missile that survives the first rolls again.
func TestFlareSecondFlareRollsAgain(t *testing.T) {
	rate := decoyRate(t, 2000, func(seed int64, r flareRun) {
		if r.drawsAfter < 1 || r.drawsAfter > 2 {
			t.Fatalf("seed %d: %d rolls for 2 flares", seed, r.drawsAfter)
		}
	}, 1, 1+FlareCooldown)
	want := 1 - (1-FlareChance)*(1-FlareChance)
	t.Logf("two flares: decoy rate %.3f, want ~%.3f", rate, want)
	if rate < want-0.06 || rate > want+0.06 {
		t.Fatalf("decoy rate %.3f, want ~%.3f", rate, want)
	}
}

// The same seed replays the same flares, rolls and outcome.
func TestFlareDeterministic(t *testing.T) {
	tm := terrain.Generate(1)
	run := func() []Snapshot {
		w := newFlareWorld(tm, 7, 1500)
		var out []Snapshot
		for i := 1; i <= 4*60; i++ {
			w.Step(map[ID]Input{2: {Throttle: 0.5, Flare: i%FlareCooldown == 1}})
			out = append(out, w.Snapshot())
		}
		return out
	}
	if a, b := run(), run(); !reflect.DeepEqual(a, b) {
		t.Fatal("replays differ")
	}
}

// The snapshot carries a flare from its drop tick through its last burning
// tick, falling and slowing; then it is gone (and so is a decoyed missile).
func TestSnapshotFlaresWhileBurning(t *testing.T) {
	w := newFlareWorld(terrain.Generate(1), 1, 5000)
	w.Step(map[ID]Input{2: {Throttle: 0.5, Flare: true}})
	s := w.Snapshot()
	if len(s.Flares) != 1 || s.Flares[0].Owner != 2 || s.Flares[0].rolled != nil {
		t.Fatalf("after the drop: %+v", s.Flares)
	}
	first := s.Flares[0]
	for range FlareLife - 1 { // FlareLife snapshots in all, the drop tick included
		w.Step(nil)
	}
	s = w.Snapshot()
	if len(s.Flares) != 1 {
		t.Fatalf("flare out early: %d", len(s.Flares))
	}
	f := s.Flares[0]
	if f.Vel.Len() >= first.Vel.Len()/5 || f.Pos.Y >= first.Pos.Y || f.Pos.Z >= first.Pos.Z {
		t.Fatalf("flare must slow, fall and drift along: %+v -> %+v", first, f)
	}
	w.Step(nil)
	if s = w.Snapshot(); len(s.Flares) != 0 {
		t.Fatalf("flare still in the snapshot after %d ticks", FlareLife)
	}
}

// A decoyed missile that cannot reach its flare self-destructs, harmless,
// on the tick the flare burns out.
func TestDecoyedMissileDiesWithFlare(t *testing.T) {
	tm := terrain.Generate(1)
	for seed := range int64(20) {
		w := newFlareWorld(tm, seed, 0)
		w.missiles[0].Pos, w.missiles[0].Vel = geom.V(0, 2000, -850), geom.V(0, 0, -MissileSpeed) // flying away
		w.Step(map[ID]Input{2: {Throttle: 0.5, Flare: true}})
		if w.missiles[0].Decoy == 0 {
			continue // not decoyed with this seed
		}
		drop := w.Tick()
		for range FlareLife + 1 {
			for _, e := range w.Step(map[ID]Input{2: {Throttle: 0.5}}) {
				if e.Kind == EvHit {
					t.Fatalf("seed %d: decoyed missile hit %v", seed, e.Plane)
				}
				if e.Kind == EvMissileGone {
					if w.Tick() != drop+FlareLife {
						t.Fatalf("seed %d: missile gone on tick %d, flare burns out on %d", seed, w.Tick(), drop+FlareLife)
					}
					return
				}
			}
		}
		t.Fatalf("seed %d: decoyed missile outlived its flare", seed)
	}
	t.Fatal("no seed decoyed")
}
