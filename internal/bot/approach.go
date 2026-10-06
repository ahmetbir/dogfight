package bot

import (
	"math"

	"playground/internal/geom"
	"playground/internal/maps"
	"playground/internal/sim"
	"playground/internal/terrain"
)

// rwy is a base's landing frame: along from the threshold (+u, the landing
// direction), lat toward the apron (+v), h = wheel height above the runway.
type rwy struct {
	axis, inner geom.Vec3
	th          geom.Vec3 // threshold, Y = runway elevation
}

func runwayOf(b maps.Base) rwy {
	th, _ := b.Threshold()
	return rwy{axis: b.Axis, inner: b.Inner, th: th}
}

func (r rwy) at(p geom.Vec3) (along, lat, h float64) {
	d := p.Sub(r.th)
	return d.Dot(r.axis), d.Dot(r.inner), p.Y - r.th.Y - sim.GearHeight
}

// point is the runway-level world point at (along, lat).
func (r rwy) point(along, lat float64) geom.Vec3 {
	return r.th.Add(r.axis.Scale(along)).Add(r.inner.Scale(lat))
}

// trackAim is the air-relative direction that flies the ground track along
// the line through p0 with unit horizontal direction d at airspeed v and
// vertical speed vz: it cuts toward the line by at most maxCut rad (lookahead
// look) and crabs into wind w. A wanted track behind the plane becomes an
// explicit level turn whose sideways drift goes toward pref, so reversals
// stay over the cleared approach corridor.
func trackAim(self sim.Plane, p0, d geom.Vec3, look, maxCut, v, vz float64, w, pref geom.Vec3) geom.Vec3 {
	n := geom.V(-d.Z, 0, d.X)
	e := self.Pos.Sub(p0).Dot(n)
	cut := math.Max(-maxCut, math.Min(maxCut, math.Atan2(-e, look)))
	g := d.Scale(math.Cos(cut)).Add(n.Scale(math.Sin(cut)))
	vz = math.Max(-0.9*v, math.Min(0.9*v, vz))
	vh := math.Sqrt(v*v - vz*vz)
	fwd := flat(self.Rot.Forward())
	if fwd.Dot(g) < -0.2 {
		right := geom.V(-fwd.Z, 0, fwd.X)
		side := 1.0
		if right.Dot(pref) < 0 {
			side = -1
		}
		h := fwd.Scale(math.Cos(1.2)).Add(right.Scale(side * math.Sin(1.2)))
		return geom.V(h.X*vh, vz, h.Z*vh)
	}
	gw := g.X*w.X + g.Z*w.Z
	vg := gw + math.Sqrt(math.Max(0, vh*vh-(w.X*w.X+w.Z*w.Z)+gw*gw))
	return geom.V(g.X*vg-w.X, vz, g.Z*vg-w.Z)
}

// fly steers toward aim holding speed with the throttle; once the nose is
// on the aim it also rolls the wings level.
func fly(self sim.Plane, aim geom.Vec3, speed float64, gear bool) sim.Input {
	p, r, y := Steer(self.Rot, self.W, aim)
	if r == 0 {
		r = clamp(2 * self.Rot.Right().Y)
	}
	th := math.Max(0, math.Min(1, 0.5+(speed-self.Vel.Len())*0.05))
	return sim.Input{Pitch: p, Roll: r, Yaw: y, Throttle: th, Gear: gear}
}

// upright rolls an inverted plane wings-up with the stick otherwise
// neutral: near a bank of ±180° Steer's push and roll-and-pull branches
// alternate between two climb aims and the plane flies on level.
func upright(self sim.Plane) (sim.Input, bool) {
	right, up := self.Rot.Right(), self.Rot.Up()
	if up.Y >= 0 {
		return sim.Input{}, false
	}
	return sim.Input{Roll: clamp(-2 * math.Atan2(-right.Y, up.Y))}, true
}

// pathFloor is the highest ground under the next few seconds of straight
// flight (ground track = air velocity + wind) and within 250 m around.
func pathFloor(t *terrain.Map, self sim.Plane, w geom.Vec3) float64 {
	gv := geom.V(self.Vel.X+w.X, 0, self.Vel.Z+w.Z)
	top := math.Inf(-1)
	for s := 0.0; s <= 8; s++ {
		p := self.Pos.Add(gv.Scale(s))
		top = math.Max(top, t.Ground(p.X, p.Z))
	}
	for a := 0.0; a < 2*math.Pi; a += math.Pi / 4 {
		top = math.Max(top, t.Ground(self.Pos.X+250*math.Cos(a), self.Pos.Z+250*math.Sin(a)))
	}
	return top
}

// outboundSide picks the side (+1 apron, -1 away) of the centerline with the
// lower ground around the turn onto final.
func outboundSide(t *terrain.Map, r rwy) float64 {
	top := func(sign float64) float64 {
		h := math.Inf(-1)
		for along := -approachDist - 300; along <= -approachDist+600; along += 100 {
			for lat := 0.0; lat <= latOut+200; lat += 50 {
				p := r.point(along, sign*lat)
				h = math.Max(h, t.Ground(p.X, p.Z))
			}
		}
		return h
	}
	if top(-1) < top(1) {
		return -1
	}
	return 1
}
