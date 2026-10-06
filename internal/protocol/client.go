// Package protocol defines the JSON wire messages between client and server.
package protocol

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"github.com/ahmetbir/roomkit/netproto"
	"playground/internal/sim"
)

// Version is the wire protocol version a hello must carry; v1 clients get
// a version error (reload the page).
const Version = 2

// MaxClientMsg is the largest client message DecodeClient accepts.
const MaxClientMsg = 1024

// Client message types: the core's, plus Dogfight's pick and team.
const (
	THello  = netproto.THello
	TCreate = netproto.TCreate
	TJoin   = netproto.TJoin
	TQuick  = netproto.TQuick
	TIn     = netproto.TIn
	TPing   = netproto.TPing
	TChat   = netproto.TChat
	TPick   = "pick"
	TTeam   = "team"
)

// ChatMax is the highest quick chat preset ID (presets are 1..ChatMax).
const ChatMax = 6

// ClientMsg is every client→server message; T selects which fields matter.
type ClientMsg struct {
	T     string  `json:"t"`               // hello|create|join|quick|pick|in|ping|chat
	V     int     `json:"v,omitempty"`     // hello
	Name  string  `json:"name,omitempty"`  // hello
	Tok   string  `json:"tok,omitempty"`   // hello: pilot token
	Mode  string  `json:"mode,omitempty"`  // create: team|ffa|base
	Size  int     `json:"size,omitempty"`  // create
	Diff  string  `json:"diff,omitempty"`  // create: easy|normal|hard
	Seed  int64   `json:"seed,omitempty"`  // create (0 = random)
	Map   string  `json:"map,omitempty"`   // create: ada|sehir|col|dag
	Wx    string  `json:"wx,omitempty"`    // create: acik|bulutlu|sisli|yagmurlu|firtina|gece
	Start string  `json:"start,omitempty"` // create: pist|hava
	Vis   string  `json:"vis,omitempty"`   // create: acik|ozel
	Code  string  `json:"code,omitempty"`  // join
	Kind  string  `json:"kind,omitempty"`  // pick
	Lo    string  `json:"lo,omitempty"`    // pick: ir|radar|mixed (missing keeps the current loadout)
	Team  string  `json:"team,omitempty"`  // team: nato|soviet|auto
	Seq   uint32  `json:"seq,omitempty"`   // in; starts at 1
	P     float64 `json:"p,omitempty"`
	R     float64 `json:"r,omitempty"`
	Y     float64 `json:"y,omitempty"`
	Th    float64 `json:"th,omitempty"`
	AB    bool    `json:"ab,omitempty"`
	F     bool    `json:"f,omitempty"`
	M     bool    `json:"m,omitempty"`
	FL    bool    `json:"fl,omitempty"`
	G     bool    `json:"g,omitempty"`  // in: gear down wanted
	BR    bool    `json:"br,omitempty"` // in: wheel brakes held
	BO    bool    `json:"bo,omitempty"` // in: drop a bomb (one-shot)
	TS    float64 `json:"ts,omitempty"` // ping
	Chat  int     `json:"id,omitempty"` // chat: preset 1..ChatMax
}

var (
	ErrTooBig      = errors.New("protocol: message too big")
	ErrUnknownType = errors.New("protocol: unknown message type")
	ErrBadTeam     = errors.New("protocol: unknown team")
	ErrBadLoadout  = errors.New("protocol: unknown loadout")
)

// DecodeClient parses one client message. It rejects oversized messages,
// unknown types, non-finite numbers, chat IDs outside 1..ChatMax, team
// choices other than nato|soviet|auto and pick loadouts other than
// ir|radar|mixed (or none).
func DecodeClient(b []byte) (ClientMsg, error) {
	var m ClientMsg
	if len(b) > MaxClientMsg {
		return m, ErrTooBig
	}
	if err := json.Unmarshal(b, &m); err != nil {
		return ClientMsg{}, fmt.Errorf("protocol: %w", err)
	}
	switch m.T {
	case THello, TCreate, TJoin, TQuick, TPick, TIn, TPing, TChat, TTeam:
	default:
		return ClientMsg{}, ErrUnknownType
	}
	if _, ok := ParseTeam(m.Team); m.T == TTeam && !ok {
		return ClientMsg{}, ErrBadTeam
	}
	if _, ok := sim.ParseLoadout(m.Lo); m.T == TPick && m.Lo != "" && !ok {
		return ClientMsg{}, ErrBadLoadout
	}
	if err := netproto.CheckHeader(m.Head(), ChatMax); err != nil {
		return ClientMsg{}, err
	}
	for _, v := range [...]float64{m.P, m.R, m.Y, m.Th} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return ClientMsg{}, netproto.ErrNotFinite
		}
	}
	return m, nil
}

// ParseTeam maps a team choice to a team; "auto" is TeamNone (the server
// balances).
func ParseTeam(s string) (sim.Team, bool) {
	switch s {
	case "nato":
		return sim.TeamNATO, true
	case "soviet":
		return sim.TeamSoviet, true
	case "auto":
		return sim.TeamNone, true
	}
	return sim.TeamNone, false
}

// Input converts an "in" message to a clamped sim input.
func (m ClientMsg) Input() sim.Input {
	return sim.Input{
		Pitch: m.P, Roll: m.R, Yaw: m.Y, Throttle: m.Th,
		AB: m.AB, Fire: m.F, Missile: m.M, Flare: m.FL,
		Gear: m.G, Brake: m.BR, Bomb: m.BO,
	}.Clamp()
}

// Head is the part of m the core reads.
func (m ClientMsg) Head() netproto.Header {
	return netproto.Header{T: m.T, V: m.V, Name: m.Name, Tok: m.Tok, Code: m.Code, Seq: m.Seq, TS: m.TS, Chat: m.Chat}
}

// Latch returns m with the one-shot presses (missile, flare, bomb) of an
// input dropped over its rate.
func (m ClientMsg) Latch(dropped ClientMsg) ClientMsg {
	m.M, m.FL, m.BO = m.M || dropped.M, m.FL || dropped.FL, m.BO || dropped.BO
	return m
}
