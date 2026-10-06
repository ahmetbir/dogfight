package front

import (
	"playground/core/server"
	"playground/internal/game"
	"playground/internal/match"
	"playground/internal/protocol"
	"playground/internal/sim"
)

// Server is the generic server instantiated for Dogfight.
type Server = server.Server[game.Settings, protocol.ClientMsg, sim.Input, match.Info]

// NewServer is Dogfight's HTTP handler.
func NewServer(l *match.Lobby, o server.Options) *Server { return server.New(l, Kit{}, o) }
