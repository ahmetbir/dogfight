package server

import (
	"time"

	"playground/core/room"
)

// Msg is a decoded client message as the server sees it.
type Msg[M, In any] interface {
	room.Msg[In]
	Latch(dropped M) M // m plus the one-shot presses of an input dropped over its rate
}

// Class is the rate class of a game message type (core types have their own).
type Class uint8

const (
	ClassAll    Class = iota // only the connection's shared bucket
	ClassChoice              // the small choice bucket (pick-like; refusal kicks), then the shared one
)

// Kit is what a game plugs into the server. Its methods run on connection
// and HTTP goroutines: they must not touch shared state.
type Kit[S, M, X any] interface {
	Version() int                               // protocol version a hello must carry
	Decode(b []byte) (M, error)                 // one whole frame; the core reads Head()
	Settings(create M, now time.Time) (S, bool) // room settings of a create message; false = bad_room
	QuickSettings(now time.Time) S              // the room quick play makes when none is free
	Class(t string) Class                       // rate class of a game message type
	InRoom(m M) bool                            // a game message allowed after the handshake
	Row(s room.Summary[X]) any                  // one /api/rooms row
}

// Stats serves the pilot API; nil = stats off (503). Safe for concurrent use.
type Stats interface {
	Ready() bool
	Periods() []string                  // allowed ?period= values
	Board(period string) []byte         // leaderboard body for an allowed period; nil = store closed
	Me(pilotHash string) ([]byte, bool) // the caller's body; false = unknown pilot
}
