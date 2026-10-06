package golden

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"sort"
	"sync"
	"testing"
)

var update = flag.Bool("update", false, "rewrite golden files (Phase 0 tasks only)")

// line is one recorded message: its type and size, and the full JSON for
// small messages or a hash for snapshots, welcomes and anything over 512 B.
type line struct {
	T string          `json:"t"`
	N int             `json:"n"`
	H string          `json:"h,omitempty"`
	M json.RawMessage `json:"m,omitempty"`
}

// transcript records what each session received, in order. Sessions are
// kept apart: the room broadcasts by ranging over a map, so only the order
// within one session is defined.
type transcript struct {
	mu       sync.Mutex
	sessions map[string][]line
}

func newTranscript() *transcript { return &transcript{sessions: map[string][]line{}} }

// add records v as wsconn would write it (json.Marshal).
func (tr *transcript) add(session string, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	var h struct {
		T string `json:"t"`
	}
	_ = json.Unmarshal(b, &h)
	tr.addRaw(session, h.T, b)
}

func (tr *transcript) addRaw(session, typ string, b []byte) {
	l := line{T: typ, N: len(b)}
	if typ == "snap" || typ == "welcome" || len(b) > 512 {
		sum := sha256.Sum256(b)
		l.H = hex.EncodeToString(sum[:8])
	} else {
		l.M = slices.Clone(b)
	}
	tr.mu.Lock()
	tr.sessions[session] = append(tr.sessions[session], l)
	tr.mu.Unlock()
}

// bytes renders every session (sorted by name) as "## name" then one JSON
// line per message. Lines of sessions named "sink*" are sorted: the room
// records tallies by ranging over a map.
func (tr *transcript) bytes() []byte {
	tr.mu.Lock()
	defer tr.mu.Unlock()
	names := make([]string, 0, len(tr.sessions))
	for n := range tr.sessions {
		names = append(names, n)
	}
	sort.Strings(names)
	var b bytes.Buffer
	for _, n := range names {
		b.WriteString("## " + n + "\n")
		var rows []string
		for _, l := range tr.sessions[n] {
			j, _ := json.Marshal(l)
			rows = append(rows, string(j))
		}
		if len(n) >= 4 && n[:4] == "sink" {
			sort.Strings(rows)
		}
		for _, r := range rows {
			b.WriteString(r + "\n")
		}
	}
	return b.Bytes()
}

// rec is a room.Sender that records into a transcript.
type rec struct {
	tr   *transcript
	name string
}

func (r rec) Send(v any) bool { r.tr.add(r.name, v); return true }
func (r rec) Close()          { r.tr.addRaw(r.name, "close", []byte(`{"t":"close"}`)) }

// deterministic runs a scenario twice and fails unless both transcripts
// are equal; a golden file of a non-deterministic scenario guards nothing.
func deterministic(t *testing.T, run func() []byte) []byte {
	t.Helper()
	a, b := run(), run()
	if !bytes.Equal(a, b) {
		t.Fatalf("scenario is not deterministic (line %d differs)", firstDiff(a, b))
	}
	return a
}

type verdict int

const (
	same      verdict = iota
	otherArch         // golden files exist, but only for other architectures
	missing
	differs
)

// compare compares got with <dir>/<name>.<arch>.golden. A file only for
// another GOARCH is otherArch: float results may differ across
// architectures (FMA), so there only determinism is checked.
func compare(dir, name, arch string, got []byte) (verdict, string) {
	path := filepath.Join(dir, name+"."+arch+".golden")
	want, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		if others, _ := filepath.Glob(filepath.Join(dir, name+".*.golden")); len(others) > 0 {
			return otherArch, fmt.Sprintf("%s: golden files exist only for %v; on %s only determinism is checked", name, others, arch)
		}
		return missing, path + " missing: it is created by the Phase 0 task that owns it"
	}
	if err != nil {
		return differs, err.Error()
	}
	if !bytes.Equal(got, want) {
		out := filepath.Join(os.TempDir(), "golden-actual-"+name+".txt")
		_ = os.WriteFile(out, got, 0o644)
		return differs, fmt.Sprintf("%s differs from %s at line %d; actual written to %s", name, path, firstDiff(got, want), out)
	}
	return same, ""
}

// check compares got with testdata/<name>.<GOARCH>.golden; with -update it
// writes the file instead.
func check(t *testing.T, name string, got []byte) {
	t.Helper()
	if *update {
		if err := os.MkdirAll("testdata", 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join("testdata", name+"."+runtime.GOARCH+".golden"), got, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	switch v, msg := compare("testdata", name, runtime.GOARCH, got); v {
	case otherArch:
		t.Skip(msg)
	case missing, differs:
		t.Fatal(msg)
	}
}

func firstDiff(a, b []byte) int {
	la, lb := bytes.Split(a, []byte("\n")), bytes.Split(b, []byte("\n"))
	for i := range min(len(la), len(lb)) {
		if !bytes.Equal(la[i], lb[i]) {
			return i + 1
		}
	}
	return min(len(la), len(lb)) + 1
}
