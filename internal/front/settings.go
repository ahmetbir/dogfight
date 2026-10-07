package front

import (
	"time"

	"playground/internal/bot"
	"playground/internal/game"
	"playground/internal/maps"
	"playground/internal/mode"
	"playground/internal/protocol"
	"playground/internal/sim"
	"playground/internal/weather"
)

// quickSettings is the room quick play makes when none is free (spec §9.2).
func quickSettings(now time.Time) game.Settings {
	return game.Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Normal, Seed: now.UnixNano(),
		Map: maps.Ada, Weather: weather.Clear, Start: sim.StartAir, Listed: true}
}

// settings builds room settings from a create message; missing optional
// fields take the spec §8 defaults (ada, acik, hava, acik). Unknown values
// of any field are refused. A created room opens in the pre-match lobby.
func settings(m protocol.ClientMsg, now time.Time) (game.Settings, bool) {
	k, ok1 := mode.ParseKind(m.Mode)
	d, ok2 := bot.ParseDifficulty(m.Diff)
	mk, ok3 := orDefault(m.Map, "ada", maps.ParseKind)
	wk, ok4 := orDefault(m.Wx, "acik", weather.ParseKind)
	start, ok5 := orDefault(m.Start, "hava", parseStart)
	listed, ok6 := orDefault(m.Vis, "acik", parseVis)
	seed := m.Seed
	if seed == 0 {
		seed = now.UnixNano()
	}
	return game.Settings{Mode: k, Size: m.Size, Difficulty: d, Seed: seed, Map: mk, Weather: wk, Start: start, Listed: listed, Lobby: true},
		ok1 && ok2 && ok3 && ok4 && ok5 && ok6
}

func orDefault[T any](s, def string, parse func(string) (T, bool)) (T, bool) {
	if s == "" {
		s = def
	}
	return parse(s)
}

func parseStart(s string) (sim.StartMode, bool) {
	switch s {
	case "pist":
		return sim.StartRunway, true
	case "hava":
		return sim.StartAir, true
	}
	return 0, false
}

func parseVis(s string) (bool, bool) { return s == "acik", s == "acik" || s == "ozel" }
