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
	// "notice" messages (a refused lobby request).
	CodeNotHost  = "not_host"  // start: only the host starts
	CodeNotLobby = "not_lobby" // side, start: the round is already running
	CodeSideFull = "side_full" // side: every seat of that side holds a human
	// The server drains: a room waiting in its lobby closes (to everyone).
	CodeLobbyClosed = "lobby_closed"
)

// CodeNameBlocked is the code of a join refused because the pilot's name
// matches the server's blocked-name list: an error frame before the player
// is seated (room.Refuse), not a notice. The client asks for another name
// (client/src/net/codes.ts NAME_BLOCKED).
const CodeNameBlocked = "name_blocked"

// NoticeCodes are the codes a "notice" message may carry, in the client's order.
func NoticeCodes() []string {
	return []string{CodeTeamUneven, CodeTeamFull, CodeTeamCooldown, CodeTeamLate, CodeTeamLocked, CodeTeamHurt, CodeTeamNone,
		CodeNotHost, CodeNotLobby, CodeSideFull, CodeLobbyClosed}
}
