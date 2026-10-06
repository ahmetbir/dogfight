package golden

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/synctest"

	"playground/internal/bot"
	"playground/internal/game"
	"playground/internal/maps"
	"playground/internal/mode"
	"playground/internal/protocol"
	"playground/internal/sim"
	"playground/internal/weather"
)

// scenario runs body in a synctest bubble twice and checks the transcript;
// every pilot hash in pilots must have reached the sink by the room's stop.
func scenario(t *testing.T, name string, s game.Settings, pilots []string, body func(x *h)) {
	got := deterministic(t, func() []byte {
		var out []byte
		synctest.Test(t, func(t *testing.T) {
			x := start(t, s)
			body(x)
			out = x.stop()
			x.played(pilots...)
		})
		return out
	})
	check(t, name, got)
}

// TestGoldenRoomFFA: two flown humans in a free-for-all with the session
// layer's paths: ping, chat and its cooldown, a stale seq, a backlog over
// the kept depth and over the queue's capacity (one-shot presses merged
// forward), a quiet seat (last input repeated), a drain flush and a leave.
func TestGoldenRoomFFA(t *testing.T) {
	scenario(t, "room_ffa", game.Settings{Mode: mode.FFA, Size: 4, Difficulty: bot.Easy, Seed: 1, Listed: true},
		[]string{"pilot-a", "pilot-b"}, func(x *h) {
			x.join("a", "pilot-a", "AAAAAAAAAAAAAAAAAAAAAA")
			x.run(30) // before its first input the plane keeps its own throttle
			x.send("a", protocol.ClientMsg{T: protocol.TPick, Kind: "f16", Lo: "mixed"})
			x.fly(70, "a") // scripted stick
			x.autopilot("a", 11)
			x.fly(400, "a")
			x.send("a", protocol.ClientMsg{T: protocol.TPing, TS: 5})
			x.send("a", protocol.ClientMsg{T: protocol.TChat, Chat: 3})
			x.send("a", protocol.ClientMsg{T: protocol.TChat, Chat: 4})      // inside the cooldown: dropped
			x.send("a", protocol.ClientMsg{T: protocol.TTeam, Team: "nato"}) // no teams in FFA: notice
			x.burst("a", 6, func(i int, m *protocol.ClientMsg) { m.M, m.FL, m.BO = i == 0, i == 1, i == 0 })
			x.run(1)
			x.burst("a", 10, func(i int, m *protocol.ClientMsg) { m.M, m.FL = i == 0, i == 1 }) // over capacity
			x.run(8)
			x.fly(200, "a")
			x.run(40)                                                         // a goes quiet: its last input repeats without presses
			x.send("a", protocol.ClientMsg{T: protocol.TIn, Seq: 3, F: true}) // stale seq: ignored
			x.join("b", "pilot-b", "")
			x.send("b", protocol.ClientMsg{T: protocol.TPick, Kind: "su27", Lo: "radar"})
			x.autopilot("b", 12)
			x.fly(1500, "a", "b")
			x.flush()
			x.fly(1500, "a", "b")
			x.leave("a")
			x.fly(300, "b")
		})
}

// TestGoldenRoomTeam: runway start in a storm; team requests (one refused),
// a rearm on the ground after cannon fire, taxi and takeoff by both humans,
// team chat and a later switch.
func TestGoldenRoomTeam(t *testing.T) {
	scenario(t, "room_team", game.Settings{Mode: mode.Team, Size: 4, Difficulty: bot.Normal, Seed: 7,
		Map: maps.Sehir, Weather: weather.Storm, Start: sim.StartRunway, Listed: true},
		[]string{"pilot-a", "pilot-b"}, func(x *h) {
			x.join("a", "pilot-a", "")
			x.join("b", "pilot-b", "")
			x.send("a", protocol.ClientMsg{T: protocol.TTeam, Team: "soviet"})
			x.send("b", protocol.ClientMsg{T: protocol.TTeam, Team: "soviet"}) // may be refused: notice
			x.run(10)
			x.pick("a", "f16", "mig29", "mixed")
			x.pick("b", "f15", "su27", "ir")
			x.send("a", protocol.ClientMsg{T: protocol.TChat, Chat: 1}) // team scope
			x.autopilot("b", 22)
			for i := range 30 { // parked: guns and flares on the ground leave it short of a full load
				x.seqs["a"]++
				x.seats["a"].Input(protocol.ClientMsg{T: protocol.TIn, Seq: x.seqs["a"], F: true, FL: i%10 == 0, BR: true, G: true})
				x.fly(1, "b")
			}
			for range 240 { // stopped on the own base: rearm
				x.seqs["a"]++
				x.seats["a"].Input(protocol.ClientMsg{T: protocol.TIn, Seq: x.seqs["a"], BR: true, G: true})
				x.fly(1, "b")
			}
			x.autopilot("a", 21)
			x.fly(4800, "a", "b")                                              // taxi, line up, take off, fight
			x.send("b", protocol.ClientMsg{T: protocol.TTeam, Team: "auto"})   // already auto's team: no change
			x.send("a", protocol.ClientMsg{T: protocol.TTeam, Team: "soviet"}) // uneven: notice
			x.fly(600, "a", "b")
			x.leave("b")
			x.send("a", protocol.ClientMsg{T: protocol.TTeam, Team: "soviet"}) // alone now: a switch in flight
			x.run(5)
			x.pick("a", "f16", "mig29", "mixed")
			x.fly(600, "a")
			x.send("a", protocol.ClientMsg{T: protocol.TTeam, Team: "nato"}) // cooldown: notice
			x.fly(1200, "a")
		})
}

// TestGoldenRoomBase: base attack at night, one flown human (a bomber or
// an escort, whatever the brain picks), leave, then the room alone.
func TestGoldenRoomBase(t *testing.T) {
	scenario(t, "room_base", game.Settings{Mode: mode.Base, Size: 4, Difficulty: bot.Hard, Seed: 3,
		Map: maps.Dag, Weather: weather.Night, Start: sim.StartAir, Listed: false},
		[]string{"pilot-a"}, func(x *h) {
			x.join("a", "pilot-a", "")
			x.pick("a", "f16", "mig29", "ir")
			x.autopilot("a", 31)
			x.fly(3000, "a")
			x.leave("a")
			x.run(60)
		})
}

// TestGoldenRoomRoundEnd: a full team round with two flown humans to its
// end (kill limit or clock), the scoreboard phase with a late joiner whose
// pick waits for the next round, and the start of that round: matches and
// wins reach the sink.
func TestGoldenRoomRoundEnd(t *testing.T) {
	scenario(t, "room_round", game.Settings{Mode: mode.Team, Size: 6, Difficulty: bot.Hard, Seed: 5, Listed: true},
		[]string{"pilot-a", "pilot-b", "pilot-c"}, func(x *h) {
			x.join("a", "pilot-a", "")
			x.join("b", "pilot-b", "")
			x.pick("a", "f16", "mig29", "mixed")
			x.pick("b", "f15", "su27", "radar")
			x.autopilot("a", 41)
			x.autopilot("b", 42)
			for x.phase("a") != "ended" {
				x.fly(60, "a", "b")
			}
			x.fly(120, "a", "b")
			x.join("c", "pilot-c", "")
			x.pick("c", "f16", "mig29", "ir") // during the scoreboard: spawns with the next round
			x.autopilot("c", 43)
			for x.phase("a") != "playing" {
				x.fly(60, "a", "b", "c")
			}
			x.fly(600, "a", "b", "c")
		})
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
