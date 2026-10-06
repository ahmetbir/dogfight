package bot

import (
	"fmt"
	"testing"

	"playground/internal/geom"
	"playground/internal/maps"
	"playground/internal/mode"
	"playground/internal/sim"
	"playground/internal/weather"
)

func TestWantsRTB(t *testing.T) {
	self := sim.Plane{ID: 1, Team: sim.TeamNATO, Kind: sim.F16, Alive: true, HP: 30, Missiles: 0}
	far := sim.Plane{ID: 2, Team: sim.TeamSoviet, Alive: true, FlightState: sim.FlightState{Pos: geom.V(5000, 0, 0)}}
	if !wantsRTB(self, []sim.Plane{self, far}, false) {
		t.Fatal("empty, hurt and alone: go home")
	}
	near := far
	near.Pos = geom.V(1000, 0, 0)
	if wantsRTB(self, []sim.Plane{self, near}, false) {
		t.Fatal("enemy within 2 km: keep fighting")
	}
	self.HP = 80
	if wantsRTB(self, []sim.Plane{self, far}, false) {
		t.Fatal("healthy: keep fighting")
	}
}

// X2: missile regen must not cancel a committed return; only an enemy
// within rtbClear does.
func TestRTBLatch(t *testing.T) {
	m := maps.Build(maps.Ada, 1)
	env := &Env{Terrain: m.Terrain, Map: m, Mode: mode.Team}
	self := sim.Plane{ID: 1, Team: sim.TeamNATO, Kind: sim.F16, Alive: true, HP: 30,
		FlightState: sim.FlightState{Pos: geom.V(0, 1500, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -150)}}
	enemy := sim.Plane{ID: 2, Team: sim.TeamSoviet, Alive: true, FlightState: sim.FlightState{Pos: geom.V(3500, 1500, 3500)}}
	b := New(1, Normal, 1)
	b.Think(&sim.Snapshot{Planes: []sim.Plane{self, enemy}}, env)
	if b.phase != phRTB {
		t.Fatalf("empty and hurt: phase %d", b.phase)
	}
	self.Missiles = 1 // regen
	b.Think(&sim.Snapshot{Tick: 1, Planes: []sim.Plane{self, enemy}}, env)
	if b.phase != phRTB {
		t.Fatalf("regen cancelled the return: phase %d", b.phase)
	}
	enemy.Pos = geom.V(0, 1500, -1500)
	b.Think(&sim.Snapshot{Tick: 2, Planes: []sim.Plane{self, enemy}}, env)
	if b.phase != phAir {
		t.Fatalf("enemy within 2 km: phase %d", b.phase)
	}
}

// landRun puts an empty, hurt plane at the brief's start geometry near base
// side and flies it home until it rearms (ok), crashes or 150 s pass
// (landing, taxi off the runway to the park spot, 3 s rearm).
func landRun(k maps.Kind, side int, wx weather.Kind, seed int64) (bool, string) {
	m := maps.Build(k, seed)
	wind := weather.Wind(wx, seed)
	w := sim.NewWorld(sim.Config{Seed: seed, Terrain: m.Terrain, Map: m, Start: sim.StartRunway, Wind: wind, Gust: wx.Spec().Gust})
	team, kind := sim.TeamNATO, sim.F16
	if side == 1 {
		team, kind = sim.TeamSoviet, sim.MiG29
	}
	w.AddPlane(1, team, kind)
	b := m.Bases[side]
	var start geom.Vec3
	if seed%2 == 1 { // behind the approach point, 600 m off the centerline
		th, _ := b.Threshold()
		start = th.Sub(b.Axis.Scale(2400)).Add(b.Inner.Scale(-600))
	} else { // abeam the runway, outside the base
		start = b.World(-1500, -1000)
	}
	// The brief's 500 m above the runway; on dag the start points sit over
	// valley walls, so 200 m above the highest ground within 600 m.
	start.Y = max(b.Center.Y+500, terrainTop(m.Terrain, start, 600)+200)
	dir := b.Axis
	w.Edit(1, func(p *sim.Plane) {
		p.FlightState = sim.FlightState{Pos: start, Rot: sim.YawPitch(maps.HeadingOf(dir), 0), Vel: dir.Scale(140), Throttle: 0.6}
		p.Missiles, p.HP, p.GroundProtect = 0, 30, false
	})
	br := New(1, Normal, seed)
	env := &Env{Terrain: m.Terrain, Map: m, Mode: mode.Team, Wind: wind}
	for tick := range 150 * 60 {
		snap := w.Snapshot()
		for _, e := range w.Step(map[sim.ID]sim.Input{1: br.Think(&snap, env)}) {
			switch e.Kind {
			case sim.EvKill:
				return false, fmt.Sprintf("crashed (%v) in phase %d at %.1f s", e.Weapon, br.phase, float64(tick)/60)
			case sim.EvRearm:
				return true, fmt.Sprintf("rearmed at %.1f s", float64(tick)/60)
			}
		}
	}
	return false, fmt.Sprintf("timeout in phase %d", br.phase)
}

