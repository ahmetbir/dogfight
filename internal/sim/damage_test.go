package sim

import (
	"math"
	"testing"

	"playground/internal/geom"
)

// The zone rolls follow the odds per weapon; weapons without zones never draw.
func TestHitZoneOdds(t *testing.T) {
	w := newTestWorld()
	const n = 200000
	for _, c := range []struct {
		weapon Weapon
		odds   []float64
	}{{WMissile, MissileZoneOdds[:]}, {WCannon, BulletZoneOdds[:]}, {WAA, BulletZoneOdds[:]}} {
		got := map[Zone]int{}
		for range n {
			got[w.hitZone(c.weapon)]++
		}
		for z := ZoneCrit; int(z) < len(c.odds); z++ {
			if rate := float64(got[z]) / n; math.Abs(rate-c.odds[z]) > 0.006 {
				t.Errorf("weapon %v zone %v: rate %.4f, want %.4f", c.weapon, z, rate, c.odds[z])
			}
		}
	}
	before := *w.rng
	for _, wp := range []Weapon{WBomb, WRam, WBounds, WCrash} {
		if z := w.hitZone(wp); z != ZoneGraze {
			t.Fatalf("weapon %v struck zone %v", wp, z)
		}
	}
	if draws(before, w.rng) != 0 {
		t.Fatal("a weapon without zones must not draw")
	}
}

// damageWith applies one hit to a fresh, unprotected plane 2 with the world
// PRNG seeded so the next zone roll is want.
func damageWith(t *testing.T, weapon Weapon, want Zone) (*World, *Plane, []Event) {
	t.Helper()
	for seed := range int64(5000) {
		w := NewWorld(Config{Seed: seed, Terrain: newTestWorld().cfg.Terrain})
		w.AddPlane(2, TeamSoviet, MiG29)
		w.clearProtection()
		probe := *w.rng
		pw := World{rng: &probe}
		if pw.hitZone(weapon) != want {
			continue
		}
		var ev []Event
		p := w.planes[2]
		w.damage(p, 1, 10, weapon, &ev)
		return w, p, ev
	}
	t.Fatalf("no seed rolls %v for %v", want, weapon)
	return nil, nil, nil
}

// A critical hit downs a full-health plane; part hits add a level each, capped.
func TestHitZonesDamage(t *testing.T) {
	_, p, ev := damageWith(t, WMissile, ZoneCrit)
	if p.Alive || p.HP != 0 {
		t.Fatalf("crit left the plane alive with %v HP", p.HP)
	}
	if ev[0].Kind != EvHit || ev[0].Zone != ZoneCrit || ev[0].Value != SpecOf(MiG29).MaxHP {
		t.Fatalf("crit hit event %+v", ev[0])
	}
	for _, c := range []struct {
		zone Zone
		part func(Damage) uint8
	}{
		{ZoneEngine, func(d Damage) uint8 { return d.Engine }},
		{ZoneControls, func(d Damage) uint8 { return d.Controls }},
		{ZoneAvionics, func(d Damage) uint8 { return d.Avionics }},
	} {
		_, p, ev := damageWith(t, WCannon, c.zone)
		if c.part(p.Damage) != 1 || p.HP != SpecOf(MiG29).MaxHP-10 || ev[0].Zone != c.zone {
			t.Fatalf("zone %v: damage %+v, HP %v, event %+v", c.zone, p.Damage, p.HP, ev[0])
		}
		for range 5 {
			p.Damage.add(c.zone)
		}
		if c.part(p.Damage) != DamageMax {
			t.Fatalf("zone %v: level %d past the cap", c.zone, c.part(p.Damage))
		}
	}
	if (Damage{Engine: 2, Controls: 1, Avionics: 2}).Pack() != 2|1<<2|2<<4 {
		t.Fatal("wire packing")
	}
}

// topSpeed flies a plane level on afterburner until its speed settles.
func topSpeed(d Damage) float64 {
	fs := FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1}
	s := Damaged(SpecOf(F16), d)
	for range 120 * 60 {
		fs = StepFlight(fs, Input{Throttle: 1, AB: false}, s, FlightMods{})
	}
	return fs.Vel.Len()
}

// Engine damage lowers the top speed by EngineFactor; controls damage the roll rate.
func TestDamagedFlight(t *testing.T) {
	full := topSpeed(Damage{})
	for lvl := uint8(1); lvl <= DamageMax; lvl++ {
		if r := topSpeed(Damage{Engine: lvl}) / full; math.Abs(r-EngineFactor[lvl]) > 0.01 {
			t.Errorf("engine %d: top speed ×%.3f, want ×%.2f", lvl, r, EngineFactor[lvl])
		}
	}
	rollRate := func(d Damage) float64 {
		fs := FlightState{Pos: geom.V(0, 2000, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -170), Throttle: 1}
		s := Damaged(SpecOf(F16), d)
		for range 60 {
			fs = StepFlight(fs, Input{Throttle: 1, Roll: 1}, s, FlightMods{})
		}
		return math.Abs(fs.W.Z)
	}
	if r := rollRate(Damage{Controls: 2}) / rollRate(Damage{}); math.Abs(r-ControlsFactor[2]) > 0.01 {
		t.Errorf("controls 2: roll rate ×%.3f, want ×%.2f", r, ControlsFactor[2])
	}
}

// Avionics damage stretches the lock time; the repair power-up clears damage.
func TestAvionicsLockAndRepair(t *testing.T) {
	lockTicks := func(d Damage) int {
		w, hold := duelWorld(LoadIR, -500)
		w.planes[1].Damage = d
		for i := 1; i <= 5*60; i++ {
			hold()
			w.Step(nil)
			if p, _ := w.Plane(1); p.Locked {
				return i
			}
		}
		return -1
	}
	base, slow := lockTicks(Damage{}), lockTicks(Damage{Avionics: 2})
	if want := int(math.Round(LockSeconds*AvionicsLockMul[2]/Dt)) + 1; slow != want || base >= slow {
		t.Fatalf("lock on tick %d intact, %d with avionics 2 (want %d)", base, slow, want)
	}
	w := newTestWorld()
	w.AddPlane(1, TeamNATO, F16)
	w.planes[1].Damage = Damage{Engine: 2, Controls: 1, Avionics: 1}
	w.applyPowerup(w.planes[1], PURepair)
	if w.planes[1].Damage != (Damage{}) {
		t.Fatal("repair must clear the damage")
	}
}
