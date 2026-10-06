package match

import (
	"playground/core/room"
	"playground/internal/protocol"
	"playground/internal/sim"
)

// The generic core types instantiated for Dogfight.
type (
	Room    = room.Room[protocol.ClientMsg, sim.Input, Info]
	Seat    = room.Seat[protocol.ClientMsg]
	Summary = room.Summary[Info]
)
