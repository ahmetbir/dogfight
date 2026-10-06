package game

import (
	"testing"

	"playground/internal/maps"
	"playground/internal/sim"
	"playground/internal/weather"
)

func TestValidKindsDefaultsZeroAndRejectsUnknown(t *testing.T) {
	if m, w, st := validKinds(Settings{}); m != maps.Ada || w != weather.Clear || st != sim.StartAir {
		t.Fatalf("zero settings: %v %v %v", m, w, st)
	}
	for _, s := range []Settings{{Map: maps.Kind(99)}, {Weather: weather.Kind(99)}, {Start: sim.StartMode(9)}} {
		func() {
			defer func() {
				if recover() == nil {
					t.Fatalf("accepted %+v", s)
				}
			}()
			validKinds(s)
		}()
	}
}
