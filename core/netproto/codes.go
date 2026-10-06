package netproto

import "fmt"

// Stable codes of the user-facing failures every game shares. The client
// shows its own text for a code; Msg stays the server's text for old clients.
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

// APICodes are the codes of HTTP API error bodies.
func APICodes() []string { return []string{CodeStatsOff, CodeBadPeriod, CodeNotFound, CodeRate} }

// Codes is one game's code registry: the core's error and API codes plus
// the game's notice codes.
type Codes struct{ Errors, Notices, API []string }

// NewCodes registers a game's notice codes; empty, duplicate or core codes
// are refused.
func NewCodes(notices ...string) (Codes, error) {
	seen := map[string]bool{}
	for _, c := range append(ErrorCodes(), APICodes()...) {
		seen[c] = true
	}
	for _, c := range notices {
		if c == "" || seen[c] {
			return Codes{}, fmt.Errorf("netproto: notice code %q is empty or taken", c)
		}
		seen[c] = true
	}
	return Codes{Errors: ErrorCodes(), Notices: notices, API: APICodes()}, nil
}
