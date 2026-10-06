package room

import (
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"
)

// panicSender panics on Send once armed: a stand-in for any bug on the room
// goroutine.
type panicSender struct {
	fakeSender
	armed atomic.Bool
}

func (p *panicSender) Send(v any) bool {
	if p.armed.Load() {
		panic("boom")
	}
	return p.fakeSender.Send(v)
}

// A panic inside the actor ends only that room: Done closes and every
// session is closed (spec §8).
func TestRoomPanicClosesRoom(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, cancel := start(t)
		defer cancel()
		bad := &panicSender{}
		other := &fakeSender{}
		if _, err := r.Join(t.Context(), Who{Name: "a"}, bad); err != nil {
			t.Fatal(err)
		}
		if _, err := r.Join(t.Context(), Who{Name: "b"}, other); err != nil {
			t.Fatal(err)
		}
		bad.armed.Store(true)
		time.Sleep(time.Second)
		synctest.Wait()
		select {
		case <-r.Done():
		default:
			t.Fatal("room still running after a panic")
		}
		if !bad.isClosed() || !other.isClosed() {
			t.Fatal("sessions left open after a panic")
		}
	})
}
