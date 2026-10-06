package maps

import (
	"math"

	"playground/internal/geom"
)

// Box is a world-space axis-aligned box.
type Box struct{ Min, Max geom.Vec3 }

const (
	cellSize = 100.0
	cells    = 100
	origin   = -5000.0
	maxGrow  = 30.0 // largest Sweep radius (bot clearance); boxes are registered with this margin
)

// Index is a uniform 100 m grid over [-5000, 5000]² listing the boxes that
// touch each cell (grown by maxGrow). Immutable after NewIndex.
type Index struct {
	boxes []Box
	cells [cells * cells][]int32
}

func cellOf(v float64) int { return max(0, min(cells-1, int(math.Floor((v-origin)/cellSize)))) }

func NewIndex(boxes []Box) *Index {
	ix := &Index{boxes: boxes}
	for i, b := range boxes {
		for cz := cellOf(b.Min.Z - maxGrow); cz <= cellOf(b.Max.Z+maxGrow); cz++ {
			for cx := cellOf(b.Min.X - maxGrow); cx <= cellOf(b.Max.X+maxGrow); cx++ {
				ix.cells[cz*cells+cx] = append(ix.cells[cz*cells+cx], int32(i))
			}
		}
	}
	return ix
}

func (ix *Index) Boxes() []Box { return ix.boxes }

// Sweep returns the smallest t in [0,1] at which segment a→b enters any box
// grown by r on every side, the box index, and whether there was a hit.
// r must be <= maxGrow (cells were registered with that margin).
func (ix *Index) Sweep(a, b geom.Vec3, r float64) (float64, int, bool) {
	if r > maxGrow {
		panic("maps: Sweep radius above maxGrow") // programming error: cells would miss boxes
	}
	best, hit := math.Inf(1), -1
	g := geom.V(r, r, r)
	for cz := cellOf(math.Min(a.Z, b.Z) - r); cz <= cellOf(math.Max(a.Z, b.Z)+r); cz++ {
		for cx := cellOf(math.Min(a.X, b.X) - r); cx <= cellOf(math.Max(a.X, b.X)+r); cx++ {
			for _, i := range ix.cells[cz*cells+cx] {
				bx := ix.boxes[i]
				if t, ok := SegBox(a, b.Sub(a), bx.Min.Sub(g), bx.Max.Add(g)); ok && (t < best || (t == best && int(i) < hit)) {
					best, hit = t, int(i)
				}
			}
		}
	}
	if hit < 0 {
		return 0, -1, false
	}
	return best, hit, true
}

// SegBox is the slab test for a + t·d, t ∈ [0,1], against [lo, hi]: the
// entry parameter and whether the segment touches the box.
func SegBox(a, d, lo, hi geom.Vec3) (float64, bool) {
	t0, t1 := 0.0, 1.0
	for _, ax := range [3][4]float64{{a.X, d.X, lo.X, hi.X}, {a.Y, d.Y, lo.Y, hi.Y}, {a.Z, d.Z, lo.Z, hi.Z}} {
		p, dd, l, h := ax[0], ax[1], ax[2], ax[3]
		if dd == 0 {
			if p < l || p > h {
				return 0, false
			}
			continue
		}
		u, v := (l-p)/dd, (h-p)/dd
		if u > v {
			u, v = v, u
		}
		t0, t1 = math.Max(t0, u), math.Min(t1, v)
		if t0 > t1 {
			return 0, false
		}
	}
	return t0, true
}
