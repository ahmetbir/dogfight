// Package lobby creates rooms under short join codes and forgets them when
// they finish.
package lobby

import (
	"cmp"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"sync"

	"playground/core/metrics"
	"playground/core/room"
	"playground/internal/game"
)

// codeAlphabet omits I, O, 0 and 1. Its 32 letters divide 256, so a random
// byte maps to a letter without bias.
const (
	codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	codeLen      = 4
	codeTries    = 16
)

var (
	ErrNoCode = errors.New("lobby: no free room code")
	ErrBusy   = errors.New("lobby: room limit reached")
	// ErrDraining: the server is handing over to a new version (blue/green
	// deploy); it starts no room.
	ErrDraining = errors.New("lobby: draining")
)

// Options configure a lobby.
type Options struct {
	MaxRooms int               // rooms running at once; 0 = no limit
	Stats    room.StatsSink    // pilot tallies of every room; nil = not counted
	Metrics  *metrics.Registry // nil = not measured
}

type Lobby struct {
	ctx      context.Context
	maxRooms int
	stats    room.StatsSink
	m        *metrics.Registry
	newRoom  func(code string, s game.Settings, o room.Options) *room.Room // room.New; swapped in tests
	running  sync.WaitGroup
	mu       sync.Mutex
	rooms    map[string]*room.Room
	seq      int64 // rooms created so far; a room's Seq is its rank
	closed   bool  // Wait has begun: no room may start (running.Add would race Wait)
	draining bool  // Drain(true): no room starts, quick play picks none
}

// Drain(true) refuses new rooms (ErrDraining) and quick-play picks while
// running rooms go on; Drain(false) undoes it.
func (l *Lobby) Drain(on bool) {
	l.mu.Lock()
	l.draining = on
	l.mu.Unlock()
}

// New returns a lobby whose rooms stop when ctx is cancelled.
func New(ctx context.Context, o Options) *Lobby {
	return &Lobby{ctx: ctx, maxRooms: o.MaxRooms, stats: o.Stats, m: o.Metrics, newRoom: room.New, rooms: map[string]*room.Room{}}
}

// Create starts a room under a fresh code. It removes itself when done.
// Past maxRooms, or once the lobby is shutting down, it fails with ErrBusy.
func (l *Lobby) Create(s game.Settings) (*room.Room, error) {
	l.mu.Lock()
	if l.draining {
		l.mu.Unlock()
		return nil, ErrDraining
	}
	if l.closed || l.ctx.Err() != nil || (l.maxRooms > 0 && len(l.rooms) >= l.maxRooms) {
		l.mu.Unlock()
		return nil, ErrBusy
	}
	code, err := l.freeCode()
	if err != nil {
		l.mu.Unlock()
		return nil, err
	}
	l.rooms[code] = nil // reserve the code; building the game takes a while
	l.running.Add(1)    // under l.mu, so never after Wait has begun
	l.seq++
	seq := l.seq
	l.mu.Unlock()

	r, err := l.build(code, s, seq)
	if err != nil {
		l.running.Done() // the room never runs: Wait must not hang on it
		return nil, err
	}
	l.mu.Lock()
	l.rooms[code] = r
	l.mu.Unlock()

	slog.Info("room created", "code", code, "mode", r.Mode())
	l.roomsGauge(1)
	go func() {
		defer l.running.Done()
		r.Run(l.ctx)
		l.roomsGauge(-1)
		l.mu.Lock()
		if l.rooms[code] == r {
			delete(l.rooms, code)
		}
		l.mu.Unlock()
		slog.Info("room closed", "code", code, "mode", r.Mode())
	}()
	return r, nil
}

func (l *Lobby) roomsGauge(d int64) {
	if l.m != nil {
		l.m.Rooms.Add(d)
	}
}

