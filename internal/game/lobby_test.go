package game

import (
	"errors"
	"testing"

	"playground/internal/bot"
	"playground/internal/mode"
	"playground/internal/sim"
)

func lobbyGame(m mode.Kind, size int) *Game {
	return New(Settings{Mode: m, Size: size, Difficulty: bot.Easy, Seed: 11, Lobby: true})
}

func seated(t *testing.T, g *Game, name string) sim.ID {
	t.Helper()
	id, err := g.AddHuman(name)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// A lobby room has no bots, no planes and no clock; stepping it moves only
// the game tick, and humans wait seatless of planes with no pick timeout.
func TestLobbyGatesTheWorld(t *testing.T) {
	g := lobbyGame(mode.Team, 2)
	if r := g.Round(); r.Phase != Lobby || r.TicksLeft != 0 || len(g.Players()) != 0 || g.Bots() != 0 || g.Seats() != 4 || g.SideSeats() != 2 {
		t.Fatalf("new lobby: %+v players=%d bots=%d", r, len(g.Players()), g.Bots())
	}
	a := seated(t, g, "a")
	if err := g.Pick(a, sim.F15); err != nil {
		t.Fatal(err)
	}
	for range PickTimeoutTicks + 10 {
		if evs := g.Step(map[sim.ID]sim.Input{a: {Throttle: 1}}); len(evs) != 0 {
			t.Fatalf("events in the lobby: %v", evs)
		}
	}
	if g.Tick() != PickTimeoutTicks+10 || g.Snapshot().Tick != 0 || len(g.Snapshot().Planes) != 0 {
		t.Fatalf("tick %d world %d planes %d", g.Tick(), g.Snapshot().Tick, len(g.Snapshot().Planes))
	}
	if g.Waiting(a) || g.Round().Phase != Lobby || player(t, g, a).Kind != sim.F15 {
		t.Fatalf("lobby human: waiting=%v %+v", g.Waiting(a), player(t, g, a))
	}
}

// Quick play rooms (no Lobby setting) still start at once, full of bots.
func TestQuickRoomSkipsLobby(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 11})
	if g.Round().Phase != Playing || g.Bots() != 4 {
		t.Fatalf("quick room: %v bots=%d", g.Round().Phase, g.Bots())
	}
	if err := g.Start(0); !errors.Is(err, ErrNotLobby) {
		t.Fatalf("start in a running room: %v", err)
	}
}

// The host is the earliest human still seated; it passes on when they leave.
func TestHostSuccession(t *testing.T) {
	g := lobbyGame(mode.FFA, 6)
	if g.Host() != 0 {
		t.Fatal("no host in an empty room")
	}
	a, b, c := seated(t, g, "a"), seated(t, g, "b"), seated(t, g, "c")
	if g.Host() != a {
		t.Fatalf("host %d, want the creator %d", g.Host(), a)
	}
	g.RemoveHuman(a)
	if g.Host() != b {
		t.Fatalf("host %d, want the next joiner %d", g.Host(), b)
	}
	d := seated(t, g, "d")
	g.RemoveHuman(b)
	if g.Host() != c || d <= c {
		t.Fatalf("host %d, want %d (not the newer %d)", g.Host(), c, d)
	}
	if g.Bots() != 0 || len(g.Players()) != 2 {
		t.Fatalf("leaving the lobby seats no bot: bots=%d players=%d", g.Bots(), len(g.Players()))
	}
}

// Joiners alternate sides. With humans on both sides a side may not get
// two humans ahead of the other (unless the move narrows the gap); everyone
// on one side against bots is allowed; no side takes more humans than its
// seats; FFA has no sides.
func TestLobbySideBalance(t *testing.T) {
	g := lobbyGame(mode.Team, 3)
	a, b := seated(t, g, "a"), seated(t, g, "b")
	if player(t, g, a).Team != sim.TeamNATO || player(t, g, b).Team != sim.TeamSoviet {
		t.Fatal("auto-balance alternates sides")
	}
	if err := g.SetSide(b, sim.TeamNATO); err != nil { // friends together: 2-0
		t.Fatal(err)
	}
	c := seated(t, g, "c") // the newcomer goes to the empty side: N a,b  S c
	if player(t, g, c).Team != sim.TeamSoviet {
		t.Fatalf("c on %v", player(t, g, c).Team)
	}
	d := seated(t, g, "d")                                             // N a,b  S c,d
	if err := g.SetSide(d, sim.TeamNATO); !errors.Is(err, ErrUneven) { // 3-1
		t.Fatalf("3-1: %v", err)
	}
	if err := g.SetSide(c, sim.TeamNATO); !errors.Is(err, ErrUneven) { // 3-1 the other way round
		t.Fatalf("3-1: %v", err)
	}
	if err := g.SetSide(a, sim.TeamSoviet); !errors.Is(err, ErrUneven) { // 1-3
		t.Fatalf("1-3: %v", err)
	}
	if err := g.SetSide(a, sim.TeamNATO); err != nil { // already there: a no-op
		t.Fatal(err)
	}
	if err := g.ChooseTeam(d, sim.TeamNATO); !errors.Is(err, ErrUneven) { // the old team message reaches SetSide in the lobby
		t.Fatalf("team in the lobby: %v", err)
	}
	if p := player(t, g, b); p.Team != sim.TeamNATO || !flies(sim.TeamNATO, p.Kind) {
		t.Fatalf("b after the move: %+v", p)
	}
	f := lobbyGame(mode.FFA, 4)
	x := seated(t, f, "x")
	if err := f.SetSide(x, sim.TeamNATO); !errors.Is(err, ErrNoTeams) {
		t.Fatalf("ffa side: %v", err)
	}
}

