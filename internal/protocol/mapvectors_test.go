package protocol

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"

	"playground/internal/maps"
)

var update = flag.Bool("update", false, "rewrite testdata/vectors/maps.json")

var mapVectorsPath = filepath.Join("..", "..", "testdata", "vectors", "maps.json")

type mapVec struct {
	Kind    string       `json:"kind"`
	Seed    int64        `json:"seed"`
	Size    float64      `json:"size"`
	Res     int          `json:"res"`
	Heights string       `json:"heights"`
	Map     MapInfo      `json:"map"`
	Points  [][4]float64 `json:"points"` // x, z, surf, ground
	// Hangar collision boxes per base side (4 per hangar: roof, back, two
	// sides) as min x,y,z, max x,y,z; pins the client's hangar meshes.
	HangarBoxes [2][][6]float64 `json:"hangarBoxes"`
}

func buildMapVec(k maps.Kind) mapVec {
	m := maps.Build(k, 1)
	var info MapInfo
	if err := json.Unmarshal(MapJSON(m, false), &info); err != nil {
		panic(err)
	}
	info.Bld = [][6]float64{}
	q := m.Terrain.Encode()
	raw := make([]byte, 2*len(q))
	for i, v := range q {
		binary.LittleEndian.PutUint16(raw[2*i:], v)
	}
	v := mapVec{Kind: k.String(), Seed: 1, Size: 10000, Res: 129, Heights: base64.StdEncoding.EncodeToString(raw), Map: info}
	local := [][2]float64{{0, 0}, {890, 20}, {0, 120}, {-700, 60}, {0, 170}, {-250, 225}, {0, 60}, {0, 300}, {950, 0}, {-1200, 0}}
	for _, b := range m.Bases {
		for _, uv := range local {
			p := b.World(uv[0], uv[1])
			v.Points = append(v.Points, [4]float64{p.X, p.Z, float64(m.SurfaceAt(p.X, p.Z)), m.Terrain.Ground(p.X, p.Z)})
		}
	}
	for i := range 20 {
		x, z := -3900+float64(i)*411.7, 3700-float64(i)*389.3
		v.Points = append(v.Points, [4]float64{x, z, float64(m.SurfaceAt(x, z)), m.Terrain.Ground(x, z)})
	}
	// Solids are the city buildings followed by each base's hangar boxes.
	hb := m.Solids.Boxes()[len(m.Buildings):]
	per := len(hb) / len(m.Bases)
	for side := range m.Bases {
		for _, b := range hb[side*per : (side+1)*per] {
			v.HangarBoxes[side] = append(v.HangarBoxes[side], [6]float64{b.Min.X, b.Min.Y, b.Min.Z, b.Max.X, b.Max.Y, b.Max.Z})
		}
	}
	return v
}

func TestMapVectors(t *testing.T) {
	var want struct {
		Maps []mapVec `json:"maps"`
	}
	for _, k := range []maps.Kind{maps.Ada, maps.Sehir, maps.Col, maps.Dag} {
		v := buildMapVec(k)
		for side, bs := range v.HangarBoxes {
			if len(bs) != 4*maps.HangarCount {
				t.Fatalf("%s side %d: %d hangar boxes, want %d", v.Kind, side, len(bs), 4*maps.HangarCount)
			}
		}
		want.Maps = append(want.Maps, v)
	}
	if *update {
		b, err := json.Marshal(want)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(mapVectorsPath, append(b, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(mapVectorsPath)
	if err != nil {
		t.Fatalf("%v (generate with -update)", err)
	}
	b, _ := json.Marshal(want)
	if string(append(b, '\n')) != string(data) {
		t.Fatal("maps.json drifted from maps.Build (regenerate with -update)")
	}
}
