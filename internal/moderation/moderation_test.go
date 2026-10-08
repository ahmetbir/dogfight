package moderation

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Patterns here are made up; real entries live only on the server.
func TestNormalize(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{"Zorlu Kartal", "zorlukartal"},
		{"ZORLU KARTAL", "zorlukartal"},
		{"z o r l u  k a r t a l", "zorlukartal"},
		{"z.o-r_l*u~kartal!", "zorlukartal"},
		{"İĞNE ışık", "igneisik"},
		{"ÇŞĞÖÜİ çşğöüı", "csgouicsgoui"},
		{"z0rlu k4r7al", "zorlukartal"},
		{"$1n1r @ma", "sinirama"},
		{"3l3m", "elem"},
		{"ｚｏｒｌｕ", "zorlu"},         // fullwidth
		{"c\u0327ag\u0306", "cag"}, // decomposed marks
		{"zоrlu", "zorlu"},         // Cyrillic о
		{"Ångström", "angstrom"},
		{"x\u200by\u200dz", "xyz"}, // zero-width characters
		{"🙂ab🙂c", "abc"},
		{"", ""},
	} {
		if got := Normalize(c.in); got != c.want {
			t.Errorf("Normalize(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestBlocked(t *testing.T) {
	l, err := NewList([]string{"zorlu kartal", "Gök Börü"})
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name string
		want bool
	}{
		{"zorlu kartal", true},
		{"ZORLU KARTAL", true},
		{"z o r l u k a r t a l", true},
		{"zorlu_kartal99", true},
		{"xx z0rlu k4r7al xx", true},
		{"zzoorrlluu kkaarrttaall", true}, // doubled letters: squashed match
		{"gok boru", true},
		{"G0K B0RÜ", true},
		{"gökbörü", true},
		{"zorlu", false},
		{"kartal", false},
		{"Pilot", false},
		{"", false},
	} {
		if got := l.Blocked(c.name); got != c.want {
			t.Errorf("Blocked(%q) = %v, want %v", c.name, got, c.want)
		}
	}
	var none *List
	if none.Blocked("zorlu kartal") {
		t.Fatal("nil list blocks nothing")
	}
}

// A short pattern is matched as typed; it never squashes into a shorter one
// that would block unrelated names ("anna" → "ana" would block "banana").
func TestShortPatternNotSquashed(t *testing.T) {
	l, _ := NewList([]string{"anna"})
	if l.Blocked("banana") || !l.Blocked("x anna x") {
		t.Fatal("short pattern")
	}
}

func TestBadPatterns(t *testing.T) {
	for _, p := range []string{"", "ab", "  a.b  ", "!!!!", strings.Repeat("x", 65)} {
		if _, err := NewList([]string{p}); !errors.Is(err, ErrPattern) {
			t.Errorf("%q: %v", p, err)
		}
	}
}

func TestMatcher(t *testing.T) {
	m, err := Matcher("Zorlu Kartal")
	if err != nil || !m("z0rlu_k4rtal") || m("kartal") {
		t.Fatal(err)
	}
}

func TestMissingFileIsEmpty(t *testing.T) {
	n, err := Open(t.TempDir(), nil)
	if err != nil || n.Blocked("anything") || len(n.Patterns()) != 0 {
		t.Fatal(err)
	}
	var nilNames *Names
	if nilNames.Blocked("x") {
		t.Fatal("nil Names")
	}
}

func TestBlockUnblockPersists(t *testing.T) {
	dir := t.TempDir()
	n, _ := Open(dir, nil)
	if ok, err := n.Block("zorlu kartal"); !ok || err != nil {
		t.Fatal(ok, err)
	}
	if ok, _ := n.Block("ZORLU  KARTAL"); ok {
		t.Fatal("an equivalent pattern is already listed")
	}
	if _, err := n.Block("ab"); !errors.Is(err, ErrPattern) {
		t.Fatal(err)
	}
	if !n.Blocked("Zorlu Kartal 7") {
		t.Fatal("blocked at once in the writing server")
	}
	fi, err := os.Stat(filepath.Join(dir, FileName))
	if err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatal(err, fi.Mode())
	}
	again, _ := Open(dir, nil)
	if !again.Blocked("zorlu kartal") {
		t.Fatal("persisted")
	}
	if ok, _ := again.Unblock("Zorlu Kartal"); !ok || again.Blocked("zorlu kartal") {
		t.Fatal("unblock")
	}
	if ok, _ := again.Unblock("zorlu kartal"); ok {
		t.Fatal("nothing left to unblock")
	}
	if left, _ := filepath.Glob(filepath.Join(dir, "*.tmp*")); len(left) != 0 {
		t.Fatal("temp files left", left)
	}
}

// Two servers (blue and green) share the data dir: a block written by one
// reaches the other on its next reload, and a write keeps the other's entries.
func TestReloadAcrossInstances(t *testing.T) {
	dir := t.TempDir()
	blue, _ := Open(dir, nil)
	green, _ := Open(dir, nil)
	if _, err := blue.Block("zorlu kartal"); err != nil {
		t.Fatal(err)
	}
	if green.Blocked("zorlu kartal") {
		t.Fatal("green has not reloaded yet")
	}
	green.Reload()
	if !green.Blocked("zorlu kartal") {
		t.Fatal("green after reload")
	}
	if _, err := green.Block("gok boru"); err != nil {
		t.Fatal(err)
	}
	blue.Reload()
	if !blue.Blocked("zorlu kartal") || !blue.Blocked("gökbörü") || len(blue.Patterns()) != 2 {
		t.Fatal(blue.Patterns())
	}
}

func TestWatchReloads(t *testing.T) {
	dir := t.TempDir()
	n, _ := Open(dir, nil)
	ctx := t.Context()
	go n.Watch(ctx, 5*time.Millisecond)
	if err := os.WriteFile(filepath.Join(dir, FileName), []byte(`{"blockedNames":["zorlu kartal"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for !n.Blocked("zorlu kartal") {
		if time.Now().After(deadline) {
			t.Fatal("not reloaded")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// A broken file keeps the previous list and refuses edits (nothing is overwritten).
func TestBadFileKeepsList(t *testing.T) {
	dir := t.TempDir()
	n, _ := Open(dir, nil)
	n.Block("zorlu kartal")
	path := filepath.Join(dir, FileName)
	os.WriteFile(path, []byte(`{"blockedNames":[`), 0o600)
	n.Reload()
	if !n.Blocked("zorlu kartal") {
		t.Fatal("previous list kept")
	}
	if _, err := n.Block("gok boru"); err == nil {
		t.Fatal("edit over a broken file")
	}
	if b, _ := os.ReadFile(path); string(b) != `{"blockedNames":[` {
		t.Fatal("broken file overwritten")
	}
	if _, err := Open(dir, nil); err == nil {
		t.Fatal("Open reports a broken file")
	}
}
