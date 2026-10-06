package stats

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// do runs f inside the actor, after every message queued before it.
func (s *Store) do(f func(*Store)) {
	s.call(func(s *Store) (bool, error) { f(s); return false, nil })
}

func TestPilotCreationThreshold(t *testing.T) {
	c := &clock{t0}
	s := open(t, t.TempDir(), c, Options{})
	defer s.Close()
	s.Record(Delta{Pilot: "a", Name: "A", Matches: 1, Flight: minFlight - 1})
	s.Record(Delta{Pilot: "b", Flight: minFlight})
	s.Record(Delta{Pilot: "c", Deaths: 1})
	s.Record(Delta{Pilot: "d", Kills: 1, BotKills: 1})
	s.Record(Delta{Pilot: "b", Matches: 1}) // existing pilots take any delta
	for _, k := range []string{"a", "c", "d"} {
		if _, ok := s.Me(k); ok {
			t.Fatalf("pilot %s created without a minute in the air", k)
		}
	}
	if p, ok := s.Me("b"); !ok || p.Matches != 1 {
		t.Fatalf("pilot b not created or existing pilot delta lost: %+v", p)
	}
}

func TestEvictionPrefersPilotsWithoutKills(t *testing.T) {
	c := &clock{t0}
	s := open(t, t.TempDir(), c, Options{MaxPilots: 3})
	defer s.Close()
	s.Record(Delta{Pilot: "ace", Kills: 1, Flight: minFlight})
	for i, k := range []string{"x", "y", "z"} {
		c.now = t0.Add(time.Duration(i+1) * time.Hour)
		s.Record(Delta{Pilot: k, Deaths: 1, Flight: minFlight})
	}
	if _, ok := s.Me("x"); ok {
		t.Fatal("the oldest pilot without kills goes first")
	}
	if _, ok := s.Me("ace"); !ok {
		t.Fatal("an older pilot with kills is kept")
	}
}

func TestEvictionRunsInBatches(t *testing.T) {
	c := &clock{t0}
	s := open(t, t.TempDir(), c, Options{MaxPilots: 500})
	defer s.Close()
	for i := range 501 {
		c.now = t0.Add(time.Duration(i) * time.Second)
		s.Record(Delta{Pilot: string(rune('A'+i%26)) + strings.Repeat("x", i/26), Deaths: 1, Flight: minFlight})
	}
	var n int
	s.do(func(s *Store) { n = len(s.pilots) })
	if n != 500-500/evictDivisor+1 {
		t.Fatalf("pilots after one batch eviction: %d", n)
	}
}

func TestBotKillsStayOffLeaderboard(t *testing.T) {
	c := &clock{t0}
	s := open(t, t.TempDir(), c, Options{})
	defer s.Close()
	s.Record(Delta{Pilot: "a", Name: "A", BotKills: 9, Deaths: 1, Flight: minFlight})
	s.Record(Delta{Pilot: "b", Name: "B", Kills: 1, Flight: minFlight})
	for _, p := range []Period{Week, All} {
		if top, _ := s.Top(p, 20); len(top) != 1 || top[0].Name != "B" {
			t.Fatalf("period %d: %+v", p, top)
		}
	}
	if p, _ := s.Me("a"); p.BotKills != 9 || p.Kills != 0 || p.WeekKills != 0 {
		t.Fatalf("card %+v", p)
	}
}

func TestOnDiskJSONKeys(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	s := open(t, dir, c, Options{})
	s.Record(Delta{Pilot: "aa", Name: "A", Kills: 2, BotKills: 1, Flight: minFlight})
	s.snapshotOnly()
	j, _ := os.ReadFile(filepath.Join(dir, journalName))
	if !strings.Contains(string(j), `"d":{"p":"aa","n":"A","k":2,"bk":1,`) {
		t.Fatalf("journal line %s", j)
	}
	s.Close()
	b, _ := os.ReadFile(filepath.Join(dir, snapName))
	var raw struct {
		V      int                       `json:"v"`
		Pilots map[string]map[string]any `json:"pilots"`
	}
	if err := json.Unmarshal(b, &raw); err != nil || raw.V != 1 {
		t.Fatalf("snapshot %s: %v", b, err)
	}
	p := raw.Pilots["aa"]
	for k, want := range map[string]float64{"kills": 2, "botKills": 1, "flight": minFlight, "weekKills": 2, "deaths": 0} {
		if p[k] != want {
			t.Fatalf("%s = %v in %s", k, p[k], b)
		}
	}
}

func TestWriteFailureIsNotSticky(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	s := open(t, dir, c, Options{})
	s.do(func(s *Store) { s.journal.Close() }) // every write now fails (EBADF)
	s.Record(Delta{Pilot: "aa", Name: "A", Kills: 1, Flight: minFlight})
	s.Record(Delta{Pilot: "aa", Name: "A", Kills: 1, Flight: minFlight})
	if _, ok := s.Me("aa"); ok || s.Dropped() != 2 {
		t.Fatalf("failed writes must drop and count: dropped %d", s.Dropped())
	}
	s.do(func(s *Store) {
		f, err := os.OpenFile(filepath.Join(dir, journalName), os.O_WRONLY|os.O_APPEND, 0o600)
		if err != nil {
			t.Error(err)
			return
		}
		s.journal = f
		s.w.Reset(f)
	})
	s.Record(Delta{Pilot: "aa", Name: "A", Kills: 2, Flight: minFlight})
	if p, _ := s.Me("aa"); p.Kills != 2 {
		t.Fatalf("writes did not recover: %+v", p)
	}
	s.crash()
	s = open(t, dir, c, Options{})
	defer s.Close()
	if p, _ := s.Me("aa"); p.Kills != 2 {
		t.Fatalf("after reopen %+v", p)
	}
}

