package protocol

import "playground/core/netproto"

// Stable codes of the user-facing failures. The client shows its own text
// for a code (client/src/net/codes.ts lists the same codes; Msg stays the
// server's Turkish text for older clients).
const (
	// "notice" messages (a refused team choice).
	CodeTeamUneven   = "team_uneven"
	CodeTeamFull     = "team_full"
	CodeTeamCooldown = "team_cooldown"
	CodeTeamLate     = "team_late"
	CodeTeamLocked   = "team_locked"
	CodeTeamHurt     = "team_hurt"
	CodeTeamNone     = "team_none"
)

// Core codes, shared with every game (netproto owns them).
const (
	CodeVersion   = netproto.CodeVersion
	CodeNoRoom    = netproto.CodeNoRoom
	CodeBadRoom   = netproto.CodeBadRoom
	CodeFull      = netproto.CodeFull
	CodeBad       = netproto.CodeBad
	CodeNoCreate  = netproto.CodeNoCreate
	CodeBusy      = netproto.CodeBusy
	CodeCreates   = netproto.CodeCreates
	CodeJoins     = netproto.CodeJoins
	CodeFlood     = netproto.CodeFlood
	CodeConns     = netproto.CodeConns
	CodeTimeout   = netproto.CodeTimeout
	CodeUpdating  = netproto.CodeUpdating
	CodeStatsOff  = netproto.CodeStatsOff
	CodeBadPeriod = netproto.CodeBadPeriod
	CodeNotFound  = netproto.CodeNotFound
	CodeRate      = netproto.CodeRate
)

// ErrorCodes are the codes an "error" message may carry, in the client's order.
func ErrorCodes() []string { return netproto.ErrorCodes() }

// NoticeCodes are the codes a "notice" message may carry, in the client's order.
func NoticeCodes() []string {
	return []string{CodeTeamUneven, CodeTeamFull, CodeTeamCooldown, CodeTeamLate, CodeTeamLocked, CodeTeamHurt, CodeTeamNone}
}
