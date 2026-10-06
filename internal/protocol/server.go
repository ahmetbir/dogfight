package protocol

import (
	"math"

	"github.com/ahmetbir/roomkit/netproto"
	"playground/internal/game"
	"playground/internal/geom"
	"playground/internal/sim"
)

type Snap struct {
	T        string        `json:"t"`    // "snap"
	Tick     int           `json:"tick"` // game tick (keeps counting between rounds)
	WT       int           `json:"wt"`   // world tick: the clock of the sim's wind
	Ack      uint32        `json:"ack"`  // set per player by the room
	Planes   []PlaneJSON   `json:"planes"`
	Missiles []MissileJSON `json:"missiles"`
	Powerups []PowerupJSON `json:"pu"`
	Events   []EventJSON   `json:"ev"`
	// Base attack only (empty elsewhere, so omitted).
	Bombs   []BombJSON     `json:"bo,omitempty"`
	Structs []StructHPJSON `json:"st,omitempty"`
	Flares  []FlareJSON    `json:"fx,omitempty"` // burning flares (omitted when none)
}

// Replaceable marks snapshots as superseded by newer ones, so a full
// outbound queue (wsconn) may evict the oldest queued one.
func (Snap) Replaceable() {}

// Carry returns s with the events of older, an evicted snapshot, in front of
// its own: state heals from the next snapshot, events do not (spec §6).
// Events slices are shared between sessions, so a new one is built.
func (s Snap) Carry(older any) any {
	o, ok := older.(Snap)
	if !ok || len(o.Events) == 0 {
		return s
	}
	ev := make([]EventJSON, 0, len(o.Events)+len(s.Events))
	s.Events = append(append(ev, o.Events...), s.Events...)
	return s
}

type PlaneJSON struct {
	ID       sim.ID      `json:"id"`
	Kind     string      `json:"k"`
	Team     string      `json:"tm"`
	Pos      [3]float64  `json:"p"`
	Rot      [4]float64  `json:"q"` // [w,x,y,z], same order as testdata/vectors (Three.js is x,y,z,w)
	Vel      [3]float64  `json:"v"`
	Th       float64     `json:"th"`
	HP       float64     `json:"hp"`
	Alive    bool        `json:"a"`
	Heat     float64     `json:"ht"`
	Overheat bool        `json:"oh"`
	Missiles int         `json:"ms"`
	Flares   int         `json:"fl"`
	Lock     sim.ID      `json:"lk,omitempty"`
	LockP    float64     `json:"lp,omitempty"` // lock progress 0..1
	Locked   bool        `json:"ld,omitempty"`
	Turbo    bool        `json:"tb,omitempty"`
	Protect  bool        `json:"pr,omitempty"`
	OOB      float64     `json:"oob,omitempty"`
	AB       bool        `json:"ab,omitempty"`
	Respawn  int         `json:"rs,omitempty"`  // ticks until respawn while dead
	Gear     bool        `json:"gr,omitempty"`  // landing gear down
	Ground   bool        `json:"gd,omitempty"`  // on the wheels
	Rearm    float64     `json:"rr,omitempty"`  // rearm progress 0..1
	Bombs    int         `json:"bm,omitempty"`  // bombs left (base attack)
	W        *[3]float64 `json:"w,omitempty"`   // body angular rate (rad/s) for prediction (FB-A); omitted at rest
	ABHeat   float64     `json:"abh,omitempty"` // afterburner heat 0..1
	ABLock   bool        `json:"abl,omitempty"` // afterburner locked out until abh <= 0.3
	Loadout  uint8       `json:"lo,omitempty"`  // sortie loadout: 0 IR (omitted), 1 radar, 2 mixed
	Radars   int         `json:"rm,omitempty"`  // radar missiles left (ms counts the IR ones)
	LockKind uint8       `json:"lkk,omitempty"` // kind the lock is for: 0 IR (omitted), 1 radar
}

// FlareJSON is a burning flare: id and position (10 cm); the client
// interpolates it between snapshots like every other object.
type FlareJSON struct {
	ID  sim.ID     `json:"id"`
	Pos [3]float64 `json:"p"`
}

