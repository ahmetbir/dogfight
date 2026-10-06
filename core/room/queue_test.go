package room

import "testing"

// in is a test input: X is a held control, Shot a one-shot press.
type in struct {
	X    int
	Shot bool
}

func (i in) Latch(d in) in { i.Shot = i.Shot || d.Shot; return i }
func (i in) Held() in      { i.Shot = false; return i }

func TestQueueOrderDuplicatesAndCap(t *testing.T) {
	q := newQueue[in]()
	q.push(2, in{X: 2})
	q.push(1, in{X: 1}) // out of order: dropped
	q.push(2, in{X: 9}) // duplicate: dropped
	q.push(3, in{X: 3})
	if v, ok := q.next(); !ok || v.X != 2 || q.ack != 2 {
		t.Fatalf("%+v %v ack=%d", v, ok, q.ack)
	}
	for s := uint32(4); s < 4+queueCap+2; s++ {
		q.push(s, in{X: int(s)})
	}
	if len(q.items) != queueCap {
		t.Fatalf("cap: %d", len(q.items))
	}
}

func TestQueueBacklogKeepsPressesAndStarvedRepeatsHeld(t *testing.T) {
	q := newQueue[in]()
	if q.started() {
		t.Fatal("started before any input")
	}
	q.push(1, in{X: 1, Shot: true})
	for s := uint32(2); s <= 7; s++ {
		q.push(s, in{X: int(s)})
	}
	v, ok := q.next() // backlog 7 > keep 4: seq 1..3 dropped, their press kept
	if !ok || v.X != 4 || !v.Shot || q.ack != 4 {
		t.Fatalf("%+v ack=%d", v, q.ack)
	}
	for range 3 {
		q.next()
	}
	r, ok := q.next() // starved: repeat the last without its press
	if ok || r.X != 7 || r.Shot || !q.started() {
		t.Fatalf("repeat %+v %v", r, ok)
	}
}
