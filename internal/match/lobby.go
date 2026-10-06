package match

import (
	"context"

	"playground/core/lobby"
	"playground/core/metrics"
	"playground/core/room"
	"playground/internal/game"
	"playground/internal/protocol"
	"playground/internal/sim"
)

// Lobby is the generic lobby instantiated for Dogfight.
type Lobby = lobby.Lobby[game.Settings, protocol.ClientMsg, sim.Input, Info]

// NewLobby is Dogfight's lobby: rooms build a Match recording into sink
// (nil = not counted) and relay the protocol's chat presets.
func NewLobby(ctx context.Context, maxRooms int, reg *metrics.Registry, sink StatsSink) *Lobby {
	return lobby.New(ctx, lobby.Options[game.Settings, protocol.ClientMsg, sim.Input, Info]{
		MaxRooms: maxRooms, Metrics: reg,
		Room: roomOptions(),
		New:  Factory(sink),
	})
}

// roomOptions are the per-room options Dogfight sets: the protocol's chat
// preset count (explicit, so a drift from the room default cannot hide).
func roomOptions() room.Options { return room.Options{ChatMax: protocol.ChatMax} }
