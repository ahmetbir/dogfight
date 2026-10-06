package room

import (
	"context"
	"testing"
	"testing/synctest"
	"time"
)

// A whole round through Run: presence and flight accrue in tick, and the
// Playing→Ended edge flushes a match for the counted pilot who flew it.
func TestRoundEndThroughTick(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		sk := &sink{}
		r := New("ROND", ffa4, Options{Stats: sk})
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		go r.Run(ctx)
		if _, err := r.Join(ctx, Who{Name: "a", Pilot: "pa"}, &fakeSender{}); err != nil {
			t.Fatal(err)
		}
		for range 120 { // up to 20 min of fake time
			time.Sleep(10 * time.Second)
			synctest.Wait()
			if len(sk.all()) > 0 {
				break
			}
		}
		got := sk.all()
		if len(got) == 0 || got[0].Pilot != "pa" || got[0].Matches != 1 || got[0].Flight == 0 {
			t.Fatalf("round end flush: %+v", got)
		}
	})
}
