package sim

import (
	"encoding/json"
	"os"
	"testing"
)

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
	names := map[string]bool{}
	for _, k := range Kinds() {
		s := SpecOf(k)
		ok := s.Team != TeamNone && !names[s.Name] && s.MaxHP >= 50 && s.MaxHP <= 200 && s.Accel > 0 &&
			s.RollRate > 0 && s.PitchRate > 0 && s.YawRate > 0 && s.Missiles >= 2 && s.Flares > 0 &&
			s.LockRange >= 800 && s.LockRange <= 1200 && s.RotateSpeed > 50 && s.RotateSpeed < s.CornerSpeed && s.ExtraBombs >= 0
		if !ok {
			t.Fatalf("implausible spec %+v", s)
		}
		names[s.Name] = true
	}
	if _, ok := ParseKind("zeppelin"); ok || Kind(0).String() != "unknown" || Kind(len(Kinds())+1).String() != "unknown" {
		t.Fatal("unknown kinds must not parse")
	}
}

// The models carry one msl_i node per missile of the sim load: the counts in
// tools/blender/contract.json (build.py and the client test read it) are
// sim.Spec.Missiles, and it lists exactly the sim's kinds.
func TestContractMissilesAreTheSimLoad(t *testing.T) {
	raw, err := os.ReadFile("../../tools/blender/contract.json")
	if err != nil {
		t.Fatal(err)
	}
	var c struct {
		Kinds map[string]struct{ Missiles int }
	}
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	if len(c.Kinds) != len(Kinds()) {
		t.Fatalf("contract.json has %d kinds, the sim %d", len(c.Kinds), len(Kinds()))
	}
	for _, k := range Kinds() {
		m, ok := c.Kinds[k.String()]
		if !ok || m.Missiles != SpecOf(k).Missiles {
			t.Errorf("%v: contract.json %d missiles (listed %v), Spec %d", k, m.Missiles, ok, SpecOf(k).Missiles)
		}
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
