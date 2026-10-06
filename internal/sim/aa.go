package sim

import (
	"math"

	"playground/internal/geom"
	"playground/internal/maps"
)

const (
	AARange      = 1500.0
	AAInterval   = 20 // ticks between shells
	AAShellSpeed = 450.0
	AASpread     = 0.022 // rad per axis
	AAShellLife  = 240
	AADmg        = 7.0
)

// stepAA fires each live AA site at the nearest hostile plane in range,
// leading it; shells are bullets owned by no plane. Planes that are
// protected or on their wheels are never targeted. Sites and planes are
// visited in slice and ID order, so the PRNG draws are deterministic.
func (w *World) stepAA(ev *[]Event) {
	for i, s := range w.structs {
		if !s.Alive || s.Kind != maps.StructAA || w.tick < w.aaReady[i] {
			continue
		}
		box := w.cfg.Map.Structures[i].Box
		gun := geom.V((box.Min.X+box.Max.X)/2, box.Max.Y+1, (box.Min.Z+box.Max.Z)/2)
		team := structTeam(s)
		var tgt *Plane
		best := AARange
		for _, id := range w.order {
			p := w.planes[id]
			if !p.Alive || p.Ground || w.protected(p) || !Hostile(team, p.Team, false) {
				continue
			}
			if d := p.Pos.Dist(gun); d < best {
				tgt, best = p, d
			}
		}
		if tgt == nil {
			continue
		}
		w.aaReady[i] = w.tick + AAInterval
		dir := w.aaLead(gun, tgt).Sub(gun).Norm()
		side := dir.Cross(geom.V(0, 1, 0)).Norm()
		if side == (geom.Vec3{}) { // straight up or down
			side = geom.V(1, 0, 0)
		}
		up := side.Cross(dir)
		yaw := (w.rng.Float64()*2 - 1) * AASpread
		pitch := (w.rng.Float64()*2 - 1) * AASpread
		dir = geom.AxisAngle(up, yaw).Mul(geom.AxisAngle(side, pitch)).Rotate(dir)
		if dir == (geom.Vec3{}) || math.IsNaN(dir.X+dir.Y+dir.Z) {
			continue
		}
		b := Bullet{Owner: 0, Team: team, Pos: gun, Vel: dir.Scale(AAShellSpeed), ExpireTick: w.tick + AAShellLife, Dmg: AADmg, Weapon: WAA}
		w.bullets = append(w.bullets, b)
		*ev = append(*ev, Event{Kind: EvFire, Plane: 0, Other: s.ID, Pos: b.Pos, Vel: b.Vel, Weapon: WAA})
	}
}

// aaLead is where the shell meets tgt if it keeps turning as it does now:
// its velocity rotates toward the nose at Slip (the flight model's lateral
// acceleration), and the wind carries it (ground track = Vel + wind). The
// intercept time is refined a few times from the shell's flight time.
func (w *World) aaLead(gun geom.Vec3, tgt *Plane) geom.Vec3 {
	speed := tgt.Vel.Len()
	if speed == 0 {
		return tgt.Pos
	}
	dir := tgt.Vel.Scale(1 / speed)
	turn := tgt.Rot.Forward().Sub(dir.Scale(dir.Dot(tgt.Rot.Forward()))) // part of the nose across the velocity
	omega := Slip * turn.Len()                                           // rad/s the velocity turns
	var across geom.Vec3
	if omega > 1e-6 {
		across = turn.Norm()
	}
	at := func(t float64) geom.Vec3 {
		along, side := speed*t, 0.0
		if omega > 1e-6 {
			along = speed * math.Sin(omega*t) / omega
			side = speed * (1 - math.Cos(omega*t)) / omega
		}
		return tgt.Pos.Add(dir.Scale(along)).Add(across.Scale(side)).Add(w.wind.Scale(t))
	}
	t := tgt.Pos.Dist(gun) / AAShellSpeed
	for range 4 {
		t = at(t).Dist(gun) / AAShellSpeed
	}
	return at(t)
}
