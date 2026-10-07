// Package front is Dogfight's server.Kit: decoding, create and quick-play
// settings, the in-room message whitelist, /api/rooms rows, and the pilot
// stats API over stats.Slot.
package front

import (
	"time"

	"github.com/ahmetbir/roomkit/room"
	"github.com/ahmetbir/roomkit/server"
	"playground/internal/game"
	"playground/internal/match"
	"playground/internal/protocol"
	"playground/internal/sim"
)

type Kit struct{}

var _ server.Kit[game.Settings, protocol.ClientMsg, match.Info] = Kit{}

func (Kit) Version() int                                { return protocol.Version }
func (Kit) Decode(b []byte) (protocol.ClientMsg, error) { return protocol.DecodeClient(b) }
func (Kit) Settings(m protocol.ClientMsg, now time.Time) (game.Settings, bool) {
	return settings(m, now)
}
func (Kit) QuickSettings(now time.Time) game.Settings { return quickSettings(now) }

// Class: a team choice opens the pick screen, so pick and team share the
// choice bucket; the lobby's side and start are choices too.
func (Kit) Class(t string) server.Class {
	switch t {
	case protocol.TPick, protocol.TTeam, protocol.TSide, protocol.TStart:
		return server.ClassChoice
	}
	return server.ClassAll
}

// InRoom: team and side (DecodeClient whitelisted their value), start, and
// pick of a known kind.
func (Kit) InRoom(m protocol.ClientMsg) bool {
	switch m.T {
	case protocol.TTeam, protocol.TSide, protocol.TStart:
		return true
	case protocol.TPick:
		_, ok := sim.ParseKind(m.Kind)
		return ok
	}
	return false
}

type roomJSON struct {
	Code   string  `json:"code"`
	Mode   string  `json:"mode"`
	Map    string  `json:"map"`
	Wx     string  `json:"wx"`
	Humans int     `json:"humans"`
	Seats  int     `json:"seats"`
	Phase  string  `json:"phase"`           // playing|ended|lobby
	Left   int     `json:"left"`            // seconds left in the round
	Teams  *[2]int `json:"teams,omitempty"` // humans on NATO, Soviet (team and base modes)
}

func (Kit) Row(x room.Summary[match.Info]) any {
	g := x.Game
	row := roomJSON{x.Code, g.Mode, g.Map, g.Weather, x.Humans, g.Seats, g.Phase, g.LeftS, nil} // g.Seats: Summary.Seats hides a lobby room from quick play
	if g.Mode != "ffa" {
		row.Teams = &[2]int{g.NATO, g.Soviet}
	}
	return row
}
