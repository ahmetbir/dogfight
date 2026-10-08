package front

import (
	"github.com/ahmetbir/roomkit/server"
	"playground/internal/game"
	"playground/internal/match"
	"playground/internal/protocol"
	"playground/internal/sim"
)

// Server is the generic server instantiated for Dogfight.
type Server = server.Server[game.Settings, protocol.ClientMsg, sim.Input, match.Info]

// NewServer is Dogfight's HTTP handler; mod's names are refused at the
// handshake (Kit.Admit) before any room is touched.
func NewServer(l *match.Lobby, o server.Options, mod match.Moderation) *Server {
	return server.New(l, Kit{mod: mod}, o)
}
