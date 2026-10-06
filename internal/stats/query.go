package stats

import (
	"fmt"
	"sort"
	"time"
)

// minFlight is the airborne time (ticks at 60 Hz) a session needs to create
// a pilot record without any kill or death: 60 s. MinFlightTicks exports it
// (the pilot's manual quotes it; internal/match checks the quote).
const minFlight = 60 * 60

const MinFlightTicks = minFlight

// Delta is one session's tally for one pilot, as the room reports it.
type Delta struct {
	Pilot    string         `json:"p"` // hex sha256 of the token
	Name     string         `json:"n,omitempty"`
	Kills    int            `json:"k,omitempty"`  // human victims only: the leaderboard counts these
	BotKills int            `json:"bk,omitempty"` // bot victims: personal card only
	Deaths   int            `json:"d,omitempty"`
	Crashes  int            `json:"c,omitempty"`
	Wins     int            `json:"w,omitempty"`
	Matches  int            `json:"m,omitempty"`
	Fired    int            `json:"f,omitempty"`
	Hits     int            `json:"h,omitempty"`
	Flight   int            `json:"t,omitempty"`  // airborne ticks
	Kinds    map[string]int `json:"kd,omitempty"` // aircraft kind → airborne ticks
}

// Empty reports whether d carries no counts (the name alone does not count).
func (d Delta) Empty() bool {
	return d.Kills == 0 && d.BotKills == 0 && d.Deaths == 0 && d.Crashes == 0 && d.Wins == 0 &&
		d.Matches == 0 && d.Fired == 0 && d.Hits == 0 && d.Flight == 0 && len(d.Kinds) == 0
}

// qualifies reports whether d may create a new pilot record: a minute in the
// air (ruling: a death alone, scripted at 20 joins/min, must not fill the store).
func (d Delta) qualifies() bool {
	return d.Flight >= minFlight
}

// Pilot is one pilot's lifetime record; it is also the snapshot's on-disk format.
type Pilot struct {
	Name      string         `json:"name"`
	Kills     int            `json:"kills"`    // human victims
	BotKills  int            `json:"botKills"` // bot victims
	Deaths    int            `json:"deaths"`
	Crashes   int            `json:"crashes"`
	Wins      int            `json:"wins"`
	Matches   int            `json:"matches"`
	Fired     int            `json:"fired"`
	Hits      int            `json:"hits"`
	Flight    int            `json:"flight"` // airborne ticks
	Kinds     map[string]int `json:"kinds,omitempty"`
	Week      string         `json:"week"`
	WeekKills int            `json:"weekKills"` // human victims this week
	Seen      int64          `json:"seen"`
}

// Favorite is the kind with the most airborne ticks (ties: alphabetical), "" if none.
func (p Pilot) Favorite() string {
	best, ticks := "", 0
	for k, v := range p.Kinds {
		if v > ticks || v == ticks && v > 0 && k < best {
			best, ticks = k, v
		}
	}
	return best
}

// Entry is one leaderboard row.
type Entry struct {
	Name    string `json:"name"`
	Kills   int    `json:"kills"`
	Deaths  int    `json:"deaths"`
	Wins    int    `json:"wins"`
	Matches int    `json:"matches"`
}

type Period uint8

const (
	Week Period = iota + 1
	All
)

// ParsePeriod accepts exactly "week" or "all".
func ParsePeriod(s string) (Period, bool) {
	switch s {
	case "week":
		return Week, true
	case "all":
		return All, true
	}
	return 0, false
}

// WeekKey is the ISO week of t in UTC, e.g. "2026-W41".
func WeekKey(t time.Time) string {
	y, w := t.UTC().ISOWeek()
	return fmt.Sprintf("%d-W%02d", y, w)
}

const defaultName = "Pilot"

type ranked struct {
	key   string
	name  string
	kills int
	p     *Pilot
}

// before orders by kills descending, then name, then key (stable across calls).
func (a ranked) before(b ranked) bool {
	if a.kills != b.kills {
		return a.kills > b.kills
	}
	if a.name != b.name {
		return a.name < b.name
	}
	return a.key < b.key
}

// top returns the n best pilots of the period: Week ranks this week's
// WeekKills, All ranks lifetime Kills. Pilots without a kill in the period
// are left out. It keeps a sorted window of n, so it never sorts the store.
func (s *Store) top(p Period, n int) ([]Entry, string) {
	week := WeekKey(s.o.Now())
	if n <= 0 {
		return []Entry{}, week
	}
	best := make([]ranked, 0, n)
	for k, pl := range s.pilots {
		kills := pl.Kills
		if p == Week {
			if pl.Week != week {
				continue
			}
			kills = pl.WeekKills
		}
		if kills <= 0 {
			continue
		}
		r := ranked{key: k, name: pl.Name, kills: kills, p: pl}
		if r.name == "" {
			r.name = defaultName
		}
		i := sort.Search(len(best), func(i int) bool { return r.before(best[i]) })
		if i >= n {
			continue
		}
		if len(best) < n {
			best = append(best, ranked{})
		}
		copy(best[i+1:], best[i:len(best)-1])
		best[i] = r
	}
	out := make([]Entry, len(best))
	for i, r := range best {
		out[i] = Entry{Name: r.name, Kills: r.kills, Deaths: r.p.Deaths, Wins: r.p.Wins, Matches: r.p.Matches}
	}
	return out, week
}

// me returns a copy of the pilot, with this week's kills as seen now.
func (s *Store) me(key string) *Pilot {
	p, ok := s.pilots[key]
	if !ok {
		return nil
	}
	cp := *p
	if len(p.Kinds) > 0 {
		cp.Kinds = make(map[string]int, len(p.Kinds))
		for k, v := range p.Kinds {
			cp.Kinds[k] = v
		}
	}
	if wk := WeekKey(s.o.Now()); cp.Week != wk {
		cp.Week, cp.WeekKills = wk, 0
	}
	return &cp
}
