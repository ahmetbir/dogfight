package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"playground/internal/lobby"
	"playground/internal/protocol"
)

// tight returns limits that are generous except for the field under test.
func tight(f func(*Limits)) Limits {
	l := Limits{MaxConnsIP: 1000, CreatePerMinIP: 1000, JoinFailPerMinIP: 1000, JoinPerMinIP: 1000}
	f(&l)
	return l
}

// rawDial dials /ws and returns the HTTP status on failure.
func rawDial(t *testing.T, url string, h http.Header) (*websocket.Conn, int) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	ws, res, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(url, "http")+"/ws", &websocket.DialOptions{HTTPHeader: h})
	if err != nil {
		if res == nil {
			t.Fatal(err)
		}
		return nil, res.StatusCode
	}
	t.Cleanup(func() { ws.CloseNow() })
	return ws, 101
}

func TestPerIPConnLimit(t *testing.T) {
	srv := newServer(t, Options{Limits: tight(func(l *Limits) { l.MaxConnsIP = 2 })})
	for range 2 {
		if _, code := rawDial(t, srv.URL, nil); code != 101 {
			t.Fatalf("dial under cap = %d", code)
		}
	}
	if _, code := rawDial(t, srv.URL, nil); code != http.StatusTooManyRequests {
		t.Fatalf("3rd conn from one IP = %d, want 429", code)
	}
}

func TestTrustedProxyLimitsByRealIP(t *testing.T) {
	proxies, _ := ParsePrefixes("127.0.0.0/8")
	srv := newServer(t, Options{TrustProxy: proxies, Limits: tight(func(l *Limits) { l.MaxConnsIP = 1 })})
	ip := func(a string) http.Header { return http.Header{"X-Real-IP": {a}} }
	if _, code := rawDial(t, srv.URL, ip("198.51.100.1")); code != 101 {
		t.Fatal(code)
	}
	if _, code := rawDial(t, srv.URL, ip("198.51.100.2")); code != 101 {
		t.Fatalf("other client behind the proxy = %d", code)
	}
	if _, code := rawDial(t, srv.URL, ip("198.51.100.1")); code != http.StatusTooManyRequests {
		t.Fatalf("same client again = %d, want 429", code)
	}
}

func TestGlobalConnLimit(t *testing.T) {
	srv := newServer(t, Options{Limits: tight(func(l *Limits) { l.MaxConns = 1 })})
	rawDial(t, srv.URL, nil)
	if _, code := rawDial(t, srv.URL, nil); code != http.StatusServiceUnavailable {
		t.Fatalf("over global cap = %d, want 503", code)
	}
}

// closeStatus reads until the server closes and returns the close code.
func (c *client) closeStatus(d time.Duration) websocket.StatusCode {
	ctx, cancel := context.WithTimeout(c.t.Context(), d)
	defer cancel()
	for {
		if _, _, err := c.ws.Read(ctx); err != nil {
			return websocket.CloseStatus(err)
		}
	}
}

func joined(t *testing.T, srv string) *client {
	c := &client{t: t}
	c.ws, _ = rawDial(t, srv, nil)
	c.ws.SetReadLimit(1 << 20)
	c.send(hello("x"))
	c.send(protocol.ClientMsg{T: protocol.TCreate, Mode: "ffa", Size: 2, Diff: "easy"})
	c.until("welcome", 5*time.Second, nil)
	return c
}

func TestPickAndPingFlood(t *testing.T) {
	srv := newServer(t, Options{Web: web, Limits: tight(func(*Limits) {})})
	for name, raw := range map[string]string{
		"pick": `{"t":"pick","kind":"f16"}`,
		"ping": `{"t":"ping","ts":1}`,
	} {
		t.Run(name, func(t *testing.T) {
			c := joined(t, srv.URL)
			for range 10 {
				if c.ws.Write(t.Context(), websocket.MessageText, []byte(raw)) != nil {
					break
				}
			}
			if got := c.closeStatus(5 * time.Second); got != websocket.StatusPolicyViolation {
				t.Fatalf("close status %v", got)
			}
		})
	}
}

func TestSteadyInputNotLimited(t *testing.T) {
	srv := newServer(t, Options{Web: web, Limits: tight(func(*Limits) {})})
	c := joined(t, srv.URL)
	tk := time.NewTicker(time.Second / 60)
	defer tk.Stop()
	for seq := uint32(1); seq <= 90; seq++ { // 1.5 s at 60 Hz
		<-tk.C
		c.send(protocol.ClientMsg{T: protocol.TIn, Seq: seq, Th: 1})
	}
	c.until("snap", time.Second, func(b []byte) bool { return strings.Contains(string(b), `"ack":90`) })
}

