//go:build unix

// Package audit keeps the server's session record: who played under which
// pilot hash, which name and which client address, in append-only JSON
// lines under <data>/audit. It is the owner's record, read only through
// the loopback admin listener: never on a public endpoint, never in the
// process log.
//
// Files are one per month, sessions-YYYY-MM.jsonl, shared by both
// blue/green colours: each line is one write(2) on an O_APPEND file under
// an exclusive flock, so two processes appending at once never interleave
// or tear each other's lines.
package audit

import (
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

// Dir is the audit directory under the data dir.
const Dir = "audit"

// Events.
const (
	Join        = "join"
	Leave       = "leave"
	Rename      = "rename" // the stored name of a known pilot changed (it came back under another name)
	NameRefused = "name_refused"
)

const (
	buffer  = 1024
	maxLine = 4096
)

// Event is one line of the record.
type Event struct {
	T        time.Time `json:"t"`
	Event    string    `json:"event"`
	Pilot    string    `json:"pilot,omitempty"`    // the pilot token's hash (the ledger's key); "" = not counted
	Name     string    `json:"name"`               // as entered (hello)
	Accepted string    `json:"accepted,omitempty"` // as seated, shown and stored; "" when refused
	Prev     string    `json:"prev,omitempty"`     // rename: the stored name before
	IP       string    `json:"ip,omitempty"`       // the client address behind the trusted proxy
	Room     string    `json:"room,omitempty"`     // room code; "" when not known yet
}

// Log appends events from any goroutine without blocking: an actor owns the files.
type Log struct {
	dir     string
	log     *slog.Logger
	now     func() time.Time
	in      chan Event
	done    chan struct{}
	dropped atomic.Uint64

	mu     sync.RWMutex // fences Record against Close
	closed bool

	// actor-owned
	f     *os.File
	month string
}

// Open makes <dataDir>/audit (0700) and starts the writer.
func Open(dataDir string, log *slog.Logger, now func() time.Time) (*Log, error) {
	if log == nil {
		log = slog.Default()
	}
	if now == nil {
		now = time.Now
	}
	dir := filepath.Join(dataDir, Dir)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	l := &Log{dir: dir, log: log, now: now, in: make(chan Event, buffer), done: make(chan struct{})}
	go l.run()
	return l, nil
}

// Record queues e (T stamped now if zero). It never blocks; a full queue
// drops it (counted, logged once per episode by the writer).
func (l *Log) Record(e Event) {
	if l == nil {
		return
	}
	l.mu.RLock()
	defer l.mu.RUnlock()
	if l.closed {
		return
	}
	if e.T.IsZero() {
		e.T = l.now()
	}
	select {
	case l.in <- e:
	default:
		l.dropped.Add(1)
	}
}

// Dropped counts events lost to a full queue or a failed write.
func (l *Log) Dropped() uint64 { return l.dropped.Load() }

// Close writes every queued event and stops the writer.
func (l *Log) Close() {
	l.mu.Lock()
	if l.closed {
		l.mu.Unlock()
		<-l.done
		return
	}
	l.closed = true
	close(l.in)
	l.mu.Unlock()
	<-l.done
}

func (l *Log) run() {
	defer close(l.done)
	defer func() {
		if l.f != nil {
			l.f.Close()
		}
	}()
	failing := false
	for e := range l.in {
		err := l.write(e)
		switch {
		case err != nil && !failing:
			failing = true
			l.log.Error("audit: write failed, dropping events", "err", err) // never the event itself
		case err == nil && failing:
			failing = false
			l.log.Info("audit: writes recovered", "dropped", l.dropped.Load())
		}
		if err != nil {
			l.dropped.Add(1)
		}
	}
}

// write appends one line to the event's month file under the flock.
func (l *Log) write(e Event) error {
	e.T = e.T.UTC()
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	if len(b) >= maxLine {
		return errors.New("audit: event too long")
	}
	b = append(b, '\n')
	month := e.T.Format("2006-01")
	if l.f == nil || month != l.month {
		if l.f != nil {
			l.f.Close()
			l.f = nil
		}
		f, err := os.OpenFile(filepath.Join(l.dir, fileName(month)), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
		if err != nil {
			return err
		}
		l.f, l.month = f, month
	}
	fd := int(l.f.Fd())
	if err := syscall.Flock(fd, syscall.LOCK_EX); err != nil {
		return err
	}
	_, err = l.f.Write(b) // one write: O_APPEND puts the whole line at the end
	if uerr := syscall.Flock(fd, syscall.LOCK_UN); err == nil {
		err = uerr
	}
	if err != nil { // reopen next time (the file may have been removed)
		l.f.Close()
		l.f = nil
	}
	return err
}

func fileName(month string) string { return "sessions-" + month + ".jsonl" }
