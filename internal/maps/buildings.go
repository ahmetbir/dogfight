package maps

import (
	"math"

	"playground/internal/geom"
	"playground/internal/rng"
	"playground/internal/terrain"
)

// MaxBuildings caps the city (spec §4.4, K30).
const MaxBuildings = 1500

// City layout (spec §4.4).
const (
	cityMinX, cityMaxX = -1500.0, 1500.0
	cityMinZ, cityMaxZ = -1500.0, 2200.0
	blockPitch         = 144.0 // 120 m block + 24 m street
	blockSize          = 120.0
	parcelSize         = blockSize / 2
	buildChance        = 0.7
	baseMin, baseSpan  = 24.0, 20.0 // footprint side in [24, 44]
	parcelJitter       = 6.0
	sink               = 2.0 // foundations start this far below the ground
)

// cityBuildings places the city's buildings, blocks in ascending x then z,
// stopping at MaxBuildings.
func cityBuildings(t *terrain.Map, seed int64) []Box {
	r := rng.New(seed, 0xB1D)
	var out []Box
	for x0 := cityMinX; x0+blockSize <= cityMaxX; x0 += blockPitch {
		for z0 := cityMinZ; z0+blockSize <= cityMaxZ; z0 += blockPitch {
			for p := range 4 {
				if len(out) == MaxBuildings {
					return out
				}
				if r.Float() >= buildChance {
					continue
				}
				w, d := baseMin+baseSpan*r.Float(), baseMin+baseSpan*r.Float()
				cx := x0 + parcelSize*(float64(p%2)+0.5) + (2*r.Float()-1)*parcelJitter
				cz := z0 + parcelSize*(float64(p/2)+0.5) + (2*r.Float()-1)*parcelJitter
				h := r.Float()
				downtown := 1 - terrain.Smoothstep(0, 1600, math.Hypot(cx, cz-300))
				g := t.Ground(cx, cz)
				out = append(out, Box{
					Min: geom.V(cx-w/2, g-sink, cz-d/2),
					Max: geom.V(cx+w/2, g+12+h*h*(25+140*downtown), cz+d/2),
				})
			}
		}
	}
	return out
}

// hangarBoxes is 4 boxes per hangar: roof, back wall and two side walls, 1 m
// thick, leaving the door side (v = 210, toward the runway) open.
func hangarBoxes(b Base) []Box {
	y0 := b.Center.Y
	out := make([]Box, 0, 4*HangarCount)
	for i := range HangarCount {
		u := hangarU(i)
		u0, u1 := u-HangarW/2, u+HangarW/2
		v0, v1 := hangarV0, hangarV0+HangarD
		out = append(out,
			b.box(u0, u1, v0, v1, y0+HangarH-1, y0+HangarH), // roof
			b.box(u0, u1, v1-1, v1, y0, y0+HangarH),         // back
			b.box(u0, u0+1, v0, v1, y0, y0+HangarH),         // side
			b.box(u1-1, u1, v0, v1, y0, y0+HangarH),         // side
		)
	}
	return out
}

// box converts a local (u, v) rect and a world Y span to a world Box.
func (b Base) box(u0, u1, v0, v1, y0, y1 float64) Box {
	a := b.area(u0, u1, v0, v1, SurfNone)
	return Box{Min: geom.V(a.MinX, y0, a.MinZ), Max: geom.V(a.MaxX, y1, a.MaxZ)}
}
