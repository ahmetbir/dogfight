package sim

import "testing"

func TestSpecTable(t *testing.T) {
	for _, k := range Kinds() {
		s := SpecOf(k)
		if s.Kind != k || s.MaxSpeedAB <= s.MaxSpeed || s.CornerSpeed <= StallSpeed {
			t.Fatalf("bad spec %+v", s)
		}
		if got, ok := ParseKind(k.String()); !ok || got != k {
			t.Fatalf("ParseKind(%q) = %v,%v", k.String(), got, ok)
		}
	}
	if SpecOf(F16).Team != TeamNATO || SpecOf(Su27).Team != TeamSoviet {
		t.Fatal("teams wrong")
	}
}

func TestInputClamp(t *testing.T) {
	in := Input{Pitch: 5, Roll: -9, Yaw: 0.5, Throttle: 2}.Clamp()
	if in.Pitch != 1 || in.Roll != -1 || in.Yaw != 0.5 || in.Throttle != 1 {
		t.Fatalf("Clamp = %+v", in)
	}
}

func TestRNGDeterministic(t *testing.T) {
	a, b := NewRNG(9), NewRNG(9)
	for range 100 {
		if a.Float64() != b.Float64() {
			t.Fatal("rng not deterministic")
		}
	}
}