// A side holds at most its seats in humans, even all together against bots.
func TestLobbySideFull(t *testing.T) {
	g := lobbyGame(mode.Team, 2)
	a, b, c := seated(t, g, "a"), seated(t, g, "b"), seated(t, g, "c") // N a,c  S b
	_ = a
	_ = c
	if err := g.SetSide(b, sim.TeamNATO); !errors.Is(err, ErrSideFull) {
		t.Fatalf("NATO has 2 seats: %v", err)
	}
}

// A lopsided lobby (left over by leavers) may move toward balance.
func TestLobbySideNarrowingMove(t *testing.T) {
	g := lobbyGame(mode.Team, 4)
	a, _, _ := seated(t, g, "a"), seated(t, g, "b"), seated(t, g, "c") // N a,c  S b
	for _, n := range []string{"d", "e", "f"} {
		seated(t, g, n)
	} // N a,c,e  S b,d,f
	for _, p := range g.Players() {
		if p.Team == sim.TeamSoviet && p.Name != "f" {
			g.RemoveHuman(p.ID)
		}
	} // N a,c,e  S f: 3-1
	if err := g.SetSide(a, sim.TeamSoviet); err != nil { // 2-2
		t.Fatal(err)
	}
}

// The lobby fills up to the seats; a full lobby refuses with ErrFull.
func TestLobbyFull(t *testing.T) {
	g := lobbyGame(mode.Team, 1)
	seated(t, g, "a")
	seated(t, g, "b")
	if _, err := g.AddHuman("c"); !errors.Is(err, ErrFull) {
		t.Fatalf("third human in a 1v1: %v", err)
	}
	f := lobbyGame(mode.FFA, 2)
	seated(t, f, "a")
	seated(t, f, "b")
	if _, err := f.AddHuman("c"); !errors.Is(err, ErrFull) {
		t.Fatalf("third human in a 2-seat ffa: %v", err)
	}
	h := lobbyGame(mode.Team, 2) // one side full of friends: the joiner takes the other
	x, y := seated(t, h, "x"), seated(t, h, "y")
	_ = x
	if err := h.SetSide(y, sim.TeamNATO); err != nil {
		t.Fatal(err)
	}
	if z := seated(t, h, "z"); player(t, h, z).Team != sim.TeamSoviet {
		t.Fatal("z joins the side with seats")
	}
}

// Only the host starts, only in the lobby; Start spawns every human in its
// pick on its side and fills each side's empty seats with bots, and the
// round clock runs.
func TestStartFillsBotsPerSide(t *testing.T) {
	g := lobbyGame(mode.Team, 3)
	a, b := seated(t, g, "a"), seated(t, g, "b")
	if err := g.SetSide(b, sim.TeamNATO); err != nil {
		t.Fatal(err)
	}
	if err := g.Pick(b, sim.F15); err != nil {
		t.Fatal(err)
	}
	if err := g.Start(b); !errors.Is(err, ErrNotHost) {
		t.Fatalf("a guest starts: %v", err)
	}
	if err := g.Start(a); err != nil {
		t.Fatal(err)
	}
	if err := g.Start(a); !errors.Is(err, ErrNotLobby) {
		t.Fatalf("second start: %v", err)
	}
	humans, bots := teamCounts(g)
	if humans[sim.TeamNATO] != 2 || bots[sim.TeamNATO] != 1 || bots[sim.TeamSoviet] != 3 || g.Bots() != 4 {
		t.Fatalf("after start: humans=%v bots=%v", humans, bots)
	}
	r := g.Round()
	if r.Phase != Playing || r.TicksLeft != g.rules.DurationTicks() {
		t.Fatalf("round %+v", r)
	}
	evs := g.Step(nil)
	for _, id := range []sim.ID{a, b} {
		pl, ok := g.world.Plane(id)
		if !ok || !pl.Alive || pl.Team != sim.TeamNATO || spawnsOf(evs, id) != 1 {
			t.Fatalf("human %d: %+v ok=%v spawns=%d", id, pl, ok, spawnsOf(evs, id))
		}
	}
	if pl, _ := g.world.Plane(b); pl.Kind != sim.F15 {
		t.Fatalf("b flies %v, picked F15", pl.Kind)
	}
	if len(g.Snapshot().Planes) != 6 {
		t.Fatalf("planes %d", len(g.Snapshot().Planes))
	}
}

