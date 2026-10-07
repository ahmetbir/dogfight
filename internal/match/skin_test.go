package match

import (
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/ahmetbir/roomkit/room"
	"playground/internal/game"
	"playground/internal/protocol"
	"playground/internal/sim"
)

// rosterBox keeps the last roster the match sent to everyone.
type rosterBox struct {
	box
	last *protocol.PlayersMsg
}

func (b *rosterBox) All(v any) {
	if m, ok := v.(protocol.PlayersMsg); ok {
		b.last = &m
	}
	b.box.All(v)
}

func (b *rosterBox) entry(t *testing.T, id room.PlayerID) protocol.PlayerJSON {
	t.Helper()
	if b.last == nil {
		t.Fatal("no roster sent")
	}
	for _, p := range b.last.List {
		if p.ID == sim.ID(id) {
			return p
		}
	}
	t.Fatalf("player %d not in the roster", id)
	return protocol.PlayerJSON{}
}

func TestPickSkinIsCheckedKeptAndRelayed(t *testing.T) {
	m := New(ffa4, nil)
	b := &rosterBox{}
	a, _ := m.Join(room.Who{Name: "a"})
	step := func(msg protocol.ClientMsg) protocol.PlayerJSON {
		m.Handle(a, msg, b)
		m.Step(nil, b) // the roster goes out when it changed
		return b.entry(t, a)
	}
	if p := step(protocol.ClientMsg{T: protocol.TPick, Kind: "su27", Skin: "flanker"}); p.Kind != "su27" || p.Skin != "flanker" {
		t.Fatalf("su27 flanker: %+v", p)
	}
	// An older client sends no skin: standard, omitted on the wire.
	if p := step(protocol.ClientMsg{T: protocol.TPick, Kind: "su27"}); p.Skin != "" {
		t.Fatalf("no skin: %+v", p)
	}
	if p := step(protocol.ClientMsg{T: protocol.TPick, Kind: "f16", Skin: "flanker"}); p.Kind != "f16" || p.Skin != "" {
		t.Fatalf("a Flanker's paint on an F-16: %+v", p)
	}
	if p := step(protocol.ClientMsg{T: protocol.TPick, Kind: "f16", Skin: "no-such"}); p.Skin != "" {
		t.Fatalf("unknown skin: %+v", p)
	}
	if p := step(protocol.ClientMsg{T: protocol.TPick, Kind: "f16", Skin: "winter"}); p.Skin != "winter" {
		t.Fatalf("winter: %+v", p)
	}
	for _, p := range b.last.List {
		if p.Bot && p.Skin != "" && p.Skin != game.SkinFor(must(t, p.Kind), p.Skin) {
			t.Fatalf("bot %+v wears an invalid skin", p)
		}
	}
}

func must(t *testing.T, kind string) sim.Kind {
	t.Helper()
	k, ok := sim.ParseKind(kind)
	if !ok {
		t.Fatalf("kind %q", kind)
	}
	return k
}

// The client's scheme table (client/src/render/skins.ts SKIN_KINDS) lists
// the same ids, for the same jets, as the server's.
func TestClientSkinsMatchServer(t *testing.T) {
	b, err := os.ReadFile("../../client/src/render/skins.ts")
	if err != nil {
		t.Fatal(err)
	}
	src := string(b)
	start := strings.Index(src, "export const SKIN_KINDS")
	if start < 0 {
		t.Fatal("skins.ts: SKIN_KINDS block not found")
	}
	end := strings.Index(src[start:], "};")
	if end < 0 {
		t.Fatal("skins.ts: SKIN_KINDS block not closed")
	}
	got := map[sim.Kind][]string{}
	n := 0
	for _, m := range regexp.MustCompile(`([a-z0-9]+): "([a-z0-9 *]+)"`).FindAllStringSubmatch(src[start:start+end], -1) {
		n++
		for _, k := range sim.Kinds() {
			if m[2] == "*" || slices.Contains(strings.Fields(m[2]), k.String()) {
				got[k] = append(got[k], m[1])
			}
		}
	}
	if n == 0 {
		t.Fatal("skins.ts: no entries in SKIN_KINDS")
	}
	for _, k := range sim.Kinds() {
		if want := game.Skins(k); !slices.Equal(got[k], want) {
			t.Errorf("%v: client %v, server %v", k, got[k], want)
		}
	}
}
