package game

import (
	"slices"
	"testing"

	"playground/internal/bot"
	"playground/internal/mode"
	"playground/internal/sim"
)

func TestSkinsSharedSetAndIconicOnlyWhereTheyBelong(t *testing.T) {
	shared := []string{StandardSkin, "airsup", "desert", "winter", "naval", "splinter", "night"}
	for _, k := range sim.Kinds() {
		got := Skins(k)
		if got[0] != StandardSkin || !slices.Equal(got[:len(shared)], shared) {
			t.Fatalf("%v skins %v: want the shared set first", k, got)
		}
	}
	if s := Skins(sim.Su27); !slices.Contains(s, "flanker") || slices.Contains(s, "blackband") {
		t.Fatalf("su27 %v", s)
	}
	if s := Skins(sim.F14); !slices.Contains(s, "blackband") || slices.Contains(s, "flanker") {
		t.Fatalf("f14 %v", s)
	}
	if s := Skins(sim.F16); len(s) != len(shared) {
		t.Fatalf("f16 %v: no iconic scheme", s)
	}
}

func TestSkinForFallsBackToStandard(t *testing.T) {
	cases := []struct {
		kind sim.Kind
		in   string
		want string
	}{
		{sim.F16, "desert", "desert"},
		{sim.F16, "", StandardSkin},
		{sim.F16, "Desert", StandardSkin},
		{sim.F16, "chrome", StandardSkin},
		{sim.F16, "flanker", StandardSkin}, // a Flanker's paint on an F-16
		{sim.Su30, "flanker", "flanker"},
		{sim.F4, "blackband", "blackband"},
		{sim.MiG29, "blackband", StandardSkin},
	}
	for _, c := range cases {
		if got := SkinFor(c.kind, c.in); got != c.want {
			t.Errorf("SkinFor(%v, %q) = %q, want %q", c.kind, c.in, got, c.want)
		}
	}
}

func TestSetSkinValidatesAndBumpsTheRosterOnlyOnChange(t *testing.T) {
	g := New(Settings{Mode: mode.FFA, Size: 4, Difficulty: bot.Easy, Seed: 1})
	id, err := g.AddHuman("a")
	if err != nil {
		t.Fatal(err)
	}
	skin := func() string {
		for _, p := range g.Players() {
			if p.ID == id {
				return p.Skin
			}
		}
		t.Fatal("no player")
		return ""
	}
	if skin() != StandardSkin {
		t.Fatalf("a new human wears %q", skin())
	}
	v := g.RosterVersion()
	g.SetSkin(id, "winter")
	if skin() != "winter" || g.RosterVersion() == v {
		t.Fatalf("skin %q, roster %d -> %d", skin(), v, g.RosterVersion())
	}
	v = g.RosterVersion()
	g.SetSkin(id, "winter")
	if g.RosterVersion() != v {
		t.Fatal("the same skin again bumped the roster")
	}
	g.SetSkin(id, "<script>")
	if skin() != StandardSkin {
		t.Fatalf("unknown id kept as %q", skin())
	}
	g.SetSkin(999, "night") // no such player: nothing happens
}

func TestBotsWearASeededValidSkinPerSeat(t *testing.T) {
	skins := func(seed int64) map[sim.ID]string {
		g := New(Settings{Mode: mode.FFA, Size: 12, Difficulty: bot.Easy, Seed: seed})
		out := map[sim.ID]string{}
		for _, p := range g.Players() {
			if !p.Bot {
				continue
			}
			if SkinFor(p.Kind, p.Skin) != p.Skin {
				t.Fatalf("bot %d (%v) wears %q, not one of its kind's", p.ID, p.Kind, p.Skin)
			}
			out[p.ID] = p.Skin
		}
		return out
	}
	a, b := skins(7), skins(7)
	if len(a) != 12 {
		t.Fatalf("%d bots", len(a))
	}
	distinct := map[string]bool{}
	for id, s := range a {
		if b[id] != s {
			t.Fatalf("seed 7 bot %d: %q then %q", id, s, b[id])
		}
		distinct[s] = true
	}
	if len(distinct) < 3 {
		t.Fatalf("12 bots wear only %v", distinct)
	}
	c := skins(8)
	same := 0
	for id, s := range a {
		if c[id] == s {
			same++
		}
	}
	if same == len(a) {
		t.Fatal("another seed paints every bot the same")
	}
}
