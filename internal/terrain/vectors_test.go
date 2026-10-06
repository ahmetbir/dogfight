package terrain

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"
)

var update = flag.Bool("update", false, "rewrite testdata/vectors/terrain.json")

// Shared terrain vectors: Go writes the seed-1 heightmap (base64 of
// little-endian uint16, the wire format of welcome.terrain.heights) and 20
// sample points [x, z, Height(x, z)]. The client's heightAt
// (client/src/render/heightmap.ts) must reproduce them within 1e-9.
//
// Without -update the test checks the committed file: the heights must equal
// Generate(vecSeed) and every point must equal Height of the decoded map.

const vecSeed = 1

var vectorsPath = filepath.Join("..", "..", "testdata", "vectors", "terrain.json")

type vecFile struct {
	Size    float64      `json:"size"`
	Res     int          `json:"res"`
	Heights string       `json:"heights"`
	Points  [][3]float64 `json:"points"`
}

// vecPoints covers grid nodes, cell interiors, the grid edges (where the
// last cell is clamped) and points outside the grid (-200).
func vecPoints() [][2]float64 {
	return [][2]float64{
		{0, 0}, {78.125, -156.25}, {123.4, -456.7}, {-1000.5, 2000.25},
		{1333.3, -1222.2}, {-899, 1999}, {1500.75, 1500.75}, {-2500, -10},
		{5000, 5000}, {-5000, -5000}, {5000, -1234.5}, {-4321, 5000},
		{4999.99, 0.01}, {-610.3, -870.9}, {250, 3100}, {1750.5, -600.25},
		{-1100, -900}, {9000, 0}, {0, -5000.01}, {-7000, 7000},
	}
}

func encodeHeights(q []uint16) string {
	raw := make([]byte, 2*len(q))
	for i, v := range q {
		binary.LittleEndian.PutUint16(raw[2*i:], v)
	}
	return base64.StdEncoding.EncodeToString(raw)
}

func decodeHeights(t *testing.T, s string) *Map {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	q := make([]uint16, len(raw)/2)
	for i := range q {
		q[i] = binary.LittleEndian.Uint16(raw[2*i:])
	}
	m, err := Decode(q)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func TestTerrainVectors(t *testing.T) {
	if *update {
		m := Generate(vecSeed)
		f := vecFile{Size: Size, Res: Res, Heights: encodeHeights(m.Encode())}
		for _, p := range vecPoints() {
			f.Points = append(f.Points, [3]float64{p[0], p[1], m.Height(p[0], p[1])})
		}
		data, err := json.MarshalIndent(f, "", " ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Dir(vectorsPath), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(vectorsPath, append(data, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(vectorsPath)
	if err != nil {
		t.Fatalf("%v (generate with -update)", err)
	}
	var f vecFile
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	if f.Size != Size || f.Res != Res {
		t.Fatalf("file grid %v/%d, want %v/%d (regenerate with -update)", f.Size, f.Res, Size, Res)
	}
	if f.Heights != encodeHeights(Generate(vecSeed).Encode()) {
		t.Fatal("heights drifted from Generate (regenerate with -update)")
	}
	pts := vecPoints()
	if len(f.Points) != len(pts) {
		t.Fatalf("file has %d points, want %d", len(f.Points), len(pts))
	}
	m := decodeHeights(t, f.Heights)
	for i, p := range f.Points {
		if p[0] != pts[i][0] || p[1] != pts[i][1] {
			t.Fatalf("point %d is %v, want %v (regenerate with -update)", i, p[:2], pts[i])
		}
		if h := m.Height(p[0], p[1]); h != p[2] {
			t.Fatalf("point %v: Height %v, file %v", p[:2], h, p[2])
		}
	}
}
