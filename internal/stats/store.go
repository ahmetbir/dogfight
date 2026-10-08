// Package stats keeps per-pilot statistics on disk without a database: an
// append-only JSON-lines journal and a periodic snapshot, owned by one goroutine.
package stats

import (
	"bufio"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

type Options struct {
	Now          func() time.Time // default time.Now
	MaxPilots    int              // default 20 000 (memory budget, see preflight S3)
	MaxIdle      time.Duration    // default 180 days
	CompactEvery time.Duration    // default 10 min
	MaxJournal   int64            // default 8 << 20
	Buffer       int              // default 1024
	Log          *slog.Logger     // default slog.Default()
	// OnRename (nil = none) hears a known pilot's stored name change, after
	// it is journaled (not on replay). It runs on the store's goroutine: it
	// must not block (the session audit queues it).
	OnRename func(pilot, prev, name string)
}

func (o Options) withDefaults() Options {
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.MaxPilots <= 0 {
		o.MaxPilots = 20_000
	}
	if o.MaxIdle <= 0 {
		o.MaxIdle = 180 * 24 * time.Hour
	}
	if o.CompactEvery <= 0 {
		o.CompactEvery = 10 * time.Minute
	}
	if o.MaxJournal <= 0 {
		o.MaxJournal = 8 << 20
	}
	if o.Buffer <= 0 {
		o.Buffer = 1024
	}
	if o.Log == nil {
		o.Log = slog.Default()
	}
	return o
}

// Store is an actor: every field below `closed` belongs to run().
type Store struct {
	dir     string
	o       Options
	in      chan any // rec | call
	done    chan struct{}
	dropped atomic.Uint64

	// mu fences Record against Close: once closed is set, no Record can
	// enqueue, so every accepted record sits ahead of Close's message.
	mu     sync.RWMutex
	closed bool

	lock        *os.File // lockDir's flock, released after the actor stops
	pilots      map[string]*Pilot
	seq         uint64
	journal     *os.File
	w           *bufio.Writer
	size        int64
	compactedAt time.Time
	failedAt    time.Time       // last failed compaction; zero when healthy
	attempts    int             // compaction attempts (tests)
	failing     bool            // journal writes are failing; logged once per episode
	torn        bool            // the journal may end inside a partial line
	tombs       map[string]tomb // purged pilots (memory only): their late tallies are dropped
}

// tombstoneFor is how long a purged pilot's tallies under its purged name
// are dropped: longer than any match it may still be flying.
const tombstoneFor = 24 * time.Hour

type tomb struct {
	name string
	at   time.Time
}

// rename is a Rename stamped with the caller's clock.
type rename struct {
	pilot, name string
	at          time.Time
}

// rec is a Delta stamped with the caller's clock at Record time.
type rec struct {
	d  Delta
	at time.Time
}

// call runs f inside the actor; stop ends the actor after the reply.
type call struct {
	f     func(*Store) (stop bool, err error)
	reply chan error
}

// Open locks dir (ErrLocked while another store has it), loads the snapshot
// and the journal under it (0700, files 0600) and starts the actor.
func Open(dir string, o Options) (*Store, error) {
	o = o.withDefaults()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	_ = os.Chmod(dir, 0o700) // best effort: MkdirAll keeps an existing dir's mode
	lock, err := lockDir(dir)
	if err != nil {
		return nil, err
	}
	s := &Store{dir: dir, o: o, in: make(chan any, o.Buffer), done: make(chan struct{}), pilots: map[string]*Pilot{}, tombs: map[string]tomb{}, lock: lock}
	if err := s.open(); err != nil {
		lock.Close()
		return nil, err
	}
	go s.run()
	return s, nil
}

// open loads the files and opens the journal for appending.
func (s *Store) open() error {
	if err := s.load(); err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(s.dir, journalName), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	_ = f.Chmod(0o600)
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return err
	}
	s.journal, s.w, s.size, s.compactedAt = f, bufio.NewWriter(f), st.Size(), s.o.Now()
	if err := s.endLine(); err != nil { // a torn last line must not swallow the next record
		f.Close()
		return err
	}
	return nil
}

// Record queues d; it never blocks. false means d was dropped (counted).
func (s *Store) Record(d Delta) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed {
		s.dropped.Add(1)
		return false
	}
	now := time.Now
	if s.o.Now != nil {
		now = s.o.Now
	}
	select {
	case s.in <- rec{d, now()}:
		return true
	default:
		s.dropped.Add(1)
		return false
	}
}

// Rename queues a known pilot's new stored name; it never blocks. Unknown
// pilots and unchanged names cost nothing (no journal line); a full queue
// drops it uncounted (it is no tally).
func (s *Store) Rename(pilot, name string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed || pilot == "" || name == "" {
		return
	}
	select {
	case s.in <- rename{pilot, name, s.o.Now()}:
	default:
	}
}

func (s *Store) Dropped() uint64 { return s.dropped.Load() }

// Top returns the best n pilots of the period and the current week key;
// week "" when the store closed before answering (no board).
func (s *Store) Top(p Period, n int) ([]Entry, string) { return s.TopVisible(p, n, nil) }

