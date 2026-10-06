package bot

import (
	"math"
	"testing"

	"playground/internal/geom"
	"playground/internal/maps"
	"playground/internal/sim"
	"playground/internal/terrain"
)

func TestSteerTurnsTowardTarget(t *testing.T) {
	cases := []geom.Vec3{geom.V(1, 0, -1), geom.V(-1, 0.3, -1), geom.V(0, 1, 0), geom.V(0, -1, -0.2), geom.V(0, 0, 1)}
	s := sim.SpecOf(sim.F16)
	for _, dir := range cases {
		fs := sim.FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -s.CornerSpeed), Throttle: 1}
		start := fs.Rot.Forward().Dot(dir.Norm())
		for range 60 * 4 {
			p, r, y := Steer(fs.Rot, fs.W, dir)
			fs = sim.StepFlight(fs, sim.Input{Pitch: p, Roll: r, Yaw: y, Throttle: 1}, s, sim.FlightMods{})
		}
		if end := fs.Rot.Forward().Dot(dir.Norm()); end < 0.97 || end < start {
			t.Fatalf("dir %v: alignment %v -> %v", dir, start, end)
		}
	}
}

func TestAvoidTerrainPullsUp(t *testing.T) {
	m := terrain.Generate(1)
	self := sim.Plane{Alive: true, FlightState: sim.FlightState{
		Pos: geom.V(4500, 120, 4500), Rot: geom.AxisAngle(geom.V(1, 0, 0), -0.4), Vel: geom.V(0, -80, -180)}}
	dir, ok := avoidTerrain(self, m)
	if !ok || dir.Y <= 0 {
		t.Fatalf("expected pull-up, got %v %v", dir, ok)
	}
}

func TestAvoidTerrainIdleHigh(t *testing.T) {
	self := sim.Plane{Alive: true, FlightState: sim.FlightState{
		Pos: geom.V(0, 2500, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200)}}
	if _, ok := avoidTerrain(self, terrain.Generate(1)); ok {
		t.Fatal("no terrain threat at 2500 m level flight")
	}
}

func TestBrainShootsTargetAhead(t *testing.T) {
	b := New(1, Hard, 1)
	snap := &sim.Snapshot{Tick: 0, Planes: []sim.Plane{
		{ID: 1, Team: sim.TeamNATO, Kind: sim.F16, Alive: true, HP: 90, FlightState: sim.FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200)}},
		{ID: 2, Team: sim.TeamSoviet, Kind: sim.MiG29, Alive: true, HP: 100, FlightState: sim.FlightState{Pos: geom.V(0, 2000, -400), Rot: geom.Identity(), Vel: geom.V(0, 0, -200)}},
	}}
	in := b.Think(snap, &Env{Terrain: terrain.Generate(1)})
	if !in.Fire {
		t.Fatalf("hard bot must fire at target dead ahead: %+v", in)
	}
}

func TestPickTargetNearestHostileWithHysteresis(t *testing.T) {
	at := func(id sim.ID, team sim.Team, z float64) sim.Plane {
		return sim.Plane{ID: id, Team: team, Alive: true, FlightState: sim.FlightState{Pos: geom.V(0, 2000, z)}}
	}
	self := at(1, sim.TeamNATO, 0)
	planes := []sim.Plane{self, at(2, sim.TeamNATO, -100), at(3, sim.TeamSoviet, -1000), at(4, sim.TeamSoviet, -1200)}
	if tg, ok := pickTarget(self, planes, 0); !ok || tg.ID != 3 {
		t.Fatalf("want nearest enemy 3, got %v %v", tg.ID, ok)
	}
	if tg, _ := pickTarget(self, planes, 4); tg.ID != 4 {
		t.Fatalf("current target within 1.3x must be kept, got %v", tg.ID)
	}
	planes[3].Pos.Z = -1400
	if tg, _ := pickTarget(self, planes, 4); tg.ID != 3 {
		t.Fatalf("current target beyond 1.3x must be dropped, got %v", tg.ID)
	}
	if _, ok := pickTarget(self, planes[:2], 0); ok {
		t.Fatal("teammates are not targets")
	}
}

func TestBrainEvadesLockedMissile(t *testing.T) {
	b := New(1, Hard, 1)
	m := terrain.Generate(1)
	self := sim.Plane{ID: 1, Team: sim.TeamNATO, Kind: sim.F16, Alive: true, HP: 90, Missiles: 2, Flares: 6,
		FlightState: sim.FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200)}}
	missile := sim.Missile{ID: 1 << 24, Owner: 2, Target: 1, Pos: geom.V(0, 2000, 500), Vel: geom.V(0, 0, -400)}
	var flared, ab bool
	for tick := range 60 {
		snap := &sim.Snapshot{Tick: tick, Planes: []sim.Plane{self}, Missiles: []sim.Missile{missile}}
		in := b.Think(snap, &Env{Terrain: m})
		flared = flared || in.Flare
		ab = ab || in.AB
	}
	if !ab {
		t.Fatal("evading bot must use afterburner")
	}
	if dir := b.aim; dir.Z < -0.5 || dir.Z > 0.5 {
		t.Fatalf("evade direction must be roughly perpendicular to the missile, got %v", dir)
	}
	if !flared {
		t.Fatal("hard bot should flare (rng roll with seed 1)")
	}
}

