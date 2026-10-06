package bot

import (
	"math"

	"playground/internal/geom"
	"playground/internal/sim"
)

// radarThreatRange: radar missiles are beamed from a little farther out
// than IR ones are evaded, since a beam needs RadarBeamTicks to break the
// track (3 km kept bots beaming long-range shots out of the fight: runway
// match kills fell below the quality floor).
const radarThreatRange = 1500.0

// returnFireCone: a radar shooter this close to the nose is turned on for a
// return shot before the beam.
const returnFireCone = 30 * math.Pi / 180

// Loadout is the missile loadout of the bot's next sortie: easy flies IR,
// normal Karışık; hard flies radar when most of the enemy it sees in s
// carries IR only (outranging them), Karışık otherwise (and with no s).
func (b *Brain) Loadout(s *sim.Snapshot) sim.Loadout {
	switch b.d {
	case Easy:
		return sim.LoadIR
	case Normal:
		return sim.LoadMixed
	}
	if s == nil {
		return sim.LoadMixed
	}
	self, ok := findPlane(s.Planes, b.id)
	if !ok {
		return sim.LoadMixed
	}
	foes, ir := 0, 0
	for _, o := range s.Planes {
		if o.ID == b.id || !sim.Hostile(self.Team, o.Team, false) {
			continue
		}
		foes++
		if o.Loadout == sim.LoadIR {
			ir++
		}
	}
	if foes > 0 && 2*ir > foes {
		return sim.LoadRadar
	}
	return sim.LoadMixed
}

// beamDir flies level across radar missile m's line of sight, on the side
// closer to the nose, so self's speed along it stays under RadarBeamSpeed.
func beamDir(self sim.Plane, m sim.Missile) geom.Vec3 {
	los := m.Pos.Sub(self.Pos)
	d := geom.V(-los.Z, 0, los.X).Norm()
	if d == (geom.Vec3{}) { // straight above or below
		d = self.Rot.Right()
	}
	if d.Dot(self.Rot.Forward()) < 0 {
		d = d.Scale(-1)
	}
	return d
}

// guiding returns the target of self's radar missile still in flight: the
// semi-active seeker needs it within RadarLeash of the nose.
func guiding(self sim.Plane, s *sim.Snapshot) (sim.Plane, bool) {
	for _, m := range s.Missiles {
		if m.Owner != self.ID || m.Kind != sim.MissileRadar || m.Target == 0 {
			continue
		}
		if tg, ok := findPlane(s.Planes, m.Target); ok && tg.Alive {
			return tg, true
		}
	}
	return sim.Plane{}, false
}

// threatRangeOf is how far out a missile of kind k is defended against.
func threatRangeOf(k sim.MissileKind) float64 {
	if k == sim.MissileRadar {
		return radarThreatRange
	}
	return threatRange
}

// returnFire answers a radar shot with one: while self's lock on the
// shooter is building (or made) and nothing of self's flies at it yet, the
// nose stays on the shooter until the missile leaves; the beam comes after.
// With only IR left the shooter must be inside the IR lock range (weather
// aside), else the bot defends at once.
func (b *Brain) returnFire(self sim.Plane, m sim.Missile, s *sim.Snapshot) bool {
	if self.Missiles+self.Radars == 0 {
		return false
	}
	for _, o := range s.Missiles {
		if o.Owner == self.ID && o.Target == m.Owner {
			return false
		}
	}
	shooter, ok := findPlane(s.Planes, m.Owner)
	if !ok || !shooter.Alive {
		return false
	}
	if self.Radars == 0 && shooter.Pos.Dist(self.Pos) > sim.SpecOf(self.Kind).LockRange { // IR only, out of its reach: defend
		return false
	}
	if self.LockTarget != m.Owner && self.Rot.Forward().Dot(shooter.Pos.Sub(self.Pos).Norm()) < math.Cos(returnFireCone) {
		return false
	}
	b.target = shooter.ID
	b.attack(self, shooter)
	return true
}
