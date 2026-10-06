package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestHistQuantiles(t *testing.T) {
	var h hist
	for range 98 {
		h.Observe(33 * time.Millisecond)
	}
	h.Observe(70 * time.Millisecond)
	h.Observe(5 * time.Second) // overflow bucket
	c := h.Snapshot()
	if c.Total() != 100 {
		t.Fatalf("total = %d", c.Total())
	}
	if q := c.Quantile(0.5); q != 34 {
		t.Errorf("p50 = %d, want 34 (bucket [33,34))", q)
	}
	if q := c.Quantile(0.99); q != 71 {
		t.Errorf("p99 = %d, want 71", q)
	}
	if q := c.Quantile(1); q != histMax+1 {
		t.Errorf("max = %d, want %d", q, histMax+1)
	}
	if n := c.Above(50); n != 2 {
		t.Errorf("above 50 ms = %d, want 2", n)
	}
	var empty counts
	if q := empty.Quantile(0.99); q != 0 {
		t.Errorf("empty p99 = %d, want 0", q)
	}
}

func TestHistSubIsTheWindow(t *testing.T) {
	var h hist
	h.Observe(10 * time.Millisecond)
	old := h.Snapshot()
	h.Observe(40 * time.Millisecond)
	h.Observe(-time.Millisecond) // clamps to bucket 0
	d := h.Snapshot().Sub(old)
	if d.Total() != 2 || d.Quantile(1) != 41 || d[0] != 1 {
		t.Errorf("window = total %d max %d b0 %d, want 2, 41, 1", d.Total(), d.Quantile(1), d[0])
	}
}

func TestLineRatesPerSecond(t *testing.T) {
	st := newStats()
	prev := st.sample(0)
	st.conns.Store(4)
	st.msgsIn.Add(240)
	st.msgsOut.Add(480)
	st.bytesIn.Add(4 * 2 * 120 * 1024) // 120 KB/s per client over 2 s
	st.snaps.Add(240)
	st.gaps.Add(3)
	st.snapIv.Observe(33 * time.Millisecond)
	st.disconnect("close:StatusPolicyViolation")
	cur := st.sample(2 * time.Second)
	got := line(prev, cur)
	for _, want := range []string{"conns=  4", "in=   120/s", "out=   240/s", "rx/client=120.0KB/s", "iv_p50=34ms", "gaps=3", "disc=1"} {
		if !strings.Contains(got, want) {
			t.Errorf("line %q lacks %q", got, want)
		}
	}
}

func TestSummaryListsReasonsSorted(t *testing.T) {
	st := newStats()
	from := st.sample(10 * time.Second)
	st.conns.Store(2)
	st.bytesIn.Add(2 * 10 * 1024 * 100)
	to := st.sample(20 * time.Second)
	got := summary(from, to, counts{}, map[string]int{"timeout": 1, "close:StatusGoingAway": 2})
	if !strings.Contains(got, "rx/client=100.0KB/s") {
		t.Errorf("summary lacks per-client rx:\n%s", got)
	}
	if !strings.HasSuffix(got, "disconnects: close:StatusGoingAway=2 timeout=1") {
		t.Errorf("summary reasons:\n%s", got)
	}
	if !strings.HasSuffix(summary(from, to, counts{}, nil), "disconnects: none") {
		t.Error("no reasons should read none")
	}
}

func TestReason(t *testing.T) {
	cases := []struct {
		err  error
		msg  string
		want string
	}{
		{nil, "oda dolu", "server:oda dolu"},
		{nil, "", "closed"},
		{websocket.CloseError{Code: websocket.StatusPolicyViolation}, "", "close:StatusPolicyViolation"},
		{fmt.Errorf("read: %w", context.DeadlineExceeded), "", "timeout"},
		{io.EOF, "", "eof"},
		{errors.New(strings.Repeat("x", 100)), "", "error:" + strings.Repeat("x", 60)},
	}
	for _, c := range cases {
		if got := reason(c.err, c.msg); got != c.want {
			t.Errorf("reason(%v, %q) = %q, want %q", c.err, c.msg, got, c.want)
		}
	}
}

func TestRoomCPU(t *testing.T) {
	// 10 us per tick, 2 us per snapshot build, 12 encodes of 5 us per snapshot:
	// 60*10 + 30*(2 + 12*5) = 2460 us per second = 0.246 %.
	r := benchResult{ticks: 100, step: 1000 * time.Microsecond, snaps: 50, snapBuild: 100 * time.Microsecond,
		marshals: 600, marshal: 3000 * time.Microsecond}
	if got := r.roomCPU(); got < 0.002459 || got > 0.002461 {
		t.Errorf("roomCPU = %v, want 0.00246", got)
	}
	if (benchResult{}).roomCPU() != 0 {
		t.Error("empty bench should cost 0")
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
