package bot

import (
	"math"
	"testing"

	"playground/internal/geom"
	"playground/internal/sim"
	"playground/internal/terrain"
)

// Easy flies IR, normal Karışık; hard picks by situation: radar against a
// mostly IR enemy (outrange it), Karışık otherwise and before it sees one.
func TestBotLoadoutPerDifficulty(t *testing.T) {
	if lo := New(1, Easy, 1).Loadout(nil); lo != sim.LoadIR {
		t.Fatalf("easy: %v", lo)
	}
	if lo := New(1, Normal, 1).Loadout(nil); lo != sim.LoadMixed {
		t.Fatalf("normal: %v", lo)
	}
	h := New(1, Hard, 1)
	if lo := h.Loadout(nil); lo != sim.LoadMixed {
		t.Fatalf("hard without a snapshot: %v", lo)
	}
	plane := func(id sim.ID, team sim.Team, lo sim.Loadout) sim.Plane {
		return sim.Plane{ID: id, Team: team, Loadout: lo}
	}
	irFoes := &sim.Snapshot{Planes: []sim.Plane{plane(1, sim.TeamNATO, sim.LoadMixed), plane(2, sim.TeamSoviet, sim.LoadIR),
		plane(3, sim.TeamSoviet, sim.LoadIR), plane(4, sim.TeamSoviet, sim.LoadRadar), plane(5, sim.TeamNATO, sim.LoadIR)}}
	if lo := h.Loadout(irFoes); lo != sim.LoadRadar {
		t.Fatalf("hard vs mostly IR foes: %v", lo)
	}
	irFoes.Planes[2].Loadout = sim.LoadMixed
	if lo := h.Loadout(irFoes); lo != sim.LoadMixed {
		t.Fatalf("hard vs mixed foes: %v", lo)
	}
}

// A radar missile is beamed (flown across its line of sight), never flared.
func TestBrainBeamsRadarMissile(t *testing.T) {
	m := terrain.Generate(1)
	self := sim.Plane{ID: 1, Team: sim.TeamNATO, Kind: sim.F16, Alive: true, HP: 90, Flares: 8,
		FlightState: sim.FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200)}}
	missile := sim.Missile{ID: 1 << 24, Owner: 2, Target: 1, Kind: sim.MissileRadar, Pos: geom.V(300, 2000, 1500), Vel: geom.V(-80, 0, -400)}
	b := New(1, Hard, 1)
	flared := false
	for tick := range 60 {
		missile.Pos = missile.Pos.Add(geom.V(0, 0, -2)) // closing to inside FlareWarn
		snap := &sim.Snapshot{Tick: tick, Planes: []sim.Plane{self}, Missiles: []sim.Missile{missile}}
		flared = flared || b.Think(snap, &Env{Terrain: m}).Flare
	}
	if flared {
		t.Fatal("flares do nothing against radar: the bot must not drop them")
	}
	los := missile.Pos.Sub(self.Pos).Norm()
	if a := math.Abs(b.aim.Norm().Dot(los)); a > 0.1 || math.Abs(b.aim.Norm().Y) > 0.1 {
		t.Fatalf("beam aim %v: |cos| to the line of sight %.2f", b.aim, a)
	}
}

// With its radar missile in flight the bot keeps the target in its nose
// even when it would otherwise go for a missile crate.
func TestBrainKeepsNoseOnRadarTarget(t *testing.T) {
	m := terrain.Generate(1)
	self := sim.Plane{ID: 1, Team: sim.TeamNATO, Kind: sim.F15, Alive: true, HP: 120, Loadout: sim.LoadRadar,
		FlightState: sim.FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200)}}
	foe := sim.Plane{ID: 2, Team: sim.TeamSoviet, Kind: sim.MiG29, Alive: true, HP: 100,
		FlightState: sim.FlightState{Pos: geom.V(-1500, 2000, -1500), Rot: geom.Identity(), Vel: geom.V(0, 0, -200)}}
	crate := sim.Powerup{Kind: sim.PUMissiles, Active: true, Pos: geom.V(800, 2000, 0)}
	aimAt := func(missiles []sim.Missile) geom.Vec3 {
		b := New(1, Hard, 1)
		b.Think(&sim.Snapshot{Planes: []sim.Plane{self, foe}, Missiles: missiles, Powerups: []sim.Powerup{crate}}, &Env{Terrain: m})
		return b.aim.Norm()
	}
	toFoe := foe.Pos.Sub(self.Pos).Norm()
	if a := aimAt(nil); a.Dot(toFoe) > 0.5 {
		t.Fatalf("control: an empty bot without a missile in flight goes for the crate, aim %v", a)
	}
	mine := sim.Missile{ID: 1 << 24, Owner: 1, Target: 2, Kind: sim.MissileRadar, Pos: geom.V(-500, 2000, -500), Vel: geom.V(-300, 0, -300)}
	if a := aimAt([]sim.Missile{mine}); a.Dot(toFoe) < 0.95 {
		t.Fatalf("guiding a radar missile: aim %v, want the target", a)
	}
}

