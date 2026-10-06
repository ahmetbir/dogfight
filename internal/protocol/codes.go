package protocol

// Stable codes of the user-facing failures. The client shows its own text
// for a code (client/src/net/codes.ts lists the same codes; Msg stays the
// server's Turkish text for older clients).
const (
	// "error" messages (the connection ends).
	CodeVersion  = "version"
	CodeNoRoom   = "no_room"
	CodeBadRoom  = "bad_room"
	CodeFull     = "full"
	CodeBad      = "bad_msg"
	CodeNoCreate = "no_create"
	CodeBusy     = "busy"
	CodeCreates  = "creates"
	CodeJoins    = "joins"
	CodeFlood    = "flood"
	CodeConns    = "conns"
	CodeTimeout  = "timeout"
	CodeUpdating = "updating"

	// "notice" messages (a refused team choice).
	CodeTeamUneven   = "team_uneven"
	CodeTeamFull     = "team_full"
	CodeTeamCooldown = "team_cooldown"
	CodeTeamLate     = "team_late"
	CodeTeamLocked   = "team_locked"
	CodeTeamHurt     = "team_hurt"
	CodeTeamNone     = "team_none"

	// HTTP API errors ({"error", "code"}).
	CodeStatsOff  = "stats_off"
	CodeBadPeriod = "bad_period"
	CodeNotFound  = "not_found"
	CodeRate      = "rate"
)

// ErrorCodes are the codes an "error" message may carry, in the client's order.
func ErrorCodes() []string {
	return []string{CodeVersion, CodeNoRoom, CodeBadRoom, CodeFull, CodeBad, CodeNoCreate, CodeBusy, CodeCreates, CodeJoins,
		CodeFlood, CodeConns, CodeTimeout, CodeUpdating}
}

// NoticeCodes are the codes a "notice" message may carry, in the client's order.
func NoticeCodes() []string {
	return []string{CodeTeamUneven, CodeTeamFull, CodeTeamCooldown, CodeTeamLate, CodeTeamLocked, CodeTeamHurt, CodeTeamNone}
}
