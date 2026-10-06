package maps

import (
	"math"

	"playground/internal/geom"
	"playground/internal/terrain"
)

const (
	flattenMargin    = 160.0
	blendWidth       = 400.0
	minElev, maxElev = 8.0, 350.0
)

// Approach corridor (base-local, spec §4.3 landing from -u): raw heights in it
// are capped under the 2.9° glide path so every map/seed/base can be landed on.
const (
	approachU0, approachU1 = -3400.0, -1160.0
	approachHalfV          = 250.0
	glideSlope             = 0.05
	glideMargin            = 40.0
)

// placeBase tries 25 centers around the nominal one and keeps the flattest
// (variance + 1000 per node below minElev); ties keep the first candidate.
func placeBase(raw []float64, n nominal) Base {
	var best Base
	bestCost := math.Inf(1)
	for _, dx := range []float64{-400, -200, 0, 200, 400} {
		for _, dz := range []float64{-400, -200, 0, 200, 400} {
			b := Base{Side: n.side, Center: geom.V(n.x+dx, 0, n.z+dz), Axis: n.axis, Inner: n.inner}
			mean, cost := footprintStats(raw, b)
			if cost < bestCost {
				b.Center.Y = terrain.Quantize(math.Max(minElev, math.Min(maxElev, mean)))
				best, bestCost = b, cost
			}
		}
	}
	best.layout()
	return best
}

func footprintStats(raw []float64, b Base) (mean, cost float64) {
	var sum, sum2, n, low float64
	for zi := range terrain.Res {
		for xi := range terrain.Res {
			u, v := b.local(terrain.NodeCoord(xi), terrain.NodeCoord(zi))
			if math.Abs(u) > footU || v < footV0 || v > footV1 {
				continue
			}
			h := raw[zi*terrain.Res+xi]
			sum, sum2, n = sum+h, sum2+h*h, n+1
			if h < minElev {
				low++
			}
		}
	}
	mean = sum / n
	return mean, sum2/n - mean*mean + 1000*low
}

// flatten sets every node within the footprint plus margin to the base
// elevation and blends a ring of blendWidth back to the raw terrain.
func flatten(raw []float64, b Base) {
	for zi := range terrain.Res {
		for xi := range terrain.Res {
			u, v := b.local(terrain.NodeCoord(xi), terrain.NodeCoord(zi))
			du := math.Max(0, math.Abs(u)-(footU+flattenMargin))
			dv := math.Max(0, math.Max((footV0-flattenMargin)-v, v-(footV1+flattenMargin)))
			d := math.Hypot(du, dv)
			i := zi*terrain.Res + xi
			switch {
			case d == 0:
				raw[i] = b.Center.Y
			case d < blendWidth:
				raw[i] = b.Center.Y + (raw[i]-b.Center.Y)*terrain.Smoothstep(0, blendWidth, d)
			}
		}
	}
}

// clearApproach lowers raw heights in b's approach corridor toward
// glideCap, but never below the runway elevation: h = min(raw, max(cap, elev)).
// That equals the ruled max(cap, min(raw, elev)) wherever raw is above the
// cap, and leaves lower ground (sea, oasis, valleys) untouched instead of
// raising it to the cap.
func clearApproach(raw []float64, b Base) {
	for zi := range terrain.Res {
		for xi := range terrain.Res {
			u, v := b.local(terrain.NodeCoord(xi), terrain.NodeCoord(zi))
			if !inApproach(u, v) {
				continue
			}
			i := zi*terrain.Res + xi
			raw[i] = math.Min(raw[i], math.Max(glideCap(b, u), b.Center.Y))
		}
	}
}

func inApproach(u, v float64) bool {
	return u >= approachU0 && u <= approachU1 && math.Abs(v) <= approachHalfV
}

// glideCap is glideMargin below the glide line elev + 2.5 + glideSlope·(-850 - u).
func glideCap(b Base, u float64) float64 {
	return b.Center.Y + 2.5 + glideSlope*(-850-u) - glideMargin
}
