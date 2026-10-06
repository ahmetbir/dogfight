package game

import (
	"testing"

	"playground/internal/bot"
	"playground/internal/mode"
	"playground/internal/weather"
)

func TestWeatherDrivesWorldConfig(t *testing.T) {
	g := New(Settings{Mode: mode.FFA, Size: 2, Difficulty: bot.Easy, Seed: 9, Weather: weather.Storm})
	c := g.worldConfig()
	if c.LockRangeMul != 0.7 || c.Gust != 6 || c.Wind != weather.Wind(weather.Storm, 9) || c.Wind.Len() == 0 {
		t.Fatalf("storm config %+v", c)
	}
	if c = New(Settings{Mode: mode.FFA, Size: 2, Difficulty: bot.Easy, Seed: 9, Weather: weather.Fog}).worldConfig(); c.LockRangeMul != 0.6 || c.Wind.Len() != 0 {
		t.Fatalf("fog config %+v", c)
	}
	// Zero → default; out of range panics (TestValidKindsDefaultsZeroAndRejectsUnknown).
	if g := New(Settings{Mode: mode.FFA, Size: 2, Difficulty: bot.Easy, Seed: 9}); g.Settings().Weather != weather.Clear || g.worldConfig().LockRangeMul != 1 {
		t.Fatalf("zero kind: %v", g.Settings().Weather)
	}
}
