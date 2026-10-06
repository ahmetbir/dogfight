package terrain

import (
	"slices"
	"testing"
)

func TestDeterministic(t *testing.T) {
	a, b := Generate(42), Generate(42)
	if a.Height(123, -456) != b.Height(123, -456) {
		t.Fatal("same seed must give same terrain")
	}
	if Generate(43).Height(123, -456) == a.Height(123, -456) {
		t.Fatal("different seeds should differ")
	}
}

func TestIslandShape(t *testing.T) {
	m := Generate(7)
	if m.MaxHeight() < 500 || m.MaxHeight() > 1400 {
		t.Fatalf("max height %v, want 500..1400", m.MaxHeight())
	}
	if h := m.Height(4900, 4900); h >= 0 {
		t.Fatalf("map corner should be sea, got %v", h)
	}
	if m.Height(9000, 0) != -200 {
		t.Fatal("outside grid must be -200")
	}
	if m.Ground(4900, 4900) != WaterLevel {
		t.Fatal("ground over sea = water level")
	}
}

func TestEncodeRoundTrip(t *testing.T) {
	m := Generate(3)
	d, err := Decode(m.Encode())
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range [][2]float64{{0, 0}, {1234.5, -2222}, {-3999, 3999}} {
		if m.Height(p[0], p[1]) != d.Height(p[0], p[1]) {
			t.Fatalf("height mismatch at %v", p)
		}
	}
	if _, err := Decode(make([]uint16, 5)); err == nil {
		t.Fatal("want error for wrong length")
	}
}

func TestFromRawMatchesGenerate(t *testing.T) {
	a, b := Generate(9), FromRaw(IslandRaw(9))
	if !slices.Equal(a.Encode(), b.Encode()) {
		t.Fatal("FromRaw(IslandRaw) must equal Generate")
	}
	if NodeCoord(0) != -Size/2 || NodeCoord(Res-1) != Size/2 || Cell != 78.125 {
		t.Fatalf("grid: %v %v %v", NodeCoord(0), NodeCoord(Res-1), Cell)
	}
}

func TestFromRawPanicsOnBadLength(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("want panic")
		}
	}()
	FromRaw(make([]float64, 3))
}
