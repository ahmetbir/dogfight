package server

import "playground/internal/protocol"

// errCode is the protocol code of a user-facing error text (socket "error"
// messages and API error bodies); "" for a text without one.
func errCode(msg string) string {
	switch msg {
	case msgVersion:
		return protocol.CodeVersion
	case msgNoRoom:
		return protocol.CodeNoRoom
	case msgBadRoom:
		return protocol.CodeBadRoom
	case msgFull:
		return protocol.CodeFull
	case msgBad:
		return protocol.CodeBad
	case msgNoCreate:
		return protocol.CodeNoCreate
	case msgBusy:
		return protocol.CodeBusy
	case msgCreates:
		return protocol.CodeCreates
	case msgJoins:
		return protocol.CodeJoins
	case msgFlood:
		return protocol.CodeFlood
	case msgConns:
		return protocol.CodeConns
	case msgTimeout:
		return protocol.CodeTimeout
	case msgUpdating:
		return protocol.CodeUpdating
	case msgStatsOff:
		return protocol.CodeStatsOff
	case msgBadPeriod:
		return protocol.CodeBadPeriod
	case msgNoAPI:
		return protocol.CodeNotFound
	case msgRequests:
		return protocol.CodeRate
	}
	return ""
}
