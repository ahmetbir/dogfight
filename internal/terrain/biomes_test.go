package terrain

import (
	"math"
	"testing"
)

// at samples a raw grid at the node nearest (x, z).
func at(raw []float64, x, z float64) float64 {
	xi := int(math.Round((x + Size/2) / Cell))
	zi := int(math.Round((z + Size/2) / Cell))
	return raw[zi*Res+xi]
}

func TestCityShape(t *testing.T) {
	r := CityRaw(5)
	for _, p := range [][2]float64{{0, 0}, {1000, 1500}, {-1200, -1000}} {
		if h := at(r, p[0], p[1]); h < 5 || h > 40 {
			t.Fatalf("city plain at %v: %v", p, h)
		}
	}
	if h := at(r, 0, 4500); h >= 0 {
		t.Fatalf("south coast must be sea: %v", h)
	}
	hi := 0.0
	for x := -4000.0; x <= 4000; x += 200 {
		hi = math.Max(hi, at(r, x, -4200))
	}
	if hi < 120 {
		t.Fatalf("northern hills too low: %v", hi)
	}
}

func TestDesertShape(t *testing.T) {
	r := DesertRaw(5)
	below, hi := 0, 0.0
	for _, h := range r {
		if h < 0 {
			below++
		}
		hi = math.Max(hi, h)
	}
	if below == 0 || below > 40 {
		t.Fatalf("oasis nodes below sea level: %d", below)
	}
	if hi < 120 {
		t.Fatalf("no mesas: max %v", hi)
	}
}

func TestMountainShape(t *testing.T) {
	r := MountainRaw(5)
	hi := 0.0
	for _, h := range r {
		hi = math.Max(hi, h)
	}
	if hi < 1200 || hi > 2900 {
		t.Fatalf("peak %v", hi)
	}
	for z := -3000.0; z <= 3000; z += 500 {
		if h := at(r, -2600, z); h > 350 {
			t.Fatalf("west valley at z=%v is %v", z, h)
		}
	}
}

func TestBiomesDeterministic(t *testing.T) {
	for _, f := range []func(int64) []float64{CityRaw, DesertRaw, MountainRaw} {
		a, b := f(3), f(3)
		for i := range a {
			if a[i] != b[i] {
				t.Fatal("same seed must give the same grid")
			}
		}
	}
}
