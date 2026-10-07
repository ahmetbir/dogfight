package sim

import "math"

const (
	RadarRangeMul    = 2.2                // radar lock range: the aircraft's lock range × this
	RadarLockSeconds = 2.0                // s on target before a radar lock
	RadarLeash       = 60 * math.Pi / 180 // semi-active: the target must stay this close to the launcher's nose
	RadarBeamSpeed   = 40.0               // m/s: target speed along the missile's line of sight under which it is beaming
	RadarDmg         = 50.0
	RadarBeamTicks   = 90 // ticks of continuous beaming that break a radar track (1.5 s)
)

// LockSeconds is the lock time of a missile kind.
func (k MissileKind) LockSeconds() float64 {
	if k == MissileRadar {
		return RadarLockSeconds
	}
	return LockSeconds
}

// MissilePick is the missile kind a pilot chose: PickAuto keeps the
// Karışık rule (lockKind), PickIR and PickRadar fire that kind while it
// lasts and the other one after.
type MissilePick uint8

const (
	PickAuto MissilePick = iota
	PickIR
	PickRadar
)

// pickedKind is the kind pick fires with the missiles p has left; ok is
// false for PickAuto.
func pickedKind(p *Plane, pick MissilePick) (k MissileKind, ok bool) {
	switch pick {
	case PickIR:
		if p.Missiles > 0 || p.Radars <= 0 {
			return MissileIR, true
		}
		return MissileRadar, true
	case PickRadar:
		if p.Radars > 0 || p.Missiles <= 0 {
			return MissileRadar, true
		}
		return MissileIR, true
	}
	return MissileIR, false
}

// lockKind is the kind the missile key fires at a target dist away: radar
// when the target is beyond the IR range irRange or no IR missile is left
// (and a radar one is), IR otherwise (Karışık selection rule).
func lockKind(p *Plane, dist, irRange float64) MissileKind {
	if p.Radars > 0 && (dist > irRange || p.Missiles <= 0) {
		return MissileRadar
	}
	return MissileIR
}

// radarTrack advances radar missile m's beam timer and reports whether it
// still tracks tgt: the launcher must be alive with tgt within RadarLeash
// of its nose (semi-active), and tgt must not beam it — its speed along
// the missile's line of sight under RadarBeamSpeed (either sign: the
// Doppler notch) for RadarBeamTicks in a row.
func (w *World) radarTrack(m *Missile, tgt *Plane) bool {
	l, ok := w.planes[m.Owner]
	if !ok || !l.Alive || angleBetween(l.Rot.Forward(), tgt.Pos.Sub(l.Pos)) > RadarLeash {
		return false
	}
	los := m.Pos.Sub(tgt.Pos)
	if los.Len() > 1e-6 && math.Abs(tgt.Vel.Dot(los.Norm())) < RadarBeamSpeed {
		m.BeamTicks++
	} else {
		m.BeamTicks = 0
	}
	return m.BeamTicks < RadarBeamTicks
}

// Damage is a hit's damage by a missile of kind k.
func (k MissileKind) Damage() float64 {
	if k == MissileRadar {
		return RadarDmg
	}
	return MissileDmg
}
