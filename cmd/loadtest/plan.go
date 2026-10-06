package main

import (
	"math"

	"playground/internal/protocol"
)

// Input pacing at the 60 Hz send rate.
const (
	inputHz      = 60  // the client's input rate (and the room's tick rate)
	fireCycle    = 300 // 5 s: cannon held for the first fireHeld ticks
	fireHeld     = 72  // 1.2 s bursts
	missileCycle = 480 // one missile every 8 s
	flareCycle   = 660 // one flare every 11 s
	abCycle      = 900 // afterburner 3 s out of every 15 s
	abHeld       = 180
)

// stick is player i's input for seq (1, 2, ... at 60 Hz): smooth,
// de-phased sinusoids on every axis, a slight climb bias so planes do not
// all fly into the ground, short cannon bursts and one-shot missiles and
// flares, each player offset so the room does not fire in lockstep.
func stick(i int, seq uint32) protocol.ClientMsg {
	t := float64(seq) / 60
	ph := float64(i) * 1.618
	off := uint32(i * 37)
	s := seq + off
	return protocol.ClientMsg{
		T: protocol.TIn, Seq: seq,
		P:  r3(0.15 + 0.35*math.Sin(0.6*t+ph)),
		R:  r3(0.7 * math.Sin(0.4*t+2*ph)),
		Y:  r3(0.2 * math.Sin(1.1*t+3*ph)),
		Th: r3(0.85 + 0.15*math.Sin(0.2*t+ph)),
		AB: s%abCycle < abHeld,
		F:  s%fireCycle < fireHeld,
		M:  s%missileCycle == 0,
		FL: s%flareCycle == 0,
	}
}

func r3(x float64) float64 { return math.Round(x*1000) / 1000 }

// pickKind is the aircraft player i flies for its team: the two types of
// each side alternate. An unknown team gets the NATO pair.
func pickKind(team string, i int) string {
	pair := [2]string{"f16", "f15"}
	if team == "soviet" {
		pair = [2]string{"mig29", "su27"}
	}
	return pair[i%2]
}
