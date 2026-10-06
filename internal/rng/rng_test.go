package rng

import "testing"

func TestMixAndStream(t *testing.T) {
	if Mix(5, 0) != Mix(5, 0) || Mix(5, 0) == Mix(5, 1) || Mix(5, 0) == Mix(6, 0) {
		t.Fatal("Mix must be a pure function of (seed, i)")
	}
	a, b := New(9, 1), New(9, 1)
	for range 100 {
		x := a.Float()
		if x != b.Float() || x < 0 || x >= 1 {
			t.Fatal("streams must agree and stay in [0,1)")
		}
	}
	if New(9, 1).Float() == New(9, 2).Float() {
		t.Fatal("salt must change the stream")
	}
}
