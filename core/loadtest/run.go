package loadtest

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// Script is what a game tells the load test.
type Script interface {
	Hello(i int) any                            // player i's hello
	Create() any                                // a creator's create message
	Input(i int, seq uint32) any                // player i's input number seq (60 Hz)
	React(i, you int, t string, raw []byte) any // a reply to a server message other than snap/pong/error, or nil; raw is valid until return
}

// Config is one run: the target, the crowd and the timing.
type Config struct {
	URL                           string
	Players, Rooms                int
	Duration, Ramp, Settle, Every time.Duration
}

// Run starts every player on its ramp slot and reports until the run ends.
func Run(ctx context.Context, c Config, sc Script) {
	st := NewStats()
	codes := make([]*roomCode, c.Rooms)
	for i := range codes {
		codes[i] = newRoomCode()
	}
	begin := time.Now()
	rctx, cancel := context.WithDeadline(ctx, begin.Add(c.Ramp+c.Duration))
	defer cancel()
	var wg sync.WaitGroup
	for i, sl := range Assign(c.Players, c.Rooms) {
		p := &player{i: i, slot: sl, url: c.URL, sc: sc, st: st, epoch: begin}
		if sl.Room >= 0 {
			p.code = codes[sl.Room]
		}
		wg.Go(func() {
			select {
			case <-time.After(time.Until(begin.Add(StartAt(i, c.Players, c.Ramp)))):
				p.run(rctx)
			case <-rctx.Done():
			}
		})
	}
	from, end := report(rctx, c, st, begin)
	wg.Wait()
	fmt.Println(Summary(from, end, st.Handshake.Snapshot(), st.ReasonCounts()))
}

// report prints a line every c.Every until ctx ends; it returns the
// samples that bound the steady-state window (ramp + settle to the end).
func report(ctx context.Context, c Config, st *Stats, begin time.Time) (from, end Sample) {
	t := time.NewTicker(c.Every)
	defer t.Stop()
	prev := st.Sample(0)
	steady := false
	for {
		select {
		case <-ctx.Done():
			// The last periodic sample ends the window: at the deadline
			// players are already closing, which would skew per-client rates.
			if !steady {
				from = Sample{} // never steady: the whole run
			}
			end = prev
			if end.At <= from.At {
				end = st.Sample(time.Since(begin))
			}
			return from, end
		case <-t.C:
			cur := st.Sample(time.Since(begin))
			fmt.Println(Line(prev, cur))
			if !steady && cur.At >= c.Ramp+c.Settle {
				from, steady = cur, true
			}
			prev = cur
		}
	}
}
