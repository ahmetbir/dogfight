package room

import (
	"playground/core/netproto"
	"playground/internal/mode"
	"playground/internal/protocol"
	"playground/internal/sim"
)

// ChatCooldown is the ticks between two relayed chats of one player.
const ChatCooldown = 2 * TickRate

// chat relays preset id from a player: to its team in team and base modes,
// to everyone in FFA. Chats inside the cooldown are dropped silently.
func (r *Room) chat(from sim.ID, id int) {
	s, ok := r.sessions[from]
	tick := r.game.Tick()
	if !ok || id < 1 || id > protocol.ChatMax || (s.chatAt != 0 && tick-s.chatAt < ChatCooldown) {
		return
	}
	s.chatAt = max(1, tick)
	teams := r.teams()
	team, ffa := teams[from], r.game.Settings().Mode == mode.FFA
	msg := netproto.NewChat(netproto.PlayerID(from), id)
	for sid, o := range r.sessions {
		// scope by the room's mode, not the sender's team: a sender missing
		// from the seat list (TeamNone) must not reach both teams
		if ffa || (team != sim.TeamNone && teams[sid] == team) {
			o.out.Send(msg)
		}
	}
}

// teams maps every seated player to its team (TeamNone in FFA).
func (r *Room) teams() map[sim.ID]sim.Team {
	ps := r.game.Players()
	out := make(map[sim.ID]sim.Team, len(ps))
	for _, p := range ps {
		out[p.ID] = p.Team
	}
	return out
}
