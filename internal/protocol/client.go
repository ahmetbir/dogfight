// Package protocol defines the JSON wire messages between client and server.
package protocol

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"unicode"
	"unicode/utf8"

	"playground/internal/sim"
)

// Version is the wire protocol version a hello must carry; v1 clients get
// a version error (reload the page).
const Version = 2

// MaxClientMsg is the largest client message DecodeClient accepts.
const MaxClientMsg = 1024

// Client message types.
const (
	THello  = "hello"
	TCreate = "create"
	TJoin   = "join"
	TPick   = "pick"
	TIn     = "in"
	TPing   = "ping"
	TQuick  = "quick"
	TChat   = "chat"
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
	ErrNotFinite   = errors.New("protocol: non-finite number")
	ErrBadChat     = errors.New("protocol: chat id out of range")
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
	if m.T == TChat && (m.Chat < 1 || m.Chat > ChatMax) {
		return ClientMsg{}, ErrBadChat
	}
	for _, v := range [...]float64{m.P, m.R, m.Y, m.Th, m.TS} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return ClientMsg{}, ErrNotFinite
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

const (
	maxNameRunes = 16
	defaultName  = "Pilot"
)

// CleanName trims a player name, drops invisible, control, zero-width,
// bidi-override and blank filler runes, keeps at most 2 combining marks per
// letter (no "zalgo" towers over the name tags), and caps it at 16 runes;
// empty becomes "Pilot".
func CleanName(s string) string {
	var b strings.Builder
	n, marks := 0, 0
	for _, r := range strings.TrimSpace(s) {
		if n == maxNameRunes {
			break
		}
		if r == utf8.RuneError || !unicode.IsGraphic(r) || hiddenRune(r) {
			continue
		}
		if unicode.In(r, unicode.Mn, unicode.Me) {
			if marks == maxMarks {
				continue
			}
			marks++
		} else {
			marks = 0
		}
		b.WriteRune(r)
		n++
	}
	if out := strings.TrimSpace(b.String()); out != "" {
		return out
	}
	return defaultName
}

const maxMarks = 2

func hiddenRune(r rune) bool {
	switch r {
	case 0x115F, 0x1160, 0x3164, 0xFFA0, 0x2800: // Hangul fillers, Braille blank
		return true
	}
	return (r >= 0x200B && r <= 0x200F) || (r >= 0x202A && r <= 0x202E) || (r >= 0x2066 && r <= 0x2069)
}
