package sim

// Hit zones: every missile and cannon (or AA) round that hurts a plane rolls
// where it struck, with the world PRNG. A critical hit kills outright; an
// engine, controls or avionics hit adds a level of lasting damage (up to
// DamageMax) on top of the hit points it takes. Spawning, a rearm and the
// repair power-up clear it.

// Zone is where a hit struck.
type Zone uint8

const (
	ZoneGraze    Zone = iota // hit points only
	ZoneCrit                 // cockpit, fuel: the plane goes down
	ZoneEngine               // less thrust and top speed (EngineFactor)
	ZoneControls             // slower roll, pitch and yaw (ControlsFactor)
	ZoneAvionics             // slower locks (AvionicsLockMul)
)

// DamageMax is the most damage levels one part takes.
const DamageMax = 2

// Per-hit zone odds by weapon; the rest grazes.
var (
	MissileZoneOdds = [...]float64{ZoneCrit: 0.15, ZoneEngine: 0.30, ZoneControls: 0.30, ZoneAvionics: 0.15}
	BulletZoneOdds  = [...]float64{ZoneCrit: 0.005, ZoneEngine: 0.02, ZoneControls: 0.02, ZoneAvionics: 0.01}
)

// Effects per damage level (index 0: intact).
var (
	EngineFactor    = [DamageMax + 1]float64{1, 0.85, 0.7}  // MaxSpeed, MaxSpeedAB and Accel: top speed scales with it
	ControlsFactor  = [DamageMax + 1]float64{1, 0.75, 0.55} // RollRate, PitchRate, YawRate
	AvionicsLockMul = [DamageMax + 1]float64{1, 1.5, 2}     // lock time
)

// Damage is a plane's lasting damage, levels 0..DamageMax per part.
type Damage struct {
	Engine, Controls, Avionics uint8
}

// Pack is the wire byte: engine in bits 0–1, controls 2–3, avionics 4–5.
func (d Damage) Pack() uint8 { return d.Engine | d.Controls<<2 | d.Avionics<<4 }

// add raises the part a zone stands for by one level, up to DamageMax.
func (d *Damage) add(z Zone) {
	bump := func(l *uint8) { *l = min(*l+1, DamageMax) }
	switch z {
	case ZoneEngine:
		bump(&d.Engine)
	case ZoneControls:
		bump(&d.Controls)
	case ZoneAvionics:
		bump(&d.Avionics)
	}
}

// Damaged is spec flown with damage d: the flight model itself never sees
// the damage (client/src/sim/damage.ts mirrors this for prediction).
func Damaged(s Spec, d Damage) Spec {
	e, c := EngineFactor[d.Engine], ControlsFactor[d.Controls]
	s.MaxSpeed *= e
	s.MaxSpeedAB *= e
	s.Accel *= e
	s.RollRate *= c
	s.PitchRate *= c
	s.YawRate *= c
	return s
}

// LockSecondsOf is the lock time of kind k for a plane with damage d.
func LockSecondsOf(k MissileKind, d Damage) float64 {
	return k.LockSeconds() * AvionicsLockMul[d.Avionics]
}

// hitZone rolls where a hit by weapon struck; weapons without zones
// (bombs, rams, bounds) graze without a draw.
func (w *World) hitZone(weapon Weapon) Zone {
	var odds []float64
	switch weapon {
	case WMissile:
		odds = MissileZoneOdds[:]
	case WCannon, WAA:
		odds = BulletZoneOdds[:]
	default:
		return ZoneGraze
	}
	r := w.rng.Float64()
	for z := ZoneCrit; int(z) < len(odds); z++ {
		if r < odds[z] {
			return z
		}
		r -= odds[z]
	}
	return ZoneGraze
}
