package golden

import (
	"context"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/synctest"
	"time"

	"playground/internal/bot"
	"playground/internal/game"
	"playground/internal/maps"
	"playground/internal/mode"
	"playground/internal/protocol"
	"playground/internal/room"
	"playground/internal/sim"
	"playground/internal/stats"
	"playground/internal/weather"
)

// newRoom builds a Dogfight room the way the lobby does. It is the only
// code in this file later refactor tasks may change (the constructor
// moves); scenarios and golden files never change.
func newRoom(code string, s game.Settings, sink *sink) *room.Room {
	return room.New(code, s, room.Options{Seq: 1, Stats: sink})
}

// sink records pilot tallies into the transcript ("sink" session).
type sink struct{ tr *transcript }

func (s *sink) Record(d stats.Delta) bool { s.tr.add("sink", d); return true }

const tick = time.Second / 60

// h drives one room inside a synctest bubble. Every action happens half a
// tick after a tick boundary, so no action races the ticker.
type h struct {
	t      *testing.T
	r      *room.Room
	tr     *transcript
	cancel context.CancelFunc
	seats  map[string]*room.Seat
	ticks  int
}

func start(t *testing.T, s game.Settings) *h {
	tr := newTranscript()
	r := newRoom("GOLD", s, &sink{tr})
	ctx, cancel := context.WithCancel(t.Context())
	go r.Run(ctx)
	time.Sleep(tick / 2)
	synctest.Wait()
	return &h{t: t, r: r, tr: tr, cancel: cancel, seats: map[string]*room.Seat{}}
}

func (x *h) join(name, pilotHash, tok string) {
	seat, err := x.r.Join(x.t.Context(), room.Who{Name: name, Pilot: pilotHash, NewToken: tok}, rec{x.tr, name})
	if err != nil {
		x.t.Fatalf("join %s: %v", name, err)
	}
	x.seats[name] = seat
	synctest.Wait()
}

func (x *h) send(name string, m protocol.ClientMsg) { x.seats[name].Input(m); synctest.Wait() }

func (x *h) run(n int) {
	for range n {
		time.Sleep(tick)
		synctest.Wait()
		x.ticks++
	}
}

func (x *h) leave(name string) { x.seats[name].Leave(); delete(x.seats, name); synctest.Wait() }

func (x *h) flush() {
	if !x.r.FlushStats(x.t.Context()) {
		x.t.Fatal("flush not acknowledged")
	}
	synctest.Wait()
}

func (x *h) stop() []byte {
	x.cancel()
	<-x.r.Done()
	synctest.Wait()
	return x.tr.bytes()
}

// stick is a deterministic input for seq: smooth sinusoids, a missile every
// 120, a flare every 200, a bomb every 300 and gear up from the start.
func stick(seq uint32, phase float64) protocol.ClientMsg {
	f := float64(seq) / 60
	r3 := func(v float64) float64 { return math.Round(v*1000) / 1000 }
	return protocol.ClientMsg{
		T: protocol.TIn, Seq: seq,
		P: r3(0.2 + 0.3*math.Sin(0.7*f+phase)), R: r3(0.6 * math.Sin(0.5*f+2*phase)), Y: r3(0.1 * math.Sin(f)),
		Th: r3(0.8 + 0.2*math.Sin(0.3*f)), AB: seq%240 < 60, F: seq%90 < 20,
		M: seq%120 == 0, FL: seq%200 == 0, BO: seq%300 == 0,
	}
}

// fly sends one input per tick for every named seat for n ticks.
func (x *h) fly(n int, seqs map[string]*uint32) {
	for range n {
		for name, seq := range seqs {
			*seq++
			x.seats[name].Input(stick(*seq, float64(len(name))))
		}
		x.run(1)
	}
}

