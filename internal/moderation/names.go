package moderation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"sync/atomic"
	"time"
)

// FileName is the moderation file under the data dir, shared by both
// blue/green colours (the dogfight-data volume).
const FileName = "moderation.json"

// ReloadEvery is how often a server looks at the file's mtime.
const ReloadEvery = 10 * time.Second

// doc is moderation.json.
type doc struct {
	BlockedNames []string `json:"blockedNames"`
}

// stamp identifies one version of the file; the zero stamp is "missing".
type stamp struct {
	mod  time.Time
	size int64
}

// Names is the live blocked-name list of one server: read lock-free by the
// rooms and the leaderboard, reloaded when the file changes (the other
// colour or an admin wrote it), written atomically by Block and Unblock.
type Names struct {
	path string
	log  *slog.Logger
	list atomic.Pointer[List]

	mu   sync.Mutex // serialises reloads and writes
	seen stamp      // the file version list came from
}

// Open loads <dir>/moderation.json; a missing file is an empty list. A file
// that cannot be read or parsed is an error (the caller decides; the server
// logs it and starts with an empty list; Watch loads the file once it changes).
func Open(dir string, log *slog.Logger) (*Names, error) {
	if log == nil {
		log = slog.Default()
	}
	n := &Names{path: filepath.Join(dir, FileName), log: log}
	n.list.Store(&List{})
	n.mu.Lock()
	defer n.mu.Unlock()
	_, err := n.reloadLocked()
	return n, err
}

// Blocked reports whether name matches a blocked pattern. Safe from any
// goroutine (rooms, HTTP), never blocks; a nil Names blocks nothing.
func (n *Names) Blocked(name string) bool {
	if n == nil {
		return false
	}
	return n.list.Load().Blocked(name)
}

// Patterns is the current list as typed.
func (n *Names) Patterns() []string { return n.list.Load().Patterns() }

// Watch reloads the file whenever its mtime or size changes, every interval,
// until ctx ends. A bad file keeps the previous list (logged once per change).
func (n *Names) Watch(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			n.Reload()
		}
	}
}

// Reload reads the file if it changed since the last load.
func (n *Names) Reload() {
	n.mu.Lock()
	defer n.mu.Unlock()
	changed, err := n.reloadLocked()
	switch {
	case err != nil:
		n.log.Error("moderation: reload failed, keeping the previous list", "err", err)
	case changed:
		n.log.Info("moderation: list reloaded", "patterns", len(n.list.Load().patterns))
	}
}

// reloadLocked loads the file when its stamp moved. A failed load records
// the stamp too, so a broken file is reported once, not every poll.
func (n *Names) reloadLocked() (bool, error) {
	st, err := statFile(n.path)
	if err != nil {
		return false, err
	}
	if st == n.seen {
		return false, nil
	}
	n.seen = st
	d, err := readDoc(n.path)
	if err != nil {
		return false, err
	}
	l, err := NewList(d.BlockedNames)
	if err != nil {
		return false, fmt.Errorf("%s: %w", FileName, err)
	}
	n.list.Store(l)
	return true, nil
}

// Block adds pattern (false: an equivalent one is already listed). It
// re-reads the file first, so a change by the other colour is kept.
func (n *Names) Block(pattern string) (bool, error) {
	if _, err := compile(pattern); err != nil {
		return false, err
	}
	return n.edit(func(ps []string) ([]string, bool) {
		if slices.ContainsFunc(ps, func(p string) bool { return same(p, pattern) }) {
			return ps, false
		}
		return append(ps, pattern), true
	})
}

// Unblock removes every pattern equivalent to pattern (false: none listed).
func (n *Names) Unblock(pattern string) (bool, error) {
	return n.edit(func(ps []string) ([]string, bool) {
		out := slices.DeleteFunc(slices.Clone(ps), func(p string) bool { return same(p, pattern) })
		return out, len(out) != len(ps)
	})
}

// edit applies f to the file's current patterns and writes the result.
func (n *Names) edit(f func([]string) ([]string, bool)) (bool, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	d, err := readDoc(n.path)
	if err != nil {
		return false, err
	}
	ps, changed := f(d.BlockedNames)
	if !changed {
		return false, nil
	}
	l, err := NewList(ps)
	if err != nil {
		return false, err
	}
	d.BlockedNames = ps
	if err := writeDoc(n.path, d); err != nil {
		return false, err
	}
	n.list.Store(l)
	if st, err := statFile(n.path); err == nil {
		n.seen = st
	}
	return true, nil
}

func statFile(path string) (stamp, error) {
	fi, err := os.Stat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return stamp{}, nil
	}
	if err != nil {
		return stamp{}, err
	}
	return stamp{fi.ModTime(), fi.Size()}, nil
}

// readDoc reads the file; missing = empty.
func readDoc(path string) (doc, error) {
	var d doc
	b, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return d, nil
	}
	if err != nil {
		return d, err
	}
	if err := json.Unmarshal(b, &d); err != nil {
		return d, fmt.Errorf("%s: %w", FileName, err)
	}
	return d, nil
}

// writeDoc writes d to a temp file in the same dir, fsyncs it and renames it
// over path, so a reader sees the old file or the new one, never half.
func writeDoc(path string, d doc) error {
	if d.BlockedNames == nil {
		d.BlockedNames = []string{}
	}
	b, err := json.MarshalIndent(d, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), FileName+".tmp*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	_, err = f.Write(append(b, '\n'))
	if err == nil {
		err = f.Chmod(0o600)
	}
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(tmp, path)
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	if dir, err := os.Open(filepath.Dir(path)); err == nil {
		_ = dir.Sync()
		dir.Close()
	}
	return nil
}