// FFA: Start fills the room's seats with bots.
func TestStartFillsFFA(t *testing.T) {
	g := lobbyGame(mode.FFA, 5)
	a := seated(t, g, "a")
	if err := g.Start(a); err != nil {
		t.Fatal(err)
	}
	if len(g.Players()) != 5 || g.Bots() != 4 {
		t.Fatalf("players %d bots %d", len(g.Players()), g.Bots())
	}
}

// A runway room starts its humans on the ground.
func TestStartUsesStartMode(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 1, Difficulty: bot.Easy, Seed: 11, Lobby: true, Start: sim.StartRunway})
	a := seated(t, g, "a")
	if err := g.Start(a); err != nil {
		t.Fatal(err)
	}
	if pl, ok := g.world.Plane(a); !ok || !pl.Ground {
		t.Fatalf("runway start: %+v", pl)
	}
}

// A late joiner while the round runs takes today's path: a bot's seat on
// the balanced side, the pick screen, the pick timeout.
func TestLateJoinReplacesBot(t *testing.T) {
	g := lobbyGame(mode.Team, 2)
	a := seated(t, g, "a")
	if err := g.Start(a); err != nil {
		t.Fatal(err)
	}
	g.Step(nil)
	b := seated(t, g, "b")
	humans, bots := teamCounts(g)
	if player(t, g, b).Team != sim.TeamSoviet || humans[sim.TeamSoviet] != 1 || bots[sim.TeamSoviet] != 1 || !g.Waiting(b) {
		t.Fatalf("late join: humans=%v bots=%v waiting=%v", humans, bots, g.Waiting(b))
	}
	if err := g.SetSide(b, sim.TeamNATO); !errors.Is(err, ErrNotLobby) {
		t.Fatalf("side while playing: %v", err)
	}
	g.RemoveHuman(b)
	if _, bots := teamCounts(g); bots[sim.TeamSoviet] != 2 {
		t.Fatal("a bot refills a seat left while playing")
	}
}

// After the scoreboard a lobby room returns to the Lobby: bots gone, the
// humans on the same sides with the same picks, a fresh world, and the host
// starts again.
func TestRoundEndReturnsToLobby(t *testing.T) {
	g := lobbyGame(mode.Team, 2)
	a, b := seated(t, g, "a"), seated(t, g, "b")
	if err := g.SetSide(b, sim.TeamNATO); err != nil {
		t.Fatal(err)
	}
	if err := g.Pick(a, sim.F15); err != nil {
		t.Fatal(err)
	}
	if err := g.Start(a); err != nil {
		t.Fatal(err)
	}
	for range 30 {
		g.Step(nil)
	}
	late := seated(t, g, "late") // joins mid-round, never picks
	g.finish("NATO")
	for range EndedTicks - 1 {
		g.Step(nil)
	}
	if g.Round().Phase != Ended {
		t.Fatal("still the scoreboard")
	}
	g.Step(nil)
	r := g.Round()
	if r.Phase != Lobby || r.Winner != "" || g.Bots() != 0 || len(g.Snapshot().Planes) != 0 || g.Snapshot().Tick != 0 {
		t.Fatalf("back in the lobby: %+v bots=%d planes=%d", r, g.Bots(), len(g.Snapshot().Planes))
	}
	if player(t, g, a).Team != sim.TeamNATO || player(t, g, b).Team != sim.TeamNATO || player(t, g, a).Kind != sim.F15 || g.Waiting(late) {
		t.Fatalf("sides and picks kept: a=%+v b=%+v late waiting=%v", player(t, g, a), player(t, g, b), g.Waiting(late))
	}
	for _, l := range r.Board {
		if l.Kills != 0 || l.Deaths != 0 || l.Score != 0 {
			t.Fatalf("board not reset: %+v", l)
		}
	}
	if err := g.Start(a); err != nil {
		t.Fatal(err)
	}
	if g.Round().Phase != Playing || len(g.Players()) != 4 {
		t.Fatalf("second round: %v players=%d", g.Round().Phase, len(g.Players()))
	}
}
