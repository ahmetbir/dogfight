package golden

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"hash"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"testing"
)

var update = flag.Bool("update", false, "rewrite golden files (Phase 0 tasks only)")

// big is the size above which a message is kept as a hash next to a
// readable prefix instead of in full.
const big = 2048

// line is one recorded message: its type and size, and the message itself
// when small (JSON as is, anything else as a JSON string), else a hash and
// a readable prefix. A run (see addRun) is one line: C messages, N bytes
// in all, one hash over them.
type line struct {
	T string          `json:"t"`
	C int             `json:"c,omitempty"`
	N int             `json:"n"`
	H string          `json:"h,omitempty"`
	P string          `json:"p,omitempty"`
	M json.RawMessage `json:"m,omitempty"`
}

// snapRun is a session's open run of messages.
type snapRun struct {
	c, n int
	h    hash.Hash
}

// transcript records what each session received, in order. Sessions are
// kept apart: the room broadcasts by ranging over a map, so only the order
// within one session is defined.
type transcript struct {
	mu       sync.Mutex
	sessions map[string][]line
	runs     map[string]*snapRun
}

func newTranscript() *transcript {
	return &transcript{sessions: map[string][]line{}, runs: map[string]*snapRun{}}
}

// add records v as wsconn would write it (json.Marshal).
func (tr *transcript) add(session string, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	var h struct {
		T string `json:"t"`
	}
	if err := json.Unmarshal(b, &h); err != nil {
		panic(fmt.Sprintf("%s: %T has no string t: %v", session, v, err))
	}
	tr.addRaw(session, h.T, b)
}

// addRaw records one message of type typ; b need not be JSON.
func (tr *transcript) addRaw(session, typ string, b []byte) {
	l := line{T: typ, N: len(b)}
	switch {
	case typ == "welcome" || len(b) > big:
		sum := sha256.Sum256(b)
		l.H = hex.EncodeToString(sum[:8])
		l.P = strings.ToValidUTF8(string(b[:min(len(b), 160)]), "")
	case json.Valid(b):
		l.M = bytes.Clone(b)
	default:
		l.M, _ = json.Marshal(string(b))
	}
	tr.mu.Lock()
	defer tr.mu.Unlock()
	tr.closeRun(session)
	tr.sessions[session] = append(tr.sessions[session], l)
}

// addRun adds a message to session's open run: messages that come by the
// hundred (snapshots) are kept as one hashed line per stretch between
// other messages.
func (tr *transcript) addRun(session string, b []byte) {
	tr.mu.Lock()
	defer tr.mu.Unlock()
	r := tr.runs[session]
	if r == nil {
		r = &snapRun{h: sha256.New()}
		tr.runs[session] = r
	}
	r.c++
	r.n += len(b)
	r.h.Write(b)
	r.h.Write([]byte{'\n'})
}

// closeRun ends session's open run with its line; tr.mu is held.
func (tr *transcript) closeRun(session string) {
	r := tr.runs[session]
	if r == nil {
		return
	}
	delete(tr.runs, session)
	tr.sessions[session] = append(tr.sessions[session], line{T: "run", C: r.c, N: r.n, H: hex.EncodeToString(r.h.Sum(nil)[:8])})
}

// bytes renders every session (sorted by name) as "## name" then one JSON
// line per message. Lines of sessions named "sink*" are sorted: the room
// records tallies by ranging over a map.
func (tr *transcript) bytes() []byte {
	tr.mu.Lock()
	defer tr.mu.Unlock()
	for n := range tr.runs {
		tr.closeRun(n)
	}
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
			j, err := json.Marshal(l)
			if err != nil {
				panic(fmt.Sprintf("%s: %v", n, err))
			}
			rows = append(rows, string(j))
		}
		if strings.HasPrefix(n, "sink") {
			sort.Strings(rows)
		}
		for _, r := range rows {
			b.WriteString(r + "\n")
		}
	}
	return b.Bytes()
}

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
// another flavour (GOARCH, race build) is otherArch: float results may
// differ across them (FMA), so there only determinism is checked.
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

// flavour is the file tag of name's golden for this build: GOARCH, or
// GOARCH+"-race" in a race detector build (see raceBuild) when name has a
// race file of its own; most scenarios do not need one.
func flavour(name string) string {
	race := runtime.GOARCH + "-race"
	if _, err := os.Stat(filepath.Join("testdata", name+"."+race+".golden")); raceBuild && err == nil {
		return race
	}
	return runtime.GOARCH
}

// check compares got with testdata/<name>.<flavour>.golden; with -update it
// writes the file instead. A race build writes a race file only where its
// output differs from the plain build's file.
func check(t *testing.T, name string, got []byte) {
	t.Helper()
	if *update {
		tag := runtime.GOARCH
		if raceBuild {
			if v, _ := compare("testdata", name, tag, got); v == same {
				return
			}
			tag += "-race"
		}
		if err := os.MkdirAll("testdata", 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join("testdata", name+"."+tag+".golden"), got, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	switch v, msg := compare("testdata", name, flavour(name), got); v {
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