type BombJSON struct {
	ID  sim.ID     `json:"id"`
	Pos [3]float64 `json:"p"`
	Vel [3]float64 `json:"v"`
}

// StructHPJSON is a base attack target's HP rounded to 0.1: a live target
// below 0.05 also reads 0, so destruction is the sdown event, not hp == 0.
type StructHPJSON struct {
	ID sim.ID  `json:"id"`
	HP float64 `json:"hp"`
}

// ObjJSON is each side's remaining target HP (base attack).
type ObjJSON struct {
	NATO   float64 `json:"nato"`
	Soviet float64 `json:"soviet"`
}

type MissileJSON struct {
	ID     sim.ID     `json:"id"`
	Target sim.ID     `json:"tg"`
	Pos    [3]float64 `json:"p"`
	Vel    [3]float64 `json:"v"`
	Kind   uint8      `json:"mk,omitempty"` // 0 IR (omitted), 1 radar
}

type PowerupJSON struct {
	Spot   int    `json:"s"`
	Kind   string `json:"k"` // missiles|repair|shield|turbo
	Active bool   `json:"a"`
}

type RoundMsg struct {
	T         string     `json:"t"`     // "round"
	Phase     string     `json:"phase"` // playing|ended
	TicksLeft int        `json:"left"`
	Winner    string     `json:"winner,omitempty"`
	NATO      int        `json:"nato"`
	Soviet    int        `json:"soviet"`
	Board     []LineJSON `json:"board"`
	WinTeam   string     `json:"wt,omitempty"`  // nato|soviet when a team won
	WinID     sim.ID     `json:"wid,omitempty"` // FFA winner's plane ID
	Obj       *ObjJSON   `json:"obj,omitempty"` // base attack only
}

type LineJSON struct {
	ID     sim.ID `json:"id"`
	Kills  int    `json:"k"`
	Deaths int    `json:"d"`
	Score  int    `json:"s"`
}

type PlayersMsg struct {
	T    string       `json:"t"` // "players"
	List []PlayerJSON `json:"list"`
}

type PlayerJSON struct {
	ID   sim.ID `json:"id"`
	Name string `json:"name"`
	Team string `json:"team"`
	Kind string `json:"kind"`
	Bot  bool   `json:"bot"`
}

// The core message types, under their old names.
type (
	Pong      = netproto.Pong
	ErrorMsg  = netproto.ErrorMsg
	ChatMsg   = netproto.ChatMsg
	NoticeMsg = netproto.NoticeMsg
)

// WithAck is s for one player: its input ack set (the room's per-player copy).
func (s Snap) WithAck(ack uint32) any {
	s.Ack = ack
	return s
}

// NewSnap builds the shared snapshot; ev are the events accumulated since
// the previous one. Positions/velocities are rounded to 1 cm, rotations to
// 1e-4, to keep the JSON small.
func NewSnap(s sim.Snapshot, ev []EventJSON, tick int) Snap {
	out := Snap{
		T: "snap", Tick: tick, WT: s.Tick,
		Planes:   make([]PlaneJSON, 0, len(s.Planes)),
		Missiles: make([]MissileJSON, 0, len(s.Missiles)),
		Powerups: make([]PowerupJSON, 0, len(s.Powerups)),
		Events:   ev,
	}
	if out.Events == nil {
		out.Events = []EventJSON{}
	}
	for _, p := range s.Planes {
		out.Planes = append(out.Planes, newPlane(p, s.Tick))
	}
	for _, m := range s.Missiles {
		out.Missiles = append(out.Missiles, MissileJSON{ID: m.ID, Target: m.Target, Pos: r3(m.Pos, 100), Vel: r3(m.Vel, 100), Kind: uint8(m.Kind)})
	}
	for _, u := range s.Powerups {
		out.Powerups = append(out.Powerups, PowerupJSON{Spot: u.Spot, Kind: itemName(u.Kind), Active: u.Active})
	}
	for _, b := range s.Bombs {
		out.Bombs = append(out.Bombs, BombJSON{ID: b.ID, Pos: r3(b.Pos, 100), Vel: r3(b.Vel, 100)})
	}
	for _, f := range s.Flares {
		out.Flares = append(out.Flares, FlareJSON{ID: f.ID, Pos: r3(f.Pos, 10)})
	}
	for _, st := range s.Structures {
		out.Structs = append(out.Structs, StructHPJSON{ID: st.ID, HP: round(st.HP, 10)})
	}
	return out
}