// A network stall delivers queued 60 Hz inputs in one bunch: up to the
// burst (2 s worth) must pass.
func TestBunchedInputNotLimited(t *testing.T) {
	srv := newServer(t, Options{Web: web, Limits: tight(func(*Limits) {})})
	c := joined(t, srv.URL)
	for seq := uint32(1); seq <= 100; seq++ {
		c.send(protocol.ClientMsg{T: protocol.TIn, Seq: seq, Th: 1})
	}
	c.until("snap", 2*time.Second, func(b []byte) bool { return strings.Contains(string(b), `"ack":100`) })
}

func TestMaxRoomsServerFull(t *testing.T) {
	srv := newServerRooms(t, Options{Web: web}, 1)
	joined(t, srv.URL)
	c := dial(t, srv)
	c.send(hello("y"))
	c.send(protocol.ClientMsg{T: protocol.TCreate, Mode: "ffa", Size: 2, Diff: "easy"})
	expectError(t, c, "sunucu dolu")
}

func TestCreateRatePerIP(t *testing.T) {
	srv := newServer(t, Options{Web: web, Limits: tight(func(l *Limits) { l.CreatePerMinIP = 3 })})
	for range 3 {
		joined(t, srv.URL)
	}
	c := dial(t, srv)
	c.send(hello("y"))
	c.send(protocol.ClientMsg{T: protocol.TCreate, Mode: "ffa", Size: 2, Diff: "easy"})
	expectError(t, c, "çok fazla oda kurdun, biraz bekle")
}

func TestJoinFailsPerIP(t *testing.T) {
	srv := newServer(t, Options{Web: web, Limits: tight(func(l *Limits) { l.JoinFailPerMinIP = 2 })})
	try := func(want string) {
		c := dial(t, srv)
		c.send(hello("y"))
		c.send(protocol.ClientMsg{T: protocol.TJoin, Code: "ZZZZ"})
		expectError(t, c, want)
	}
	try("oda bulunamadı")
	try("oda bulunamadı")
	try("çok fazla deneme, biraz bekle")
}

func TestDrainOnShutdown(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	l := lobby.New(ctx, lobby.Options{})
	s := New(l, Options{Web: web})
	srv := httptest.NewServer(s)
	defer srv.Close()
	c := joined(t, srv.URL)
	gone := make(chan bool, 1)
	go func() { gone <- c.closed(10 * time.Second) }() // a live client keeps reading
	start := time.Now()
	cancel() // what SIGTERM does to the lobby context
	l.Wait()
	s.Wait()
	if d := time.Since(start); d > 2*time.Second {
		t.Fatalf("rooms and sockets drained in %v", d)
	}
	if !<-gone {
		t.Fatal("client socket still open")
	}
}

// While the server is full, retrying a create answers "sunucu dolu" and
// spends no create token.
func TestFullServerKeepsCreateTokens(t *testing.T) {
	srv := newServerRooms(t, Options{Web: web, Limits: tight(func(l *Limits) { l.CreatePerMinIP = 2 })}, 1)
	joined(t, srv.URL)
	for range 3 {
		c := dial(t, srv)
		c.send(hello("y"))
		c.send(protocol.ClientMsg{T: protocol.TCreate, Mode: "ffa", Size: 2, Diff: "easy"})
		expectError(t, c, "sunucu dolu")
	}
}

func TestBurstOf(t *testing.T) {
	for in, want := range map[float64]int{0.5: 1, 1: 1, 2.2: 3, 3: 3, 10: 10} {
		if got := burstOf(in); got != want {
			t.Errorf("burstOf(%v)=%d want %d", in, got, want)
		}
	}
}

// Concurrent creates from one address cannot share a create token: the
// check and the spend are one step.
func TestConcurrentCreatesShareNoToken(t *testing.T) {
	srv := newServer(t, Options{Web: web, Limits: tight(func(l *Limits) { l.CreatePerMinIP = 1 })})
	const n = 8
	cs := make([]*client, n)
	for i := range cs {
		cs[i] = dial(t, srv)
		cs[i].send(hello("y"))
	}
	create, _ := json.Marshal(protocol.ClientMsg{T: protocol.TCreate, Mode: "ffa", Size: 2, Diff: "easy"})
	var wg sync.WaitGroup
	for _, c := range cs {
		wg.Go(func() { c.ws.Write(t.Context(), websocket.MessageText, create) })
	}
	wg.Wait()
	welcomes := 0
	for _, c := range cs {
		ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
		_, b, err := c.ws.Read(ctx)
		cancel()
		if err != nil {
			t.Fatal(err)
		}
		var h struct{ T string }
		json.Unmarshal(b, &h)
		if h.T == "welcome" {
			welcomes++
		}
	}
	if welcomes != 1 {
		t.Fatalf("%d creates passed on one token", welcomes)
	}
}