// FlushStats asks every running room to hand its open tallies to the stats
// sink (room.FlushStats), all at once, and waits for them until ctx ends.
// It reports whether every room acknowledged.
func (l *Lobby) FlushStats(ctx context.Context) bool {
	rooms := l.live()
	acks := make(chan bool, len(rooms))
	for _, r := range rooms {
		go func() { acks <- r.FlushStats(ctx) }()
	}
	ok := true
	for range rooms {
		ok = <-acks && ok
	}
	return ok
}

// Wait blocks until every room has stopped (after ctx is cancelled). No room
// starts once it has begun.
func (l *Lobby) Wait() {
	l.mu.Lock()
	l.closed = true
	l.mu.Unlock()
	l.running.Wait()
}

// freeCode needs l.mu held.
func (l *Lobby) freeCode() (string, error) {
	for range codeTries {
		var b [codeLen]byte
		rand.Read(b[:]) // never fails (crypto/rand panics instead)
		for i := range b {
			b[i] = codeAlphabet[int(b[i])%len(codeAlphabet)]
		}
		if _, taken := l.rooms[string(b[:])]; !taken {
			return string(b[:]), nil
		}
	}
	return "", ErrNoCode
}

// Get finds a room by code, case-insensitively; malformed codes never match.
func (l *Lobby) Get(code string) (*room.Room, bool) {
	code, ok := NormalizeCode(code)
	if !ok {
		return nil, false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	r := l.rooms[code]
	return r, r != nil
}

// live is every built room (reserved codes skipped).
func (l *Lobby) live() []*room.Room {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]*room.Room, 0, len(l.rooms))
	for _, r := range l.rooms {
		if r != nil {
			out = append(out, r)
		}
	}
	return out
}

// List is the listed rooms' summaries, most humans first, then newest.
// Private rooms never appear.
func (l *Lobby) List() []room.Summary {
	var out []room.Summary
	for _, r := range l.live() {
		if s := r.Summary(); s.Listed {
			out = append(out, s)
		}
	}
	slices.SortFunc(out, func(a, b room.Summary) int {
		if c := cmp.Compare(b.Humans, a.Humans); c != 0 {
			return c
		}
		return cmp.Compare(b.Seq, a.Seq)
	})
	return out
}

// Quick picks the first listed room in List order with a free seat. The
// room may fill or close before the caller joins; the caller falls back.
func (l *Lobby) Quick() (*room.Room, bool) {
	l.mu.Lock()
	draining := l.draining
	l.mu.Unlock()
	if draining {
		return nil, false
	}
	for _, s := range l.List() {
		if s.Humans < s.Seats {
			if r, ok := l.Get(s.Code); ok {
				return r, true
			}
		}
	}
	return nil, false
}

// NormalizeCode upper-cases code and checks it against ^[A-HJ-NP-Z2-9]{4}$.
func NormalizeCode(code string) (string, bool) {
	if len(code) != codeLen {
		return "", false
	}
	b := []byte(code)
	for i, c := range b {
		if c >= 'a' && c <= 'z' {
			c -= 'a' - 'A'
			b[i] = c
		}
		if !inAlphabet(c) {
			return "", false
		}
	}
	return string(b), true
}

func inAlphabet(c byte) bool {
	for i := range len(codeAlphabet) {
		if codeAlphabet[i] == c {
			return true
		}
	}
	return false
}

// build runs room.New for a reserved code. A panic is an error: the
// reservation is released so the code (and a room slot) is not burned.
func (l *Lobby) build(code string, s game.Settings, seq int64) (r *room.Room, err error) {
	defer func() {
		if v := recover(); v != nil {
			l.mu.Lock()
			delete(l.rooms, code)
			l.mu.Unlock()
			slog.Error("room build panic", "code", code, "panic", v)
			r, err = nil, fmt.Errorf("lobby: building room: %v", v)
		}
	}()
	return l.newRoom(code, s, room.Options{Seq: seq, Stats: l.stats, Metrics: l.m}), nil
}