// newPlane converts one plane; tick is the world tick its timers refer to.
func newPlane(p sim.Plane, tick int) PlaneJSON {
	j := PlaneJSON{
		ID: p.ID, Kind: p.Kind.String(), Team: TeamName(p.Team),
		Pos: r3(p.Pos, 100), Vel: r3(p.Vel, 100),
		Rot: [4]float64{round(p.Rot.W, 1e4), round(p.Rot.X, 1e4), round(p.Rot.Y, 1e4), round(p.Rot.Z, 1e4)},
		Th:  round(p.Throttle, 100), HP: round(p.HP, 100), Alive: p.Alive,
		Heat: round(p.Heat, 100), Overheat: tick < p.OverheatUntil,
		Missiles: p.Missiles, Flares: p.Flares,
		Lock: p.LockTarget, Locked: p.Locked,
		LockP: round(min(1, p.LockTime/p.LockKind.LockSeconds()), 100), LockKind: uint8(p.LockKind),
		Loadout: uint8(p.Loadout), Radars: p.Radars,
		Turbo: tick < p.TurboUntil, Protect: tick < p.ProtectUntil,
		OOB:  round(p.OutOfBounds, 100),
		Gear: p.Gear, Ground: p.Ground, Bombs: p.Bombs,
		ABHeat: round(p.ABHeat, 1000), ABLock: p.ABLock,
	}
	if w := r3(p.W, 1000); w != ([3]float64{}) {
		j.W = &w // parked, dead and level planes send no "w":[0,0,0]
	}
	if p.Alive {
		j.AB = p.AB
		j.Rearm = round(float64(p.RearmTicks)/sim.RearmTicks, 100)
	} else {
		j.Respawn = max(0, p.RespawnTick-tick)
	}
	return j
}

func NewRound(r game.Round) RoundMsg {
	phase := "playing"
	if r.Phase == game.Ended {
		phase = "ended"
	}
	board := make([]LineJSON, 0, len(r.Board))
	for _, l := range r.Board {
		board = append(board, LineJSON{ID: l.ID, Kills: l.Kills, Deaths: l.Deaths, Score: l.Score})
	}
	msg := RoundMsg{T: "round", Phase: phase, TicksLeft: r.TicksLeft, Winner: r.Winner, NATO: r.NATO, Soviet: r.Soviet, Board: board,
		WinID: r.WinnerID}
	if r.WinnerTeam != sim.TeamNone {
		msg.WinTeam = TeamName(r.WinnerTeam)
	}
	if r.Base {
		msg.Obj = &ObjJSON{NATO: round(r.ObjNATO, 10), Soviet: round(r.ObjSoviet, 10)}
	}
	return msg
}

func NewPlayers(ps []game.Player) PlayersMsg {
	list := make([]PlayerJSON, 0, len(ps))
	for _, p := range ps {
		list = append(list, PlayerJSON{ID: p.ID, Name: p.Name, Team: TeamName(p.Team), Kind: p.Kind.String(), Bot: p.Bot})
	}
	return PlayersMsg{T: "players", List: list}
}

func TeamName(t sim.Team) string {
	switch t {
	case sim.TeamNATO:
		return "nato"
	case sim.TeamSoviet:
		return "soviet"
	}
	return "none"
}

func round(x, scale float64) float64 { return math.Round(x*scale) / scale }

func r3(v geom.Vec3, scale float64) [3]float64 {
	return [3]float64{round(v.X, scale), round(v.Y, scale), round(v.Z, scale)}
}
