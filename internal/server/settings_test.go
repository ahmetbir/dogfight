package server

import (
	"testing"
	"time"

	"playground/internal/maps"
	"playground/internal/mode"
	"playground/internal/protocol"
	"playground/internal/sim"
	"playground/internal/weather"
)

func TestSettingsDefaultsAndParsing(t *testing.T) {
	now := time.Unix(100, 0)
	s, ok := settings(protocol.ClientMsg{T: "create", Mode: "base", Size: 3, Diff: "hard"}, now)
	if !ok || s.Mode != mode.Base || s.Map != maps.Ada || s.Weather != weather.Clear || s.Start != sim.StartAir || !s.Listed || s.Seed != now.UnixNano() {
		t.Fatalf("defaults: %+v %v", s, ok)
	}
	s, ok = settings(protocol.ClientMsg{T: "create", Mode: "ffa", Size: 6, Diff: "easy", Seed: 7, Map: "dag", Wx: "gece", Start: "pist", Vis: "ozel"}, now)
	if !ok || s.Map != maps.Dag || s.Weather != weather.Night || s.Start != sim.StartRunway || s.Listed || s.Seed != 7 {
		t.Fatalf("explicit: %+v %v", s, ok)
	}
	for _, bad := range []protocol.ClientMsg{
		{T: "create", Mode: "team", Diff: "normal", Map: "mars"},
		{T: "create", Mode: "team", Diff: "normal", Wx: "kar"},
		{T: "create", Mode: "team", Diff: "normal", Start: "tepe"},
		{T: "create", Mode: "team", Diff: "normal", Vis: "gizli"},
		{T: "create", Mode: "tdm", Diff: "normal"},
	} {
		if _, ok := settings(bad, now); ok {
			t.Fatalf("accepted %+v", bad)
		}
	}
}
