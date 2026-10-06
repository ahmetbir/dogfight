package loadtest

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

type script struct{ reacted atomic.Int32 }

func (*script) Hello(i int) any             { return map[string]any{"t": "hello", "v": 1, "name": "p"} }
func (*script) Create() any                 { return map[string]any{"t": "create", "seats": 2} }
func (*script) Input(i int, seq uint32) any { return map[string]any{"t": "in", "seq": seq} }
func (s *script) React(i, you int, t string, raw []byte) any {
	if t == "roster" {
		s.reacted.Add(1)
		return map[string]any{"t": "color", "color": "blue"}
	}
	return nil
}

// echoServer: welcome, one roster, snapshots at 30 Hz, pongs; counts colors.
func echoServer(t *testing.T, colors *atomic.Int32) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer ws.CloseNow()
		ctx := r.Context()
		ws.Read(ctx) // hello
		ws.Read(ctx) // entry
		ws.Write(ctx, websocket.MessageText, []byte(`{"t":"welcome","you":1,"code":"ABCD"}`))
		ws.Write(ctx, websocket.MessageText, []byte(`{"t":"roster"}`))
		go func() {
			for tick := 2; ctx.Err() == nil; tick += 2 {
				ws.Write(ctx, websocket.MessageText, []byte(`{"t":"snap","tick":`+itoa(tick)+`}`))
				time.Sleep(33 * time.Millisecond)
			}
		}()
		for {
			_, b, err := ws.Read(ctx)
			if err != nil {
				return
			}
			var m map[string]any
			json.Unmarshal(b, &m)
			switch m["t"] {
			case "ping":
				ws.Write(ctx, websocket.MessageText, []byte(`{"t":"pong","ts":`+itoa(int(m["ts"].(float64)))+`}`))
			case "color":
				colors.Add(1)
			}
		}
	}))
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

func TestRunDrivesAScript(t *testing.T) {
	var colors atomic.Int32
	srv := echoServer(t, &colors)
	defer srv.Close()
	sc := &script{}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	Run(ctx, Config{URL: "ws" + strings.TrimPrefix(srv.URL, "http"), Players: 2, Rooms: 1,
		Duration: 1500 * time.Millisecond, Ramp: 100 * time.Millisecond, Every: 500 * time.Millisecond}, sc)
	if sc.reacted.Load() != 2 || colors.Load() != 2 {
		t.Fatalf("reacted=%d colors=%d", sc.reacted.Load(), colors.Load())
	}
}

func TestRoomCodeHandsOverOnce(t *testing.T) {
	c := newRoomCode()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if _, ok := c.wait(ctx); ok {
		t.Fatal("wait returned before set")
	}
	c.set("ABCD")
	c.set("ZZZZ")
	if code, ok := c.wait(context.Background()); !ok || code != "ABCD" {
		t.Errorf("wait = %q, %v; want ABCD", code, ok)
	}
}
