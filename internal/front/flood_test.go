package front

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/ahmetbir/roomkit/server"
)

// writeRaw writes one text frame; false once the server has closed.
func (c *client) writeRaw(s string) bool {
	return c.ws.Write(c.t.Context(), websocket.MessageText, []byte(s)) == nil
}

func inMsg(seq int) string { return `{"t":"in","seq":` + strconv.Itoa(seq) + `,"th":1}` }

// Root cause of the prod kick (flood-report.md): a network stall longer than
// the input burst (2 s at 60 Hz) delivers the queued inputs in one bunch.
// A 3 s stall, its one ping included, must not end the connection, and the
// live inputs after it must reach the room.
func TestStalledInputsDoNotKick(t *testing.T) {
	srv := newServer(t, server.Options{Web: web, Limits: tight(func(*server.Limits) {})})
	c := joined(t, srv.URL)
	seq := 0
	for range 180 { // 3 s of 60 Hz input released at once
		seq++
		if !c.writeRaw(inMsg(seq)) {
			t.Fatalf("server closed during the bunch at seq %d", seq)
		}
	}
	c.writeRaw(`{"t":"ping","ts":1}`)
	tk := time.NewTicker(time.Second / 60)
	defer tk.Stop()
	for range 30 { // live again at 60 Hz
		<-tk.C
		seq++
		if !c.writeRaw(inMsg(seq)) {
			t.Fatalf("server closed after the bunch at seq %d", seq)
		}
	}
	want := `"ack":` + strconv.Itoa(seq)
	c.until("snap", 2*time.Second, func(b []byte) bool { return strings.Contains(string(b), want) })
}

// A 10 s stall (far beyond any burst) still only drops inputs.
func TestHugeInputBunchOnlyDrops(t *testing.T) {
	srv := newServer(t, server.Options{Web: web, Limits: tight(func(*server.Limits) {})})
	c := joined(t, srv.URL)
	for seq := 1; seq <= 600; seq++ {
		if !c.writeRaw(inMsg(seq)) {
			t.Fatalf("server closed at seq %d", seq)
		}
	}
	time.Sleep(100 * time.Millisecond) // the bucket refills
	c.writeRaw(inMsg(601))
	c.until("snap", 2*time.Second, func(b []byte) bool { return strings.Contains(string(b), `"ack":601`) })
}

// The most a legit client sends of the other kinds in a stall: its pick gate
// allows one per 500 ms (4 in 2 s) and it pings every 15 s.
func TestLegitPicksAndPingsBunchedPass(t *testing.T) {
	srv := newServer(t, server.Options{Web: web, Limits: tight(func(*server.Limits) {})})
	c := joined(t, srv.URL)
	for range 4 {
		c.writeRaw(`{"t":"pick","kind":"f16"}`)
	}
	c.writeRaw(`{"t":"ping","ts":7}`)
	c.until("pong", 2*time.Second, nil)
}

// Non-input floods still end the connection.
func TestChatFloodClosedWithPolicyViolation(t *testing.T) {
	srv := newServer(t, server.Options{Web: web, Limits: tight(func(*server.Limits) {})})
	c := joined(t, srv.URL)
	for range 400 {
		if !c.writeRaw(`{"t":"chat","id":1}`) {
			break
		}
	}
	if got := c.closeStatus(5 * time.Second); got != websocket.StatusPolicyViolation {
		t.Fatalf("close status %v, want policy violation", got)
	}
}
