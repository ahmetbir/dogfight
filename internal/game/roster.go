package game

import (
	"cmp"
	"errors"
	"slices"
	"strings"
	"unicode/utf8"

	"playground/internal/bot"
	"playground/internal/sim"
)

var (
	ErrFull     = errors.New("game: room is full")
	ErrBadKind  = errors.New("game: aircraft not allowed for team")
	ErrNoPlayer = errors.New("game: no such player")
)

var botNames = [...]string{"Maverick", "Iceman", "Viper", "Goose", "Ivan", "Sokol", "Berkut", "Yastreb", "Ghost", "Raven", "Falcon", "Hawk"}

const (
	maxNameLen  = 16
	defaultName = "Pilot"
)

type Player struct {
	ID      sim.ID
	Name    string
	Team    sim.Team
	Kind    sim.Kind
	Bot     bool
	Loadout sim.Loadout // missile loadout of the next spawn
}

// teamKinds lists the aircraft a team may fly, in sim.Kinds order (the first
// is a new human's default and the bots' rotation starts there); TeamNone
// (FFA) flies all.
func teamKinds(t sim.Team) []sim.Kind {
	if t == sim.TeamNone {
		return sim.Kinds()
	}
	var out []sim.Kind
	for _, k := range sim.Kinds() {
		if sim.SpecOf(k).Team == t {
			out = append(out, k)
		}
	}
	return out
}

func cleanName(name string) string {
	name = strings.TrimSpace(name)
	if !utf8.ValidString(name) {
		name = strings.ToValidUTF8(name, "")
	}
	if utf8.RuneCountInString(name) > maxNameLen {
		name = string([]rune(name)[:maxNameLen])
	}
	if name == "" || strings.EqualFold(name, drawWinner) { // the draw sentinel
		return defaultName
	}
	return name
}

// seat adds a player to the roster and scoreboard (not yet to the world).
func (g *Game) seat(name string, team sim.Team, kind sim.Kind, isBot bool) sim.ID {
	g.nextID++
	id := g.nextID
	g.players[id] = &Player{ID: id, Name: name, Team: team, Kind: kind, Bot: isBot}
	if isBot {
		b := bot.New(id, g.s.Difficulty, g.s.Seed*7919+int64(id))
		g.bots[id] = b
		g.players[id].Loadout = b.Loadout(nil)
	}
	g.board.Add(id)
	g.rosterVer++
	return id
}

// add seats a new player in the roster, scoreboard and world.
func (g *Game) add(name string, team sim.Team, kind sim.Kind, isBot bool) sim.ID {
	id := g.seat(name, team, kind, isBot)
	g.world.AddPlaneLoadout(id, team, kind, g.players[id].Loadout)
	return id
}

func (g *Game) remove(id sim.ID) {
	delete(g.pending, id)
	delete(g.players, id)
	delete(g.bots, id)
	delete(g.swappedLife, id)
	delete(g.switchAt, id)
	delete(g.hurtAt, id)
	g.world.RemovePlane(id)
	g.board.Remove(id)
	g.rosterVer++
}

// addBot seats a bot on team with the first free name and the team's next
// aircraft in rotation.
func (g *Game) addBot(team sim.Team) {
	used := map[string]bool{}
	for _, p := range g.players {
		used[p.Name] = true
	}
	name := botNames[0]
	for _, n := range botNames {
		if !used[n] {
			name = n
			break
		}
	}
	kinds := teamKinds(team)
	kind := kinds[g.botKind[team]%len(kinds)]
	g.botKind[team]++
	g.add(name, team, kind, true)
}

// AddHuman seats a human on the team the rules pick from the human counts,
// replacing the newest bot there at once (team balance holds from the join).
// The human is in the roster and on the scoreboard but has no plane until
// the first Pick, or until PickTimeoutTicks pass (default kind). In the
// Lobby there are no bots: the human takes a free seat on the balanced side
// and waits for Start.
func (g *Game) AddHuman(name string) (sim.ID, error) {
	if g.phase == Lobby {
		return g.addLobbyHuman(name)
	}
	humans := map[sim.Team]int{}
	for _, p := range g.players {
		if !p.Bot {
			humans[p.Team]++
		}
	}
	team := g.rules.TeamFor(humans)
	victim := g.newestBot(team)
	if victim == 0 {
		return 0, ErrFull
	}
	g.remove(victim)
	id := g.seat(cleanName(name), team, teamKinds(team)[0], false)
	g.pending[id] = g.tick + PickTimeoutTicks
	return id, nil
}

