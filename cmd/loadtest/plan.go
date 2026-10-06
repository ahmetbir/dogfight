package main

import (
	"bytes"
	"errors"
	"fmt"
	"math"
	"net/url"
	"time"

	"playground/internal/protocol"
)

// slot is one simulated player's place in the run: its room (-1 = quick
// play) and whether it creates that room.
type slot struct {
	room    int
	creator bool
}

// assign spreads players over rooms round-robin, so a linear ramp fills
// every room evenly; the first player of each room creates it. rooms == 0
// sends every player through quick play.
func assign(players, rooms int) []slot {
	out := make([]slot, players)
	for i := range out {
		if rooms <= 0 {
			out[i] = slot{room: -1}
			continue
		}
		out[i] = slot{room: i % rooms, creator: i < rooms}
	}
	return out
}

// humansPerRoom is the most humans any one room gets from assign.
func humansPerRoom(players, rooms int) int {
	if rooms <= 0 || players <= 0 {
		return 0
	}
	return (players + rooms - 1) / rooms
}

// startAt is player i's connect time after the run starts: players start
// evenly over ramp (all at once with ramp 0).
func startAt(i, n int, ramp time.Duration) time.Duration {
	if n <= 1 || ramp <= 0 {
		return 0
	}
	return time.Duration(int64(ramp) * int64(i) / int64(n))
}

// wsURL checks a target URL: ws:// or wss:// with a host; an empty path
// becomes the game socket path /ws.
func wsURL(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	if u.Scheme != "ws" && u.Scheme != "wss" {
		return "", fmt.Errorf("scheme must be ws or wss, got %q", u.Scheme)
	}
	if u.Host == "" {
		return "", errors.New("missing host")
	}
	if u.Path == "" || u.Path == "/" {
		u.Path = "/ws"
	}
	return u.String(), nil
}

// Input pacing at the 60 Hz send rate.
const (
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

// snapPrefix is how every snapshot starts (protocol.Snap's field order).
const snapPrefix = `{"t":"snap","tick":`

// snapTick reads a snapshot's tick from its prefix without decoding the
// rest; ok is false for anything else (decode it in full).
func snapTick(b []byte) (tick int, ok bool) {
	if !bytes.HasPrefix(b, []byte(snapPrefix)) {
		return 0, false
	}
	digits := 0
	for _, c := range b[len(snapPrefix):] {
		if c < '0' || c > '9' {
			break
		}
		tick = tick*10 + int(c-'0')
		digits++
	}
	return tick, digits > 0 && digits < 19
}
