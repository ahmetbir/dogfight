package moderation

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// Patterns and names here are made up; real entries live only on the
// server. The evasions are the reviewer's, applied to a made-up name.
func TestNormalizeSameSkeleton(t *testing.T) {
	base := Normalize("Zorlu Kartal")
	for _, in := range []string{
		"ZORLU KARTAL",
		"z o r l u  k a r t a l",
		"z.o-r_l*u~kartal",
		"ZorIu KartaI", // capital I for l
		"Zor1u Karta|", // 1 and |
		"Zor!u Kartal", // !
		"Zorⅼu Kartaⅼ", // U+217C small Roman numeral fifty
		"ᴢᴏʀʟᴜ ᴋᴀʀᴛᴀʟ", // small capitals
		"𝐙𝐨𝐫𝐥𝐮 𝐊𝐚𝐫𝐭𝐚𝐥",   // math bold
		"𝔷𝔬𝔯𝔩𝔲 𝔨𝔞𝔯𝔱𝔞𝔩",   // math fraktur
		"ｚｏｒｌｕ ｋａｒｔａｌ",   // fullwidth
		"zоrlu kаrtаl",   // Cyrillic о а
		"z​orlu‍ kartal", // zero-width characters
		"zo̧rlu kar̆tal", // combining marks
		"z0rlu k4r7al",   // leetspeak
		"Zorlu‮Kartal",   // RTL override
	} {
		if got := Normalize(in); got != base {
			t.Errorf("Normalize(%q) = %q, want %q", in, got, base)
		}
	}
	// Turkish letters, the C look-alikes and the I/l class.
	for _, c := range [][2]string{
		{"ÇOBANCI", "cobanci"}, {"Çobancı", "COBANCİ"}, {"ℂobanci", "cobanci"}, {"Ϲobanci", "cobanci"},
		{"Ҫobanci", "cobanci"}, {"Ꮯobanci", "cobanci"}, {"Ⅽobanci", "cobanci"}, {"Coban!", "cobani"},
		{"İĞNE ışık", "igne isik"}, {"Halil", "HaIiI"}, {"ŞĞÖÜ", "sgou"},
	} {
		if Normalize(c[0]) != Normalize(c[1]) {
			t.Errorf("%q and %q differ: %q %q", c[0], c[1], Normalize(c[0]), Normalize(c[1]))
		}
	}
	if Normalize("🙂ab🙂c") != "abc" || Normalize("") != "" {
		t.Fatal("symbols")
	}
}

func TestBlocked(t *testing.T) {
	l, err := NewList([]string{"zorlu kartal", "Gök Börü", "*xbad*", "=tam ad"})
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name string
		want bool
	}{
		{"zorlu kartal", true},
		{"ZorIu KartaI", true},
		{"z o r l u k a r t a l", true},
		{"zorlu_kartal99", true}, // digits glued on are a word of their own
		{"xx z0rlu k4r7al xx", true},
		{"zzoorrlluu kkaarrttaall", true}, // doubled letters: squashed match
		{"Zorlu.Kartal", true},
		{"gok boru", true},
		{"G0K B0RÜ", true},
		{"gökbörü", true},
		{"xxzorlukartal", false}, // words mode: not inside a longer word
		{"zorlu", false},
		{"kartal", false},
		{"abcXBADdef", true}, // *part*: anywhere
		{"tam ad", true},
		{"Tam Ad 2", false}, // =exact: the whole name only
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

// Short word patterns do not block ordinary Turkish names that contain them.
func TestShortPatternsSpareOrdinaryNames(t *testing.T) {
	l, _ := NewList([]string{"sik", "ali", "anna"})
	for _, n := range []string{"Işık", "Isik", "Aşık Veysel", "Kasık", "Sıkı", "Halil", "Salih", "Vitali", "Kaliteli", "banana", "Hasan"} {
		if l.Blocked(n) {
			t.Errorf("%q blocked", n)
		}
	}
	for _, n := range []string{"sik", "S.I.K", "Ali", "Ali Veli", "x anna x", "ali_99"} {
		if !l.Blocked(n) {
			t.Errorf("%q not blocked", n)
		}
	}
	part, _ := NewList([]string{"*sik*"})
	if !part.Blocked("Işık") {
		t.Fatal("*part* matches inside words (documented)")
	}
}

func TestBadPatterns(t *testing.T) {
	for _, p := range []string{"", "ab", "  a.b  ", "-- ..", strings.Repeat("x", 65)} {
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
	exact, _ := Matcher("=zorlu kartal")
	if !exact("ZORLU KARTAL") || exact("zorlu kartal 2") {
		t.Fatal("exact")
	}
}

func TestModesAreDistinctPatterns(t *testing.T) {
	if same("ali", "=ali") || same("ali", "*ali*") || !same("Ali", "ALI") || !same("*a l i*", "*ali*") {
		t.Fatal("same")
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
// A corrupt file keeps the running list, a restart falls back to the last
// good copy, and an edit sets the corrupt file aside (never deletes it) and
// continues from the last good list.
func TestCorruptFileKeepsLastGood(t *testing.T) {
	dir := t.TempDir()
	n, _ := Open(dir, nil)
	n.Block("zorlu kartal")
	path := filepath.Join(dir, FileName)
	broken := []byte(`{"blockedNames":[`)
	os.WriteFile(path, broken, 0o600)
	n.Reload()
	if !n.Blocked("zorlu kartal") {
		t.Fatal("running list kept")
	}
	restarted, err := Open(dir, nil)
	if err == nil || !restarted.Blocked("zorlu kartal") {
		t.Fatal("restart: error reported and the last good copy loaded", err)
	}
	if ok, err := restarted.Block("gok boru"); !ok || err != nil {
		t.Fatal(ok, err)
	}
	if !restarted.Blocked("zorlu kartal") || !restarted.Blocked("gok boru") {
		t.Fatal("edit from the last good list")
	}
	aside, _ := filepath.Glob(filepath.Join(dir, FileName+".corrupt-*"))
	if len(aside) != 1 {
		t.Fatal("corrupt file set aside", aside)
	}
	if b, _ := os.ReadFile(aside[0]); string(b) != string(broken) {
		t.Fatal("corrupt file kept as it was")
	}
	fresh, err := Open(dir, nil)
	if err != nil || len(fresh.Patterns()) != 2 {
		t.Fatal(err, fresh.Patterns())
	}
}

// A bad pattern written by hand is a corrupt file too (it fails whole).
func TestBadPatternInFileFallsBack(t *testing.T) {
	dir := t.TempDir()
	n, _ := Open(dir, nil)
	n.Block("zorlu kartal")
	os.WriteFile(filepath.Join(dir, FileName), []byte(`{"blockedNames":["zorlu kartal","ab"]}`), 0o600)
	again, err := Open(dir, nil)
	if err == nil || !again.Blocked("zorlu kartal") {
		t.Fatal(err)
	}
}

// Blue and green edit at once: every edit lands (moderation.lock).
func TestConcurrentEditsAcrossInstances(t *testing.T) {
	dir := t.TempDir()
	a, _ := Open(dir, nil)
	b, _ := Open(dir, nil)
	var wg sync.WaitGroup
	for i := range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			n := a
			if i%2 == 1 {
				n = b
			}
			if _, err := n.Block(fmt.Sprintf("pilot%c%c%c", 'a'+i, 'a'+i, 'b'+i)); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	a.Reload()
	if got := len(a.Patterns()); got != 20 {
		t.Fatalf("%d of 20 edits kept: %v", got, a.Patterns())
	}
}