// spawnPending gives a waiting human a plane of its current kind.
func (g *Game) spawnPending(id sim.ID) {
	p, ok := g.players[id]
	if !ok {
		return
	}
	delete(g.pending, id)
	g.world.AddPlaneLoadout(id, p.Team, p.Kind, p.Loadout)
}

// SetLoadout chooses id's missile loadout; it applies with the next spawn,
// or at once through a following Pick that respawns the plane.
func (g *Game) SetLoadout(id sim.ID, lo sim.Loadout) {
	if p, ok := g.players[id]; ok {
		p.Loadout = lo
		g.world.SetLoadout(id, lo)
	}
}

// spawnOverdue spawns, in ID order, every waiting human whose pick time ran
// out. It runs only while Playing; humans due during the scoreboard spawn
// with the next round.
func (g *Game) spawnOverdue() {
	if len(g.pending) == 0 {
		return
	}
	ids := make([]sim.ID, 0, len(g.pending))
	for id, deadline := range g.pending {
		if g.tick >= deadline {
			ids = append(ids, id)
		}
	}
	slices.Sort(ids)
	for _, id := range ids {
		g.spawnPending(id)
	}
}

// Waiting reports whether id is a human still waiting for its first plane.
func (g *Game) Waiting(id sim.ID) bool {
	_, ok := g.pending[id]
	return ok
}

// RemoveHuman frees a human's seat and puts a bot back on that team (in the
// Lobby the seat stays empty until Start).
func (g *Game) RemoveHuman(id sim.ID) {
	p, ok := g.players[id]
	if !ok || p.Bot {
		return
	}
	team := p.Team
	g.remove(id)
	if g.phase != Lobby {
		g.addBot(team)
	}
}

// Pick chooses the aircraft for id. A plane still in untouched spawn
// protection respawns with it at once, at most once per life and without
// extending protection; picking the aircraft it already flies there only
// re-arms it in place with the chosen loadout (SetLoadout), so a loadout and
// an aircraft change both apply in either order. Otherwise it applies at the
// next spawn. A waiting
// human spawns now, or with the next round while the scoreboard shows. In
// the Lobby the pick is only recorded: the plane comes with Start.
func (g *Game) Pick(id sim.ID, k sim.Kind) error {
	p, ok := g.players[id]
	if !ok {
		return ErrNoPlayer
	}
	allowed := false
	for _, tk := range teamKinds(p.Team) {
		allowed = allowed || tk == k
	}
	if !allowed {
		return ErrBadKind
	}
	p.Kind = k
	g.rosterVer++
	if g.phase == Lobby {
		return nil
	}
	if g.Waiting(id) { // first pick: the human enters the world now
		if g.phase == Ended { // or with the next round, not into the frozen world
			g.pending[id] = g.tick
			return nil
		}
		g.spawnPending(id)
		return nil
	}
	pl, ok := g.world.Plane(id)
	if ok && g.world.CanSwap(id) && k == pl.Kind { // same aircraft (a loadout change): re-armed in place, the respawn stays unused
		g.world.SetKind(id, k)
		g.world.Refit(id)
		return nil
	}
	if ok && g.world.CanSwap(id) && g.swappedLife[id] != pl.Life {
		// Once per life: Life identifies the life, and Reseat keeps it.
		g.swappedLife[id] = pl.Life
		g.world.Reseat(id, k)
		return nil
	}
	g.world.SetKind(id, k)
	return nil
}

// Players returns the roster ordered by ID.
func (g *Game) Players() []Player {
	out := make([]Player, 0, len(g.players))
	for _, p := range g.players {
		out = append(out, *p)
	}
	slices.SortFunc(out, func(a, b Player) int { return cmp.Compare(a.ID, b.ID) })
	return out
}

func (g *Game) Humans() int {
	n := 0
	for _, p := range g.players {
		if !p.Bot {
			n++
		}
	}
	return n
}

func (g *Game) RosterVersion() int { return g.rosterVer }

func (g *Game) teamOf(id sim.ID) sim.Team {
	if p, ok := g.players[id]; ok {
		return p.Team
	}
	return sim.TeamNone
}
