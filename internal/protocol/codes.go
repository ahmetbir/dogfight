package protocol

// Dogfight's stable notice codes. The client shows its own text for a code
// (client/src/net/codes.ts lists the same codes; Msg stays the server's
// Turkish text for older clients). The error and API codes every game shares
// are core/netproto's.
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

// NoticeCodes are the codes a "notice" message may carry, in the client's order.
func NoticeCodes() []string {
	return []string{CodeTeamUneven, CodeTeamFull, CodeTeamCooldown, CodeTeamLate, CodeTeamLocked, CodeTeamHurt, CodeTeamNone}
}
