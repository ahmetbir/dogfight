package match

import (
	"errors"
	"strings"
	"testing"

	"github.com/ahmetbir/roomkit/room"
	"playground/internal/audit"
	"playground/internal/game"
	"playground/internal/protocol"
	"playground/internal/sim"
)

// blockX blocks the made-up name "xbad" (moderation.Names in production).
type blockX struct{}

func (blockX) Blocked(name string) bool { return strings.Contains(strings.ToLower(name), "xbad") }

// A blocked name is refused with name_blocked before any seat is taken, in
// a quick-play room and in a lobby room; other names are seated and the
// counted pilot's stored name follows the seated (cleaned) one.
func TestBlockedNameRefusedBeforeSeat(t *testing.T) {
	lobby := ffa4
	lobby.Lobby = true
	for _, st := range []struct {
		label string
		s     game.Settings
	}{{"quick", ffa4}, {"lobby", lobby}} {
		sk := &sink{}
		mk, _ := Factory(sk, nil, Moderation{Names: blockX{}})(st.s)
		m := mk.(*Match)
		before := m.Info()
		for _, n := range []string{"XBAD", "  xBad 7  "} {
			_, err := m.Join(room.Who{Name: n, Pilot: "pa"})
			var rf *room.Refusal
			if !errors.As(err, &rf) || rf.Code != protocol.CodeNameBlocked {
				t.Fatalf("%s %q: %v", st.label, n, err)
			}
		}
		if m.Info().Humans != before.Humans || len(m.humans) != 0 || len(sk.renames) != 0 {
			t.Fatalf("%s: a refused join left a trace: %+v %v", st.label, m.Info(), sk.renames)
		}
		if _, err := m.Join(room.Who{Name: "  Ali  ", Pilot: "pa"}); err != nil {
			t.Fatalf("%s: %v", st.label, err)
		}
		if len(sk.renames) != 1 || sk.renames[0] != "pa=Ali" {
			t.Fatalf("%s: renames %v", st.label, sk.renames)
		}
		if _, err := m.Join(room.Who{Name: "Guest"}); err != nil || len(sk.renames) != 1 {
			t.Fatalf("%s: uncounted pilot renamed: %v %v", st.label, err, sk.renames)
		}
	}
}

// The roster cleans a name (trim, 16 runes); the cleaned name is checked
// too, so what is shown and stored never matches a pattern.
func TestCleanedNameChecked(t *testing.T) {
	cleanOnly := blockFunc(func(n string) bool { return n == "abc" })
	mk, _ := Factory(nil, nil, Moderation{Names: cleanOnly})(ffa4)
	if _, err := mk.Join(room.Who{Name: " abc "}); err == nil {
		t.Fatal("cleaned name not checked")
	}
}

type blockFunc func(string) bool

func (f blockFunc) Blocked(n string) bool { return f(n) }

// Without a list nothing is refused.
func TestNoNamesNoRefusal(t *testing.T) {
	mk, _ := Factory(nil, nil, Moderation{})(ffa4)
	if _, err := mk.Join(room.Who{Name: "xbad"}); err != nil {
		t.Fatal(err)
	}
}

type auditRec struct{ evs []audit.Event }

func (a *auditRec) Record(e audit.Event) { a.evs = append(a.evs, e) }

// A room records refused, joined (with its code, at the welcome) and left
// sessions: the pilot hash, the name as entered and as seated.
func TestAuditEvents(t *testing.T) {
	rec := &auditRec{}
	mk, _ := Factory(nil, nil, Moderation{Names: blockX{}, Audit: rec})(ffa4)
	if _, err := mk.Join(room.Who{Name: "xbad", Pilot: "pa"}); err == nil {
		t.Fatal("refusal")
	}
	id, err := mk.Join(room.Who{Name: "  Ali  ", Pilot: "pa"})
	if err != nil {
		t.Fatal(err)
	}
	mk.Welcome(id, "ABCD", "", &box{})
	mk.Leave(id)
	want := []audit.Event{
		{Event: audit.NameRefused, Pilot: "pa", Name: "xbad"},
		{Event: audit.Join, Pilot: "pa", Name: "  Ali  ", Accepted: "Ali", Room: "ABCD"},
		{Event: audit.Leave, Pilot: "pa", Name: "  Ali  ", Accepted: "Ali", Room: "ABCD"},
	}
	if len(rec.evs) != len(want) {
		t.Fatalf("%+v", rec.evs)
	}
	for i := range want {
		if rec.evs[i] != want[i] {
			t.Fatalf("event %d: %+v, want %+v", i, rec.evs[i], want[i])
		}
	}
}

// toggle blocks "xbad" once on is set (a block added mid-match).
type toggle struct{ on bool }

func (b *toggle) Blocked(n string) bool { return b.on && blockX{}.Blocked(n) }

// A name blocked while its pilot flies is not stored with the match's tally.
func TestBlockedMidMatchTallyDropsName(t *testing.T) {
	sk := &sink{}
	tg := &toggle{}
	mk, _ := Factory(sk, nil, Moderation{Names: tg})(ffa4)
	m := mk.(*Match)
	id, err := m.Join(room.Who{Name: "Xbad", Pilot: "pa"})
	if err != nil {
		t.Fatal(err)
	}
	m.humans[sim.ID(id)].tally.Kills = 1
	tg.on = true
	m.Leave(id)
	got := sk.all()
	if len(got) != 1 || got[0].Pilot != "pa" || got[0].Name != "" || got[0].Kills != 1 {
		t.Fatalf("%+v", got)
	}
}