func TestGoldenRoomFFA(t *testing.T) {
	got := deterministic(t, func() []byte {
		var out []byte
		synctest.Test(t, func(t *testing.T) {
			x := start(t, game.Settings{Mode: mode.FFA, Size: 4, Difficulty: bot.Easy, Seed: 1, Listed: true})
			x.join("a", "pilot-a", "AAAAAAAAAAAAAAAAAAAAA1")
			x.run(30)
			seqA, seqB := uint32(0), uint32(0)
			x.fly(70, map[string]*uint32{"a": &seqA})
			x.send("a", protocol.ClientMsg{T: protocol.TPing, TS: 5})
			x.send("a", protocol.ClientMsg{T: protocol.TChat, Chat: 3})
			x.send("a", protocol.ClientMsg{T: protocol.TChat, Chat: 4}) // inside the cooldown: dropped
			x.fly(200, map[string]*uint32{"a": &seqA})
			x.join("b", "pilot-b", "")
			x.send("b", protocol.ClientMsg{T: protocol.TPick, Kind: "su27", Lo: "radar"})
			x.fly(300, map[string]*uint32{"a": &seqA, "b": &seqB})
			x.send("a", protocol.ClientMsg{T: protocol.TIn, Seq: 3}) // stale seq: ignored
			x.flush()
			x.fly(300, map[string]*uint32{"a": &seqA, "b": &seqB})
			x.leave("a")
			x.fly(300, map[string]*uint32{"b": &seqB})
			out = x.stop()
		})
		return out
	})
	check(t, "room_ffa", got)
}

func TestGoldenRoomTeam(t *testing.T) {
	got := deterministic(t, func() []byte {
		var out []byte
		synctest.Test(t, func(t *testing.T) {
			x := start(t, game.Settings{Mode: mode.Team, Size: 4, Difficulty: bot.Normal, Seed: 7,
				Map: maps.Sehir, Weather: weather.Storm, Start: sim.StartRunway, Listed: true})
			x.join("a", "pilot-a", "")
			x.join("b", "pilot-b", "")
			x.send("a", protocol.ClientMsg{T: protocol.TTeam, Team: "soviet"})
			x.send("b", protocol.ClientMsg{T: protocol.TTeam, Team: "soviet"}) // may be refused: notice
			x.run(10)
			x.send("a", protocol.ClientMsg{T: protocol.TPick, Kind: "mig29", Lo: "mixed"})
			x.send("b", protocol.ClientMsg{T: protocol.TPick, Kind: "f15", Lo: "ir"})
			x.send("a", protocol.ClientMsg{T: protocol.TChat, Chat: 1}) // team scope
			seqA, seqB := uint32(0), uint32(0)
			x.fly(600, map[string]*uint32{"a": &seqA, "b": &seqB})
			x.send("b", protocol.ClientMsg{T: protocol.TTeam, Team: "auto"})
			x.fly(300, map[string]*uint32{"a": &seqA, "b": &seqB})
			out = x.stop()
		})
		return out
	})
	check(t, "room_team", got)
}

func TestGoldenRoomBase(t *testing.T) {
	got := deterministic(t, func() []byte {
		var out []byte
		synctest.Test(t, func(t *testing.T) {
			x := start(t, game.Settings{Mode: mode.Base, Size: 4, Difficulty: bot.Hard, Seed: 3,
				Map: maps.Dag, Weather: weather.Night, Start: sim.StartAir, Listed: false})
			x.join("a", "pilot-a", "")
			seqA := uint32(0)
			x.fly(900, map[string]*uint32{"a": &seqA})
			x.leave("a")
			x.run(60)
			out = x.stop()
		})
		return out
	})
	check(t, "room_base", got)
}

// Review Focus 1: a golden file of another architecture is neither a
// failure nor a pass, and a missing or different file fails.
func TestGoldenOtherArchChecksDeterminismOnly(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "x.otherarch.golden"), []byte("a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if v, msg := compare(dir, "x", "thisarch", []byte("b\n")); v != otherArch || !strings.Contains(msg, "only determinism") {
		t.Fatalf("other arch: %v %q", v, msg)
	}
	if v, _ := compare(dir, "y", "thisarch", nil); v != missing {
		t.Fatalf("missing: %v", v)
	}
	if v, _ := compare(dir, "x", "otherarch", []byte("b\n")); v != differs {
		t.Fatalf("differs: %v", v)
	}
	if v, _ := compare(dir, "x", "otherarch", []byte("a\n")); v != same {
		t.Fatalf("same: %v", v)
	}
}
