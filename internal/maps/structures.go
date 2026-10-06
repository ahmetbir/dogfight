package maps

import "playground/internal/geom"

// StructKind is a base attack target type.
type StructKind uint8

const (
	StructHangar StructKind = iota + 1
	StructFuel
	StructRadar
	StructAA
)

var structNames = [...]string{StructHangar: "hangar", StructFuel: "fuel", StructRadar: "radar", StructAA: "aa"}

func (k StructKind) String() string {
	if k < StructHangar || k > StructAA {
		return ""
	}
	return structNames[k]
}

// StructDef is one base attack target as laid out on the map.
type StructDef struct {
	Side, Index int // index 0..5 within the side (spec §3.10 table)
	Kind        StructKind
	Box         Box
	MaxHP       float64
	Hangar      int // hangar slot it covers, -1 if none
}

// structLayout is spec §3.10: kind, center (u, v), size along u, height, size along v, HP, hangar slot.
var structLayout = [6]struct {
	kind          StructKind
	u, v, w, h, d float64
	hp            float64
	hangar        int
}{
	{StructHangar, -250, 225, 40, 12, 30, 400, 0},
	{StructHangar, 250, 225, 40, 12, 30, 400, 5},
	{StructFuel, 420, 170, 20, 14, 20, 250, -1},
	{StructFuel, 500, 170, 20, 14, 20, 250, -1},
	{StructRadar, -480, 180, 12, 18, 12, 300, -1},
	{StructAA, 0, 320, 16, 5, 16, 350, -1},
}

// structures are base b's six targets in table order.
func structures(b Base) []StructDef {
	out := make([]StructDef, 0, len(structLayout))
	for i, l := range structLayout {
		p, q := b.World(l.u-l.w/2, l.v-l.d/2), b.World(l.u+l.w/2, l.v+l.d/2)
		box := Box{Min: geom.V(min(p.X, q.X), b.Center.Y, min(p.Z, q.Z)), Max: geom.V(max(p.X, q.X), b.Center.Y+l.h, max(p.Z, q.Z))}
		out = append(out, StructDef{Side: b.Side, Index: i, Kind: l.kind, Box: box, MaxHP: l.hp, Hangar: l.hangar})
	}
	return out
}
