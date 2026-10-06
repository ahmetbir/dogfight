package maps

import (
	"math"
	"reflect"
	"testing"

	"playground/internal/terrain"
)

var kinds = []Kind{Ada, Sehir, Col, Dag}

func TestParseKind(t *testing.T) {
	for _, k := range kinds {
		if got, ok := ParseKind(k.String()); !ok || got != k {
			t.Fatalf("round trip %v", k)
		}
	}
	if _, ok := ParseKind("mars"); ok {
		t.Fatal("unknown kind accepted")
	}
}

func TestBuildDeterministic(t *testing.T) {
	for _, k := range kinds {
		a, b := Build(k, 3), Build(k, 3)
		if !reflect.DeepEqual(a.Bases, b.Bases) || !reflect.DeepEqual(a.Terrain.Encode(), b.Terrain.Encode()) ||
			!reflect.DeepEqual(a.Buildings, b.Buildings) || !reflect.DeepEqual(a.Solids.Boxes(), b.Solids.Boxes()) {
			t.Fatalf("%v: same seed, different map", k)
		}
	}
}

func TestBasesFlatPavedAndInBounds(t *testing.T) {
	for _, k := range kinds {
		for seed := int64(1); seed <= 5; seed++ {
			m := Build(k, seed)
			for side, b := range m.Bases {
				checkBase(t, m, side, b)
				checkGlidePath(t, m, b)
			}
			if m.BaseAt(0, 0) != -1 {
				t.Fatal("map center is no base")
			}
		}
	}
}

func checkBase(t *testing.T, m *Map, side int, b Base) {
	t.Helper()
	k := m.Kind
	if b.Side != side || b.Center.Y < 8 || b.Center.Y > 350 {
		t.Fatalf("%v/%d base %d: %+v", k, m.Seed, side, b.Center)
	}
	for _, u := range []float64{-1000, -900, -450, 0, 450, 900, 1000} {
		for _, v := range []float64{-80, -22, 0, 22, 120, 170, 225, 330, 360} {
			p := b.World(u, v)
			if h := m.Terrain.Height(p.X, p.Z); h != b.Center.Y {
				t.Fatalf("%v/%d base %d (%v,%v): height %v != elev %v", k, m.Seed, side, u, v, h, b.Center.Y)
			}
			if math.Abs(p.X) > 4000 || math.Abs(p.Z) > 4000 {
				t.Fatalf("%v/%d base %d leaves the play area at (%v,%v)", k, m.Seed, side, u, v)
			}
		}
	}
	at := func(u, v float64) Surface { p := b.World(u, v); return m.SurfaceAt(p.X, p.Z) }
	cases := []struct {
		u, v float64
		want Surface
	}{{0, 0, SurfRunway}, {890, 20, SurfRunway}, {0, 120, SurfTaxi}, {-700, 60, SurfTaxi}, {700, 60, SurfTaxi},
		{0, 170, SurfTaxi}, {-250, 225, SurfTaxi}, {0, 60, SurfNone}, {0, 300, SurfNone}, {950, 0, SurfNone}}
	for _, c := range cases {
		if got := at(c.u, c.v); got != c.want {
			t.Fatalf("%v/%d base %d surface at (%v,%v) = %v, want %v", k, m.Seed, side, c.u, c.v, got, c.want)
		}
	}
	if p := b.World(0, 300); m.BaseAt(p.X, p.Z) != side {
		t.Fatalf("BaseAt inside base %d", side)
	}
	if len(b.Hangars) != HangarCount {
		t.Fatalf("hangars %d", len(b.Hangars))
	}
}

// checkGlidePath asserts the 2.9° approach (0.05 slope from the threshold at
// u = -850 back to the approach point 2.5 km out) clears the terrain across
// a 300 m wide corridor. Samples whose bilinear nodes all lie in the capped
// corridor (u <= -1240) keep the cap margin, or the height of the glide over
// the runway elevation at the nearest node where that is smaller (the cap
// never cuts below elev).
func checkGlidePath(t *testing.T, m *Map, b Base) {
	t.Helper()
	for u := -3320.0; u <= -850; u += 10 {
		glide := b.Center.Y + 0.05*(-850-u)
		need := 0.0
		if u <= -1240 {
			need = min(37, glideSlope*(-850-(u+terrain.Cell)))
		}
		for v := -150.0; v <= 150; v += 25 {
			p := b.World(u, v)
			if h := m.Terrain.Height(p.X, p.Z); glide-h < need {
				t.Fatalf("%v/%d base %d: terrain %v at (%v,%v) leaves %v m under the glide path, want >= %v",
					m.Kind, m.Seed, b.Side, h, u, v, glide-h, need)
			}
		}
	}
}

func TestWaypointsArePaved(t *testing.T) {
	m := Build(Sehir, 2)
	for _, b := range m.Bases {
		for i := range b.Hangars {
			for _, p := range b.Waypoints(i) {
				if m.SurfaceAt(p.X, p.Z) == SurfNone {
					t.Fatalf("waypoint %v of hangar %d is off the pavement", p, i)
				}
			}
		}
		if lp, h := b.Lineup(); m.SurfaceAt(lp.X, lp.Z) != SurfRunway || h != HeadingOf(b.Axis) {
			t.Fatal("lineup must be on the runway along the axis")
		}
	}
}

// TestApproachCapKeepsRunwayElevation checks every corridor node against the
// pre-cap grid: the cap may lower terrain toward the glide path but never
// below min(raw, elev) (no trench or pond), and never leaves it above
// max(cap, elev).
func TestApproachCapKeepsRunwayElevation(t *testing.T) {
	const q = 0.05 + 1e-9 // half the 0.1 m quantization step
	for _, k := range kinds {
		for seed := int64(1); seed <= 5; seed++ {
			m := Build(k, seed)
			raw := rawFor(k, seed)
			for _, b := range m.Bases {
				flatten(raw, b)
			}
			for _, b := range m.Bases {
				nodes := 0
				for zi := range terrain.Res {
					for xi := range terrain.Res {
						x, z := terrain.NodeCoord(xi), terrain.NodeCoord(zi)
						u, v := b.local(x, z)
						if !inApproach(u, v) {
							continue
						}
						nodes++
						h, r := m.Terrain.Height(x, z), raw[zi*terrain.Res+xi]
						if lo := min(r, b.Center.Y); h < lo-q {
							t.Fatalf("%v/%d base %d node (%v,%v): %v below min(raw %v, elev %v)", k, seed, b.Side, u, v, h, r, b.Center.Y)
						}
						if hi := max(glideCap(b, u), b.Center.Y); h > hi+q {
							t.Fatalf("%v/%d base %d node (%v,%v): %v above max(cap, elev) %v", k, seed, b.Side, u, v, h, hi)
						}
					}
				}
				if nodes < 100 {
					t.Fatalf("%v/%d base %d: corridor has only %d nodes", k, seed, b.Side, nodes)
				}
			}
		}
	}
}
