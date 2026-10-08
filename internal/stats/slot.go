package stats

import (
	"sync"
	"sync/atomic"
)

// slotQueue bounds the deltas a waiting Slot holds. It stays under the
// store's default Buffer, so replaying the queue into a fresh store never
// overflows it.
const slotQueue = 512

type slotState int

const (
	slotWaiting slotState = iota // no store yet: deltas queue
	slotOpen                     // deltas go to the store
	slotClosed                   // drained: deltas are dropped
)

// Slot is where rooms record and the API reads while the store may not be
// open yet (it waits for the previous server's lock during a blue/green
// handoff) or has been handed off (drain). It is safe for concurrent use.
type Slot struct {
	mu      sync.Mutex
	state   slotState
	st      *Store
	queue   []Delta
	dropped atomic.Uint64 // deltas lost by the slot itself (full queue, closed)
}

// NewSlot returns a waiting slot.
func NewSlot() *Slot { return &Slot{} }

// Set hands the slot its store and replays the queued deltas into it. On a
// closed slot it closes st (releasing its lock) and returns false.
func (s *Slot) Set(st *Store) bool {
	s.mu.Lock()
	if s.state != slotWaiting {
		s.mu.Unlock()
		st.Close()
		return false
	}
	for _, d := range s.queue {
		st.Record(d) // never blocks; len(queue) < the store's buffer
	}
	s.queue, s.st, s.state = nil, st, slotOpen
	s.mu.Unlock()
	return true
}

// Close closes the store (final snapshot, lock released) and drops every
// later delta until Reopen. Queued deltas of a waiting slot are dropped.
func (s *Slot) Close() error {
	s.mu.Lock()
	st := s.st
	s.dropped.Add(uint64(len(s.queue)))
	s.st, s.queue, s.state = nil, nil, slotClosed
	s.mu.Unlock()
	if st == nil {
		return nil
	}
	s.dropped.Add(st.Dropped()) // the closed store's losses stay counted
	return st.Close()
}

// Reopen makes a closed slot wait for a store again (undrain).
func (s *Slot) Reopen() {
	s.mu.Lock()
	if s.state == slotClosed {
		s.state = slotWaiting
	}
	s.mu.Unlock()
}

// Ready reports whether a store is open behind the slot.
func (s *Slot) Ready() bool { return s.store() != nil }

func (s *Slot) store() *Store {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.st
}

// Record forwards d to the store, queues it while waiting, or drops it
// (counted). It never blocks.
func (s *Slot) Record(d Delta) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case s.state == slotOpen:
		return s.st.Record(d)
	case s.state == slotWaiting && len(s.queue) < slotQueue:
		s.queue = append(s.queue, d)
		return true
	}
	s.dropped.Add(1)
	return false
}

// Rename is Store.Rename while a store is open; otherwise it is dropped
// (the pilot's next tally carries the name anyway).
func (s *Slot) Rename(pilot, name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state == slotOpen {
		s.st.Rename(pilot, name)
	}
}

// Dropped counts deltas lost by the slot and by its open store.
func (s *Slot) Dropped() uint64 {
	n := s.dropped.Load()
	if st := s.store(); st != nil {
		n += st.Dropped()
	}
	return n
}

// Top is Store.Top; week "" with no open store.
func (s *Slot) Top(p Period, n int) ([]Entry, string) {
	if st := s.store(); st != nil {
		return st.Top(p, n)
	}
	return nil, ""
}

// TopVisible is Store.TopVisible; week "" with no open store.
func (s *Slot) TopVisible(p Period, n int, hide func(name string) bool) ([]Entry, string) {
	if st := s.store(); st != nil {
		return st.TopVisible(p, n, hide)
	}
	return nil, ""
}

// Find is Store.Find; ok false with no open store (this server does not
// hold the ledger: the other colour does, or stats are off).
func (s *Slot) Find(match func(name string) bool) ([]Found, bool) {
	if st := s.store(); st != nil {
		return st.Find(match)
	}
	return nil, false
}

// Purge is Store.Purge; ok false with no open store.
func (s *Slot) Purge(match func(name string) bool) (int, bool, error) {
	if st := s.store(); st != nil {
		return st.Purge(match)
	}
	return 0, false, nil
}

// Me is Store.Me; not found with no open store.
func (s *Slot) Me(pilot string) (Pilot, bool) {
	if st := s.store(); st != nil {
		return st.Me(pilot)
	}
	return Pilot{}, false
}
