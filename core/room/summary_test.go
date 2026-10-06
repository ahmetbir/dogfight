package room

import (
	"testing"
	"testing/synctest"
	"time"
)

func TestSummaryTracksJoins(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, cancel := start(t)
		defer cancel()
		if s := r.Summary(); s.Humans != 0 || s.Seats != 4 || s.Mode != "ffa" || s.Map != "ada" || s.Weather != "acik" || s.Phase != "playing" {
			t.Fatalf("initial %+v", s)
		}
		seat, err := r.Join(t.Context(), Who{Name: "a"}, &fakeSender{})
		if err != nil {
			t.Fatal(err)
		}
		if s := r.Summary(); s.Humans != 1 {
			t.Fatalf("after join %+v", s)
		}
		seat.Leave()
		time.Sleep(100 * time.Millisecond)
		synctest.Wait()
		if s := r.Summary(); s.Humans != 0 || s.LeftS <= 0 {
			t.Fatalf("after leave %+v", s)
		}
	})
}
