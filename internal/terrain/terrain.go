// Package terrain generates the island heightmap shared by server and client.
package terrain

import (
	"fmt"
	"math"
)

const (
	Size       = 10000.0 // meters, square, centered on origin
	Res        = 129     // grid points per side
	PlayHalf   = 4000.0  // playable area is [-PlayHalf, PlayHalf] on X and Z
	WaterLevel = 0.0
	Cell       = Size / (Res - 1) // 78.125 m between grid nodes
	cell       = Cell
)

// NodeCoord is the world x of grid column i (or z of row i).
func NodeCoord(i int) float64 { return -Size/2 + float64(i)*Cell }

type Map struct {
	h   []float64
	max float64
}

// IslandRaw is the v1 island before quantization, row-major [zi*Res+xi].
func IslandRaw(seed int64) []float64 {
	n := noise{seed: uint64(seed)*0x9E3779B97F4A7C15 + 1}
	raw := make([]float64, Res*Res)
	for zi := range Res {
		for xi := range Res {
			x := NodeCoord(xi)
			z := NodeCoord(zi)
			d := math.Hypot(x, z) / 3600
			mask := 1 - Smoothstep(0.45, 1.0, d)
			mount := n.fbm(x/1400, z/1400, 5)
			ridge := 1 - math.Abs(n.fbm(x/700+31, z/700-17, 3)*2-1)
			h := (math.Pow(mount, 1.6)*1500 + ridge*180) * mask
			raw[zi*Res+xi] = h - 220*(1-mask) - 30
		}
	}
	return raw
}

// FromRaw quantizes a raw height grid exactly like the wire format, so the
// server's map equals the client's decoded one.
func FromRaw(raw []float64) *Map {
	m, err := Decode((&Map{h: raw}).Encode())
	if err != nil {
		panic(err) // programming error: wrong grid size
	}
	return m
}

// Generate is the v1 island, bit-identical to v1.
func Generate(seed int64) *Map { return FromRaw(IslandRaw(seed)) }

// Smoothstep is the cubic Hermite step from a to b (a > b gives a falling step).
func Smoothstep(a, b, x float64) float64 {
	t := math.Max(0, math.Min(1, (x-a)/(b-a)))
	return t * t * (3 - 2*t)
}

// Quantize rounds h to the 0.1 m wire step: Decode(Encode) yields exactly
// Quantize(h) for any h inside the encodable range [-500, 6053.5].
func Quantize(h float64) float64 { return math.Round((h+500)*10)/10 - 500 }

func (m *Map) Encode() []uint16 {
	q := make([]uint16, len(m.h))
	for i, h := range m.h {
		q[i] = uint16(math.Round(math.Max(0, math.Min(65535, (h+500)*10))))
	}
	return q
}

func Decode(q []uint16) (*Map, error) {
	if len(q) != Res*Res {
		return nil, fmt.Errorf("terrain: got %d samples, want %d", len(q), Res*Res)
	}
	m := &Map{h: make([]float64, len(q)), max: math.Inf(-1)}
	for i, v := range q {
		m.h[i] = float64(v)/10 - 500
		m.max = math.Max(m.max, m.h[i])
	}
	return m, nil
}

func (m *Map) MaxHeight() float64 { return m.max }

func (m *Map) Height(x, z float64) float64 {
	gx, gz := (x+Size/2)/cell, (z+Size/2)/cell
	if gx < 0 || gz < 0 || gx > Res-1 || gz > Res-1 {
		return -200
	}
	x0, z0 := min(int(gx), Res-2), min(int(gz), Res-2)
	tx, tz := gx-float64(x0), gz-float64(z0)
	at := func(xi, zi int) float64 { return m.h[zi*Res+xi] }
	a := at(x0, z0) + (at(x0+1, z0)-at(x0, z0))*tx
	b := at(x0, z0+1) + (at(x0+1, z0+1)-at(x0, z0+1))*tx
	return a + (b-a)*tz
}

func (m *Map) Ground(x, z float64) float64 { return math.Max(m.Height(x, z), WaterLevel) }
