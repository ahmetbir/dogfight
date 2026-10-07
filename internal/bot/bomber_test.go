package bot

import (
	"math"
	"testing"

	"playground/internal/geom"
	"playground/internal/maps"
	"playground/internal/mode"
	"playground/internal/sim"
)

func TestBombImpact(t *testing.T) {
	p := bombImpact(geom.V(0, 500, 0), geom.V(0, 0, -150), 0)
	tt := (-2 + math.Sqrt(4+2*sim.Gravity*500)) / sim.Gravity
	if math.Abs(p.Z+150*tt) > 1e-9 || p.Y != 0 {
		t.Fatalf("impact %v (t=%v)", p, tt)
	}
}

func TestBomberHitsEnemyBase(t *testing.T) {
	m := maps.Build(maps.Sehir, 3) // flat middle: the run is not about terrain avoidance
	w := sim.NewWorld(sim.Config{Seed: 3, Terrain: m.Terrain, Map: m, Structures: true, Bombs: 2})
	w.AddPlane(2, sim.TeamNATO, sim.F16) // alone on its team: bomber
	br := New(2, Normal, 3)
	env := &Env{Terrain: m.Terrain, Map: m, Mode: mode.Base}
	for range 4 * 60 * 60 {
		snap := w.Snapshot()
		for _, e := range w.Step(map[sim.ID]sim.Input{2: br.Think(&snap, env)}) {
			if e.Kind == sim.EvStructHit && e.Weapon == sim.WBomb && e.Other == 2 {
				return
			}
		}
	}
	t.Fatal("bomber never hit an enemy structure in 4 minutes")
}

// Half of each team bombs: the role follows the plane's rank among its own
// team, so the alternating seating of a room gives both sides bombers.
func TestBomberRolePerTeam(t *testing.T) {
	var s sim.Snapshot
	for id := sim.ID(1); id <= 6; id++ {
		team := sim.TeamNATO
		if id%2 == 0 {
			team = sim.TeamSoviet
		}
		s.Planes = append(s.Planes, sim.Plane{ID: id, Team: team, Alive: true, Bombs: 2})
	}
	want := map[sim.ID]bool{1: true, 2: true, 3: false, 4: false, 5: true, 6: true}
	for _, p := range s.Planes {
		if got := isBomber(p, s.Planes, mode.Base); got != want[p.ID] {
			t.Fatalf("plane %d bomber %v", p.ID, got)
		}
		if isBomber(p, s.Planes, mode.Team) {
			t.Fatalf("plane %d bombs outside base attack", p.ID)
		}
	}
}

func TestNearestTargetSkipsOwnAndDestroyed(t *testing.T) {
	m := maps.Build(maps.Ada, 1)
	w := sim.NewWorld(sim.Config{Seed: 1, Terrain: m.Terrain, Map: m, Structures: true, Bombs: 2})
	w.AddPlane(1, sim.TeamNATO, sim.F16)
	s := w.Snapshot()
	self := s.Planes[0]
	tg, ok := nearestTarget(self, &s, m)
	if !ok || tg.Side != 1 {
		t.Fatalf("target %+v %v", tg, ok)
	}
	for i := range s.Structures {
		if m.Structures[i].Side == 1 {
			s.Structures[i].Alive = false
		}
	}
	if _, ok := nearestTarget(self, &s, m); ok {
		t.Fatal("no live enemy target left")
	}
}

