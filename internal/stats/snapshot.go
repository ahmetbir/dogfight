package stats

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

type snapshot struct {
	V      int               `json:"v"`
	Seq    uint64            `json:"seq"`
	Pilots map[string]*Pilot `json:"pilots"`
}

// writeSnapshot streams the snapshot to a temp file, fsyncs, renames it into
// place and fsyncs the directory. Pilots are encoded one at a time, so the
// whole store is never marshalled into one buffer.
func (s *Store) writeSnapshot() error {
	if err := s.w.Flush(); err != nil {
		s.w.Reset(s.journal)
	}
	tmp := filepath.Join(s.dir, snapName+".tmp")
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	bw := bufio.NewWriterSize(f, 64<<10)
	err = s.encodeSnapshot(bw)
	if err == nil {
		err = bw.Flush()
	}
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(tmp, filepath.Join(s.dir, snapName))
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	d, err := os.Open(s.dir)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}

// encodeSnapshot writes {"v":1,"seq":n,"pilots":{hash:Pilot,…}}; errors surface at Flush.
func (s *Store) encodeSnapshot(w *bufio.Writer) error {
	w.WriteString(`{"v":1,"seq":`)
	w.WriteString(strconv.FormatUint(s.seq, 10))
	w.WriteString(`,"pilots":{`)
	first := true
	for k, p := range s.pilots {
		kb, err := json.Marshal(k)
		if err != nil {
			return err
		}
		pb, err := json.Marshal(p)
		if err != nil {
			return err
		}
		if !first {
			w.WriteByte(',')
		}
		first = false
		w.Write(kb)
		w.WriteByte(':')
		w.Write(pb)
	}
	_, err := w.WriteString("}}\n")
	return err
}

// compact prunes idle pilots, writes the snapshot and empties the journal.
func (s *Store) compact(now time.Time) error {
	cut := now.Add(-s.o.MaxIdle).Unix()
	for k, p := range s.pilots {
		if p.Seen < cut {
			delete(s.pilots, k)
		}
	}
	if err := s.writeSnapshot(); err != nil {
		return err
	}
	if err := s.journal.Truncate(0); err != nil {
		return err
	}
	s.size, s.torn, s.compactedAt = 0, false, now
	return nil
}
