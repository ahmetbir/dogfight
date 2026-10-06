package room

import (
	"errors"

	"playground/internal/game"
	"playground/internal/protocol"
	"playground/internal/sim"
)

// User-facing texts of a refused team choice.
const (
	msgTeamUneven   = "Takımlar dengesiz olur"
	msgTeamFull     = "Takım dolu"
	msgTeamCooldown = "Takım değiştirmek için 30 sn bekle"
	msgTeamLate     = "Raundun son dakikasında değiştirilemez"
	msgTeamLocked   = "Kilitliyken takım değiştiremezsin"
	msgTeamHurt     = "Hasar aldıktan sonra 10 sn bekle"
	msgTeamNone     = "Bu modda takım yok"
)

// team applies a player's team choice ("nato", "soviet" or "auto"); a
// refusal comes back as a notice to that player only.
func (r *Room) team(id sim.ID, choice string) {
	s, ok := r.sessions[id]
	want, valid := protocol.ParseTeam(choice)
	if !ok || !valid {
		return
	}
	if err := r.game.ChooseTeam(id, want); err != nil {
		if code, msg := teamMsg(err); msg != "" {
			s.out.Send(protocol.NewNotice(code, msg))
		}
		return
	}
	r.publish() // the lobby lists humans per team
}

// teamMsg is the notice code and Turkish text of a refused team choice ("" when err is none of them).
func teamMsg(err error) (code, msg string) {
	switch {
	case errors.Is(err, game.ErrUneven):
		return protocol.CodeTeamUneven, msgTeamUneven
	case errors.Is(err, game.ErrTeamFull):
		return protocol.CodeTeamFull, msgTeamFull
	case errors.Is(err, game.ErrCooldown):
		return protocol.CodeTeamCooldown, msgTeamCooldown
	case errors.Is(err, game.ErrLate):
		return protocol.CodeTeamLate, msgTeamLate
	case errors.Is(err, game.ErrLocked):
		return protocol.CodeTeamLocked, msgTeamLocked
	case errors.Is(err, game.ErrHurt):
		return protocol.CodeTeamHurt, msgTeamHurt
	case errors.Is(err, game.ErrNoTeams):
		return protocol.CodeTeamNone, msgTeamNone
	}
	return "", ""
}
