package protocol

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ahmetbir/roomkit/netproto"
	"playground/internal/bot"
	"playground/internal/game"
	"playground/internal/maps"
	"playground/internal/mode"
	"playground/internal/sim"
	"playground/internal/terrain"
	"playground/internal/weather"
)

func TestDecodeInputClamps(t *testing.T) {
	m, err := DecodeClient([]byte(`{"t":"in","seq":7,"p":3,"r":-2,"y":0.5,"th":1.5,"ab":true,"f":true}`))
	if err != nil {
		t.Fatal(err)
	}
	if m.Seq != 7 {
		t.Fatalf("seq=%d", m.Seq)
	}
	in := m.Input()
	want := sim.Input{Pitch: 1, Roll: -1, Yaw: 0.5, Throttle: 1, AB: true, Fire: true}
	if in != want {
		t.Fatalf("got %+v want %+v", in, want)
	}
}

func TestDecodeRejects(t *testing.T) {
	for name, b := range map[string]string{
		"unknown type": `{"t":"nope"}`,
		"no type":      `{"seq":1}`,
		"too big":      `{"t":"hello","name":"` + strings.Repeat("a", 2048) + `"}`,
		"not json":     `{"t":"in"`,
		"wrong type":   `{"t":"in","p":"x"}`,
		"huge number":  `{"t":"in","p":1e999}`,
	} {
		if _, err := DecodeClient([]byte(b)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func newGame() *game.Game {
	return game.New(game.Settings{Mode: mode.Team, Size: 4, Difficulty: bot.Normal, Seed: 42})
}

func TestSnapUnder3KB(t *testing.T) {
	g := newGame()
	var evs []EventJSON
	for range 600 {
		evs = NewEvents(g.Step(nil), g.Tick())
	}
	s := g.Snapshot()
	if len(s.Planes) != 8 {
		t.Fatalf("planes=%d", len(s.Planes))
	}
	b, err := json.Marshal(NewSnap(s, evs, g.Tick()))
	if err != nil {
		t.Fatal(err)
	}
	if len(b) >= 3*1024 {
		t.Fatalf("snap is %d bytes: %s", len(b), b)
	}
	t.Logf("snap: %d bytes, %d events", len(b), len(evs))
	var back Snap
	if err := json.Unmarshal(b, &back); err != nil || back.T != "snap" || back.Tick != g.Tick() {
		t.Fatalf("roundtrip: %v %+v", err, back.T)
	}
}

func TestWelcomeTerrainRoundTrip(t *testing.T) {
	g := newGame()
	b, err := json.Marshal(NewWelcome(3, "ABCD", g, NewStatic(g)))
	if err != nil {
		t.Fatal(err)
	}
	var w struct {
		Welcome
		Terrain TerrainInfo `json:"terrain"`
	}
	if err := json.Unmarshal(b, &w); err != nil {
		t.Fatal(err)
	}
	if w.T != "welcome" || w.Mode != "team" || w.Terrain.Seed != "42" || len(w.Aircraft) != len(sim.Kinds()) || len(w.Terrain.Spots) != 8 {
		t.Fatalf("welcome: %+v", w.Aircraft)
	}
	raw, err := base64.StdEncoding.DecodeString(w.Terrain.Heights)
	if err != nil {
		t.Fatal(err)
	}
	q := make([]uint16, len(raw)/2)
	for i := range q {
		q[i] = binary.LittleEndian.Uint16(raw[2*i:])
	}
	m, err := terrain.Decode(q)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range [][2]float64{{0, 0}, {1234.5, -987.25}, {-3000, 2500}} {
		if got, want := m.Height(p[0], p[1]), g.Terrain().Height(p[0], p[1]); got != want {
			t.Fatalf("height at %v: %v != %v", p, got, want)
		}
	}
}

func TestEventStrings(t *testing.T) {
	evs := NewEvents([]sim.Event{
		{Kind: sim.EvKill, Plane: 2, Other: 1, Weapon: sim.WRam},
		{Kind: sim.EvPickup, Plane: 1, Item: sim.PUTurbo, Value: 3},
		{Kind: sim.EvLock, Plane: 1, Other: 2},
	}, 99)
	if evs[0].K != "kill" || evs[0].W != "ram" || evs[0].Tick != 99 || evs[0].Pos == nil {
		t.Fatalf("kill: %+v", evs[0])
	}
	if evs[1].K != "pickup" || evs[1].Item != "turbo" {
		t.Fatalf("pickup: %+v", evs[1])
	}
	if evs[2].K != "lock" || evs[2].Pos != nil || evs[2].B != 2 {
		t.Fatalf("lock: %+v", evs[2])
	}
}

func TestLaunchEventCarriesOwner(t *testing.T) {
	evs := NewEvents([]sim.Event{{Kind: sim.EvMissileLaunch, Plane: 1<<24 + 1, Other: 5, By: 3}}, 10)
	b, err := json.Marshal(evs[0])
	if err != nil || !strings.Contains(string(b), `"o":3`) {
		t.Fatalf("%s %v", b, err)
	}
}

func TestWelcomeMapInfo(t *testing.T) {
	g := game.New(game.Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Normal, Seed: 2, Map: maps.Sehir})
	b, err := json.Marshal(NewWelcome(1, "ABCD", g, NewStatic(g)))
	if err != nil {
		t.Fatal(err)
	}
	var w struct {
		Map MapInfo `json:"map"`
	}
	if err := json.Unmarshal(b, &w); err != nil {
		t.Fatal(err)
	}
	if w.Map.Kind != "sehir" || len(w.Map.Bases) != 2 || len(w.Map.Bld) != len(g.Map().Buildings) || len(w.Map.Bld) == 0 {
		t.Fatalf("map info: kind %q bases %d bld %d", w.Map.Kind, len(w.Map.Bases), len(w.Map.Bld))
	}
	nato := w.Map.Bases[0]
	if nato.Side != "nato" || len(nato.Hangars) != 6 || nato.Areas[0][4] != float64(maps.SurfRunway) {
		t.Fatalf("base: %+v", nato)
	}
}

func TestDefaultMapIsIsland(t *testing.T) {
	if newGame().Map().Kind != maps.Ada {
		t.Fatal("zero Settings.Map must build the island")
	}
}

func TestGearBrakeInputAndPlaneFields(t *testing.T) {
	m, err := DecodeClient([]byte(`{"t":"in","seq":1,"th":0.5,"g":true,"br":true}`))
	if err != nil {
		t.Fatal(err)
	}
	if in := m.Input(); !in.Gear || !in.Brake {
		t.Fatalf("input %+v", in)
	}
	p := sim.Plane{ID: 1, Kind: sim.F16, Alive: true, RearmTicks: 90, FlightState: sim.FlightState{Gear: true, Ground: true}}
	b, _ := json.Marshal(newPlane(p, 0))
	for _, want := range []string{`"gr":true`, `"gd":true`, `"rr":0.5`} {
		if !strings.Contains(string(b), want) {
			t.Fatalf("%s lacks %s", b, want)
		}
	}
	ev := NewEvents([]sim.Event{{Kind: sim.EvRearm, Plane: 1}}, 5)
	if len(ev) != 1 || ev[0].K != "rearm" {
		t.Fatalf("events %+v", ev)
	}
}

// TestWelcomeCarriesRotateSpeed: the client's ground prediction needs every
// aircraft's lift-off speed; a missing one would keep it rolling forever.
func TestWelcomeCarriesRotateSpeed(t *testing.T) {
	g := newGame()
	b, err := json.Marshal(NewWelcome(3, "ABCD", g, NewStatic(g)))
	if err != nil {
		t.Fatal(err)
	}
	var w struct {
		Aircraft []map[string]any `json:"aircraft"`
	}
	if err := json.Unmarshal(b, &w); err != nil {
		t.Fatal(err)
	}
	for _, a := range w.Aircraft {
		k, _ := sim.ParseKind(a["kind"].(string))
		if v, ok := a["rotateSpeed"].(float64); !ok || v != sim.SpecOf(k).RotateSpeed || v <= 0 {
			t.Fatalf("%v: rotateSpeed %v", a["kind"], a["rotateSpeed"])
		}
	}
}

func TestDeadPlaneSendsNoRearm(t *testing.T) {
	p := sim.Plane{ID: 1, Kind: sim.F16, Alive: false, RearmTicks: 90, RespawnTick: 100}
	b, _ := json.Marshal(newPlane(p, 0))
	if strings.Contains(string(b), `"rr"`) {
		t.Fatalf("dead plane carries rearm progress: %s", b)
	}
}

func TestWelcomeWeather(t *testing.T) {
	g := game.New(game.Settings{Mode: mode.FFA, Size: 2, Difficulty: bot.Easy, Seed: 3, Weather: weather.Storm})
	b, _ := json.Marshal(NewWelcome(1, "ABCD", g, NewStatic(g)))
	var w struct {
		Weather WeatherInfo `json:"weather"`
	}
	if err := json.Unmarshal(b, &w); err != nil || w.Weather.Kind != "firtina" || w.Weather.LockMul != 0.7 || w.Weather.Gust != 6 {
		t.Fatalf("%+v %v", w.Weather, err)
	}
}

func TestSnapCarriesWorldTick(t *testing.T) {
	b, _ := json.Marshal(NewSnap(sim.Snapshot{Tick: 5}, nil, 605))
	var s struct {
		Tick int `json:"tick"`
		WT   int `json:"wt"`
	}
	if err := json.Unmarshal(b, &s); err != nil || s.Tick != 605 || s.WT != 5 {
		t.Fatalf("%s %v", b, err)
	}
}

func TestBaseModeWire(t *testing.T) {
	g := game.New(game.Settings{Mode: mode.Base, Size: 1, Difficulty: bot.Easy, Seed: 1})
	st := NewStatic(g)
	var info MapInfo
	if err := json.Unmarshal(st.Map, &info); err != nil || len(info.Structs) != 12 || info.Structs[5].K != "aa" {
		t.Fatalf("structs %+v %v", info.Structs, err)
	}
	if s := info.Structs[6]; s.ID != sim.StructID(1, 0) || s.Tm != "soviet" || s.HP != 400 || s.Box[3] <= s.Box[0] {
		t.Fatalf("soviet hangar target %+v", s)
	}
	g.Step(nil)
	b, _ := json.Marshal(NewSnap(g.Snapshot(), nil, g.Tick()))
	if !strings.Contains(string(b), `"st":[`) || !strings.Contains(string(b), `"bm":2`) {
		t.Fatalf("snap lacks structures/bombs: %s", b)
	}
	evs := NewEvents([]sim.Event{
		{Kind: sim.EvBombDrop, Plane: 1<<25 + 1, By: 2},
		{Kind: sim.EvStructDown, Plane: sim.StructID(0, 1), Other: 2},
		{Kind: sim.EvKill, Plane: 3, Weapon: sim.WAA},
		{Kind: sim.EvBombHit, Plane: 1<<25 + 1, By: 2},
		{Kind: sim.EvStructHit, Plane: sim.StructID(0, 1), Other: 2, Value: 260, Weapon: sim.WBomb},
	}, 9)
	if evs[0].K != "bdrop" || evs[0].O != 2 || evs[0].Vel == nil || evs[1].K != "sdown" || evs[2].W != "aa" ||
		evs[3].K != "boom" || evs[4].K != "shit" || evs[4].W != "bomb" || evs[4].B != 2 {
		t.Fatalf("%+v", evs)
	}
	r := NewRound(game.Round{Phase: game.Ended, Winner: "NATO", WinnerTeam: sim.TeamNATO, ObjNATO: 10, ObjSoviet: 0, Base: true})
	rb, _ := json.Marshal(r)
	if !strings.Contains(string(rb), `"wt":"nato"`) || !strings.Contains(string(rb), `"obj":{"nato":10,"soviet":0}`) {
		t.Fatalf("%s", rb)
	}
	m, _ := DecodeClient([]byte(`{"t":"in","seq":1,"bo":true}`))
	if !m.Input().Bomb {
		t.Fatal("bo → Bomb")
	}
}

// sel carries the picked missile kind; missing or unknown is auto (old clients, bots).
func TestInputPick(t *testing.T) {
	for wire, want := range map[string]sim.MissilePick{
		`{"t":"in","seq":1}`: sim.PickAuto, `{"t":"in","seq":1,"sel":1}`: sim.PickIR,
		`{"t":"in","seq":1,"sel":2}`: sim.PickRadar, `{"t":"in","seq":1,"sel":9}`: sim.PickAuto,
	} {
		m, err := DecodeClient([]byte(wire))
		if err != nil || m.Input().Pick != want {
			t.Errorf("%s: pick %v (%v), want %v", wire, m.Input().Pick, err, want)
		}
	}
}

// Outside base attack the wire carries no structures, bombs or objective.
func TestNonBaseWireHasNoBaseAttackFields(t *testing.T) {
	for _, k := range []mode.Kind{mode.Team, mode.FFA} {
		g := game.New(game.Settings{Mode: k, Size: 2, Difficulty: bot.Easy, Seed: 1})
		st := NewStatic(g)
		g.Step(nil)
		snap, _ := json.Marshal(NewSnap(g.Snapshot(), nil, g.Tick()))
		round, _ := json.Marshal(NewRound(g.Round()))
		for _, c := range []struct{ name, js, key string }{
			{"map", string(st.Map), `"structs"`},
			{"snap", string(snap), `"st"`},
			{"snap", string(snap), `"bo"`},
			{"snap", string(snap), `"bm"`},
			{"round", string(round), `"obj"`},
			{"round", string(round), `"wt"`},
			{"round", string(round), `"wid"`},
		} {
			if strings.Contains(c.js, c.key+":") {
				t.Fatalf("%v %s carries %s: %s", k, c.name, c.key, c.js)
			}
		}
	}
	r, _ := json.Marshal(NewRound(game.Round{Phase: game.Ended, Winner: "Pilot", WinnerID: 7}))
	if !strings.Contains(string(r), `"wid":7`) || strings.Contains(string(r), `"wt"`) || strings.Contains(string(r), `"obj"`) {
		t.Fatalf("ffa winner: %s", r)
	}
}

func TestDecodeV2Messages(t *testing.T) {
	for _, ok := range []string{`{"t":"quick"}`, `{"t":"chat","id":1}`, `{"t":"chat","id":6}`, `{"t":"hello","v":2,"name":"a","tok":"AAAAAAAAAAAAAAAAAAAAAA"}`} {
		if _, err := DecodeClient([]byte(ok)); err != nil {
			t.Fatalf("%s: %v", ok, err)
		}
	}
	for _, bad := range []string{`{"t":"chat","id":0}`, `{"t":"chat","id":7}`, `{"t":"chat"}`, `{"t":"chat","id":1e9}`} {
		if _, err := DecodeClient([]byte(bad)); err == nil {
			t.Fatalf("%s accepted", bad)
		}
	}
	if Version != 2 {
		t.Fatal("protocol version must be 2")
	}
}

func TestWelcomeStart(t *testing.T) {
	for st, want := range map[sim.StartMode]string{0: "hava", sim.StartAir: "hava", sim.StartRunway: "pist"} {
		g := game.New(game.Settings{Mode: mode.FFA, Size: 2, Difficulty: bot.Easy, Seed: 3, Start: st})
		b, _ := json.Marshal(NewWelcome(1, "ABCD", g, NewStatic(g)))
		var w struct{ Start string }
		if err := json.Unmarshal(b, &w); err != nil || w.Start != want {
			t.Fatalf("start %d: %q %v", st, w.Start, err)
		}
	}
}

func TestHeadLatchAndWithAck(t *testing.T) {
	m := ClientMsg{T: TIn, Seq: 4, TS: 2, Name: "n", Tok: "t", Code: "c", V: 2, Chat: 1, P: 0.3}
	if h := m.Head(); h != (netproto.Header{T: TIn, V: 2, Name: "n", Tok: "t", Code: "c", Seq: 4, TS: 2, Chat: 1}) {
		t.Fatalf("head %+v", h)
	}
	l := m.Latch(ClientMsg{M: true, BO: true, P: 9})
	if !l.M || !l.BO || l.FL || l.P != 0.3 || l.Seq != 4 {
		t.Fatalf("latch %+v", l)
	}
	s := Snap{T: "snap", Tick: 2}
	if a, ok := s.WithAck(7).(Snap); !ok || a.Ack != 7 || s.Ack != 0 {
		t.Fatalf("withAck %+v", a)
	}
}
