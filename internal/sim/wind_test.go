package sim

import (
	"math"
	"testing"

	"playground/internal/geom"
	"playground/internal/terrain"
)

func TestWindAt(t *testing.T) {
	base := geom.V(6, 0, -4)
	if WindAt(base, 0, 1234) != base {
		t.Fatal("no gust: constant")
	}
	w := WindAt(base, 2, 0)
	along := 2 * 0.4 * math.Sin(1.3)
	cross := 0.5 * 2 * math.Sin(0.7)
	d := base.Norm()
	want := base.Add(d.Scale(along)).Add(geom.V(-d.Z, 0, d.X).Scale(cross))
	if w.Sub(want).Len() > 1e-12 {
		t.Fatalf("tick 0: %v want %v", w, want)
	}
	if WindAt(geom.Vec3{}, 5, 99) != (geom.Vec3{}) {
		t.Fatal("gust without a base wind has no direction: zero")
	}
}

func TestWorldWindDrifts(t *testing.T) {
	calm := NewWorld(Config{Seed: 1, Terrain: terrain.Generate(1)})
	windy := NewWorld(Config{Seed: 1, Terrain: terrain.Generate(1), Wind: geom.V(10, 0, 0), Gust: 0})
	for _, w := range []*World{calm, windy} {
		w.AddPlane(1, TeamNATO, F16)
		for range 60 {
			w.Step(nil)
		}
	}
	a, _ := calm.Plane(1)
	b, _ := windy.Plane(1)
	if dx := b.Pos.X - a.Pos.X; math.Abs(dx-10) > 1e-6 {
		t.Fatalf("1 s of 10 m/s wind: dx %v", dx)
	}
}
