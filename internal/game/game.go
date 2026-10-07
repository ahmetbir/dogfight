// Package game runs one room's match: world, rules, scoreboard and bots.
package game

import (
	"fmt"

	"playground/internal/bot"
	"playground/internal/geom"
	"playground/internal/maps"
	"playground/internal/mode"
	"playground/internal/sim"
	"playground/internal/terrain"
	"playground/internal/weather"
)

type Settings struct {
	Mode       mode.Kind
	Size       int
	Difficulty bot.Difficulty
	Seed       int64
	Map        maps.Kind     // zero means maps.Ada
	Weather    weather.Kind  // zero means weather.Clear
	Start      sim.StartMode // zero means sim.StartAir
	Listed     bool          // shown in the lobby list; the game ignores it
	// Lobby: the room opens in the pre-match Lobby phase and returns there
	// after every round (created rooms); otherwise it plays at once (quick play).
	Lobby bool
}

type Phase uint8

const (
	Playing Phase = iota + 1
	Ended
	// Lobby: before a round of a created room. Humans pick sides and
	// aircraft; no bots, no world tick, no round clock.
	Lobby
)

const EndedTicks = 600 // 10 s scoreboard between rounds

// PickTimeoutTicks is how long a joining human may stay on the pick screen
// before it spawns with its default aircraft.
const PickTimeoutTicks = 15 * 60

const drawWinner = mode.Draw

// Game is not safe for concurrent use; the room actor owns it.
type Game struct {
	s       Settings
	rules   mode.Rules
	terrain *terrain.Map
	m       *maps.Map
	world   *sim.World
	board   *mode.Scoreboard
	env     *bot.Env // what every bot knows of the room

	players map[sim.ID]*Player
	bots    map[sim.ID]*bot.Brain
	botKind map[sim.Team]int // aircraft rotation per team
	// swappedLife records, per plane, the Life of the life in which Pick
	// used its instant respawn.
	swappedLife map[sim.ID]int
	// pending holds humans without a plane yet: ID → tick of the fallback spawn.
	pending   map[sim.ID]int
	switchAt  map[sim.ID]int // tick of a human's last team switch
	hurtAt    map[sim.ID]int // tick a human's plane last took damage (team switch gate)
	nextID    sim.ID
	rosterVer int
	hostPin   sim.ID // a host handed back by SetHost (0: the earliest human)

	tick     int // own monotonic counter; advances while Ended too
	phase    Phase
	roundEnd int // tick at which the round time runs out
	phaseEnd int // tick at which the Ended phase gives way to a new round
	winner   string
	winTeam  sim.Team
	winID    sim.ID
}

// New builds the room and fills every seat with a bot, or, with
// Settings.Lobby, leaves it empty in the Lobby phase until Start.
func New(s Settings) *Game {
	if s.Difficulty < bot.Easy || s.Difficulty > bot.Hard {
		s.Difficulty = bot.Normal
	}
	rules := mode.NewRules(s.Mode, s.Size)
	s.Mode = rules.Kind()
	s.Size = rules.Slots()
	if s.Mode != mode.FFA {
		s.Size /= 2 // per team
	}
	s.Map, s.Weather, s.Start = validKinds(s)
	m := maps.Build(s.Map, s.Seed)
	t := m.Terrain
	g := &Game{
		s:           s,
		rules:       rules,
		terrain:     t,
		m:           m,
		board:       mode.NewScoreboard(),
		env:         &bot.Env{Terrain: t, Map: m, Mode: s.Mode, Wind: weather.Wind(s.Weather, s.Seed)},
		players:     map[sim.ID]*Player{},
		bots:        map[sim.ID]*bot.Brain{},
		botKind:     map[sim.Team]int{},
		swappedLife: map[sim.ID]int{},
		pending:     map[sim.ID]int{},
		switchAt:    map[sim.ID]int{},
		hurtAt:      map[sim.ID]int{},
		phase:       Playing,
	}
	cfg := g.worldConfig()
	g.env.Bombs = cfg.Bombs // bots rearm to the same sortie load as the sim
	g.world = sim.NewWorld(cfg)
	if s.Mode == mode.Base {
		g.board.SetObjective(objective(m))
		g.board.SetTargets(targets(m))
	}
	if s.Lobby {
		g.phase = Lobby
		return g
	}
	g.roundEnd = rules.DurationTicks()
	for range rules.Slots() {
		all := map[sim.Team]int{}
		for _, p := range g.players {
			all[p.Team]++
		}
		g.addBot(rules.TeamFor(all))
	}
	return g
}

