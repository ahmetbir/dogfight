package match

import (
	"errors"
	"fmt"

	"playground/core/netproto"
	"playground/core/room"
	"playground/internal/game"
	"playground/internal/protocol"
	"playground/internal/sim"
)

// User-facing texts of a refused team choice; the timed ones take their
// seconds from the game's constants (msgSecs).
const (
	msgTeamUneven   = "Takımlar dengesiz olur"
	msgTeamFull     = "Takım dolu"
	msgTeamCooldown = "Takım değiştirmek için %d sn bekle"
	msgTeamLate     = "Raundun son %d saniyesinde takım değiştirilemez"
	msgTeamLocked   = "Kilitliyken takım değiştiremezsin"
	msgTeamHurt     = "Hasar aldıktan sonra %d sn bekle"
	msgTeamNone     = "Bu modda takım yok"
)

// msgSecs fills a timed notice with a tick count in whole seconds.
func msgSecs(format string, ticks int) string { return fmt.Sprintf(format, ticks/tickRate) }

// team applies a player's team choice ("nato", "soviet" or "auto"); a
// refusal comes back as a notice to that player only.
func (m *Match) team(id room.PlayerID, choice string, out room.Outbox) {
	want, valid := protocol.ParseTeam(choice)
	if !valid {
		return
	}
	if err := m.g.ChooseTeam(sim.ID(id), want); err != nil {
		if code, msg := teamMsg(err); msg != "" {
			out.To(id, netproto.NewNotice(code, msg))
		}
		return
	}
	out.Changed() // the lobby lists humans per team
}

// teamMsg is the notice code and Turkish text of a refused team choice ("" when err is none of them).
func teamMsg(err error) (code, msg string) {
	switch {
	case errors.Is(err, game.ErrUneven):
		return protocol.CodeTeamUneven, msgTeamUneven
	case errors.Is(err, game.ErrTeamFull):
		return protocol.CodeTeamFull, msgTeamFull
	case errors.Is(err, game.ErrCooldown):
		return protocol.CodeTeamCooldown, msgSecs(msgTeamCooldown, game.SwitchCooldownTicks)
	case errors.Is(err, game.ErrLate):
		return protocol.CodeTeamLate, msgSecs(msgTeamLate, game.SwitchCloseTicks)
	case errors.Is(err, game.ErrLocked):
		return protocol.CodeTeamLocked, msgTeamLocked
	case errors.Is(err, game.ErrHurt):
		return protocol.CodeTeamHurt, msgSecs(msgTeamHurt, game.HurtTicks)
	case errors.Is(err, game.ErrNoTeams):
		return protocol.CodeTeamNone, msgTeamNone
	}
	return "", ""
}
