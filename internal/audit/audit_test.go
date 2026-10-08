//go:build unix

package audit

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

var t0 = time.Date(2026, 10, 8, 15, 0, 0, 0, time.UTC)

func lower(s string) string { return strings.ReplaceAll(strings.ToLower(s), " ", "") }

func lines(t *testing.T, path string) []string {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var out []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		out = append(out, sc.Text())
	}
	return out
}

func TestRecordWritesMonthFiles(t *testing.T) {
	dir := t.TempDir()
	l, err := Open(dir, nil, func() time.Time { return t0 })
	if err != nil {
		t.Fatal(err)
	}
	l.Record(Event{Event: Join, Pilot: "ab12cd34ef", Name: " Ali ", Accepted: "Ali", IP: "192.0.2.7", Room: "ABCD"})
	l.Record(Event{T: t0.AddDate(0, 1, 0), Event: Leave, Pilot: "ab12cd34ef", Accepted: "Ali", Room: "ABCD"})
	l.Close()
	l.Record(Event{Event: Join}) // after Close: ignored, no panic
	oct := lines(t, filepath.Join(dir, Dir, "sessions-2026-10.jsonl"))
	nov := lines(t, filepath.Join(dir, Dir, "sessions-2026-11.jsonl"))
	if len(oct) != 1 || len(nov) != 1 {
		t.Fatal(oct, nov)
	}
	if want := `{"t":"2026-10-08T15:00:00Z","event":"join","pilot":"ab12cd34ef","name":" Ali ","accepted":"Ali","ip":"192.0.2.7","room":"ABCD"}`; oct[0] != want {
		t.Fatalf("%s\n%s", oct[0], want)
	}
	fi, _ := os.Stat(filepath.Join(dir, Dir, "sessions-2026-10.jsonl"))
	di, _ := os.Stat(filepath.Join(dir, Dir))
	if fi.Mode().Perm() != 0o600 || di.Mode().Perm() != 0o700 {
		t.Fatal(fi.Mode(), di.Mode())
	}
}

// Blue and green append to the same month file at once: every line whole.
func TestTwoWritersAppend(t *testing.T) {
	dir := t.TempDir()
	const n = 500
	var wg sync.WaitGroup
	for _, colour := range []string{"blue", "green"} {
		l, err := Open(dir, nil, func() time.Time { return t0 })
		if err != nil {
			t.Fatal(err)
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range n {
				l.Record(Event{Event: Join, Name: fmt.Sprintf("%s-%d-%s", colour, i, strings.Repeat("x", 200)), Room: colour})
				if i%100 == 0 {
					time.Sleep(time.Millisecond) // let the queue drain: this test is about the file, not the buffer
				}
			}
			l.Close()
			if l.Dropped() != 0 {
				t.Errorf("%s dropped %d", colour, l.Dropped())
			}
		}()
	}
	wg.Wait()
	got, err := Query(dir, func(Event) bool { return true }, 10*n)
	if err != nil {
		t.Fatal(err)
	}
	if all := lines(t, filepath.Join(dir, Dir, "sessions-2026-10.jsonl")); len(all) != 2*n || len(got) != 2*n {
		t.Fatalf("lines %d, parsed %d, want %d", len(all), len(got), 2*n)
	}
}

func TestQuery(t *testing.T) {
	dir := t.TempDir()
	l, _ := Open(dir, nil, nil)
	l.Record(Event{T: t0, Event: Join, Pilot: "aaaa1111bbbb2222", Name: "Zorlu Kartal", Accepted: "Zorlu Kartal", IP: "192.0.2.7", Room: "AAAA"})
	l.Record(Event{T: t0.Add(time.Minute), Event: NameRefused, Pilot: "cccc3333dddd4444", Name: "zorlu  kartal", IP: "2001:db8:1:2::9"})
	l.Record(Event{T: t0.Add(2 * time.Minute), Event: Leave, Pilot: "aaaa1111bbbb2222", Accepted: "Zorlu Kartal", IP: "192.0.2.7", Room: "AAAA"})
	l.Record(Event{T: t0.AddDate(0, -2, 0), Event: Join, Pilot: "eeee5555", Name: "Ali", Accepted: "Ali", IP: "198.51.100.1"})
	l.Close()
	byName, _ := ByName("ZORLU kartal", lower)
	got, err := Query(dir, byName, 10)
	if err != nil || len(got) != 3 || got[0].Event != Leave || got[2].Event != Join {
		t.Fatalf("%v %+v", err, got)
	}
	if got, _ := Query(dir, byName, 1); len(got) != 1 || got[0].Event != Leave {
		t.Fatalf("limit: %+v", got)
	}
	ip, _ := ByIP("192.0.2.7")
	if got, _ := Query(dir, ip, 10); len(got) != 2 {
		t.Fatalf("ip: %+v", got)
	}
	net, _ := ByIP("2001:db8:1:2::/64")
	if got, _ := Query(dir, net, 10); len(got) != 1 || got[0].Event != NameRefused {
		t.Fatalf("prefix: %+v", got)
	}
	p, _ := ByPilot("AAAA1111")
	if got, _ := Query(dir, p, 10); len(got) != 2 {
		t.Fatalf("pilot: %+v", got)
	}
	for _, bad := range []string{"", "abc", "zzzzzzzz"} {
		if _, err := ByPilot(bad); err == nil {
			t.Errorf("pilot %q", bad)
		}
	}
	if _, err := ByIP("not-an-ip"); err == nil {
		t.Fatal("bad ip")
	}
	if _, err := ByName("   ", lower); err == nil {
		t.Fatal("empty name")
	}
	if got, err := Query(t.TempDir(), p, 10); err != nil || got != nil {
		t.Fatal("no audit dir")
	}
}

func TestPrune(t *testing.T) {
	dir := t.TempDir()
	ad := filepath.Join(dir, Dir)
	os.MkdirAll(ad, 0o700)
	for _, n := range []string{"sessions-2025-08.jsonl", "sessions-2025-09.jsonl", "sessions-2025-10.jsonl", "sessions-2026-10.jsonl", "notes.txt", "sessions-2020-01.jsonl.bak"} {
		os.WriteFile(filepath.Join(ad, n), []byte("{}\n"), 0o600)
	}
	n, err := Prune(dir, DefaultRetention, t0) // cut: 2025-10-08
	if err != nil || n != 2 {
		t.Fatal(n, err)
	}
	left, _ := os.ReadDir(ad)
	var names []string
	for _, e := range left {
		names = append(names, e.Name())
	}
	if strings.Join(names, ",") != "notes.txt,sessions-2020-01.jsonl.bak,sessions-2025-10.jsonl,sessions-2026-10.jsonl" {
		t.Fatal(names)
	}
	if n, err := Prune(t.TempDir(), DefaultRetention, t0); n != 0 || err != nil {
		t.Fatal("no dir")
	}
}
