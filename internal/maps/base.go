package maps

import (
	"math"

	"playground/internal/geom"
)

// Base layout in local (u, v): u along the runway, v toward the apron (spec §4.3).
const (
	RunwayHalfL, RunwayHalfW               = 900.0, 22.5
	taxiV0, taxiV1, taxiHalfL              = 110.0, 130.0, 710.0
	connU0, connU1                         = 690.0, 710.0
	apronV0, apronV1, apronHalfL           = 130.0, 210.0, 300.0
	HangarCount                            = 6
	HangarPitch, HangarW, HangarD, HangarH = 100.0, 40.0, 30.0, 12.0
	hangarV0                               = 210.0
	footU, footV0, footV1                  = 1000.0, -80.0, 360.0
)

// Hangar is a spawn slot; Spawn.Y is the paved elevation.
type Hangar struct {
	Spawn   geom.Vec3
	Heading float64
}

// Base is one side's airfield.
type Base struct {
	Side    int       // 0 NATO, 1 Soviet
	Center  geom.Vec3 // runway center, Y = quantized elevation
	Axis    geom.Vec3 // unit along the runway (+u), world X or Z
	Inner   geom.Vec3 // unit toward the apron (+v)
	Areas   []Area    // [0] runway, then taxiway, connectors, apron, 6 hangar floors
	Hangars []Hangar  // 6, index i at u = -250 + 100*i
	Bounds  Area      // footprint u ±1000, v -80..360 (Surf = SurfNone)
}

type nominal struct {
	side        int
	x, z        float64
	axis, inner geom.Vec3
}

// nominals is the constant per-kind base table (spec §4.2).
var nominals = map[Kind][2]nominal{
	Ada:   {{0, -2400, 0, geom.V(0, 0, 1), geom.V(1, 0, 0)}, {1, 2400, 0, geom.V(0, 0, 1), geom.V(-1, 0, 0)}},
	Sehir: {{0, -2900, 0, geom.V(0, 0, 1), geom.V(1, 0, 0)}, {1, 2900, 0, geom.V(0, 0, 1), geom.V(-1, 0, 0)}},
	Col:   {{0, 0, -2600, geom.V(1, 0, 0), geom.V(0, 0, 1)}, {1, 0, 2600, geom.V(1, 0, 0), geom.V(0, 0, -1)}},
	Dag:   {{0, -2600, 0, geom.V(0, 0, 1), geom.V(1, 0, 0)}, {1, 2600, 0, geom.V(0, 0, 1), geom.V(-1, 0, 0)}},
}

// HeadingOf is the heading ψ of horizontal direction d: atan2(-d.X, -d.Z).
func HeadingOf(d geom.Vec3) float64 { return math.Atan2(-d.X, -d.Z) }

// World maps local (u, v) to world space at the base elevation.
func (b Base) World(u, v float64) geom.Vec3 {
	p := b.Center.Add(b.Axis.Scale(u)).Add(b.Inner.Scale(v))
	p.Y = b.Center.Y
	return p
}

// local returns (u, v) of world (x, z) in b's frame.
func (b Base) local(x, z float64) (float64, float64) {
	d := geom.V(x-b.Center.X, 0, z-b.Center.Z)
	return d.Dot(b.Axis), d.Dot(b.Inner)
}

// area converts a local rect to a world AABB (axes are world-aligned).
func (b Base) area(u0, u1, v0, v1 float64, s Surface) Area {
	p, q := b.World(u0, v0), b.World(u1, v1)
	return Area{math.Min(p.X, q.X), math.Min(p.Z, q.Z), math.Max(p.X, q.X), math.Max(p.Z, q.Z), s}
}

// layout fills Areas, Hangars and Bounds for a base at Center.
func (b *Base) layout() {
	b.Areas = []Area{
		b.area(-RunwayHalfL, RunwayHalfL, -RunwayHalfW, RunwayHalfW, SurfRunway),
		b.area(-taxiHalfL, taxiHalfL, taxiV0, taxiV1, SurfTaxi),
		b.area(-connU1, -connU0, RunwayHalfW, taxiV0, SurfTaxi),
		b.area(connU0, connU1, RunwayHalfW, taxiV0, SurfTaxi),
		b.area(-apronHalfL, apronHalfL, apronV0, apronV1, SurfTaxi),
	}
	b.Hangars = make([]Hangar, HangarCount)
	for i := range HangarCount {
		u := hangarU(i)
		b.Areas = append(b.Areas, b.area(u-HangarW/2, u+HangarW/2, hangarV0, hangarV0+HangarD, SurfTaxi))
		b.Hangars[i] = Hangar{Spawn: b.World(u, hangarV0+16), Heading: HeadingOf(b.Inner.Scale(-1))}
	}
	b.Bounds = b.area(-footU, footU, footV0, footV1, SurfNone)
}

func hangarU(i int) float64 { return -250 + HangarPitch*float64(i) }

// Waypoints is the taxi route from hangar i: door, apron exit, taxi end, hold, lineup.
func (b Base) Waypoints(i int) []geom.Vec3 {
	u := hangarU(i)
	return []geom.Vec3{b.World(u, 205), b.World(u, 120), b.World(-700, 120), b.World(-700, 40), b.World(-700, 0)}
}

// Lineup is the takeoff point on the runway and the takeoff heading (+u).
func (b Base) Lineup() (geom.Vec3, float64) { return b.World(-700, 0), HeadingOf(b.Axis) }

// Threshold is the landing threshold and the landing heading (+u).
func (b Base) Threshold() (geom.Vec3, float64) { return b.World(-850, 0), HeadingOf(b.Axis) }