func TestCompactionBackoffAndJournalCap(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	const maxJ = 300
	s := open(t, dir, c, Options{MaxJournal: maxJ})
	defer s.Close()
	s.do(func(s *Store) { s.dir = filepath.Join(dir, "missing") }) // snapshots now fail
	attempts := func() (n int) { s.do(func(s *Store) { n = s.attempts }); return }
	for range 10 {
		s.Record(Delta{Pilot: "aa", Kills: 1, Flight: minFlight})
	}
	if a := attempts(); a != 1 {
		t.Fatalf("attempts within a minute of a failure: %d", a)
	}
	c.now = c.now.Add(61 * time.Second)
	s.Record(Delta{Pilot: "aa", Kills: 1, Flight: minFlight})
	if a := attempts(); a != 2 {
		t.Fatalf("attempts after a minute: %d", a)
	}
	for range 40 {
		s.Record(Delta{Pilot: "aa", Kills: 1, Flight: minFlight})
	}
	s.do(func(*Store) {}) // drain the queue
	st, _ := os.Stat(filepath.Join(dir, journalName))
	if s.Dropped() == 0 || st.Size() > 4*maxJ+maxLine {
		t.Fatalf("journal must stop growing: size %d dropped %d", st.Size(), s.Dropped())
	}
	s.do(func(s *Store) { s.dir = dir })
	c.now = c.now.Add(61 * time.Second)
	s.Record(Delta{Pilot: "aa", Kills: 1, Flight: minFlight})
	p, _ := s.Me("aa")
	if st, _ := os.Stat(filepath.Join(dir, journalName)); st.Size() > maxLine || p.Kills != 52-int(s.Dropped()) {
		t.Fatalf("recovery: journal %d, kills %d, dropped %d", st.Size(), p.Kills, s.Dropped())
	}
}

func TestDataDirTightenedTo0700(t *testing.T) {
	dir := t.TempDir()
	if err := os.Chmod(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	s := open(t, dir, &clock{t0}, Options{})
	defer s.Close()
	if st, _ := os.Stat(dir); st.Mode().Perm() != 0o700 {
		t.Fatalf("dir mode %v", st.Mode().Perm())
	}
}

func TestOverlongLineDropped(t *testing.T) {
	s := open(t, t.TempDir(), &clock{t0}, Options{})
	defer s.Close()
	s.Record(Delta{Pilot: "aa", Name: strings.Repeat("x", maxLine), Kills: 1, Flight: minFlight})
	if _, ok := s.Me("aa"); ok || s.Dropped() != 1 {
		t.Fatalf("over-long line kept, dropped %d", s.Dropped())
	}
}

func TestReplaySkipsGarbageLines(t *testing.T) {
	dir := t.TempDir()
	junk := strings.Repeat("z", 3*maxLine) + "\n" + "{not json}\n" +
		`{"seq":5,"at":1,"d":{"p":"aa","n":"A","k":4,"t":3600}}` + "\n"
	if err := os.WriteFile(filepath.Join(dir, journalName), []byte(junk), 0o600); err != nil {
		t.Fatal(err)
	}
	s := open(t, dir, &clock{t0}, Options{})
	defer s.Close()
	if p, _ := s.Me("aa"); p.Kills != 4 {
		t.Fatalf("line after garbage lost: %+v", p)
	}
}

func TestCloseIsIdempotentAndFinal(t *testing.T) {
	s := open(t, t.TempDir(), &clock{t0}, Options{})
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if s.Record(Delta{Pilot: "aa", Kills: 1, Flight: minFlight}) {
		t.Fatal("record after close accepted")
	}
	if _, ok := s.Me("aa"); ok {
		t.Fatal("me after close")
	}
	if top, wk := s.Top(All, 20); top != nil || wk != "" { // week "": no board (the API answers 503, caches nothing)
		t.Fatalf("top after close %v %q", top, wk)
	}
}

func TestCloseAppliesOrCountsEveryRecord(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t0}
	s := open(t, dir, c, Options{Buffer: 64})
	const writers, each = 4, 300
	var wg sync.WaitGroup
	for range writers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range each {
				s.Record(Delta{Pilot: "aa", Kills: 1, Flight: minFlight})
			}
		}()
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	dropped := s.Dropped()
	if s.Record(Delta{Pilot: "aa", Kills: 1, Flight: minFlight}) || s.Dropped() != dropped+1 {
		t.Fatal("record after close must be refused and counted")
	}
	s2 := open(t, dir, c, Options{})
	defer s2.Close()
	p, _ := s2.Me("aa")
	if uint64(p.Kills)+dropped != writers*each {
		t.Fatalf("kept %d + dropped %d != %d: records lost silently", p.Kills, dropped, writers*each)
	}
}
