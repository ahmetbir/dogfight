package front

import (
	"strings"
	"testing"
	"time"

	"github.com/ahmetbir/roomkit/metrics"
	"github.com/ahmetbir/roomkit/server"
	"playground/internal/protocol"
)

func TestServerCounters(t *testing.T) {
	reg := metrics.New("dogfight", nil)
	srv := newServer(t, server.Options{Metrics: reg})
	c := dial(t, srv)
	c.send(hello("a"))
	c.send(protocol.ClientMsg{T: "create", Mode: "ffa", Size: 2, Diff: "easy"})
	c.until("snap", 2*time.Second, nil)
	if reg.Conns.Load() != 1 || reg.MsgsIn.Load() < 2 || reg.MsgsOut.Load() < 2 {
		t.Fatalf("conns %d in %d out %d", reg.Conns.Load(), reg.MsgsIn.Load(), reg.MsgsOut.Load())
	}
	getRooms(t, srv.URL)
	get(t, srv.URL+"/api/leaderboard?period=week")
	get(t, srv.URL+"/api/nope")
	text := exposition(reg)
	for _, want := range []string{`dogfight_api_requests_total{path="rooms"} 1`, `dogfight_api_requests_total{path="leaderboard"} 1`,
		`dogfight_api_requests_total{path="other"} 1`} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing %s in\n%s", want, text)
		}
	}
	c.ws.CloseNow()
	deadline := time.Now().Add(2 * time.Second)
	for reg.Conns.Load() != 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if reg.Conns.Load() != 0 {
		t.Fatalf("closed connection still counted: %d", reg.Conns.Load())
	}
}

// Every refusal is counted under its reason, not only the logged ones.
func TestRejectCounters(t *testing.T) {
	reg := metrics.New("dogfight", nil)
	srv := newServer(t, server.Options{Metrics: reg, Limits: tight(func(l *server.Limits) { l.MaxConnsIP = 1 })})
	if _, code := rawDial(t, srv.URL, nil); code != 101 {
		t.Fatalf("first dial %d", code)
	}
	for range 3 {
		if _, code := rawDial(t, srv.URL, nil); code != 429 {
			t.Fatalf("over the cap: %d", code)
		}
	}
	if text := exposition(reg); !strings.Contains(text, `dogfight_rejects_total{reason="conns-per-ip"} 3`) {
		t.Fatalf("reject counter:\n%s", text)
	}
	if reg.Conns.Load() != 1 {
		t.Fatalf("refused sockets are not connections: %d", reg.Conns.Load())
	}
}

func exposition(reg *metrics.Registry) string {
	var b strings.Builder
	reg.WriteText(&b)
	return b.String()
}