// radarShot: plane 2 (radar F-15) sits 2 km behind the bot, nose held on
// it, locks and fires; the missile either hits the bot or loses it.
func radarShot(seed int64, d Difficulty) (hit bool) {
	t := terrain.Generate(1)
	w := sim.NewWorld(sim.Config{Seed: seed, Terrain: t})
	w.AddPlane(1, sim.TeamNATO, sim.F16)
	w.AddPlaneLoadout(2, sim.TeamSoviet, sim.F15, sim.LoadRadar)
	w.Edit(1, func(p *sim.Plane) {
		p.FlightState = sim.FlightState{Pos: geom.V(0, 2200, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1}
		p.ProtectUntil = 0
	})
	b := New(1, d, seed)
	fired := false
	for range 12 * 60 {
		me, _ := w.Plane(1)
		w.Edit(2, func(p *sim.Plane) { // the launcher keeps the bot in its nose from 2 km behind
			back := me.Vel.Norm()
			if back == (geom.Vec3{}) {
				back = geom.V(0, 0, -1)
			}
			p.FlightState = sim.FlightState{Pos: me.Pos.Sub(back.Scale(2000)), Rot: geom.LookRotation(back, geom.V(0, 1, 0)), Vel: back.Scale(200), Throttle: 1}
			p.ProtectUntil = 0
		})
		snap := w.Snapshot()
		in := map[sim.ID]sim.Input{1: b.Think(&snap, &Env{Terrain: t}), 2: {Throttle: 1, Missile: !fired}}
		for _, e := range w.Step(in) {
			switch {
			case e.Kind == sim.EvMissileLaunch:
				fired = true
			case e.Kind == sim.EvHit && e.Plane == 1 && e.Weapon == sim.WMissile:
				return true
			case e.Kind == sim.EvMissileGone && fired:
				return false
			}
		}
	}
	return false
}

// Bots defend correctly against radar: a hard bot beams most shots, an easy
// one far fewer.
func TestBotsBeamRadarMissiles(t *testing.T) {
	const seeds = 20
	hits := map[Difficulty]int{}
	for _, d := range []Difficulty{Easy, Hard} {
		for seed := range int64(seeds) {
			if radarShot(seed, d) {
				hits[d]++
			}
		}
	}
	t.Logf("radar hits out of %d: easy %d, hard %d", seeds, hits[Easy], hits[Hard])
	if hits[Hard] > seeds/4 || hits[Easy] <= hits[Hard] {
		t.Fatalf("radar hits: easy %d, hard %d of %d", hits[Easy], hits[Hard], seeds)
	}
}

// A bot with only IR left cannot answer a radar shooter beyond its IR lock
// range: it defends (beams) instead of holding its nose on the shooter; with
// a radar missile aboard it turns on the shooter first.
func TestIROnlyBotBeamsUnreachableShooter(t *testing.T) {
	m := terrain.Generate(1)
	self := sim.Plane{ID: 1, Team: sim.TeamNATO, Kind: sim.F16, Alive: true, HP: 90, Missiles: 2, Flares: 8,
		FlightState: sim.FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200)}}
	shooter := sim.Plane{ID: 2, Team: sim.TeamSoviet, Kind: sim.Su27, Alive: true, HP: 110,
		FlightState: sim.FlightState{Pos: geom.V(0, 2000, -2000), Rot: geom.AxisAngle(geom.V(0, 1, 0), math.Pi), Vel: geom.V(0, 0, 200)}}
	missile := sim.Missile{ID: 1 << 24, Owner: 2, Target: 1, Kind: sim.MissileRadar, Pos: geom.V(0, 2000, -1200), Vel: geom.V(0, 0, 400)}
	aim := func(self sim.Plane) geom.Vec3 {
		b := New(1, Hard, 1)
		for tick := range 30 {
			b.Think(&sim.Snapshot{Tick: tick, Planes: []sim.Plane{self, shooter}, Missiles: []sim.Missile{missile}}, &Env{Terrain: m})
		}
		return b.aim.Norm()
	}
	toShooter := shooter.Pos.Sub(self.Pos).Norm()
	if a := aim(self); math.Abs(a.Dot(toShooter)) > 0.2 {
		t.Fatalf("IR only, shooter at 2 km: want a beam, aim %v", a)
	}
	self.Radars = 1
	if a := aim(self); a.Dot(toShooter) < 0.9 {
		t.Fatalf("radar aboard: want return fire on the shooter, aim %v", a)
	}
}