// landSeeds flies seeds 1-5 and fails below 4 rearms (spec §14).
func landSeeds(t *testing.T, k maps.Kind, side int, wx weather.Kind) {
	t.Helper()
	ok := 0
	for seed := int64(1); seed <= 5; seed++ {
		landed, why := landRun(k, side, wx, seed)
		t.Logf("%v base %d %v seed %d: %s", k, side, wx, seed, why)
		if landed {
			ok++
		}
	}
	if ok < 4 {
		t.Errorf("%v base %d %v: landed and rearmed %d/5", k, side, wx, ok)
	}
}

func TestBotLandsAndRearms(t *testing.T) {
	landSeeds(t, maps.Ada, 0, weather.Clear)
	landSeeds(t, maps.Ada, 0, weather.Storm) // N5: crab into the crosswind
}

// M6: every map, both bases, calm and storm.
func TestBotLandsOnEveryMap(t *testing.T) {
	if testing.Short() {
		t.Skip("long")
	}
	for _, k := range []maps.Kind{maps.Ada, maps.Sehir, maps.Col, maps.Dag} {
		for side := range 2 {
			for _, wx := range []weather.Kind{weather.Clear, weather.Storm} {
				landSeeds(t, k, side, wx)
			}
		}
	}
}

// I2: two bots of one side return back to back (10 s apart, same start):
// the second goes around while the first is on the runway, both land, taxi
// clear and rearm, nobody dies.
func TestBackToBackLandings(t *testing.T) {
	m := maps.Build(maps.Ada, 1)
	w := sim.NewWorld(sim.Config{Seed: 1, Terrain: m.Terrain, Map: m, Start: sim.StartRunway})
	w.AddPlane(1, sim.TeamNATO, sim.F16)
	w.AddPlane(2, sim.TeamNATO, sim.F16)
	b := m.Bases[0]
	th, _ := b.Threshold()
	start := th.Sub(b.Axis.Scale(2400)).Add(b.Inner.Scale(-600))
	start.Y = b.Center.Y + 500
	place := func(id sim.ID) {
		w.Edit(id, func(p *sim.Plane) {
			p.FlightState = sim.FlightState{Pos: start, Rot: sim.YawPitch(maps.HeadingOf(b.Axis), 0), Vel: b.Axis.Scale(140), Throttle: 0.6}
			p.Missiles, p.HP, p.GroundProtect = 0, 30, false
		})
	}
	place(1)
	w.Edit(2, func(p *sim.Plane) { // out of the way for 10 s
		p.FlightState = sim.FlightState{Pos: b.World(0, 2000).Add(geom.V(0, 2500, 0)), Rot: sim.YawPitch(maps.HeadingOf(b.Axis), 0), Vel: b.Axis.Scale(150), Throttle: 0.6}
		p.GroundProtect = false
	})
	brains := map[sim.ID]*Brain{1: New(1, Normal, 1), 2: New(2, Normal, 2)}
	env := &Env{Terrain: m.Terrain, Map: m, Mode: mode.Team}
	rearmed := map[sim.ID]bool{}
	for tick := range 240 * 60 {
		if tick == 10*60 {
			place(2)
		}
		snap := w.Snapshot()
		in := map[sim.ID]sim.Input{}
		for id, br := range brains {
			if tick >= 10*60 || id == 1 {
				in[id] = br.Think(&snap, env)
			}
		}
		for _, e := range w.Step(in) {
			switch e.Kind {
			case sim.EvKill:
				t.Fatalf("plane %d died (%v) in phase %d", e.Plane, e.Weapon, brains[e.Plane].phase)
			case sim.EvHit:
				t.Fatalf("plane %d hit (%v)", e.Plane, e.Weapon)
			case sim.EvRearm:
				rearmed[e.Plane] = true
			}
		}
		if len(rearmed) == 2 {
			t.Logf("both rearmed at %.1f s; go-arounds %d/%d", float64(tick)/60, brains[1].goArounds, brains[2].goArounds)
			return
		}
	}
	t.Fatalf("rearmed %v in 240 s", rearmed)
}

