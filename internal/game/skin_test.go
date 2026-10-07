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

// A team switch changes the kind: the roster's paint is the new jet's (its
// own paint, standard if never set), never the old jet's scheme.
func TestTeamSwitchKeepsTheSkinValidForTheNewJet(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 1})
	a, _ := g.AddHuman("a") // NATO
	if err := g.ChooseTeam(a, sim.TeamSoviet); err != nil {
		t.Fatal(err)
	}
	if err := g.Pick(a, sim.Su27); err != nil {
		t.Fatal(err)
	}
	g.SetSkin(a, "flanker")
	if p := player(t, g, a); p.Kind != sim.Su27 || p.Skin != "flanker" {
		t.Fatalf("su27: %+v", p)
	}
	g.switchAt = map[sim.ID]int{} // no cooldown for the test
	if err := g.ChooseTeam(a, sim.TeamNATO); err != nil {
		t.Fatal(err)
	}
	p := player(t, g, a)
	if p.Team != sim.TeamNATO || SkinFor(p.Kind, p.Skin) != p.Skin || p.Skin != StandardSkin {
		t.Fatalf("after the switch: kind %v skin %q fly %q", p.Kind, p.Skin, p.FlySkin)
	}
}

// A pick for the next spawn paints the next jet; the jet in the air keeps
// its own paint (FlySkin) until the new one spawns.
func TestNextJetPaintLeavesTheFlyingJetAlone(t *testing.T) {
	g := New(Settings{Mode: mode.FFA, Size: 4, Difficulty: bot.Easy, Seed: 1})
	a, _ := g.AddHuman("a")
	pick := func(k sim.Kind, skin string) Player {
		if err := g.Pick(a, k); err != nil {
			t.Fatal(err)
		}
		g.SetSkin(a, skin)
		return player(t, g, a)
	}
	pick(sim.F14, "blackband")  // spawns
	pick(sim.F4, "night")       // in spawn protection: reseated in an F-4 at once (once per life)
	p := pick(sim.F14, "naval") // the F-4 flies on; the F-14 waits for the next spawn
	if pl, _ := g.world.Plane(a); pl.Kind != sim.F4 {
		t.Fatalf("flying %v", pl.Kind)
	}
	if p.Kind != sim.F14 || p.Skin != "naval" || p.FlySkin != "night" {
		t.Fatalf("next f14 naval, flying f4 night: %+v", p)
	}
	g.SetSkin(a, "winter") // repaint the next jet again: the F-4 still wears night
	if p := player(t, g, a); p.Skin != "winter" || p.FlySkin != "night" {
		t.Fatalf("%+v", p)
	}
	p = pick(sim.F4, "night") // back to the jet in the air
	if p.Skin != "night" || p.FlySkin != "" {
		t.Fatalf("same kind again: %+v", p)
	}
}
