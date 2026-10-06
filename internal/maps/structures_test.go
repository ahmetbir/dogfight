package maps

import "testing"

func TestStructuresLayout(t *testing.T) {
	for _, k := range []Kind{Ada, Sehir, Col, Dag} {
		structuresOn(t, Build(k, 2))
	}
}

func structuresOn(t *testing.T, m *Map) {
	t.Helper()
	if len(m.Structures) != 12 {
		t.Fatalf("%d structures", len(m.Structures))
	}
	total := map[int]float64{}
	for i, s := range m.Structures {
		b := m.Bases[s.Side]
		if s.Side != i/6 || s.Index != i%6 || s.Box.Min.Y != b.Center.Y {
			t.Fatalf("struct %d: %+v", i, s)
		}
		for _, c := range [][2]float64{{s.Box.Min.X, s.Box.Min.Z}, {s.Box.Max.X, s.Box.Max.Z}} {
			if !b.Bounds.Contains(c[0], c[1]) || m.Terrain.Height(c[0], c[1]) != b.Center.Y {
				t.Fatalf("struct %d corner %v off the flat base", i, c)
			}
		}
		total[s.Side] += s.MaxHP
	}
	if total[0] != 1950 || total[1] != 1950 {
		t.Fatalf("hp totals %v", total)
	}
	for _, side := range []int{0, 6} {
		h0, h5, aa := m.Structures[side], m.Structures[side+1], m.Structures[side+5]
		if h0.Kind != StructHangar || h0.Hangar != 0 || h5.Hangar != 5 || aa.Kind != StructAA || aa.Hangar != -1 {
			t.Fatalf("kinds: %+v %+v %+v", h0, h5, aa)
		}
		sp := m.Bases[h0.Side].Hangars[0].Spawn
		if sp.X < h0.Box.Min.X || sp.X > h0.Box.Max.X || sp.Z < h0.Box.Min.Z || sp.Z > h0.Box.Max.Z {
			t.Fatal("hangar target must cover hangar 0")
		}
	}
}