// A round reset respawns live planes in their hangars without a death:
// the brain must drop its landing phase and taxi out again.
func TestNewLifeResetsPhase(t *testing.T) {
	m := maps.Build(maps.Ada, 1)
	w := sim.NewWorld(sim.Config{Seed: 1, Terrain: m.Terrain, Map: m, Start: sim.StartRunway})
	w.AddPlane(1, sim.TeamNATO, sim.F16)
	env := &Env{Terrain: m.Terrain, Map: m, Mode: mode.Team}
	br := New(1, Normal, 1)
	snap := w.Snapshot()
	br.Think(&snap, env)
	br.phase = phFinal
	w.ResetAll()
	w.Step(nil)
	snap = w.Snapshot()
	br.Think(&snap, env)
	if br.phase != phTaxi {
		t.Fatalf("after a reset: phase %d", br.phase)
	}
}

// Review I1: in an FFA runway room a hostile parked in a hangar of the home
// base must not hold off the return; the bot lands and rearms.
func TestFFARTBIgnoresParkedPlanes(t *testing.T) {
	m := maps.Build(maps.Ada, 1)
	w := sim.NewWorld(sim.Config{Seed: 1, Terrain: m.Terrain, Map: m, Start: sim.StartRunway})
	w.AddPlane(1, sim.TeamNone, sim.F16)
	w.AddPlane(2, sim.TeamNone, sim.MiG29) // parks at base 0 (ID parity) and stays
	b := m.Bases[0]
	th, _ := b.Threshold()
	start := th.Sub(b.Axis.Scale(2400)).Add(b.Inner.Scale(-600))
	start.Y = b.Center.Y + 500
	w.Edit(1, func(p *sim.Plane) {
		p.FlightState = sim.FlightState{Pos: start, Rot: sim.YawPitch(maps.HeadingOf(b.Axis), 0), Vel: b.Axis.Scale(140), Throttle: 0.6}
		p.Missiles, p.HP, p.GroundProtect = 0, 30, false
	})
	br := New(1, Normal, 1)
	env := &Env{Terrain: m.Terrain, Map: m, Mode: mode.FFA}
	for range 120 * 60 {
		snap := w.Snapshot()
		in := map[sim.ID]sim.Input{1: br.Think(&snap, env), 2: {Gear: true, Brake: true}}
		for _, e := range w.Step(in) {
			switch {
			case e.Kind == sim.EvRearm && e.Plane == 1:
				return
			case e.Kind == sim.EvKill:
				t.Fatalf("plane %d died (%v) in phase %d", e.Plane, e.Weapon, br.phase)
			}
		}
	}
	t.Fatalf("no rearm in 120 s: phase %d", br.phase)
}
