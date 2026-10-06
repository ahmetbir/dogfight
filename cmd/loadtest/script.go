package main

import (
	"encoding/json"
	"fmt"
	"sync/atomic"

	"playground/internal/protocol"
)

// dogfight is the load test's Dogfight player: hello, the create message
// from the flags, the scripted stick, and one aircraft pick once the
// roster names the player's team. Each player calls React from its own
// goroutine, so picked needs no lock.
type dogfight struct {
	create protocol.ClientMsg
	picked []atomic.Bool // per player: the pick was sent
}

func (d dogfight) Hello(i int) any {
	return protocol.ClientMsg{T: protocol.THello, V: protocol.Version, Name: fmt.Sprintf("lt%d", i)}
}
func (d dogfight) Create() any                 { return d.create }
func (d dogfight) Input(i int, seq uint32) any { return stick(i, seq) }

func (d dogfight) React(i, you int, t string, raw []byte) any {
	if t != "players" {
		return nil
	}
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