// Live targets are solids: a plane flying into one pulls up; a destroyed
// one is wreckage and is ignored.
func TestAvoidSolidsSeesLiveTargets(t *testing.T) {
	m := maps.Build(maps.Ada, 1)
	w := sim.NewWorld(sim.Config{Seed: 1, Terrain: m.Terrain, Map: m, Structures: true})
	s := w.Snapshot()
	d := m.Structures[3] // fuel tank B, clear of the hangars
	c := d.Box.Min.Add(d.Box.Max).Scale(0.5)
	self := sim.Plane{Alive: true, FlightState: sim.FlightState{Pos: c.Add(geom.V(-150, 0, 0)), Vel: geom.V(150, 0, 0), Rot: sim.YawPitch(-math.Pi/2, 0)}}
	if _, _, hit := m.Solids.Sweep(self.Pos, self.Pos.Add(self.Vel.Scale(solidHorizon)), solidMargin); hit {
		t.Skip("layout: a static solid is on the path")
	}
	if dir, ok := avoidSolids(self, m, s.Structures); !ok || dir.Y <= 0 {
		t.Fatalf("live target ahead: %v %v", dir, ok)
	}
	s.Structures[3].Alive = false
	if _, ok := avoidSolids(self, m, s.Structures); ok {
		t.Fatal("destroyed target is not a solid")
	}
}

// A bomber that has dropped everything goes home to rearm; a fighter with
// bombs left (it never drops them) does not.
func TestBomberReturnsForBombs(t *testing.T) {
	self := sim.Plane{ID: 2, Team: sim.TeamNATO, Kind: sim.F16, Alive: true, HP: sim.SpecOf(sim.F16).MaxHP, Missiles: sim.SpecOf(sim.F16).Missiles}
	if !wantsRTB(self, []sim.Plane{self}, true) {
		t.Fatal("empty bomber should return")
	}
	if wantsRTB(self, []sim.Plane{self}, false) {
		t.Fatal("a fighter does not return for bombs")
	}
	self.Bombs = 1
	if wantsRTB(self, []sim.Plane{self}, true) {
		t.Fatal("a bomber with a bomb left keeps bombing")
	}
	env := &Env{Mode: mode.Base, Bombs: 2}
	if !needsAmmo(self, env) || needsAmmo(self, &Env{Mode: mode.Team}) {
		t.Fatal("base attack rearm waits for the bombs")
	}
	// The wait follows the room's load and the kind's extra bombs, as the sim refills them.
	a10 := sim.Plane{Kind: sim.A10, Alive: true, HP: sim.SpecOf(sim.A10).MaxHP, Missiles: sim.SpecOf(sim.A10).Missiles}
	for _, c := range []struct {
		room, bombs int
		wait        bool
	}{{2, 3, true}, {2, 4, false}, {3, 4, true}, {3, 5, false}, {0, 0, false}} {
		a10.Bombs = c.bombs
		if got := needsAmmo(a10, &Env{Mode: mode.Base, Bombs: c.room}); got != c.wait {
			t.Errorf("A-10 with %d bombs, room load %d: waits %v, want %v", c.bombs, c.room, got, c.wait)
		}
	}
}

// Review m7: a bomber that passes the release point without a drop three
// times in a sortie gives up the runs and fights until its next rearm.
func TestBomberGivesUpAfterThreeGoArounds(t *testing.T) {
	m := maps.Build(maps.Sehir, 3)
	w := sim.NewWorld(sim.Config{Seed: 3, Terrain: m.Terrain, Map: m, Structures: true, Bombs: 2})
	w.AddPlane(2, sim.TeamNATO, sim.F16)
	s := w.Snapshot()
	tg, _ := nearestTarget(s.Planes[0], &s, m)
	c := boxCenter(tg.Box)
	s.Planes[0].Pos = geom.V(c.X+100, c.Y+600, c.Z) // inside the throw: a run past its release point
	s.Planes[0].Vel = geom.V(0, 0, -200)
	env := &Env{Terrain: m.Terrain, Map: m, Mode: mode.Base}
	br := New(2, Normal, 3)
	for i := 1; i <= maxBombGoArounds; i++ {
		br.extend = false
		active := br.bomberRole(&s, s.Planes[0], env)
		if br.bombMisses != i || active != (i < maxBombGoArounds) {
			t.Fatalf("go-around %d: misses %d active %v", i, br.bombMisses, active)
		}
	}
	if br.bomberRole(&s, s.Planes[0], env) {
		t.Fatal("past the cap the bomber fights")
	}
}