func TestParseDifficulty(t *testing.T) {
	for s, want := range map[string]Difficulty{"easy": Easy, "normal": Normal, "hard": Hard} {
		if d, ok := ParseDifficulty(s); !ok || d != want {
			t.Fatalf("%s -> %v %v", s, d, ok)
		}
	}
	if _, ok := ParseDifficulty("insane"); ok {
		t.Fatal("unknown difficulty accepted")
	}
}

func TestAvoidCollisionBreaksHeadOn(t *testing.T) {
	a := sim.Plane{ID: 1, Alive: true, FlightState: sim.FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200)}}
	b := sim.Plane{ID: 2, Alive: true, FlightState: sim.FlightState{Pos: geom.V(0, 2000, -300), Rot: geom.AxisAngle(geom.V(0, 1, 0), 3.14159265), Vel: geom.V(0, 0, 200)}}
	dir, ok := avoidCollision(a, []sim.Plane{a, b})
	if !ok || dir.X <= 0 {
		t.Fatalf("head-on pair must break right: %v %v", dir, ok)
	}
	b.Pos = geom.V(500, 2000, -300) // passes 500 m abeam
	if _, ok := avoidCollision(a, []sim.Plane{a, b}); ok {
		t.Fatal("no break for a wide pass")
	}
}

func TestAvoidSolidsPullsUpBeforeTower(t *testing.T) {
	m := maps.Build(maps.Sehir, 1)
	var tall maps.Box
	top := 0.0
	for _, b := range m.Buildings {
		if b.Max.Y-b.Min.Y > tall.Max.Y-tall.Min.Y {
			tall = b
		}
		top = max(top, b.Max.Y)
	}
	c := tall.Min.Add(tall.Max).Scale(0.5)
	self := sim.Plane{Alive: true, FlightState: sim.FlightState{Pos: geom.V(c.X, c.Y, tall.Max.Z+250), Rot: geom.Identity(), Vel: geom.V(0, 0, -200)}}
	dir, ok := avoidSolids(self, m, nil)
	if !ok || dir.Y <= 0 {
		t.Fatalf("tower 250 m ahead: %v %v", dir, ok)
	}
	// Above every roof plus the margin nothing is in the way; a sideways
	// offset could meet another downtown tower (preflight T22).
	self.Pos.Y = top + solidMargin + 5
	if _, ok := avoidSolids(self, m, nil); ok {
		t.Fatal("no threat above the tallest roof")
	}
}

func TestAvoidSolidsSeesHangars(t *testing.T) {
	m := maps.Build(maps.Ada, 1)
	b := m.Bases[0]
	h := b.Hangars[2].Spawn
	// Low over the apron, flying at the back wall of a hangar.
	pos := h.Add(b.Inner.Scale(-200)).Add(geom.V(0, 8, 0))
	vel := b.Inner.Scale(150)
	self := sim.Plane{Alive: true, FlightState: sim.FlightState{Pos: pos, Rot: sim.YawPitch(maps.HeadingOf(b.Inner), 0), Vel: vel}}
	if dir, ok := avoidSolids(self, m, nil); !ok || dir.Y <= 0 {
		t.Fatalf("hangar 200 m ahead: %v %v", dir, ok)
	}
}

// A dag valley wall too steep to climb head-on: climb while turning away.
func TestAvoidTerrainTurnsFromRidge(t *testing.T) {
	m := maps.Build(maps.Dag, 1)
	b := m.Bases[0]
	pos := b.World(0, 250).Add(geom.V(0, 100, 0))
	self := sim.Plane{Alive: true, FlightState: sim.FlightState{Pos: pos, Rot: sim.YawPitch(maps.HeadingOf(b.Inner), 0), Vel: b.Inner.Scale(220)}}
	dir, ok := avoidTerrain(self, m.Terrain)
	if !ok || dir.Y <= 0 || math.Abs(headingErr(b.Inner, dir)) < 0.4 {
		t.Fatalf("wall ahead: want a climbing turn, got %v %v", dir, ok)
	}
}

// safeAim lifts an attack dive that would end in the ground and leaves a
// clear one alone.
func TestSafeAimLiftsDiveIntoGround(t *testing.T) {
	m := terrain.Generate(1)
	self := sim.Plane{Alive: true, FlightState: sim.FlightState{Pos: geom.V(0, 2500, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200)}}
	level := geom.V(0, 0, -1)
	if got := safeAim(self, level, m); got != level {
		t.Fatalf("level at 2500 m changed: %v", got)
	}
	steep := geom.V(0, -3, -1).Norm()
	if got := safeAim(self, steep, m); got.Y <= steep.Y {
		t.Fatalf("a dive into the ground must be lifted: %v", got)
	}
}
