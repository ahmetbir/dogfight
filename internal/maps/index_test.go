package maps

import (
	"math"
	"testing"

	"playground/internal/geom"
)

func TestSweepHitsGrownBox(t *testing.T) {
	ix := NewIndex([]Box{{Min: geom.V(100, 0, -10), Max: geom.V(120, 50, 10)}})
	tt, i, ok := ix.Sweep(geom.V(0, 20, 0), geom.V(200, 20, 0), 5)
	if !ok || i != 0 || math.Abs(tt-0.475) > 1e-9 { // enters x = 95
		t.Fatalf("t=%v i=%d ok=%v", tt, i, ok)
	}
	if _, _, ok := ix.Sweep(geom.V(0, 20, 30), geom.V(200, 20, 30), 5); ok {
		t.Fatal("passes 20 m abeam, must miss")
	}
	if _, _, ok := ix.Sweep(geom.V(0, 60, 0), geom.V(200, 60, 0), 5); ok {
		t.Fatal("passes 5+ m above the roof, must miss")
	}
	if tt, _, ok := ix.Sweep(geom.V(110, 20, 0), geom.V(110, 20, 0), 0); !ok || tt != 0 {
		t.Fatal("a point inside is a hit at t=0")
	}
}

func TestSweepNearestOfTwo(t *testing.T) {
	ix := NewIndex([]Box{{Min: geom.V(300, 0, -5), Max: geom.V(310, 9, 5)}, {Min: geom.V(150, 0, -5), Max: geom.V(160, 9, 5)}})
	if _, i, ok := ix.Sweep(geom.V(0, 4, 0), geom.V(400, 4, 0), 0); !ok || i != 1 {
		t.Fatalf("want nearest box 1, got %d", i)
	}
}

func TestCityBuildings(t *testing.T) {
	m := Build(Sehir, 4)
	if n := len(m.Buildings); n < 300 || n > MaxBuildings {
		t.Fatalf("buildings %d", n)
	}
	for _, b := range m.Buildings {
		c := b.Min.Add(b.Max).Scale(0.5)
		if c.X < -1500 || c.X > 1500 || c.Z < -1500 || c.Z > 2200 || b.Max.Y-b.Min.Y < 12 {
			t.Fatalf("building outside the city or too low: %+v", b)
		}
	}
	if len(Build(Ada, 4).Buildings) != 0 {
		t.Fatal("only the city has buildings")
	}
}

func TestHangarsAreOpenAndSolid(t *testing.T) {
	m := Build(Ada, 1)
	for _, b := range m.Bases {
		for _, h := range b.Hangars {
			p := h.Spawn.Add(geom.V(0, 2.5, 0))
			out := p.Add(b.Inner.Scale(-60)) // through the door toward the runway
			if _, _, hit := m.Solids.Sweep(p, out, 5); hit {
				t.Fatalf("taxiing out of the hangar at %v hits a wall", p)
			}
			back := p.Add(b.Inner.Scale(40))
			if _, _, hit := m.Solids.Sweep(p, back, 5); !hit {
				t.Fatal("the back wall must be solid")
			}
		}
	}
}
