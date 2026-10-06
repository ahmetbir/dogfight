package room

import (
	"context"
	"testing"
	"testing/synctest"
	"time"

	"playground/internal/metrics"
)

func TestRoomMetrics(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		reg := metrics.New(nil)
		r := New("MTRC", ffa4, Options{Metrics: reg})
		ctx, cancel := context.WithCancel(t.Context())
		go r.Run(ctx)
		if reg.Bots.Load() != 4 || reg.Humans.Load() != 0 {
			t.Fatalf("bots %d humans %d", reg.Bots.Load(), reg.Humans.Load())
		}
		seat, _ := r.Join(ctx, Who{Name: "a"}, &fakeSender{})
		time.Sleep(time.Second)
		synctest.Wait()
		if reg.Bots.Load() != 3 || reg.Humans.Load() != 1 || reg.TickSeconds.Count() == 0 {
			t.Fatalf("bots %d humans %d", reg.Bots.Load(), reg.Humans.Load())
		}
		seat.Leave()
		cancel()
		<-r.Done()
		if reg.Bots.Load() != 0 || reg.Humans.Load() != 0 {
			t.Fatalf("a closed room leaves nothing behind: bots %d humans %d", reg.Bots.Load(), reg.Humans.Load())
		}
	})
}

// A room closed with humans still seated gives back every gauge too.
func TestRoomMetricsClosedWithHumans(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		reg := metrics.New(nil)
		r := New("MTRH", ffa4, Options{Metrics: reg})
		ctx, cancel := context.WithCancel(t.Context())
		go r.Run(ctx)
		r.Join(ctx, Who{Name: "a"}, &fakeSender{})
		r.Join(ctx, Who{Name: "b"}, &fakeSender{})
		cancel()
		<-r.Done()
		if reg.Bots.Load() != 0 || reg.Humans.Load() != 0 {
			t.Fatalf("bots %d humans %d", reg.Bots.Load(), reg.Humans.Load())
		}
	})
}
