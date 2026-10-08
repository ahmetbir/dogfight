package stats

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"time"
)

const (
	journalName  = "pilots.jsonl"
	snapName     = "pilots.snap.json"
	maxLine      = 4096
	evictDivisor = 100 // at the cap, evict MaxPilots/evictDivisor pilots in one pass
)

type line struct {
	Seq uint64 `json:"seq"`
	At  int64  `json:"at"`
	D   Delta  `json:"d"`
}

// record journals d and then applies it. A delta the journal cannot take is
// dropped and counted, so memory never holds what a restart would lose.
func (s *Store) record(d Delta, at time.Time) {
	if t, ok := s.tombs[d.Pilot]; ok {
		if at.Sub(t.at) >= tombstoneFor {
			delete(s.tombs, d.Pilot)
		} else if d.Name == t.name || d.Name == "" {
			return // a purged pilot's late tally under the purged name
		}
	}
	if !s.accepts(d) {
		return
	}
	if s.size > s.o.MaxJournal {
		s.tryCompact(at)
	}
	if !s.writeLine(d, at) {
		s.dropped.Add(1)
		return
	}
	var prev string
	if p, ok := s.pilots[d.Pilot]; ok {
		prev = p.Name
	}
	s.apply(d, at)
	if s.o.OnRename != nil && prev != "" && d.Name != "" && d.Name != prev {
		s.o.OnRename(d.Pilot, prev, d.Name)
	}
}

// accepts: known pilots take any non-empty delta; a new one needs a real session.
func (s *Store) accepts(d Delta) bool {
	if d.Pilot == "" || d.Empty() && d.Name == "" {
		return false
	}
	if _, ok := s.pilots[d.Pilot]; ok {
		return true
	}
	return d.qualifies()
}

// writeLine appends one journal line and flushes it. On an error the writer
// is reset (bufio errors are sticky), the failure is logged once per episode,
// and the next line starts on a fresh line in case this one was torn.
func (s *Store) writeLine(d Delta, at time.Time) bool {
	if s.size > 4*s.o.MaxJournal { // compaction keeps failing: stop growing the file
		return false
	}
	s.seq++
	b, err := json.Marshal(line{Seq: s.seq, At: at.Unix(), D: d})
	if err != nil || len(b) >= maxLine {
		return false
	}
	if s.torn {
		b = append([]byte{'\n'}, b...)
	}
	b = append(b, '\n')
	if _, err = s.w.Write(b); err == nil {
		err = s.w.Flush()
	}
	if err != nil {
		s.w.Reset(s.journal)
		s.torn = true
		if !s.failing {
			s.failing = true
			s.o.Log.Error("stats: journal write failed, dropping records", "err", err)
		}
		return false
	}
	if s.failing {
		s.failing = false
		s.o.Log.Info("stats: journal writes recovered", "dropped", s.dropped.Load())
	}
	s.torn = false
	s.size += int64(len(b))
	return true
}

// apply adds d to its pilot, creating (and evicting at the cap) as needed.
func (s *Store) apply(d Delta, at time.Time) {
	p, ok := s.pilots[d.Pilot]
	if !ok {
		if len(s.pilots) >= s.o.MaxPilots {
			s.evict()
		}
		p = &Pilot{}
		s.pilots[d.Pilot] = p
	}
	if d.Name != "" {
		p.Name = d.Name
	}
	p.Kills += d.Kills
	p.BotKills += d.BotKills
	p.Deaths += d.Deaths
	p.Crashes += d.Crashes
	p.Wins += d.Wins
	p.Matches += d.Matches
	p.Fired += d.Fired
	p.Hits += d.Hits
	p.Flight += d.Flight
	for k, v := range d.Kinds {
		if p.Kinds == nil {
			p.Kinds = map[string]int{}
		}
		p.Kinds[k] += v
	}
	// Weeks only move forward: keys are zero-padded, so string order is time
	// order. A record stamped in an older week (queued out of order across
	// the boundary) counts for life only and never resets the newer week.
	switch wk := WeekKey(at); {
	case wk > p.Week:
		p.Week, p.WeekKills = wk, d.Kills
	case wk == p.Week:
		p.WeekKills += d.Kills
	}
	p.Seen = max(p.Seen, at.Unix())
}

// evict removes a batch of pilots: those without any kill first, then the
// least recently seen (ties: smallest key). Batching keeps the O(n log n)
// pass off the per-insert path.
func (s *Store) evict() {
	type cand struct {
		key    string
		killer bool
		seen   int64
	}
	all := make([]cand, 0, len(s.pilots))
	for k, p := range s.pilots {
		all = append(all, cand{k, p.Kills+p.BotKills > 0, p.Seen})
	}
	sort.Slice(all, func(i, j int) bool {
		a, b := all[i], all[j]
		if a.killer != b.killer {
			return !a.killer
		}
		if a.seen != b.seen {
			return a.seen < b.seen
		}
		return a.key < b.key
	})
	n := max(1, s.o.MaxPilots/evictDivisor)
	for _, c := range all[:min(n, len(all))] {
		delete(s.pilots, c.key)
	}
}

// endLine appends '\n' when the journal ends inside a torn line.
func (s *Store) endLine() error {
	if s.size == 0 {
		return nil
	}
	r, err := os.Open(filepath.Join(s.dir, journalName))
	if err != nil {
		return err
	}
	defer r.Close()
	last := make([]byte, 1)
	if _, err := r.ReadAt(last, s.size-1); err != nil {
		return err
	}
	if last[0] == '\n' {
		return nil
	}
	n, err := s.journal.Write([]byte{'\n'})
	s.size += int64(n)
	return err
}

// load reads the snapshot, then journal lines newer than it. Torn, garbage
// and over-long lines are skipped; lines at or below the snapshot's seq were
// already counted (crash between rename and truncate).
func (s *Store) load() error {
	if f, err := os.Open(filepath.Join(s.dir, snapName)); err == nil {
		var snap snapshot
		err = json.NewDecoder(bufio.NewReader(f)).Decode(&snap)
		f.Close()
		if err != nil {
			return fmt.Errorf("stats: snapshot: %w", err)
		}
		s.seq = snap.Seq
		for k, p := range snap.Pilots {
			if p != nil {
				s.pilots[k] = p
			}
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	f, err := os.Open(filepath.Join(s.dir, journalName))
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()
	return eachLine(f, func(b []byte) {
		var l line
		if json.Unmarshal(b, &l) != nil || l.Seq <= s.seq {
			return
		}
		if s.accepts(l.D) {
			s.apply(l.D, time.Unix(l.At, 0))
		}
		s.seq = l.Seq
	})
}

// eachLine calls fn for every line shorter than maxLine; longer ones are skipped whole.
func eachLine(r io.Reader, fn func([]byte)) error {
	br := bufio.NewReaderSize(r, maxLine)
	skip := false
	for {
		b, err := br.ReadSlice('\n')
		if err == bufio.ErrBufferFull {
			skip = true
			continue
		}
		if !skip && len(b) > 0 {
			fn(b)
		}
		skip = false
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
	}
}
