package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/coder/websocket"

	"playground/internal/protocol"
)

const (
	dialTimeout = 10 * time.Second // dial + hello + create/join + welcome
	readLimit   = 8 << 20          // the welcome carries the ~45 KB heightmap
	pingEvery   = 60               // input ticks between pings (1 s)
)

// roomCode hands the creator's room code to the room's joiners.
type roomCode struct {
	once  sync.Once
	ready chan struct{}
	code  string
}

func newRoomCode() *roomCode { return &roomCode{ready: make(chan struct{})} }

func (c *roomCode) set(code string) {
	c.once.Do(func() { c.code = code; close(c.ready) })
}

func (c *roomCode) wait(ctx context.Context) (string, bool) {
	select {
	case <-c.ready:
		return c.code, true
	case <-ctx.Done():
		return "", false
	}
}

// inbound is the part of any server message the load test reads; the rest
// of a snapshot is scanned but not kept.
type inbound struct {
	T    string  `json:"t"`
	Tick int     `json:"tick"`
	Code string  `json:"code"`
	You  int     `json:"you"`
	Msg  string  `json:"msg"`
	TS   float64 `json:"ts"`
	List []struct {
		ID   int    `json:"id"`
		Team string `json:"team"`
	} `json:"list"`
}

// player is one simulated client.
type player struct {
	i     int
	slot  slot
	url   string
	entry protocol.ClientMsg // create settings; T is set per slot
	code  *roomCode          // nil for quick play
	st    *stats
	epoch time.Time    // ping timestamps are ms since it
	buf   bytes.Buffer // reused read buffer
}

// run plays until ctx ends or the socket does; a socket that ends before
// ctx is recorded as a disconnect with its reason.
func (p *player) run(ctx context.Context) {
	start := time.Now()
	hctx, cancel := context.WithTimeout(ctx, dialTimeout)
	defer cancel()
	entry := p.entry
	switch {
	case p.slot.room < 0:
		entry = protocol.ClientMsg{T: protocol.TQuick}
	case !p.slot.creator:
		code, ok := p.code.wait(hctx)
		if !ok {
			p.end(ctx, errors.New("no room code"), "")
			return
		}
		entry = protocol.ClientMsg{T: protocol.TJoin, Code: code}
	}
	conn, resp, err := websocket.Dial(hctx, p.url, nil)
	if err != nil {
		if resp != nil {
			p.st.disconnect(fmt.Sprintf("dial:%d", resp.StatusCode))
			return
		}
		p.end(ctx, err, "")
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(readLimit)
	hello := protocol.ClientMsg{T: protocol.THello, V: protocol.Version, Name: fmt.Sprintf("lt%d", p.i)}
	if err := p.write(hctx, conn, hello); err != nil {
		p.end(ctx, err, "")
		return
	}
	if err := p.write(hctx, conn, entry); err != nil {
		p.end(ctx, err, "")
		return
	}
	w, err := p.welcome(hctx, conn)
	if err != nil || w.T == "error" {
		p.end(ctx, err, w.Msg)
		return
	}
	p.st.handshake.Observe(time.Since(start))
	if p.slot.creator {
		p.code.set(w.Code)
	}
	p.st.conns.Add(1)
	defer p.st.conns.Add(-1)

	wctx, stop := context.WithCancel(ctx)
	picks := make(chan string, 1)
	done := make(chan struct{})
	go func() { defer close(done); p.send(wctx, conn, picks) }()
	msg, err := p.read(ctx, conn, w.You, picks)
	stop()
	<-done
	if ctx.Err() != nil {
		conn.Close(websocket.StatusNormalClosure, "")
		return
	}
	p.end(ctx, err, msg)
}

// end records why the socket ended, unless the run itself is over.
func (p *player) end(ctx context.Context, err error, msg string) {
	if ctx.Err() != nil && msg == "" {
		return
	}
	p.st.disconnect(reason(err, msg))
}

// welcome reads until the welcome (or an error message).
func (p *player) welcome(ctx context.Context, conn *websocket.Conn) (inbound, error) {
	for {
		m, err := p.recv(ctx, conn)
		if err != nil || m.T == "welcome" || m.T == "error" {
			return m, err
		}
	}
}

func (p *player) recv(ctx context.Context, conn *websocket.Conn) (inbound, error) {
	_, r, err := conn.Reader(ctx)
	if err != nil {
		return inbound{}, err
	}
	p.buf.Reset()
	if _, err := p.buf.ReadFrom(r); err != nil {
		return inbound{}, err
	}
	b := p.buf.Bytes()
	p.st.msgsIn.Add(1)
	p.st.bytesIn.Add(uint64(len(b)))
	if tick, ok := snapTick(b); ok {
		return inbound{T: "snap", Tick: tick}, nil // most traffic: skip the full decode
	}
	var m inbound
	if err := json.Unmarshal(b, &m); err != nil {
		return inbound{}, fmt.Errorf("bad json: %w", err)
	}
	return m, nil
}

// read consumes game messages: snapshot arrival intervals and tick gaps,
// pong round trips, and the roster (to pick an aircraft of our team once).
// It returns the server's error text, if any, and the read error.
func (p *player) read(ctx context.Context, conn *websocket.Conn, you int, picks chan<- string) (string, error) {
	var last time.Time
	lastTick, picked := 0, false
	for {
		m, err := p.recv(ctx, conn)
		if err != nil {
			return "", err
		}
		now := time.Now()
		switch m.T {
		case "snap":
			p.st.snaps.Add(1)
			if !last.IsZero() {
				p.st.snapIv.Observe(now.Sub(last))
			}
			if lastTick > 0 && m.Tick-lastTick > 2 {
				p.st.gaps.Add(uint64((m.Tick-lastTick)/2 - 1))
			}
			last, lastTick = now, m.Tick
		case "pong":
			sent := p.epoch.Add(time.Duration(m.TS * float64(time.Millisecond)))
			p.st.rtt.Observe(now.Sub(sent))
		case "players":
			for _, e := range m.List {
				if e.ID == you && !picked {
					picked = true
					picks <- pickKind(e.Team, p.i)
				}
			}
		case "error":
			return m.Msg, nil
		}
	}
}

// send writes inputs at 60 Hz, a ping every second and the pick once the
// reader has it, until ctx ends or a write fails.
func (p *player) send(ctx context.Context, conn *websocket.Conn, picks <-chan string) {
	t := time.NewTicker(time.Second / 60)
	defer t.Stop()
	var seq uint32
	for {
		select {
		case <-ctx.Done():
			return
		case k := <-picks:
			if p.write(ctx, conn, protocol.ClientMsg{T: protocol.TPick, Kind: k}) != nil {
				return
			}
		case <-t.C:
			seq++
			if p.write(ctx, conn, stick(p.i, seq)) != nil {
				return
			}
			if seq%pingEvery == 0 {
				ts := float64(time.Since(p.epoch).Microseconds()) / 1000
				if p.write(ctx, conn, protocol.ClientMsg{T: protocol.TPing, TS: ts}) != nil {
					return
				}
			}
		}
	}
}

func (p *player) write(ctx context.Context, conn *websocket.Conn, m protocol.ClientMsg) error {
	b, err := json.Marshal(m)
	if err != nil {
		return err
	}
	if err := conn.Write(ctx, websocket.MessageText, b); err != nil {
		return err
	}
	p.st.msgsOut.Add(1)
	p.st.bytesOut.Add(uint64(len(b)))
	return nil
}
