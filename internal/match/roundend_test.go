package match

import (
	"testing"
	"testing/synctest"
	"time"

	"playground/core/room"
)

// A whole round through the room: presence and flight accrue in Step, and the
// Playing→Ended edge flushes a match for the counted pilot who flew it.
func TestRoundEndThroughTick(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		sk := &sink{}
		r, _, cancel := startMatch(t, ffa4, sk)
		defer cancel()
		if _, err := r.Join(t.Context(), room.Who{Name: "a", Pilot: "pa"}, &fakeSender{}); err != nil {
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