// validKinds fills zero map, weather and start with their defaults (ada,
// acik, hava). Wire values are whitelisted before a room is built, so any
// other unknown value is a programming error.
func validKinds(s Settings) (maps.Kind, weather.Kind, sim.StartMode) {
	if s.Map == 0 {
		s.Map = maps.Ada
	}
	if s.Weather == 0 {
		s.Weather = weather.Clear
	}
	if s.Start == 0 {
		s.Start = sim.StartAir
	}
	_, mapOK := maps.ParseKind(s.Map.String())
	if !mapOK || !s.Weather.Valid() || (s.Start != sim.StartAir && s.Start != sim.StartRunway) {
		panic(fmt.Sprintf("game: invalid settings map=%d weather=%d start=%d", s.Map, s.Weather, s.Start))
	}
	return s.Map, s.Weather, s.Start
}

// worldConfig is the sim configuration of the room's settings: map, rules,
// the weather's lock-range scale and wind, and (base attack only) targets
// and bombs.
func (g *Game) worldConfig() sim.Config {
	ws := g.s.Weather.Spec()
	c := sim.Config{
		Seed: g.s.Seed, Terrain: g.terrain, FriendlyFire: g.rules.FriendlyFire(), Map: g.m,
		LockRangeMul: ws.LockMul, Wind: weather.Wind(g.s.Weather, g.s.Seed), Gust: ws.Gust, Start: g.s.Start,
	}
	if g.s.Mode == mode.Base {
		c.Structures, c.Bombs = true, 2
	}
	return c
}

// targets counts each side's targets.
func targets(m *maps.Map) (nato, soviet int) {
	for _, d := range m.Structures {
		if d.Side == 0 {
			nato++
		} else {
			soviet++
		}
	}
	return nato, soviet
}

// objective sums each side's target HP.
func objective(m *maps.Map) (nato, soviet float64) {
	for _, d := range m.Structures {
		if d.Side == 0 {
			nato += d.MaxHP
		} else {
			soviet += d.MaxHP
		}
	}
	return nato, soviet
}

// Step advances one tick: bots think on a single shared snapshot, all
// inputs drive the world, kills feed the scoreboard and the round ends on
// the rules' limit or the clock. While Ended the world is frozen; in the
// Lobby it does not exist for the players (only the game tick advances). A
// lobby room's scoreboard gives way to the Lobby, any other to a new round.
func (g *Game) Step(inputs map[sim.ID]sim.Input) []sim.Event {
	g.tick++
	if g.phase == Lobby {
		return nil
	}
	if g.phase == Ended {
		if g.tick < g.phaseEnd {
			return nil
		}
		if g.s.Lobby {
			g.toLobby()
			return nil
		}
		g.board.Reset()
		g.world.ResetAll()
		g.phase, g.winner = Playing, ""
		g.winTeam, g.winID = sim.TeamNone, 0
		g.roundEnd = g.tick + g.rules.DurationTicks()
	}
	g.spawnOverdue() // after ResetAll, so a late joiner spawns once
	merged := make(map[sim.ID]sim.Input, len(g.players))
	var snap sim.Snapshot
	if len(g.bots) > 0 {
		snap = g.world.Snapshot()
		for id, b := range g.bots {
			merged[id] = b.Think(&snap, g.env)
		}
	}
	for id, in := range inputs {
		if p, ok := g.players[id]; ok && !p.Bot {
			merged[id] = in
		}
	}
	evs := g.world.Step(merged)
	for _, ev := range evs {
		g.board.Apply(ev, g.teamOf)
		if p, ok := g.players[ev.Plane]; ok && !p.Bot && ev.Kind == sim.EvHit {
			g.hurtAt[ev.Plane] = g.tick
		}
		if b, ok := g.bots[ev.Plane]; ok && ev.Kind == sim.EvKill { // a downed bot picks its next sortie's loadout
			g.SetLoadout(ev.Plane, b.Loadout(&snap))
		}
	}
	if over, w := g.rules.Over(g.board); over {
		g.finish(w)
	} else if g.tick >= g.roundEnd {
		g.finish(g.leader())
	}
	return evs
}

func (g *Game) Snapshot() sim.Snapshot { return g.world.Snapshot() }
func (g *Game) Terrain() *terrain.Map  { return g.terrain }
func (g *Game) Map() *maps.Map         { return g.m }
func (g *Game) Settings() Settings     { return g.s }

// Tick is the game's own monotonic tick (it keeps counting while Ended,
// unlike the world's). Snapshots, welcome and event ticks use it.
func (g *Game) Tick() int { return g.tick }

// PowerupSpots returns the fixed crate positions, indexed by spot.
func (g *Game) PowerupSpots() []geom.Vec3 {
	pus := g.world.Snapshot().Powerups
	out := make([]geom.Vec3, len(pus))
	for _, u := range pus {
		out[u.Spot] = u.Pos
	}
	return out
}
