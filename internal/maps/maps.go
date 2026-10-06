// Package maps builds a playable map from (kind, seed): biome terrain, two
// flattened air bases and, later, buildings and structures. Pure and
// deterministic; it knows nothing of sim (sides are ints: 0 NATO, 1 Soviet).
package maps

import (
	"slices"

	"playground/internal/terrain"
)

// Kind is the map biome.
type Kind uint8

const (
	Ada Kind = iota + 1
	Sehir
	Col
	Dag
)

var kindNames = [...]string{Ada: "ada", Sehir: "sehir", Col: "col", Dag: "dag"}

// ParseKind maps a wire name ("ada", "sehir", "col", "dag") to its Kind.
func ParseKind(s string) (Kind, bool) {
	for k, name := range kindNames {
		if name != "" && name == s {
			return Kind(k), true
		}
	}
	return 0, false
}

func (k Kind) String() string {
	if int(k) < len(kindNames) && kindNames[k] != "" {
		return kindNames[k]
	}
	return "?"
}

// Surface is the paved surface type under a point.
type Surface uint8

const (
	SurfNone Surface = iota
	SurfRunway
	SurfTaxi
)

// Area is a world-space axis-aligned rectangle with a surface type.
type Area struct {
	MinX, MinZ, MaxX, MaxZ float64
	Surf                   Surface
}

func (a Area) Contains(x, z float64) bool {
	return x >= a.MinX && x <= a.MaxX && z >= a.MinZ && z <= a.MaxZ
}

// Map is a built map: quantized terrain, both bases and the solid boxes.
type Map struct {
	Kind       Kind
	Seed       int64
	Terrain    *terrain.Map
	Bases      [2]Base
	Buildings  []Box       // city buildings only (sent to clients)
	Solids     *Index      // Buildings + hangar walls/roofs (server collision)
	Structures []StructDef // base attack targets: NATO 0..5, then Soviet 0..5
}

// Build generates the map for (k, seed): raw terrain, two bases placed and
// flattened into it, approach corridors capped under the glide path, then
// quantized. Everything is a pure function of (k, seed).
func Build(k Kind, seed int64) *Map {
	raw := rawFor(k, seed)
	m := &Map{Kind: k, Seed: seed}
	for side := range 2 {
		m.Bases[side] = placeBase(raw, nominals[k][side])
		flatten(raw, m.Bases[side])
	}
	for _, b := range m.Bases {
		clearApproach(raw, b)
	}
	m.Terrain = terrain.FromRaw(raw)
	if k == Sehir {
		m.Buildings = cityBuildings(m.Terrain, seed)
	}
	solids := slices.Clone(m.Buildings)
	for _, b := range m.Bases {
		solids = append(solids, hangarBoxes(b)...)
	}
	m.Solids = NewIndex(solids)
	for _, b := range m.Bases {
		m.Structures = append(m.Structures, structures(b)...)
	}
	return m
}

func rawFor(k Kind, seed int64) []float64 {
	switch k {
	case Sehir:
		return terrain.CityRaw(seed)
	case Col:
		return terrain.DesertRaw(seed)
	case Dag:
		return terrain.MountainRaw(seed)
	}
	return terrain.IslandRaw(seed)
}

// SurfaceAt is the paved surface at (x, z); runway wins over taxiway.
func (m *Map) SurfaceAt(x, z float64) Surface {
	s := SurfNone
	for _, b := range m.Bases {
		for _, a := range b.Areas {
			if !a.Contains(x, z) {
				continue
			}
			if a.Surf == SurfRunway {
				return SurfRunway
			}
			if a.Surf == SurfTaxi {
				s = SurfTaxi
			}
		}
	}
	return s
}

// BaseAt is the side whose Bounds contain (x, z), else -1.
func (m *Map) BaseAt(x, z float64) int {
	for i, b := range m.Bases {
		if b.Bounds.Contains(x, z) {
			return i
		}
	}
	return -1
}
