package stats

import (
	"testing"
	"time"
)

func TestParsePeriodAndWeekKey(t *testing.T) {
	if p, ok := ParsePeriod("week"); !ok || p != Week {
		t.Fatal("week")
	}
	if p, ok := ParsePeriod("all"); !ok || p != All {
		t.Fatal("all")
	}
	for _, bad := range []string{"", "Week", "day", "all "} {
		if _, ok := ParsePeriod(bad); ok {
			t.Fatalf("accepted %q", bad)
		}
	}
	for at, want := range map[time.Time]string{
		t0: "2026-W41",
		time.Date(2027, 1, 1, 12, 0, 0, 0, time.UTC):                        "2026-W53",
		time.Date(2026, 10, 12, 1, 30, 0, 0, time.FixedZone("TRT", 3*3600)): "2026-W41", // Monday locally, Sunday 22:30 UTC
	} {
		if got := WeekKey(at); got != want {
			t.Fatalf("WeekKey(%v) = %s, want %s", at, got, want)
		}
	}
}

func TestFavoriteAndEmpty(t *testing.T) {
	if (Pilot{}).Favorite() != "" {
		t.Fatal("no kinds → no favorite")
	}
	if f := (Pilot{Kinds: map[string]int{"mig29": 50, "f16": 50, "a10": 10}}).Favorite(); f != "f16" {
		t.Fatalf("tie breaks alphabetically, got %s", f)
	}
	if !(Delta{Pilot: "a", Name: "A"}).Empty() || (Delta{Pilot: "a", Kinds: map[string]int{"f16": 2}}).Empty() || (Delta{BotKills: 1}).Empty() {
		t.Fatal("Empty")
	}
}

func TestTopOrderCutAndDefaults(t *testing.T) {
	c := &clock{t0}
	s := open(t, t.TempDir(), c, Options{})
	defer s.Close()
	s.Record(Delta{Pilot: "p1", Name: "Zeki", Kills: 3, Flight: minFlight})
	s.Record(Delta{Pilot: "p2", Name: "Ali", Kills: 3, Deaths: 2, Wins: 1, Matches: 4, Flight: minFlight})
	s.Record(Delta{Pilot: "p3", Kills: 7, Flight: minFlight})
	s.Record(Delta{Pilot: "p4", Name: "Can", Deaths: 1, Flight: minFlight}) // no kills: not on the board
	s.Record(Delta{Pilot: "p5", Name: "Ece", Kills: 1, Flight: minFlight})
	top, _ := s.Top(All, 3)
	want := []Entry{{"Pilot", 7, 0, 0, 0}, {"Ali", 3, 2, 1, 4}, {"Zeki", 3, 0, 0, 0}}
	if len(top) != len(want) {
		t.Fatalf("top %+v", top)
	}
	for i := range want {
		if top[i] != want[i] {
			t.Fatalf("top[%d] = %+v, want %+v", i, top[i], want[i])
		}
	}
	if top, _ := s.Top(All, 0); len(top) != 0 {
		t.Fatalf("n=0: %+v", top)
	}
}

func TestMeShowsZeroWeekKillsAfterRollover(t *testing.T) {
	c := &clock{t0}
	s := open(t, t.TempDir(), c, Options{})
	defer s.Close()
	s.Record(Delta{Pilot: "aa", Kills: 5, Flight: minFlight})
	c.now = t0.Add(8 * 24 * time.Hour)
	if p, _ := s.Me("aa"); p.Week != "2026-W42" || p.WeekKills != 0 || p.Kills != 5 {
		t.Fatalf("stale week shown: %+v", p)
	}
}

func TestOutOfOrderRecordsAcrossWeekBoundary(t *testing.T) {
	c := &clock{t0}
	s := open(t, t.TempDir(), c, Options{})
	defer s.Close()
	sunday := time.Date(2026, 10, 11, 23, 59, 59, 0, time.UTC) // W41
	monday := sunday.Add(2 * time.Second)                      // W42
	c.now = monday
	s.Record(Delta{Pilot: "aa", Kills: 2, Flight: minFlight})
	c.now = sunday // a room stamped this earlier, but it is applied later
	s.Record(Delta{Pilot: "aa", Kills: 1, Flight: minFlight})
	c.now = monday
	s.Record(Delta{Pilot: "aa", Kills: 3, Flight: minFlight})
	p, _ := s.Me("aa")
	if p.Week != "2026-W42" || p.WeekKills != 5 || p.Kills != 6 || p.Seen != monday.Unix() {
		t.Fatalf("out-of-order week handling: %+v", p)
	}
}
