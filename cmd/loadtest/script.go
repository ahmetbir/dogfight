package main

import (
	"encoding/json"
	"fmt"
	"sync/atomic"

	"playground/internal/protocol"
)

// dogfight is the load test's Dogfight player: hello, the create message
// from the flags, the scripted stick, one aircraft pick once the roster
// names the player's team, and, as the host of a created room waiting in
// its lobby, the start (again with every lobby round message, since a
// reply may be dropped). Each player calls React from its own goroutine, so
// picked and host need no lock.
type dogfight struct {
	create protocol.ClientMsg
	picked []atomic.Bool // per player: the pick was sent
	host   []atomic.Bool // per player: hosts a room waiting in its lobby
}

func (d dogfight) Hello(i int) any {
	return protocol.ClientMsg{T: protocol.THello, V: protocol.Version, Name: fmt.Sprintf("lt%d", i)}
}
func (d dogfight) Create() any                 { return d.create }
func (d dogfight) Input(i int, seq uint32) any { return stick(i, seq) }

func (d dogfight) React(i, you int, t string, raw []byte) any {
	switch t {
	case "players":
		return d.pick(i, you, raw)
	case "lobby", "round":
		return d.start(i, you, t, raw)
	}
	return nil
}

func (d dogfight) pick(i, you int, raw []byte) any {
	var m struct {
		List []struct {
			ID   int    `json:"id"`
			Team string `json:"team"`
		} `json:"list"`
	}
	if json.Unmarshal(raw, &m) != nil {
		return nil
	}
	for _, e := range m.List {
		if e.ID == you && d.picked[i].CompareAndSwap(false, true) {
			return protocol.ClientMsg{T: protocol.TPick, Kind: pickKind(e.Team, i)}
		}
	}
	return nil
}

// start: the host of a room in its lobby asks to start on every lobby or
// lobby-phase round message until the round runs.
func (d dogfight) start(i, you int, t string, raw []byte) any {
	var m struct {
		Phase string `json:"phase"`
		Host  int    `json:"host"`
	}
	if json.Unmarshal(raw, &m) != nil || i >= len(d.host) {
		return nil
	}
	if t == "lobby" {
		d.host[i].Store(m.Phase == "lobby" && m.Host == you)
	}
	if m.Phase == "lobby" && d.host[i].Load() {
		return protocol.ClientMsg{T: protocol.TStart}
	}
	return nil
}