// TopVisible is Top without the pilots whose stored name hide reports
// (nil = none); the board still fills up to n from the pilots below them.
// hide runs on the store's goroutine: it must be quick and not block.
func (s *Store) TopVisible(p Period, n int, hide func(name string) bool) ([]Entry, string) {
	var e []Entry
	var wk string
	ran := false // read after call returns: the reply is received after the actor set it
	s.call(func(s *Store) (bool, error) { e, wk = s.top(p, n, hide); ran = true; return false, nil })
	if !ran {
		return nil, ""
	}
	if wk == "" {
		wk = WeekKey(s.o.Now())
	}
	return e, wk
}

// Me returns the pilot stored under the token hash.
func (s *Store) Me(pilot string) (Pilot, bool) {
	var p *Pilot
	s.call(func(s *Store) (bool, error) { p = s.me(pilot); return false, nil })
	if p == nil {
		return Pilot{}, false
	}
	return *p, true
}

// Find lists the pilots whose stored name match accepts (match runs on the
// store's goroutine: quick, non-blocking); ok false when the store closed.
func (s *Store) Find(match func(name string) bool) (found []Found, ok bool) {
	s.call(func(s *Store) (bool, error) { found, ok = s.find(match), true; return false, nil })
	return found, ok
}

// Purge removes exactly the pilots keys names whose stored name match still
// accepts (a row renamed since the caller listed it is kept), for good:
// after removing them it compacts (snapshot without them, journal emptied),
// so a restart does not replay them back. A purged pilot's later tallies
// under the purged name (a match it was still flying) are dropped for
// tombstoneFor; under another name they count as a new pilot. ok false
// when the store closed. On a failed compaction the rows are gone from
// memory but err says the disk may still hold them until the next
// compaction succeeds.
func (s *Store) Purge(keys []string, match func(name string) bool) (n int, ok bool, err error) {
	err = s.call(func(s *Store) (bool, error) {
		ok = true
		now := s.o.Now()
		for _, k := range keys {
			p, found := s.pilots[k]
			if !found || !match(p.Name) {
				continue
			}
			delete(s.pilots, k)
			s.tombs[k] = tomb{name: p.Name, at: now}
			n++
		}
		if n == 0 {
			return false, nil
		}
		return false, s.compact(now)
	})
	return n, ok, err
}

// Close applies every record accepted before it, writes a final snapshot and
// stops the actor; later Records are dropped and counted, later Closes return nil.
func (s *Store) Close() error {
	s.mu.Lock()
	s.closed = true
	s.mu.Unlock()
	err := s.call(func(s *Store) (bool, error) {
		err := s.compact(s.o.Now())
		return true, errors.Join(err, s.journal.Close())
	})
	<-s.done // the lock is free once Close returns
	return err
}

func (s *Store) compactNow() {
	s.call(func(s *Store) (bool, error) { return false, s.compact(s.o.Now()) })
}

// snapshotOnly writes the snapshot without truncating the journal (tests).
func (s *Store) snapshotOnly() {
	s.call(func(s *Store) (bool, error) { return false, s.writeSnapshot() })
}

// crash flushes the journal and stops without a snapshot (tests: power loss).
func (s *Store) crash() {
	s.call(func(s *Store) (bool, error) { s.w.Flush(); s.journal.Close(); return true, nil })
	<-s.done
}

// call runs f in the actor and waits. After the actor has stopped it
// returns nil without running f.
func (s *Store) call(f func(*Store) (bool, error)) error {
	r := make(chan error, 1)
	select {
	case s.in <- call{f, r}:
	case <-s.done:
		return nil
	}
	select {
	case err := <-r:
		return err
	case <-s.done:
		select { // the reply is sent before done closes
		case err := <-r:
			return err
		default:
			return nil
		}
	}
}

func (s *Store) run() {
	defer close(s.done)
	defer s.lock.Close() // flock released: the next store may open the dir
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		select {
		case m := <-s.in:
			switch m := m.(type) {
			case rec:
				s.record(m.d, m.at)
			case rename:
				if p, ok := s.pilots[m.pilot]; ok && p.Name != m.name {
					s.record(Delta{Pilot: m.pilot, Name: m.name}, m.at)
				}
			case call:
				stop, err := m.f(s)
				m.reply <- err
				if stop {
					return
				}
			}
		case <-tick.C:
			now := s.o.Now()
			if s.size > 0 && (now.Sub(s.compactedAt) >= s.o.CompactEvery || s.size > s.o.MaxJournal) {
				s.tryCompact(now)
			}
		}
	}
}

// tryCompact compacts unless a compaction failed less than a minute ago.
func (s *Store) tryCompact(now time.Time) {
	if !s.failedAt.IsZero() && now.Sub(s.failedAt) < time.Minute {
		return
	}
	s.attempts++
	if err := s.compact(now); err != nil {
		s.failedAt = now
		s.o.Log.Error("stats: compaction failed", "err", err) // never logs pilot hashes or names
		return
	}
	s.failedAt = time.Time{}
}
