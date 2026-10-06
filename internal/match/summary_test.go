package match

import (
	"testing"
	"testing/synctest"
	"time"

	"playground/core/room"
)

func TestSummaryTracksJoins(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, _, cancel := startMatch(t, ffa4, nil)
		defer cancel()
		if s := r.Summary(); s.Humans != 0 || s.Seats != 4 || s.Game.Mode != "ffa" || s.Game.Map != "ada" || s.Game.Weather != "acik" || s.Game.Phase != "playing" {
			t.Fatalf("initial %+v", s)
		}
		seat, err := r.Join(t.Context(), room.Who{Name: "a"}, &fakeSender{})
		if err != nil {
			t.Fatal(err)
		}
		if s := r.Summary(); s.Humans != 1 {
			t.Fatalf("after join %+v", s)
		}
		seat.Leave()
		time.Sleep(100 * time.Millisecond)
		synctest.Wait()
		if s := r.Summary(); s.Humans != 0 || s.Game.LeftS <= 0 {
			t.Fatalf("after leave %+v", s)
		}
	})
}
