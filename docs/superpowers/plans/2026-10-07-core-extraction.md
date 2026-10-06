# Core Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Dogfight's multiplayer infrastructure (room, lobby, server, protocol envelope, wsconn, limits, pilot tokens, metrics, load-test harness; client socket, prediction, interpolation, i18n, UI and audio shells) into game-agnostic `core/` packages that Dogfight consumes, with Dogfight's wire, behaviour and deployment unchanged.

**Architecture:** Freeze the current wire with golden transcripts first. Move the already-agnostic Go packages verbatim, then introduce `core/netproto`, then make room, lobby and server generic over a game contract (`room.Game`, `server.Kit`) with Dogfight as the first implementation (`internal/match`, `internal/front`). The client follows the same pattern under `client/src/core/`. Every task leaves `main` green and deployable.

**Tech Stack:** Go 1.26 (`testing/synctest`, generics), `github.com/coder/websocket` (only external Go dependency); TypeScript 5, esbuild, Node 22 (`node --test --experimental-strip-types`), repo-local `.tools/node/bin`.

**Spec:** `docs/superpowers/specs/2026-10-07-core-extraction-design.md` (decisions `[D1]`…`[D12]` are its §13).

## Global Constraints

- Go module `playground`, `go 1.26`. The only external Go dependency is `github.com/coder/websocket`; a new `require` is FORBIDDEN.
- Client runtime dependency only `three`; dev: `esbuild`, `typescript`, `@types/three`, `@types/node`. A new package is FORBIDDEN.
- Every source file ≤ ~300 lines; split inside the same task if one would exceed it.
- No global variables (constant tables excepted). No shared state; the room is an actor; summaries via `atomic`.
- `core/**` imports only the standard library, `github.com/coder/websocket` and `playground/core/**` (enforced by `internal/golden/boundary_test.go`; its allowlist only shrinks). `client/src/core/**` imports only `client/src/core/**`, never `three` (enforced by `client/src/core/boundary.test.ts`).
- Wire byte-identical: golden files under `internal/golden/testdata/` and `client/src/golden/` are created only in Tasks 1, 2 and 4. No later task may run `-update` / `UPDATE_GOLDEN=1` or edit a golden file; a mismatch is a defect of the task (stop, report BLOCKED with the diff path the test prints).
- No behaviour change: existing tests move with their code; a test is never deleted without its replacement in the same commit.
- Deploy unchanged: `deploy/`, `scripts/`, CLI flags, metric names (`dogfight_*`), localStorage keys (`dogfight.*`), the release binary path and `cmd/dogfight/web` output stay as they are. The only build-file change allowed is `COPY core/ core/` in `Dockerfile` (Task 5).
- User-visible texts Turkish (server) / i18n dictionaries (client); code, identifiers and comments English.
- DOM text only through `h()`/`text()` (text nodes); `innerHTML` FORBIDDEN. CSP unchanged.
- Security: raw pilot tokens never reach logs, metrics, URLs or disk; API endpoints stay rate-limited, JSON, `no-store`.
- Go verification (end of every Go task): `go build ./... && go vet ./... && go test ./... -race -short`
- Client verification (end of every client task, from the repo root): `export PATH="$PWD/.tools/node/bin:$PATH"; cd client && npm run check && npm test && npm run build`
- Commit: stage only the task's files by path (`git add <path>…`, `git mv`, `git rm <file>`); `git add -A` / `git add .` FORBIDDEN; `rm -rf` FORBIDDEN. Commit with `.tools/gc -m "<subject>" -m "<body>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`. PUBLIC REPO: no `Claude-Session` line, no absolute local paths, no infra names, no owner e-mail. Never push.
- A task's tests never need code from a later task; task order is dependency order.

## Review Focus

Five failure modes the spec implies that no task's main test targets directly; each line's test is added to the owning task:

1. **Golden files on another architecture:** a golden file produced on arm64 must not fail (or falsely pass) on amd64, where FMA changes floats; the test must skip the byte comparison with a message naming the arch, after still proving determinism (Task 1: `TestGoldenOtherArchChecksDeterminismOnly`).
2. **A game that panics:** after `Step` panics, the room's teardown calls the game again (`Close`, `Info`); a second panic there must not crash the process, every session must still be closed and the gauges returned (Task 12: `TestPanickingGameStillClosesEverySeat`).
3. **Stats off:** with no `-data`, `/api/leaderboard` and `/api/me` must answer 503 `stats_off`, never panic or 200 on a typed-nil interface (Task 15: `TestNewStatsNilIsNilInterface`; Task 16 golden covers the body).
4. **One-shot presses across both latches:** a press in an input dropped by the connection's rate bucket, followed by a room backlog trim, must still fire exactly once (Task 8 adds `TestDroppedPressSurvivesBothLatches` at unit level; Task 12 replaces it with the black-box version in `internal/match`).
5. **Stored user settings:** after the store helper moves, every localStorage key must be the same string (`dogfight.lang`, `dogfight.name`, `dogfight.pilot`, `dogfight.settings`, `dogfight.book.chapter`, `dogfight.hint.ground`, `dogfight.coach.takeoff`) (Task 19: `store keys are unchanged`).

---

## File Structure

| path | responsibility | created in |
|---|---|---|
| `internal/golden/` | characterization tests (room transcripts, server frames, API bodies, metrics text), import-boundary and Dockerfile guards | 1–3 |
| `client/src/golden/` | client wire and prediction golden tests + fixtures | 4 |
| `core/limit`, `core/pilot`, `core/wsconn` | moved verbatim | 5 |
| `core/metrics` | moved; namespace argument | 6 |
| `core/netproto` | `PlayerID`, `Header`, core types/messages, codes registry, `CleanName`, `CheckHeader` | 7 |
| `core/internal/fakegame`, `core/internal/fakekit` | minimal game for core tests (`room.Game`; `server.Kit`) | 10; 15 |
| `core/room` | generic room actor, seats, input queue, chat, Game contract | 9–12 |
| `internal/match` | Dogfight's `room.Game` (+ tallies, team notices) and aliases | 11–13 |
| `core/lobby` | generic lobby | 13 |
| `core/server` | generic server; `Kit`, `Stats`, `Msg` contracts | 14–16 |
| `internal/front` | Dogfight's `server.Kit` and `server.Stats`; server integration tests | 15–16 |
| `core/loadtest` | generic load-test harness, `Script` | 17–18 |
| `client/src/core/` | store, net, predict, i18n, ui, audio shells | 19–25 |

Phases: **0** freeze (Tasks 1–4) · **1** agnostic moves (5–6) · **2** netproto (7–8) · **3** room (9–12) · **4** lobby (13) · **5** server (14–16) · **6** load test (17–18) · **7** client (19–25) · **8** close-out (26).

---

## Phase 0 — Freeze current behaviour

### Task 1: Golden room transcripts

**Files:**
- Create: `internal/golden/doc.go`
- Create: `internal/golden/transcript_test.go`
- Create: `internal/golden/room_test.go`
- Create (generated): `internal/golden/testdata/room_ffa.<GOARCH>.golden`, `room_team.<GOARCH>.golden`, `room_base.<GOARCH>.golden`

**Interfaces:**
- Consumes: today's `room.New(code string, s game.Settings, o room.Options) *room.Room`, `(*Room).Run/Join/FlushStats`, `(*Seat).Input/Leave`, `room.Who`, `room.StatsSink`.
- Produces: `newRoom` — the single constructor line later tasks (12, 13) adapt; `transcript`, `check(t, name, got)`, `deterministic(t, run func() []byte) []byte`, flag `-update`.

- [ ] **Step 1: Write the package doc**

`internal/golden/doc.go`:

```go
// Package golden holds characterization tests that freeze Dogfight's wire
// behaviour while its infrastructure moves into core/. Golden files are
// written only by the Phase 0 tasks of the core extraction plan; every
// later change must reproduce them byte for byte.
package golden
```

- [ ] **Step 2: Write the transcript helpers**

`internal/golden/transcript_test.go`:

```go
package golden

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"sort"
	"sync"
	"testing"
)

var update = flag.Bool("update", false, "rewrite golden files (Phase 0 tasks only)")

// line is one recorded message: its type and size, and the full JSON for
// small messages or a hash for snapshots, welcomes and anything over 512 B.
type line struct {
	T string          `json:"t"`
	N int             `json:"n"`
	H string          `json:"h,omitempty"`
	M json.RawMessage `json:"m,omitempty"`
}

// transcript records what each session received, in order. Sessions are
// kept apart: the room broadcasts by ranging over a map, so only the order
// within one session is defined.
type transcript struct {
	mu       sync.Mutex
	sessions map[string][]line
}

func newTranscript() *transcript { return &transcript{sessions: map[string][]line{}} }

// add records v as wsconn would write it (json.Marshal).
func (tr *transcript) add(session string, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	var h struct {
		T string `json:"t"`
	}
	_ = json.Unmarshal(b, &h)
	tr.addRaw(session, h.T, b)
}

func (tr *transcript) addRaw(session, typ string, b []byte) {
	l := line{T: typ, N: len(b)}
	if typ == "snap" || typ == "welcome" || len(b) > 512 {
		sum := sha256.Sum256(b)
		l.H = hex.EncodeToString(sum[:8])
	} else {
		l.M = slices.Clone(b)
	}
	tr.mu.Lock()
	tr.sessions[session] = append(tr.sessions[session], l)
	tr.mu.Unlock()
}

// bytes renders every session (sorted by name) as "## name" then one JSON
// line per message. Lines of sessions named "sink*" are sorted: the room
// records tallies by ranging over a map.
func (tr *transcript) bytes() []byte {
	tr.mu.Lock()
	defer tr.mu.Unlock()
	names := make([]string, 0, len(tr.sessions))
	for n := range tr.sessions {
		names = append(names, n)
	}
	sort.Strings(names)
	var b bytes.Buffer
	for _, n := range names {
		b.WriteString("## " + n + "\n")
		var rows []string
		for _, l := range tr.sessions[n] {
			j, _ := json.Marshal(l)
			rows = append(rows, string(j))
		}
		if len(n) >= 4 && n[:4] == "sink" {
			sort.Strings(rows)
		}
		for _, r := range rows {
			b.WriteString(r + "\n")
		}
	}
	return b.Bytes()
}

// rec is a room.Sender that records into a transcript.
type rec struct {
	tr   *transcript
	name string
}

func (r rec) Send(v any) bool { r.tr.add(r.name, v); return true }
func (r rec) Close()          { r.tr.addRaw(r.name, "close", []byte(`{"t":"close"}`)) }

// deterministic runs a scenario twice and fails unless both transcripts
// are equal; a golden file of a non-deterministic scenario guards nothing.
func deterministic(t *testing.T, run func() []byte) []byte {
	t.Helper()
	a, b := run(), run()
	if !bytes.Equal(a, b) {
		t.Fatalf("scenario is not deterministic (line %d differs)", firstDiff(a, b))
	}
	return a
}

type verdict int

const (
	same verdict = iota
	otherArch // golden files exist, but only for other architectures
	missing
	differs
)

// compare compares got with <dir>/<name>.<arch>.golden. A file only for
// another GOARCH is otherArch: float results may differ across
// architectures (FMA), so there only determinism is checked.
func compare(dir, name, arch string, got []byte) (verdict, string) {
	path := filepath.Join(dir, name+"."+arch+".golden")
	want, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		if others, _ := filepath.Glob(filepath.Join(dir, name+".*.golden")); len(others) > 0 {
			return otherArch, fmt.Sprintf("%s: golden files exist only for %v; on %s only determinism is checked", name, others, arch)
		}
		return missing, path + " missing: it is created by the Phase 0 task that owns it"
	}
	if err != nil {
		return differs, err.Error()
	}
	if !bytes.Equal(got, want) {
		out := filepath.Join(os.TempDir(), "golden-actual-"+name+".txt")
		_ = os.WriteFile(out, got, 0o644)
		return differs, fmt.Sprintf("%s differs from %s at line %d; actual written to %s", name, path, firstDiff(got, want), out)
	}
	return same, ""
}

// check compares got with testdata/<name>.<GOARCH>.golden; with -update it
// writes the file instead.
func check(t *testing.T, name string, got []byte) {
	t.Helper()
	if *update {
		if err := os.MkdirAll("testdata", 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join("testdata", name+"."+runtime.GOARCH+".golden"), got, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	switch v, msg := compare("testdata", name, runtime.GOARCH, got); v {
	case otherArch:
		t.Skip(msg)
	case missing, differs:
		t.Fatal(msg)
	}
}

func firstDiff(a, b []byte) int {
	la, lb := bytes.Split(a, []byte("\n")), bytes.Split(b, []byte("\n"))
	for i := range min(len(la), len(lb)) {
		if !bytes.Equal(la[i], lb[i]) {
			return i + 1
		}
	}
	return min(len(la), len(lb)) + 1
}
```

- [ ] **Step 3: Write the room scenarios**

`internal/golden/room_test.go`:

```go
package golden

import (
	"context"
	"math"
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
```

Add `"os"`, `"path/filepath"` and `"strings"` to `room_test.go`'s imports for this test.

- [ ] **Step 4: Run without golden files, expect FAIL**

Run: `go test ./internal/golden -run TestGoldenRoom -count=1`
Expected: FAIL with `testdata/room_ffa.<arch>.golden missing: it is created by the Phase 0 task that owns it` (and the same for team, base). If instead it fails with `scenario is not deterministic`, find the source (map iteration reaching one session's order, a timer racing an action) and fix the scenario harness, never the room; record the finding in the report.

- [ ] **Step 5: Generate, then verify**

Run: `go test ./internal/golden -run TestGoldenRoom -count=1 -update && go test ./internal/golden -run TestGoldenRoom -count=1 -v`
Expected: PASS, three files in `internal/golden/testdata/`. Check sizes: `wc -c internal/golden/testdata/*.golden` each well under 200 KB; inspect `head -5` of one: lines like `{"t":"welcome","n":…,"h":"…"}` and full `players`/`round`/`pong`/`chat`/`notice` messages.

- [ ] **Step 6: Prove the other-arch path end to end**

Run: `A=$(go env GOARCH); mv internal/golden/testdata/room_ffa.$A.golden internal/golden/testdata/room_ffa.otherarch.golden; go test ./internal/golden -run 'TestGoldenRoomFFA|TestGoldenOtherArch' -count=1 -v; mv internal/golden/testdata/room_ffa.otherarch.golden internal/golden/testdata/room_ffa.$A.golden`
Expected: `--- SKIP: TestGoldenRoomFFA … golden files exist only for [testdata/room_ffa.otherarch.golden]; on <arch> only determinism is checked` and `--- PASS: TestGoldenOtherArchChecksDeterminismOnly`. Afterwards `git status --short internal/golden` lists only the new (untracked) files of this task.

- [ ] **Step 7: Go verification**

Run: `go build ./... && go vet ./... && go test ./... -race -short`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add internal/golden/doc.go internal/golden/transcript_test.go internal/golden/room_test.go internal/golden/testdata/room_ffa.*.golden internal/golden/testdata/room_team.*.golden internal/golden/testdata/room_base.*.golden
.tools/gc -m "golden: freeze room wire transcripts before the core extraction" -m "Three seeded rooms (ffa, team on runway in a storm, base at night) driven through the public room API under synctest; per-session transcripts (snapshots and welcomes hashed, small messages in full) and recorded stats deltas. Each scenario runs twice and must agree; files are tagged with the GOARCH they come from." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Golden server frames, API bodies, headers and metrics

**Files:**
- Create: `internal/golden/server_test.go`
- Create (generated): `internal/golden/testdata/server_frames.<GOARCH>.golden`, `server_api.<GOARCH>.golden`, `metrics_text.<GOARCH>.golden`

**Interfaces:**
- Consumes: today's `lobby.New(ctx, lobby.Options{MaxRooms})`, `server.New(l, server.Options)`, `(*server.Server).Drain`, `stats.Open`, `stats.NewSlot`, `metrics.New(func() uint64)`, `(*metrics.Registry).WriteText`.
- Produces: `newServer` / `newStatsServer` — the constructor lines Tasks 6, 13 and 16 adapt.

- [ ] **Step 1: Write the server golden tests**

`internal/golden/server_test.go`:

```go
package golden

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sort"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/coder/websocket"

	"playground/internal/lobby"
	"playground/internal/metrics"
	"playground/internal/pilot"
	"playground/internal/server"
	"playground/internal/stats"
)

var web = fstest.MapFS{"index.html": {Data: []byte("<!doctype html>dogfight")}}

// newServer builds the HTTP handler the way cmd/dogfight does. The only
// code here later tasks may change (constructors move).
func newServer(t *testing.T, maxRooms int, lim server.Limits, st *stats.Slot) (*httptest.Server, *server.Server) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	o := server.Options{Web: web, Limits: lim, HandshakeTimeout: 300 * time.Millisecond}
	if st != nil {
		o.Stats = st
	}
	s := server.New(lobby.New(ctx, lobby.Options{MaxRooms: maxRooms}), o)
	srv := httptest.NewServer(s)
	t.Cleanup(func() { cancel(); srv.Close() })
	return srv, s
}

var open = server.Limits{MaxConnsIP: 1000, CreatePerMinIP: 1000, JoinFailPerMinIP: 1000, JoinPerMinIP: 1000}

var (
	codeRE = regexp.MustCompile(`"code":"[A-HJ-NP-Z2-9]{4}"`)
	tokRE  = regexp.MustCompile(`"tok":"[A-Za-z0-9_-]{22}"`)
	leftRE = regexp.MustCompile(`"left":\d+`)
	tickRE = regexp.MustCompile(`"tick":\d+`)
)

// normalize replaces what depends on chance or timing: the room code, a
// fresh token, the seconds left and the welcome's tick.
func normalize(b []byte) []byte {
	b = codeRE.ReplaceAll(b, []byte(`"code":"CODE"`))
	b = tokRE.ReplaceAll(b, []byte(`"tok":"TOKEN"`))
	b = tickRE.ReplaceAll(b, []byte(`"tick":0`))
	return leftRE.ReplaceAll(b, []byte(`"left":0`))
}

// exchange dials, writes msgs and records the error and welcome frames
// (normalized) and the close status and reason; snapshots, rosters and
// rounds in between depend on timing and are skipped. It stops after a
// frame of type until, or at the close.
func exchange(t *testing.T, srv *httptest.Server, tr *transcript, name string, until string, msgs ...string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	ws.SetReadLimit(1 << 20)
	for _, m := range msgs {
		if err := ws.Write(ctx, websocket.MessageText, []byte(m)); err != nil {
			t.Fatal(err)
		}
	}
	for {
		_, b, err := ws.Read(ctx)
		if err != nil {
			var ce websocket.CloseError
			if errors.As(err, &ce) {
				tr.addRaw(name, "close", []byte(fmt.Sprintf(`{"status":%d,"reason":%q}`, ce.Code, ce.Reason)))
			} else {
				tr.addRaw(name, "close", []byte(`{"status":"none"}`))
			}
			return
		}
		var h struct{ T string }
		_ = json.Unmarshal(b, &h)
		if h.T == "error" || h.T == "welcome" {
			tr.addRaw(name, h.T, normalize(b))
		}
		if h.T == until {
			return
		}
	}
}

// roomsSettled polls /api/rooms (1 s cache) until no human is listed, so
// the recorded body does not depend on when the setup socket's leave landed.
func roomsSettled(t *testing.T, url string) {
	t.Helper()
	deadline := time.Now().Add(4 * time.Second)
	for {
		res, err := http.Get(url + "/api/rooms")
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if bytes.Contains(b, []byte(`"humans":0`)) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("rooms never settled: %s", b)
		}
		time.Sleep(250 * time.Millisecond)
	}
}

func TestGoldenServerFrames(t *testing.T) {
	tr := newTranscript()
	srv, s := newServer(t, 1, open, nil)
	hello := `{"t":"hello","v":2,"name":"golden"}`
	exchange(t, srv, tr, "version", "", `{"t":"hello","v":1,"name":"x"}`)
	exchange(t, srv, tr, "bad_first", "", `{"t":"join","code":"ABCD"}`)
	exchange(t, srv, tr, "no_room", "", hello, `{"t":"join","code":"ZZZZ"}`)
	exchange(t, srv, tr, "bad_room", "", hello, `{"t":"create","mode":"x","size":4,"diff":"easy"}`)
	exchange(t, srv, tr, "timeout", "", hello)
	exchange(t, srv, tr, "welcome", "welcome", hello, `{"t":"create","mode":"ffa","size":4,"diff":"easy","seed":1}`)
	exchange(t, srv, tr, "busy", "", hello, `{"t":"create","mode":"ffa","size":4,"diff":"easy","seed":2}`)
	exchange(t, srv, tr, "bad_msg_in_room", "", hello, `{"t":"quick"}`, `{"t":"nope"}`)
	s.Drain(true)
	exchange(t, srv, tr, "updating", "", hello, `{"t":"quick"}`)
	s.Drain(false)

	lim := open
	lim.CreatePerMinIP = 1
	srv2, _ := newServer(t, 0, lim, nil)
	create := `{"t":"create","mode":"team","size":2,"diff":"easy","seed":3}`
	exchange(t, srv2, tr, "create_ok", "welcome", hello, create)
	exchange(t, srv2, tr, "creates", "", hello, create)
	check(t, "server_frames", tr.bytes())
}

// get records status, the headers the server sets and the body.
func get(t *testing.T, tr *transcript, name, url string, hdr map[string]string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	var hs []string
	for _, k := range []string{"Content-Type", "Cache-Control", "Content-Security-Policy", "X-Content-Type-Options",
		"Referrer-Policy", "Permissions-Policy", "Cross-Origin-Opener-Policy"} {
		hs = append(hs, k+": "+res.Header.Get(k))
	}
	sort.Strings(hs)
	rec := fmt.Sprintf("%d\n%s\n%s", res.StatusCode, strings.Join(hs, "\n"), normalize(body))
	tr.addRaw(name, "http", []byte(rec))
}

func TestGoldenServerAPI(t *testing.T) {
	tr := newTranscript()
	srv, _ := newServer(t, 0, open, nil)
	exchange(t, srv, tr, "setup", "welcome", `{"t":"hello","v":2,"name":"g"}`, `{"t":"create","mode":"team","size":4,"diff":"easy","seed":1}`)
	roomsSettled(t, srv.URL)
	get(t, tr, "index", srv.URL+"/", nil)
	get(t, tr, "healthz", srv.URL+"/healthz", nil)
	get(t, tr, "rooms", srv.URL+"/api/rooms", nil)
	get(t, tr, "nope", srv.URL+"/api/nope", nil)
	get(t, tr, "board_off", srv.URL+"/api/leaderboard?period=week", nil)
	get(t, tr, "me_off", srv.URL+"/api/me", map[string]string{pilot.Header: "AAAAAAAAAAAAAAAAAAAAA1"})

	now := time.Date(2026, 10, 7, 21, 0, 0, 0, time.UTC)
	store, err := stats.Open(t.TempDir(), stats.Options{Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	slot := stats.NewSlot()
	slot.Set(store)
	t.Cleanup(func() { slot.Close() })
	tok := "AAAAAAAAAAAAAAAAAAAAA1"
	slot.Record(stats.Delta{Pilot: pilot.Hash(tok), Name: "ace", Kills: 3, Deaths: 1, Wins: 1, Matches: 2, Flight: 7200,
		Kinds: map[string]int{"f16": 7200}})
	deadline := time.Now().Add(2 * time.Second)
	for {
		if top, _ := slot.Top(stats.All, 20); len(top) > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("delta never reached the store")
		}
		time.Sleep(5 * time.Millisecond)
	}
	srv2, _ := newServer(t, 0, open, slot)
	get(t, tr, "board_week", srv2.URL+"/api/leaderboard?period=week", nil)
	get(t, tr, "board_all", srv2.URL+"/api/leaderboard?period=all", nil)
	get(t, tr, "board_bad", srv2.URL+"/api/leaderboard?period=year", nil)
	get(t, tr, "me", srv2.URL+"/api/me", map[string]string{pilot.Header: tok})
	get(t, tr, "me_unknown", srv2.URL+"/api/me", map[string]string{pilot.Header: "BBBBBBBBBBBBBBBBBBBBB2"})
	get(t, tr, "me_bad", srv2.URL+"/api/me", map[string]string{pilot.Header: "short"})
	check(t, "server_api", tr.bytes())
}

func TestGoldenMetricsText(t *testing.T) {
	reg := metrics.New(func() uint64 { return 7 })
	reg.Rooms.Add(2)
	reg.Humans.Add(3)
	reg.Bots.Add(5)
	reg.Conns.Add(4)
	reg.TickSeconds.Observe(0.003)
	reg.TickSeconds.Observe(0.02)
	reg.TickOverruns.Inc()
	reg.MsgsIn.Add(10)
	reg.MsgsOut.Add(20)
	reg.SnapDrops.Inc()
	reg.Rejects.Inc("flood")
	reg.Rejects.Inc("weird")
	reg.API.Inc("rooms")
	var b bytes.Buffer
	if err := reg.WriteText(&b); err != nil {
		t.Fatal(err)
	}
	var keep []string
	for _, l := range strings.Split(b.String(), "\n") {
		if !strings.Contains(l, "go_goroutines") && !strings.Contains(l, "go_memstats") { // runtime values vary
			keep = append(keep, l)
		}
	}
	tr := newTranscript()
	tr.addRaw("metrics", "text", []byte(strings.Join(keep, "\n")))
	check(t, "metrics_text", tr.bytes())
}
```

Note: `addRaw` hashes anything over 512 B; the metrics text and some API bodies exceed that. That is intended (exactness is what matters); when such a line differs, the actual transcript file the test writes shows the full new value only as a hash, so on a mismatch rerun the old commit in a worktree to compare full bodies. To keep the API diagnosable, `get` bodies are short except `/` (index) and the metrics text.

- [ ] **Step 2: Run, expect FAIL (missing golden files)**

Run: `go test ./internal/golden -run 'TestGoldenServer|TestGoldenMetrics' -count=1`
Expected: FAIL with `server_frames.<arch>.golden missing…` (and api, metrics). Any other failure (e.g. the `busy` exchange gets a welcome) means the scenario misreads today's behaviour: fix the scenario, not the server.

- [ ] **Step 3: Make the frames deterministic, generate and verify**

Run each test twice with `-count=2` before `-update` to see they are stable: `go test ./internal/golden -run 'TestGoldenServer|TestGoldenMetrics' -count=2 -update` then `go test ./internal/golden -count=3 -v`.
Expected: PASS three times. If a line still varies between runs, find what depends on timing and normalize or skip exactly that (record the reason in the report); never weaken a comparison that is stable.

- [ ] **Step 4: Go verification and commit**

Run: `go build ./... && go vet ./... && go test ./... -race -short` → PASS.

```bash
git add internal/golden/server_test.go internal/golden/testdata/server_frames.*.golden internal/golden/testdata/server_api.*.golden internal/golden/testdata/metrics_text.*.golden
.tools/gc -m "golden: freeze handshake frames, API bodies, headers and metrics text" -m "Error frames and close codes for every handshake refusal reachable without timing games, the normalized welcome, 1012 while draining; /, /healthz, /api/* bodies with and without stats; the metrics exposition without runtime gauges." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Import boundary and Dockerfile guards

**Files:**
- Create: `internal/golden/boundary_test.go`

**Interfaces:**
- Produces: `coreAllow` map (package dir → allowed `playground/internal/...` imports). Tasks 9 and 14 add entries; Tasks 12, 13 and 16 remove them; Task 26 asserts it is empty.

- [ ] **Step 1: Write the guard tests**

`internal/golden/boundary_test.go`:

```go
package golden

import (
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
)

const module = "playground"

// coreAllow lists, per core package directory, the Dogfight packages it may
// still import while it is being made generic. It only ever shrinks; the
// extraction is done when it is empty.
var coreAllow = map[string][]string{}

// TestCoreImportsNothingFromDogfight: core/** (tests included) imports only
// the standard library, coder/websocket and core/**.
func TestCoreImportsNothingFromDogfight(t *testing.T) {
	root := filepath.Join("..", "..", "core")
	if _, err := os.Stat(root); os.IsNotExist(err) {
		t.Skip("no core/ yet")
	}
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") {
			return err
		}
		f, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(filepath.Join("..", ".."), filepath.Dir(path))
		for _, im := range f.Imports {
			p, _ := strconv.Unquote(im.Path.Value)
			switch {
			case !strings.Contains(strings.SplitN(p, "/", 2)[0], ".") && !strings.HasPrefix(p, module+"/"):
				// standard library
			case p == "github.com/coder/websocket":
			case strings.HasPrefix(p, module+"/core/"):
			case slices.Contains(coreAllow[filepath.ToSlash(rel)], p):
			default:
				t.Errorf("%s imports %s", path, p)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// TestDockerfileCopiesEveryGoDir: the reproducible build copies every
// top-level directory holding Go code the server is built from.
func TestDockerfileCopiesEveryGoDir(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "Dockerfile"))
	if err != nil {
		t.Fatal(err)
	}
	copied := map[string]bool{}
	for _, m := range regexp.MustCompile(`(?m)^COPY (\w+)/ `).FindAllStringSubmatch(string(b), -1) {
		copied[m[1]] = true
	}
	for _, dir := range []string{"cmd", "internal", "core"} {
		if _, err := os.Stat(filepath.Join("..", "..", dir)); err == nil && !copied[dir] {
			t.Errorf("Dockerfile does not COPY %s/", dir)
		}
	}
}
```

- [ ] **Step 2: Prove they bite**

Run: `mkdir -p core/tmpprobe && printf 'package tmpprobe\n\nimport _ "playground/internal/sim"\n' > core/tmpprobe/p.go && go test ./internal/golden -run 'TestCoreImports|TestDockerfile' -count=1; rm core/tmpprobe/p.go && rmdir core/tmpprobe core`
Expected: FAIL with `core/tmpprobe/p.go imports playground/internal/sim` and `Dockerfile does not COPY core/`. After cleanup `git status --short` shows no `core/`.

- [ ] **Step 3: Run clean, verify, commit**

Run: `go test ./internal/golden -count=1 && go build ./... && go vet ./... && go test ./... -race -short`
Expected: PASS (`TestCoreImportsNothingFromDogfight` skips: no core/ yet).

```bash
git add internal/golden/boundary_test.go
.tools/gc -m "golden: guard core imports and the Dockerfile's copied dirs" -m "core/** may import only stdlib, coder/websocket and core/** (plus a shrinking allowlist while packages are made generic); the reproducible Dockerfile must copy every Go source dir." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Client golden — socket wire, prediction and interpolation numbers

**Files:**
- Create: `client/src/golden/golden.ts` (fixture read/write helper; not a test file)
- Create: `client/src/golden/wire.test.ts`
- Create: `client/src/golden/predict.test.ts`
- Create (generated): `client/src/golden/wire.json`, `client/src/golden/predict.json`

**Interfaces:**
- Consumes: `Socket`, `socketURL`, `type Conn`, `type Env` (`net/socket.ts`), `Predictor`, `AIR_ENV`, `InterpBuffer`, `ServerClock`, `extrapolate`, `stepFlight`.
- Produces: `matchFixture(name, value)`; the `Socket` construction line and the `Predictor` construction line are the only lines Tasks 20–22 may adapt.

- [ ] **Step 1: Write the fixture helper**

`client/src/golden/golden.ts`:

```ts
// Golden fixtures: a test compares its value with <name>.json next to this
// file; UPDATE_GOLDEN=1 writes it instead (Phase 0, Task 4 only).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const dir = new URL(".", import.meta.url);

export function matchFixture(name: string, value: unknown): void {
  const file = new URL(`${name}.json`, dir);
  const text = JSON.stringify(value, null, 1) + "\n";
  if (process.env.UPDATE_GOLDEN === "1") {
    writeFileSync(file, text);
    return;
  }
  assert.ok(existsSync(file), `${name}.json missing: created by Task 4 only`);
  assert.deepStrictEqual(JSON.parse(text), JSON.parse(readFileSync(file, "utf8")));
}
```

(`JSON.parse(JSON.stringify(x))` round-trips doubles exactly, so `deepStrictEqual` here is bit-exact for finite numbers.)

- [ ] **Step 2: Write the wire golden test**

`client/src/golden/wire.test.ts`:

```ts
import { test } from "node:test";
import { matchFixture } from "./golden.ts";
import { Socket, type Conn, type Env } from "../net/socket.ts";

class RawConn implements Conn {
  readyState = 0;
  bufferedAmount = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  constructor(private readonly log: string[], private readonly n: number) {}
  send(data: string) { this.log.push(`c${this.n} ${data}`); }
  close() { this.readyState = 3; this.log.push(`c${this.n} close`); }
}

test("socket wire transcript", () => {
  let t = 0;
  const log: string[] = [];
  const conns: RawConn[] = [];
  type T = { at: number; f: () => void; every: number; live: boolean };
  const timers: T[] = [];
  const env: Env = {
    dial: () => { const c = new RawConn(log, conns.length); conns.push(c); return c; },
    now: () => t,
    setTimeout: (f, ms) => { const h = { at: t + ms, f, every: 0, live: true }; timers.push(h); return h; },
    clearTimeout: (h) => { (h as T).live = false; },
    setInterval: (f, ms) => { const h = { at: t + ms, f, every: ms, live: true }; timers.push(h); return h; },
    clearInterval: (h) => { (h as T).live = false; },
  };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const due = timers.filter((x) => x.live && x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      t = due.at;
      if (due.every > 0) due.at += due.every; else due.live = false;
      due.f();
    }
    t = end;
  };
  const open = (c: RawConn) => { c.readyState = 1; c.onopen?.({} as Event); };
  const recv = (c: RawConn, m: object) => c.onmessage?.({ data: JSON.stringify(m) } as MessageEvent);
  // The only line later tasks may adapt (the Socket constructor moves into core).
  const s = new Socket("ws://x/ws", "Ace", { t: "create", mode: "team", size: 4, diff: "normal", seed: 9 }, {
    onMsg: (m) => log.push(`msg ${m.t}`), onStatus: (st) => log.push(`status ${st}`), onFatal: (c, m) => log.push(`fatal ${c} ${m}`),
  }, env);
  s.setToken("AAAAAAAAAAAAAAAAAAAAA1");
  open(conns[0]);
  recv(conns[0], { t: "welcome", you: 3, code: "ABCD" });
  for (let seq = 1; seq <= 6; seq++) {
    s.send({ t: "in", seq, p: 0.1 * seq, r: -0.2, y: 0, th: 1, ab: seq === 2, f: seq % 2 === 0, m: seq === 3, fl: seq === 4, g: false, br: false, bo: seq === 5 });
    advance(16);
  }
  conns[0].bufferedAmount = 64 * 1024; // backed up: inputs are held, one-shots merged
  s.send({ t: "in", seq: 7, p: 0, r: 0, y: 0, th: 1, ab: false, f: false, m: true, fl: false, g: false, br: false });
  s.send({ t: "in", seq: 8, p: 0, r: 0, y: 0, th: 1, ab: false, f: false, m: false, fl: true, g: false, br: false });
  conns[0].bufferedAmount = 0;
  recv(conns[0], { t: "pong", ts: 1 });
  s.send({ t: "pick", kind: "f16", lo: "radar" });
  s.send({ t: "pick", kind: "f15" }); // inside the gap: held, newest wins
  advance(600);
  s.send({ t: "chat", id: 2 });
  advance(15000); // a ping
  conns[0].readyState = 3;
  conns[0].onclose?.({ code: 1012 } as CloseEvent); // server update: reconnect at once, join by code
  advance(600);
  open(conns[1]);
  recv(conns[1], { t: "error", msg: "oda bulunamadı", code: "no_room" });
  matchFixture("wire", log);
});
```

- [ ] **Step 3: Write the prediction golden test**

`client/src/golden/predict.test.ts`:

```ts
import { test } from "node:test";
import { matchFixture } from "./golden.ts";
import { Predictor } from "../predict/predictor.ts";
import { InterpBuffer, ServerClock, extrapolate } from "../predict/interp.ts";
import { AIR_ENV } from "../game/env.ts";
import { stepFlight, type FlightState, type Spec, type StickInput } from "../sim/flight.ts";
import { qAxisAngle, qIdentity, v3 } from "../sim/vec.ts";

const F16: Spec = { maxSpeed: 230, maxSpeedAB: 290, accel: 48, rollRate: 4.2, pitchRate: 1.6, yawRate: 0.5, cornerSpeed: 170, rotateSpeed: 78 };
const start = (): FlightState => ({ pos: v3(0, 1500, 0), rot: qIdentity(), vel: v3(0, 0, -200), th: 1 });
const input = (i: number): StickInput => ({ p: Math.sin(i / 7), r: Math.cos(i / 11), y: 0.2, th: (i % 5) / 4, ab: i % 3 === 0 });

test("predictor numeric transcript", () => {
  // The only line later tasks may adapt (the Predictor moves onto core/predict).
  const pr = new Predictor(F16);
  pr.reset(start(), 0, 0);
  const server: FlightState[] = [start()];
  const out: unknown[] = [];
  const jitter = [6, 7, 5, 6, 8, 4, 6, 6, 9, 6];
  for (let seq = 1; seq <= 240; seq++) {
    server.push(stepFlight(server[seq - 1], input(seq), F16, { turbo: false }));
    pr.push(seq, input(seq), seq, AIR_ENV);
    if (seq % 2 === 0 && seq > 10) {
      const lag = jitter[(seq / 2) % jitter.length];
      const ack = seq - lag;
      const snapTick = ack + (seq % 14 === 0 ? 1 : 0); // a starved repeat now and then
      const s = server[ack];
      pr.reconcile(seq === 120 ? { ...s, pos: v3(s.pos.x + 12, s.pos.y, s.pos.z) } : s, ack, snapTick, AIR_ENV);
      out.push({ seq, ahead: pr.ahead(), pending: pr.pendingCount(), tickFor: pr.tickFor(seq), state: pr.state(), render: pr.render(1 / 60) });
    }
  }
  matchFixture("predict", out);
});

test("interpolation numeric transcript", () => {
  const buf = new InterpBuffer();
  const clock = new ServerClock();
  const out: unknown[] = [];
  for (let k = 0; k < 40; k++) {
    const tick = 2 * k;
    const now = tick * (1000 / 60) + 40 + (k % 3) * 7;
    clock.observe(tick, now);
    buf.push(ServerClock.serverMs(tick), { pos: v3(k * 3, 100, -k), rot: qAxisAngle(v3(0, 1, 0), k * 0.05), vel: v3(180, 0, -60), th: (k % 4) / 4 });
    const rt = clock.renderTime(now);
    out.push({ k, rt, sample: buf.sample(rt), ahead: extrapolate(buf, ServerClock.serverMs(tick) + 120), size: buf.size() });
  }
  matchFixture("interp", out);
});
```

(If `qAxisAngle` has a different signature in `sim/vec.ts`, use the one `predictor.test.ts` imports and keep the angle values.)

- [ ] **Step 4: Run, expect FAIL; generate; verify**

Run: `export PATH="$PWD/.tools/node/bin:$PATH"; cd client && node --experimental-strip-types --no-warnings --test src/golden/*.test.ts`
Expected: FAIL `wire.json missing: created by Task 4 only` (and predict, interp).
Run: `UPDATE_GOLDEN=1 node --experimental-strip-types --no-warnings --test src/golden/*.test.ts && node --experimental-strip-types --no-warnings --test src/golden/*.test.ts`
Expected: PASS; `wire.json` contains `c0 {"t":"hello","v":2,"name":"Ace","tok":"AAAAAAAAAAAAAAAAAAAAA1"}`, the create line, `c0` input lines, a merged held input with `"m":true,"fl":true`, the pick lines, a ping, `status updating`, `c1 {"t":"hello",…}`, `c1 {"t":"join","code":"ABCD"}` and `fatal room_gone …`.

- [ ] **Step 5: Client verification and commit**

Run: `export PATH="$PWD/.tools/node/bin:$PATH"; cd client && npm run check && npm test && npm run build` → PASS.

```bash
git add client/src/golden/golden.ts client/src/golden/wire.test.ts client/src/golden/predict.test.ts client/src/golden/wire.json client/src/golden/predict.json client/src/golden/interp.json
.tools/gc -m "golden: freeze client socket wire and prediction numbers" -m "Exact strings the socket writes (hello, create, shaped inputs with merged one-shots, gapped picks, ping, 1012 reconnect by code) and the predictor's and interpolator's numeric output for fixed scenarios, compared bit-exact." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 1 — Move the already-agnostic packages

### Task 5: Move limit, pilot and wsconn into core

**Files:**
- Move: `internal/limit/*` → `core/limit/`, `internal/pilot/*` → `core/pilot/`, `internal/wsconn/*` → `core/wsconn/`
- Modify: every importer (`internal/server/*.go`, `internal/room` none, `cmd/dogfight/main.go`, tests) — import paths only
- Modify: `Dockerfile` (one line)

**Interfaces:**
- Produces: `playground/core/limit`, `playground/core/pilot`, `playground/core/wsconn` with today's exported API, unchanged.

- [ ] **Step 1: Failing check**

Run: `go list playground/core/wsconn`
Expected: FAIL `package playground/core/wsconn is not in std` / no matching packages.

- [ ] **Step 2: Move and rewrite imports**

```bash
mkdir -p core
git mv internal/limit core/limit
git mv internal/pilot core/pilot
git mv internal/wsconn core/wsconn
grep -rl --include='*.go' -e '"playground/internal/limit"' -e '"playground/internal/pilot"' -e '"playground/internal/wsconn"' . \
  | xargs sed -i '' -e 's#"playground/internal/limit"#"playground/core/limit"#' -e 's#"playground/internal/pilot"#"playground/core/pilot"#' -e 's#"playground/internal/wsconn"#"playground/core/wsconn"#'
gofmt -l . | grep -v '^client/' ; true
```

(`gofmt -l` must print nothing; if it lists files, run `gofmt -w` on exactly those and re-check: import groups may need re-sorting.)

- [ ] **Step 3: Dockerfile**

In `Dockerfile`, after `COPY internal/ internal/` add:

```dockerfile
COPY core/ core/
```

- [ ] **Step 4: Verify**

Run: `go build ./... && go vet ./... && go test ./... -race -short && go test ./internal/golden -count=1 -v 2>&1 | grep -E '^(--- |ok|FAIL)'`
Expected: PASS; every golden test PASS (not SKIP) on the arch that generated them; `TestCoreImportsNothingFromDogfight` now runs and passes; `TestDockerfileCopiesEveryGoDir` passes.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile $(git diff --name-only --cached) $(git diff --name-only)
git status --short   # must list only renames under core/, the import-path edits and Dockerfile
.tools/gc -m "core: move limit, pilot and wsconn out of internal" -m "Verbatim moves (import paths only); the reproducible Dockerfile copies core/." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Move metrics into core with a namespace

**Files:**
- Move: `internal/metrics/*` → `core/metrics/`
- Modify: `core/metrics/metrics.go` (`New` signature, `Registry.ns`), `core/metrics/text.go` (names), `core/metrics/metrics_test.go`
- Modify: importers (`internal/room`, `internal/lobby`, `internal/server`, `cmd/dogfight/main.go`, tests); `internal/golden/server_test.go` (`metrics.New` call — constructor line)

**Interfaces:**
- Produces: `func New(namespace string, statsDropped func() uint64) *Registry` — every exposed name is `namespace + "_" + suffix`; `go_*` runtime names unchanged.

- [ ] **Step 1: Move and rewrite imports**

```bash
git mv internal/metrics core/metrics
grep -rl --include='*.go' '"playground/internal/metrics"' . | xargs sed -i '' 's#"playground/internal/metrics"#"playground/core/metrics"#'
```

- [ ] **Step 2: Failing test**

Append to `core/metrics/metrics_test.go`:

```go
func TestNamespacePrefixesEveryName(t *testing.T) {
	var b bytes.Buffer
	if err := New("f1", nil).WriteText(&b); err != nil {
		t.Fatal(err)
	}
	for _, l := range strings.Split(strings.TrimSpace(b.String()), "\n") {
		name := strings.Fields(strings.TrimPrefix(strings.TrimPrefix(l, "# HELP "), "# TYPE "))[0]
		if !strings.HasPrefix(name, "f1_") && !strings.HasPrefix(name, "go_") {
			t.Fatalf("unprefixed metric %q", l)
		}
	}
}
```

(add `bytes`/`strings` imports if missing). Run: `go test ./core/metrics -run TestNamespace` → FAIL: `too many arguments in call to New`.

- [ ] **Step 3: Implement**

`core/metrics/metrics.go`: add field `ns string` to `Registry` (first field, comment `// name prefix, e.g. "dogfight"`), change the comment `// Registry holds every dogfight metric.` to `// Registry holds one server's metrics.` and:

```go
func New(namespace string, statsDropped func() uint64) *Registry {
	return &Registry{
		ns: namespace,
		// tick buckets in seconds: 1, 2, 4, 8, 12, 16.7, 25, 50 ms (spec §11)
		TickSeconds: NewHistogram([]float64{0.001, 0.002, 0.004, 0.008, 0.012, 0.0167, 0.025, 0.05}),
		Rejects: NewCounterVec("reason", "conns-per-ip", "conns-total", "create-rate", "join-rate",
			"join-fail-rate", "limiter-full", "max-rooms", "flood", "api-rate"),
		API:          NewCounterVec("path", "rooms", "leaderboard", "me"),
		StatsDropped: statsDropped,
	}
}
```

`core/metrics/text.go`: in `WriteText` replace every literal `"dogfight_` with `r.ns+"_` (e.g. `gauge(&b, r.ns+"_rooms", "Open rooms.", r.Rooms.Load())`). Leave `go_goroutines` and `go_memstats_heap_alloc_bytes`.

Callers: `cmd/dogfight/main.go` `metrics.New(dropped)` → `metrics.New("dogfight", dropped)`; every test calling `metrics.New(` gets `"dogfight", ` as first argument (`grep -rn 'metrics.New(' --include='*.go' .`), including the constructor line in `internal/golden/server_test.go`.

- [ ] **Step 4: Verify**

Run: `go build ./... && go vet ./... && go test ./... -race -short && go test ./internal/golden -run TestGoldenMetricsText -count=1 -v`
Expected: PASS; `TestGoldenMetricsText` PASS (byte-identical `dogfight_*` exposition).

- [ ] **Step 5: Commit**

```bash
git add core/metrics $(git diff --name-only)
.tools/gc -m "core: move metrics; the name prefix is a constructor argument" -m "Dogfight passes \"dogfight\": exposed names (and the deploy scripts reading dogfight_conns) are unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 2 — The shared envelope

### Task 7: `core/netproto`

**Files:**
- Create: `core/netproto/netproto.go` (types, header, core messages)
- Create: `core/netproto/codes.go` (core codes, registry)
- Create: `core/netproto/name.go` (`CleanName`, copied from `internal/protocol/client.go`)
- Create: `core/netproto/netproto_test.go`

**Interfaces:**
- Produces:

```go
type PlayerID uint32
type Header struct { T string; V int; Name, Tok, Code string; Seq uint32; TS float64; Chat int }
const THello, TCreate, TJoin, TQuick, TIn, TPing, TChat = "hello", "create", "join", "quick", "in", "ping", "chat"
type Pong struct{ T string `json:"t"`; TS float64 `json:"ts"` }
type ErrorMsg struct{ T, Msg, Code string } // json: t, msg, code,omitempty
type NoticeMsg struct{ T, Msg, Code string } // json: t, msg, code,omitempty
type ChatMsg struct{ T string; From PlayerID; ID int } // json: t, from, id
func NewPong(ts float64) Pong
func NewError(code, msg string) ErrorMsg
func NewNotice(code, msg string) NoticeMsg
func NewChat(from PlayerID, id int) ChatMsg
var ErrNotFinite, ErrBadChat error
func CheckHeader(h Header, chatMax int) error
func CleanName(s string) string
const CodeVersion … CodeUpdating, CodeStatsOff, CodeBadPeriod, CodeNotFound, CodeRate
func ErrorCodes() []string // core "error" codes in the client's order
type Codes struct{ Errors, Notices, API []string }
func NewCodes(notices ...string) (Codes, error)
```

- [ ] **Step 1: Write the failing tests**

`core/netproto/netproto_test.go`:

```go
package netproto

import (
	"encoding/json"
	"math"
	"testing"
)

func TestCoreMessagesWire(t *testing.T) {
	for _, c := range []struct {
		v    any
		want string
	}{
		{NewPong(5), `{"t":"pong","ts":5}`},
		{NewError(CodeFull, "oda dolu"), `{"t":"error","msg":"oda dolu","code":"full"}`},
		{NewError("", "x"), `{"t":"error","msg":"x"}`},
		{NewNotice("team_full", "Takım dolu"), `{"t":"notice","msg":"Takım dolu","code":"team_full"}`},
		{NewChat(3, 2), `{"t":"chat","from":3,"id":2}`},
	} {
		b, err := json.Marshal(c.v)
		if err != nil || string(b) != c.want {
			t.Errorf("%T: %s %v, want %s", c.v, b, err, c.want)
		}
	}
}

func TestCheckHeader(t *testing.T) {
	ok := []Header{{T: TPing, TS: 1}, {T: TChat, Chat: 1}, {T: TChat, Chat: 6}, {T: TIn, Seq: 1}}
	for _, h := range ok {
		if err := CheckHeader(h, 6); err != nil {
			t.Errorf("%+v: %v", h, err)
		}
	}
	if err := CheckHeader(Header{T: TChat, Chat: 7}, 6); err != ErrBadChat {
		t.Errorf("chat 7: %v", err)
	}
	if err := CheckHeader(Header{T: TChat}, 6); err != ErrBadChat {
		t.Errorf("chat 0: %v", err)
	}
	if err := CheckHeader(Header{T: TPing, TS: math.Inf(1)}, 6); err != ErrNotFinite {
		t.Errorf("inf ts: %v", err)
	}
}

func TestNewCodesRefusesCollisions(t *testing.T) {
	c, err := NewCodes("team_full", "team_late")
	if err != nil || len(c.Notices) != 2 || len(c.Errors) != len(ErrorCodes()) || len(c.API) != 4 {
		t.Fatalf("%+v %v", c, err)
	}
	for _, bad := range [][]string{{"full"}, {"rate"}, {"x", "x"}, {""}} {
		if _, err := NewCodes(bad...); err == nil {
			t.Errorf("%v accepted", bad)
		}
	}
}

func TestCleanName(t *testing.T) {
	for in, want := range map[string]string{
		"  Ace  ":                    "Ace",
		"":                           "Pilot",
		"​​":               "Pilot",
		"abcdefghijklmnopqrstuvwxyz": "abcdefghijklmnop",
		"a‮b":                   "ab",
		"é́́":        "é́",
	} {
		if got := CleanName(in); got != want {
			t.Errorf("CleanName(%q) = %q, want %q", in, got, want)
		}
	}
}
```

Also copy every case of `TestCleanName` in `internal/protocol/protocol_test.go` into this map (keep both copies until Task 8 removes the protocol one).

Run: `go test ./core/netproto` → FAIL (package has no non-test files / undefined: NewPong …).

- [ ] **Step 2: Implement `netproto.go`**

```go
// Package netproto is the part of the wire protocol every game shares: the
// message envelope, the core message types (handshake, ping, chat, errors,
// notices) and the error-code registry. A game's own messages are flat JSON
// objects with the same "t" field; its snapshot starts {"t":"snap","tick":N.
package netproto

import (
	"errors"
	"math"
)

// PlayerID is a seated player's id on the wire.
type PlayerID uint32

// Header is what the core reads of a client message.
type Header struct {
	T    string  // message type
	V    int     // hello: protocol version
	Name string  // hello
	Tok  string  // hello: pilot token
	Code string  // join: room code
	Seq  uint32  // in: input sequence, from 1
	TS   float64 // ping: client timestamp, echoed in the pong
	Chat int     // chat: preset id, 1..chatMax
}

// Core client message types.
const (
	THello  = "hello"
	TCreate = "create"
	TJoin   = "join"
	TQuick  = "quick"
	TIn     = "in"
	TPing   = "ping"
	TChat   = "chat"
)

type Pong struct {
	T  string  `json:"t"` // "pong"
	TS float64 `json:"ts"`
}

// ErrorMsg ends the connection; Code names the failure, Msg is its (Turkish) text.
type ErrorMsg struct {
	T    string `json:"t"` // "error"
	Msg  string `json:"msg"`
	Code string `json:"code,omitempty"`
}

// NoticeMsg is a short, non-fatal message for the player.
type NoticeMsg struct {
	T    string `json:"t"` // "notice"
	Msg  string `json:"msg"`
	Code string `json:"code,omitempty"`
}

// ChatMsg relays quick chat preset ID from player From.
type ChatMsg struct {
	T    string   `json:"t"` // "chat"
	From PlayerID `json:"from"`
	ID   int      `json:"id"`
}

func NewPong(ts float64) Pong                { return Pong{T: "pong", TS: ts} }
func NewError(code, msg string) ErrorMsg     { return ErrorMsg{T: "error", Msg: msg, Code: code} }
func NewNotice(code, msg string) NoticeMsg   { return NoticeMsg{T: "notice", Msg: msg, Code: code} }
func NewChat(from PlayerID, id int) ChatMsg { return ChatMsg{T: "chat", From: from, ID: id} }

var (
	ErrNotFinite = errors.New("protocol: non-finite number")
	ErrBadChat   = errors.New("protocol: chat id out of range")
)

// CheckHeader applies the checks every game's decoder needs: a finite ping
// timestamp and a chat preset in 1..chatMax.
func CheckHeader(h Header, chatMax int) error {
	if h.T == TChat && (h.Chat < 1 || h.Chat > chatMax) {
		return ErrBadChat
	}
	if math.IsNaN(h.TS) || math.IsInf(h.TS, 0) {
		return ErrNotFinite
	}
	return nil
}
```

(The error texts keep the `protocol:` prefix so log lines read as today.)

- [ ] **Step 3: Implement `codes.go`**

```go
package netproto

import "fmt"

// Stable codes of the user-facing failures every game shares. The client
// shows its own text for a code; Msg stays the server's text for old clients.
const (
	// "error" messages (the connection ends).
	CodeVersion  = "version"
	CodeNoRoom   = "no_room"
	CodeBadRoom  = "bad_room"
	CodeFull     = "full"
	CodeBad      = "bad_msg"
	CodeNoCreate = "no_create"
	CodeBusy     = "busy"
	CodeCreates  = "creates"
	CodeJoins    = "joins"
	CodeFlood    = "flood"
	CodeConns    = "conns"
	CodeTimeout  = "timeout"
	CodeUpdating = "updating"

	// HTTP API errors ({"error", "code"}).
	CodeStatsOff  = "stats_off"
	CodeBadPeriod = "bad_period"
	CodeNotFound  = "not_found"
	CodeRate      = "rate"
)

// ErrorCodes are the codes an "error" message may carry, in the client's order.
func ErrorCodes() []string {
	return []string{CodeVersion, CodeNoRoom, CodeBadRoom, CodeFull, CodeBad, CodeNoCreate, CodeBusy, CodeCreates, CodeJoins,
		CodeFlood, CodeConns, CodeTimeout, CodeUpdating}
}

// APICodes are the codes of HTTP API error bodies.
func APICodes() []string { return []string{CodeStatsOff, CodeBadPeriod, CodeNotFound, CodeRate} }

// Codes is one game's code registry: the core's error and API codes plus
// the game's notice codes.
type Codes struct{ Errors, Notices, API []string }

// NewCodes registers a game's notice codes; empty, duplicate or core codes
// are refused.
func NewCodes(notices ...string) (Codes, error) {
	seen := map[string]bool{}
	for _, c := range append(ErrorCodes(), APICodes()...) {
		seen[c] = true
	}
	for _, c := range notices {
		if c == "" || seen[c] {
			return Codes{}, fmt.Errorf("netproto: notice code %q is empty or taken", c)
		}
		seen[c] = true
	}
	return Codes{Errors: ErrorCodes(), Notices: notices, API: APICodes()}, nil
}
```

- [ ] **Step 4: Implement `name.go`**

Copy `CleanName`, `maxNameRunes`, `defaultName`, `maxMarks` and `hiddenRune` from `internal/protocol/client.go` verbatim into `core/netproto/name.go` (package `netproto`, imports `strings`, `unicode`, `unicode/utf8`). Do not change `internal/protocol` in this task.

- [ ] **Step 5: Verify and commit**

Run: `go test ./core/netproto -v && go build ./... && go vet ./... && go test ./... -race -short`
Expected: PASS.

```bash
git add core/netproto/netproto.go core/netproto/codes.go core/netproto/name.go core/netproto/netproto_test.go
.tools/gc -m "core: netproto, the envelope every game shares" -m "PlayerID, the header the core reads, hello/create/join/quick/in/ping/chat, pong/error/notice/chat messages, header checks, CleanName and the code registry a game extends with its notice codes. Not used yet." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Dogfight's protocol on netproto; input latch methods

**Files:**
- Modify: `internal/protocol/client.go` (type constants alias netproto; `Head`, `Latch`; `DecodeClient` uses `CheckHeader`; remove `CleanName` and helpers)
- Modify: `internal/protocol/server.go` (`Pong`, `ErrorMsg`, `NoticeMsg`, `ChatMsg` become aliases; constructors removed; `Snap.WithAck`)
- Modify: `internal/protocol/codes.go` (core codes alias netproto)
- Modify: `internal/protocol/protocol_test.go` (drop the moved `TestCleanName`), `internal/protocol/codes_test.go` (constructor rename)
- Modify: `internal/sim/types.go` (`Input.Latch`, `Input.Held`) + `internal/sim/input_test.go` (create)
- Modify: `internal/room/session.go` (use `Latch`/`Held`), `internal/room/chat.go`, `internal/room/room.go`, `internal/room/team.go` (netproto constructors)
- Modify: `internal/server/inbound.go`, `internal/server/socket.go`, `internal/server/handshake.go` (latch via `Latch`; `netproto.CleanName`, `netproto.NewPong`, `netproto.NewError`)
- Test: `internal/room/session_test.go` (`TestDroppedPressSurvivesBothLatches`)

**Interfaces:**
- Consumes: Task 7's `netproto`.
- Produces:

```go
func (m protocol.ClientMsg) Head() netproto.Header
func (m protocol.ClientMsg) Latch(dropped protocol.ClientMsg) protocol.ClientMsg // m with dropped's M, FL, BO OR-ed in
func (s protocol.Snap) WithAck(ack uint32) any                                  // copy with Ack set
func (in sim.Input) Latch(dropped sim.Input) sim.Input                          // Missile, Flare, Bomb OR-ed in
func (in sim.Input) Held() sim.Input                                            // Missile, Flare, Bomb cleared
type protocol.Pong = netproto.Pong (and ErrorMsg, NoticeMsg, ChatMsg)
```

- [ ] **Step 1: Failing tests**

`internal/sim/input_test.go`:

```go
package sim

import "testing"

func TestInputLatchAndHeld(t *testing.T) {
	in := Input{Pitch: 0.5, Throttle: 1, Fire: true}
	got := in.Latch(Input{Missile: true, Bomb: true, Pitch: -1})
	if got != (Input{Pitch: 0.5, Throttle: 1, Fire: true, Missile: true, Bomb: true}) {
		t.Fatalf("latch %+v", got)
	}
	if h := got.Held(); h != (Input{Pitch: 0.5, Throttle: 1, Fire: true}) {
		t.Fatalf("held %+v", h)
	}
}
```

Append to `internal/protocol/protocol_test.go`:

```go
func TestHeadLatchAndWithAck(t *testing.T) {
	m := ClientMsg{T: TIn, Seq: 4, TS: 2, Name: "n", Tok: "t", Code: "c", V: 2, Chat: 1, P: 0.3}
	if h := m.Head(); h != (netproto.Header{T: TIn, V: 2, Name: "n", Tok: "t", Code: "c", Seq: 4, TS: 2, Chat: 1}) {
		t.Fatalf("head %+v", h)
	}
	l := m.Latch(ClientMsg{M: true, BO: true, P: 9})
	if !l.M || !l.BO || l.FL || l.P != 0.3 || l.Seq != 4 {
		t.Fatalf("latch %+v", l)
	}
	s := Snap{T: "snap", Tick: 2}
	if a, ok := s.WithAck(7).(Snap); !ok || a.Ack != 7 || s.Ack != 0 {
		t.Fatalf("withAck %+v", a)
	}
}
```

Append to `internal/room/session_test.go` (Review Focus 4):

```go
// A missile press in an input the connection's rate bucket dropped rides on
// the next admitted input (the server's latch is ClientMsg.Latch), then
// survives the room's backlog trim (session.drop uses Input.Latch).
func TestDroppedPressSurvivesBothLatches(t *testing.T) {
	dropped := protocol.ClientMsg{T: protocol.TIn, Seq: 2, M: true}
	admitted := protocol.ClientMsg{T: protocol.TIn, Seq: 3}.Latch(dropped)
	s := newSession(1, nil)
	s.push(1, protocol.ClientMsg{T: protocol.TIn, Seq: 1}.Input())
	s.push(admitted.Seq, admitted.Input())
	for seq := uint32(4); seq <= 9; seq++ { // backlog: the trim drops seq 1 and 3
		s.push(seq, protocol.ClientMsg{T: protocol.TIn, Seq: seq}.Input())
	}
	fired := 0
	for range 8 {
		if in, ok := s.next(); ok && in.Missile {
			fired++
		}
	}
	if fired != 1 {
		t.Fatalf("missile fired %d times, want 1", fired)
	}
}
```

Run: `go test ./internal/sim ./internal/protocol ./internal/room -run 'TestInputLatch|TestHeadLatch|TestDroppedPress'`
Expected: FAIL (`in.Latch undefined`, `m.Head undefined`, `m.Latch undefined`).

- [ ] **Step 2: sim input methods**

Append to `internal/sim/types.go`:

```go
// Latch returns in with the one-shot presses (missile, flare, bomb) of an
// older input that was dropped, so a dropped press still fires.
func (in Input) Latch(dropped Input) Input {
	in.Missile = in.Missile || dropped.Missile
	in.Flare = in.Flare || dropped.Flare
	in.Bomb = in.Bomb || dropped.Bomb
	return in
}

// Held is in without its one-shot presses: what repeats while inputs starve.
func (in Input) Held() Input {
	in.Missile, in.Flare, in.Bomb = false, false, false
	return in
}
```

- [ ] **Step 3: protocol on netproto**

`internal/protocol/client.go`:
- Replace the client type constants block with:

```go
// Client message types: the core's, plus Dogfight's pick and team.
const (
	THello = netproto.THello
	TCreate = netproto.TCreate
	TJoin  = netproto.TJoin
	TQuick = netproto.TQuick
	TIn    = netproto.TIn
	TPing  = netproto.TPing
	TChat  = netproto.TChat
	TPick  = "pick"
	TTeam  = "team"
)
```

- Replace `ErrNotFinite` and `ErrBadChat` in the `var` block with `ErrNotFinite = netproto.ErrNotFinite` and `ErrBadChat = netproto.ErrBadChat`.
- In `DecodeClient`, replace the chat check and the finite loop with:

```go
	if err := netproto.CheckHeader(m.Head(), ChatMax); err != nil {
		return ClientMsg{}, err
	}
	for _, v := range [...]float64{m.P, m.R, m.Y, m.Th} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return ClientMsg{}, ErrNotFinite
		}
	}
```

- Add:

```go
// Head is the part of m the core reads.
func (m ClientMsg) Head() netproto.Header {
	return netproto.Header{T: m.T, V: m.V, Name: m.Name, Tok: m.Tok, Code: m.Code, Seq: m.Seq, TS: m.TS, Chat: m.Chat}
}

// Latch returns m with the one-shot presses (missile, flare, bomb) of an
// input dropped over its rate.
func (m ClientMsg) Latch(dropped ClientMsg) ClientMsg {
	m.M, m.FL, m.BO = m.M || dropped.M, m.FL || dropped.FL, m.BO || dropped.BO
	return m
}
```

- Delete `CleanName`, `maxNameRunes`, `defaultName`, `maxMarks`, `hiddenRune` (now in netproto) and the imports only they used (`strings`, `unicode`, `unicode/utf8`).

`internal/protocol/server.go`: delete the `Pong`, `ErrorMsg`, `ChatMsg`, `NoticeMsg` types and `NewNotice`, `NewPong`, `NewError`, `NewChat`; add

```go
// The core message types, under their old names.
type (
	Pong      = netproto.Pong
	ErrorMsg  = netproto.ErrorMsg
	ChatMsg   = netproto.ChatMsg
	NoticeMsg = netproto.NoticeMsg
)

// WithAck is s for one player: its input ack set (the room's per-player copy).
func (s Snap) WithAck(ack uint32) any {
	s.Ack = ack
	return s
}
```

`internal/protocol/codes.go`: replace the core constants with aliases (`CodeVersion = netproto.CodeVersion`, … for all 13 error codes and 4 API codes), keep the `team_*` constants, make `ErrorCodes()` return `netproto.ErrorCodes()`, keep `NoticeCodes()`, and add a test to `codes_test.go`:

```go
func TestNoticeCodesRegister(t *testing.T) {
	if _, err := netproto.NewCodes(NoticeCodes()...); err != nil {
		t.Fatal(err)
	}
}
```

Delete `TestCleanName` from `internal/protocol/protocol_test.go` (its cases live in `core/netproto` since Task 7). Update `TestErrorWire` to `netproto.NewError`.

- [ ] **Step 4: Callers**

- `internal/room/session.go`: `drop` becomes

```go
func (s *session) drop(n int) {
	for _, in := range s.queue[:n] {
		s.queue[n] = s.queue[n].Latch(in)
	}
	s.queue = append(s.queue[:0], s.queue[n:]...)
	s.seqs = append(s.seqs[:0], s.seqs[n:]...)
}
```

and in `next` replace the two lines after `s.last = in` with `s.last = in.Held()` (one line; keep the comment).
- `internal/room/room.go`: `protocol.NewPong(m.TS)` → `netproto.NewPong(m.TS)`.
- `internal/room/chat.go`: `protocol.NewChat(from, id)` → `netproto.NewChat(netproto.PlayerID(from), id)`.
- `internal/room/team.go`: `protocol.NewNotice` → `netproto.NewNotice`.
- `internal/server/inbound.go`: replace `presses` with the message latch:

```go
// The one-shot presses of dropped inputs ride on the next admitted one, as
// the room's backlog trim does (protocol.ClientMsg.Latch).
```

delete `type presses`, `keep`, `into`; in `peer` (socket.go) replace `latch presses` with `held protocol.ClientMsg // one-shot presses of dropped inputs`; in `admit`: `p.latch.keep(m)` → `p.held = p.held.Latch(m)`; `p.latch.into(&m)` → `m = m.Latch(p.held); p.held = protocol.ClientMsg{}`.
- `internal/server/socket.go` `fail`: `protocol.NewError` → `netproto.NewError`; `internal/server/handshake.go`: `protocol.CleanName` → `netproto.CleanName`, `protocol.NewPong` → `netproto.NewPong`.
- Any test using the removed constructors: `grep -rn 'protocol\.New\(Pong\|Error\|Notice\|Chat\)\|protocol\.CleanName' --include='*.go' .` must print nothing after the edit.

- [ ] **Step 5: Verify**

Run: `go test ./internal/sim ./internal/protocol ./internal/room -run 'TestInputLatch|TestHeadLatch|TestDroppedPress|TestNoticeCodes' -v && go build ./... && go vet ./... && go test ./... -race -short && go test ./internal/golden -count=1`
Expected: PASS; all golden tests PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/sim/types.go internal/sim/input_test.go internal/protocol/client.go internal/protocol/server.go internal/protocol/codes.go internal/protocol/protocol_test.go internal/protocol/codes_test.go internal/room/session.go internal/room/session_test.go internal/room/room.go internal/room/chat.go internal/room/team.go internal/server/inbound.go internal/server/socket.go internal/server/handshake.go
git status --short   # any other modified file is a test caller from Step 4: add it by path
.tools/gc -m "protocol: build on core/netproto; latch methods on inputs and messages" -m "Core types, messages, codes and CleanName come from netproto under their old names. sim.Input and protocol.ClientMsg carry the one-shot latch (Latch, Held) the room queue and the connection guard used inline; Snap.WithAck makes the per-player copy. Wire unchanged (golden)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 3 — Generic room

### Task 9: Move room into core (still coupled)

**Files:**
- Move: `internal/room/*` → `core/room/`
- Modify: importers (`internal/lobby`, `internal/server`, `cmd/dogfight`, `internal/golden/room_test.go`, tests) — import path only
- Modify: `internal/golden/boundary_test.go` (`coreAllow`)

**Interfaces:**
- Produces: `playground/core/room` with today's API. `coreAllow["core/room"] = []string{"playground/internal/bot", "playground/internal/game", "playground/internal/mode", "playground/internal/protocol", "playground/internal/sim", "playground/internal/stats"}` (exactly the internal imports `go list -deps` shows for its files and tests; adjust the list to what `TestCoreImportsNothingFromDogfight` reports, nothing more).

- [ ] **Step 1: Move**

```bash
git mv internal/room core/room
grep -rl --include='*.go' '"playground/internal/room"' . | xargs sed -i '' 's#"playground/internal/room"#"playground/core/room"#'
```

`core/room/book_rules_test.go` reads client files by a relative path: it stays at the same depth (`core/room` vs `internal/room`), so `../../client/...` still resolves. Run `go test ./core/room -run TestBook` to confirm.

- [ ] **Step 2: Failing boundary test, then the allowlist**

Run: `go test ./internal/golden -run TestCoreImports -count=1` → FAIL listing `core/room/... imports playground/internal/...`.
Add to `coreAllow` in `internal/golden/boundary_test.go` the entry for `"core/room"` with exactly the reported imports, each with a comment `// until Task 12`.

- [ ] **Step 3: Verify and commit**

Run: `go build ./... && go vet ./... && go test ./... -race -short && go test ./internal/golden -count=1` → PASS.

```bash
git add core/room internal/golden/boundary_test.go $(git diff --name-only)
.tools/gc -m "core: move room under core (still Dogfight-coupled)" -m "Path-only move so the next tasks show as edits; the boundary test allows its current Dogfight imports until the room is generic." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Room contract, generic input queue, fake game

**Files:**
- Create: `core/room/game.go` (contract types)
- Create: `core/room/queue.go`, `core/room/queue_test.go`
- Modify: `core/room/session.go` (session embeds `queue[sim.Input]`), `core/room/room.go`, `core/room/stats.go` (field renames only: `s.lastSeq` → `s.q.lastSeq`, `s.ack` → `s.q.ack`, `s.push` → `s.q.push`, `s.next` → `s.q.next`)
- Modify: `core/room/session_test.go` (queue cases move to `queue_test.go`; `TestDroppedPressSurvivesBothLatches` keeps using the session through `s.q`)
- Create: `core/internal/fakegame/fakegame.go`, `core/internal/fakegame/fakegame_test.go`

**Interfaces:**
- Produces (`core/room/game.go`):

```go
type PlayerID = netproto.PlayerID
type Input[In any] interface{ Latch(dropped In) In; Held() In }
type Msg[In any] interface{ Head() netproto.Header; Input() In }
type Outbox interface{ To(id PlayerID, v any); All(v any); Snap(v Acker); Changed() }
type Acker interface{ WithAck(ack uint32) any }
type Who struct{ Name, Pilot, NewToken string } // moved from seats.go
type Info[X any] struct{ Humans, Seats int; Listed bool; Game X }
type Game[M Msg[In], In Input[In], X any] interface {
	Join(who Who) (PlayerID, error); Welcome(id PlayerID, code, newToken string, out Outbox); Leave(id PlayerID)
	Handle(id PlayerID, m M, out Outbox); Step(inputs map[PlayerID]In, out Outbox)
	ChatScope(from PlayerID) func(to PlayerID) bool; Info() Info[X]; Label() string; FlushStats(); Close()
}
var ErrFull = errors.New("room: full")
```

- Produces (`core/room/queue.go`): `queue[In Input[In]]` with `push(seq uint32, in In)`, `next() (In, bool)`, `started() bool`, fields `lastSeq`, `ack`.
- Produces (`core/internal/fakegame`): `Settings`, `Input`, `Msg`, `Decode`, `Snap`, `Info`, `Game`, `New(Settings, *Recorder) *Game`, `Recorder` (see code). It imports `core/room`, so core tests that use it are external test packages (`package room_test`, `package lobby_test`, `package server_test`).

- [ ] **Step 1: Failing queue tests**

`core/room/queue_test.go`:

```go
package room

import "testing"

// in is a test input: X is a held control, Shot a one-shot press.
type in struct {
	X    int
	Shot bool
}

func (i in) Latch(d in) in { i.Shot = i.Shot || d.Shot; return i }
func (i in) Held() in      { i.Shot = false; return i }

func TestQueueOrderDuplicatesAndCap(t *testing.T) {
	q := newQueue[in]()
	q.push(2, in{X: 2})
	q.push(1, in{X: 1}) // out of order: dropped
	q.push(2, in{X: 9}) // duplicate: dropped
	q.push(3, in{X: 3})
	if v, ok := q.next(); !ok || v.X != 2 || q.ack != 2 {
		t.Fatalf("%+v %v ack=%d", v, ok, q.ack)
	}
	for s := uint32(4); s < 4+queueCap+2; s++ {
		q.push(s, in{X: int(s)})
	}
	if len(q.items) != queueCap {
		t.Fatalf("cap: %d", len(q.items))
	}
}

func TestQueueBacklogKeepsPressesAndStarvedRepeatsHeld(t *testing.T) {
	q := newQueue[in]()
	if q.started() {
		t.Fatal("started before any input")
	}
	q.push(1, in{X: 1, Shot: true})
	for s := uint32(2); s <= 7; s++ {
		q.push(s, in{X: int(s)})
	}
	v, ok := q.next() // backlog 7 > keep 4: seq 1..3 dropped, their press kept
	if !ok || v.X != 4 || !v.Shot || q.ack != 4 {
		t.Fatalf("%+v ack=%d", v, q.ack)
	}
	for range 3 {
		q.next()
	}
	r, ok := q.next() // starved: repeat the last without its press
	if ok || r.X != 7 || r.Shot || !q.started() {
		t.Fatalf("repeat %+v %v", r, ok)
	}
}
```

Run: `go test ./core/room -run TestQueue` → FAIL `undefined: newQueue`.

- [ ] **Step 2: `core/room/queue.go`**

```go
package room

const (
	queueCap  = 8 // inputs buffered per player
	queueKeep = 4 // backlog above this is dropped at tick time
)

// queue is one seat's inputs, owned by the room goroutine. Duplicates and
// out-of-order seqs are dropped; a full queue loses its oldest entry; at
// tick time a backlog beyond queueKeep is dropped. Dropped one-shot presses
// latch onto the oldest kept input. Starved, it repeats the last input
// without its presses.
type queue[In Input[In]] struct {
	items   []In
	seqs    []uint32
	last    In
	lastSeq uint32 // highest seq accepted
	ack     uint32 // seq of the input last applied
}

func newQueue[In Input[In]]() queue[In] {
	return queue[In]{items: make([]In, 0, queueCap), seqs: make([]uint32, 0, queueCap)}
}

// started reports whether any input arrived; before that the game keeps the
// seat's own controls.
func (q *queue[In]) started() bool { return q.lastSeq > 0 }

func (q *queue[In]) push(seq uint32, in In) {
	if seq <= q.lastSeq {
		return
	}
	q.lastSeq = seq
	if len(q.items) == queueCap {
		q.drop(1)
	}
	q.items = append(q.items, in)
	q.seqs = append(q.seqs, seq)
}

// next pops this tick's input; false when starved (the held repeat).
func (q *queue[In]) next() (In, bool) {
	if len(q.items) == 0 {
		return q.last, false
	}
	if n := len(q.items) - queueKeep; n > 0 {
		q.drop(n)
	}
	in := q.items[0]
	q.ack = q.seqs[0]
	q.items = append(q.items[:0], q.items[1:]...)
	q.seqs = append(q.seqs[:0], q.seqs[1:]...)
	q.last = in.Held()
	return in, true
}

// drop removes the n oldest inputs; their presses latch onto the next one.
func (q *queue[In]) drop(n int) {
	for _, in := range q.items[:n] {
		q.items[n] = q.items[n].Latch(in)
	}
	q.items = append(q.items[:0], q.items[n:]...)
	q.seqs = append(q.seqs[:0], q.seqs[n:]...)
}
```

- [ ] **Step 3: `core/room/game.go`**

```go
package room

import (
	"errors"

	"playground/core/netproto"
)

// PlayerID is a seated player's id (uint32 on the wire).
type PlayerID = netproto.PlayerID

// Input is one tick of one player's controls.
type Input[In any] interface {
	Latch(dropped In) In // this input plus the one-shot presses of an older, dropped one
	Held() In            // this input without its one-shot presses (repeated while starved)
}

// Msg is a decoded client message: the core reads the header, the game the rest.
type Msg[In any] interface {
	Head() netproto.Header
	Input() In // the message as a tick input (T == "in")
}

// Outbox is how a game talks to the seated humans during one call. It must
// not be kept after the call returns.
type Outbox interface {
	To(id PlayerID, v any) // one seated human
	All(v any)             // every seated human
	Snap(v Acker)          // every seated human, each with its own input ack
	Changed()              // the game's Info changed: republish the lobby summary
}

// Acker is a snapshot that carries the receiving player's input ack.
type Acker interface{ WithAck(ack uint32) any }

// Who is the human asking for a seat.
type Who struct {
	Name     string
	Pilot    string // pilot.Hash(token); "" = not counted
	NewToken string // raw token to hand back in the welcome, only when just issued; never stored
}

// Info is what a game reports for the lobby.
type Info[X any] struct {
	Humans, Seats int // Seats is constant for a room's life; a seat without a human is a bot
	Listed        bool
	Game          X // game-specific summary; a value type (copied across goroutines)
}

// ErrFull: no seat is left. A game's Join wraps it.
var ErrFull = errors.New("room: full")

// Game is one match. The room calls every method on its own goroutine;
// none may block, start goroutines or keep the Outbox.
type Game[M Msg[In], In Input[In], X any] interface {
	Join(who Who) (PlayerID, error)
	Welcome(id PlayerID, code, newToken string, out Outbox)
	Leave(id PlayerID)
	Handle(id PlayerID, m M, out Outbox) // in-room messages other than in, ping and chat
	Step(inputs map[PlayerID]In, out Outbox)
	ChatScope(from PlayerID) func(to PlayerID) bool
	Info() Info[X]
	Label() string // for logs
	FlushStats()   // hand open tallies to the stats sink; players stay seated
	Close()        // the room stops: final tallies
}
```

Move `Who` out of `core/room/seats.go` (delete it there). The generic `Summary[X]` is added in Task 12 (today's non-generic `Summary` keeps its name until then).

- [ ] **Step 4: Session on the queue**

`core/room/session.go`: delete `queueCap`, `queueKeep`, `push`, `next`, `drop` and the fields `queue`, `seqs`, `last`, `lastSeq`, `ack`; add field `q queue[sim.Input]`; `newSession` sets `q: newQueue[sim.Input]()`. Update the users: `room.go` (`s.push(m.Seq, m.Input())` → `s.q.push(m.Seq, m.Input())`; in `tick`: `in, _ := s.q.next(); if s.q.started() {…}`; `ps.Ack = s.ack` → `ps.Ack = s.q.ack`), session tests (`s.push`→`s.q.push`, `s.next`→`s.q.next`, `s.ack`→`s.q.ack`). Move `TestSessionQueue`, `TestSessionBacklogLatchesPresses`, `TestRepeatedInputDropsPresses`, `TestBacklogKeepsBomb` unchanged in content into `queue_test.go` only if they no longer need `session`; otherwise keep them in `session_test.go` with the renames.

- [ ] **Step 5: The fake game**

`core/internal/fakegame/fakegame.go`:

```go
// Package fakegame is the smallest game the core's tests drive: players
// move a counter, bots fill free seats, a snapshot every second tick.
package fakegame

import (
	"encoding/json"
	"fmt"

	"playground/core/netproto"
	"playground/core/room"
)

type Settings struct {
	Seats      int  // default 4
	Listed     bool
	PanicStep  bool // Step panics (room panic tests)
	PanicClose bool // Close and Info panic too after a Step panic
	BadNew     bool // New panics (lobby build tests)
}

// Input: D moves the player's counter, Shot is a one-shot press.
type Input struct {
	D    int  `json:"d"`
	Shot bool `json:"shot"`
}

func (i Input) Latch(d Input) Input { i.Shot = i.Shot || d.Shot; return i }
func (i Input) Held() Input         { i.Shot = false; return i }

// Msg is every client message of the fake game.
type Msg struct {
	T     string  `json:"t"`
	V     int     `json:"v,omitempty"`
	Name  string  `json:"name,omitempty"`
	Tok   string  `json:"tok,omitempty"`
	Code  string  `json:"code,omitempty"`
	Seq   uint32  `json:"seq,omitempty"`
	TS    float64 `json:"ts,omitempty"`
	Chat  int     `json:"id,omitempty"`
	D     int     `json:"d,omitempty"`
	Shot  bool    `json:"shot,omitempty"`
	Seats int     `json:"seats,omitempty"` // create
	Color string  `json:"color,omitempty"` // "color": the game's own in-room message
}

func (m Msg) Head() netproto.Header {
	return netproto.Header{T: m.T, V: m.V, Name: m.Name, Tok: m.Tok, Code: m.Code, Seq: m.Seq, TS: m.TS, Chat: m.Chat}
}
func (m Msg) Input() Input        { return Input{D: m.D, Shot: m.Shot} }
func (m Msg) Latch(d Msg) Msg     { m.Shot = m.Shot || d.Shot; return m }

// Decode is the fake game's decoder.
func Decode(b []byte) (Msg, error) {
	var m Msg
	if err := json.Unmarshal(b, &m); err != nil {
		return Msg{}, err
	}
	switch m.T {
	case netproto.THello, netproto.TCreate, netproto.TJoin, netproto.TQuick, netproto.TIn, netproto.TPing, netproto.TChat, "color":
	default:
		return Msg{}, fmt.Errorf("fakegame: unknown type %q", m.T)
	}
	return m, netproto.CheckHeader(m.Head(), 6)
}

// Snap is the fake snapshot.
type Snap struct {
	T    string           `json:"t"`
	Tick int              `json:"tick"`
	Ack  uint32           `json:"ack"`
	Pos  map[uint32]int   `json:"pos"`
}

func (s Snap) WithAck(a uint32) any { s.Ack = a; return s }
func (Snap) Replaceable()           {}

// Info is the fake game's lobby summary.
type Info struct{ Color string }

// Recorder counts what the room asked of the game (tests read it after the
// room stopped or under synctest.Wait).
type Recorder struct{ Leaves, Flushes, Closes, Steps int }

type Game struct {
	s       Settings
	rec     *Recorder
	tick    int
	next    room.PlayerID
	humans  map[room.PlayerID]int // position per human
	color   string
	panicked bool
}

func New(s Settings, rec *Recorder) *Game {
	if s.BadNew {
		panic("fakegame: bad settings")
	}
	if s.Seats <= 0 {
		s.Seats = 4
	}
	if rec == nil {
		rec = &Recorder{}
	}
	return &Game{s: s, rec: rec, humans: map[room.PlayerID]int{}, color: "red"}
}

var _ room.Game[Msg, Input, Info] = (*Game)(nil)

func (g *Game) Join(who room.Who) (room.PlayerID, error) {
	if len(g.humans) == g.s.Seats {
		return 0, fmt.Errorf("fakegame: %w", room.ErrFull)
	}
	g.next++
	g.humans[g.next] = 0
	return g.next, nil
}

func (g *Game) Welcome(id room.PlayerID, code, tok string, out room.Outbox) {
	out.To(id, map[string]any{"t": "welcome", "you": id, "code": code, "tok": tok, "tick": g.tick})
}

func (g *Game) Leave(id room.PlayerID) { delete(g.humans, id); g.rec.Leaves++ }

func (g *Game) Handle(id room.PlayerID, m Msg, out room.Outbox) {
	if m.T == "color" && m.Color != "" {
		g.color = m.Color
		out.To(id, netproto.NewNotice("color_set", m.Color))
		out.Changed()
	}
}

func (g *Game) Step(inputs map[room.PlayerID]Input, out room.Outbox) {
	g.rec.Steps++
	if g.s.PanicStep {
		g.panicked = true
		panic("fakegame: step")
	}
	g.tick++
	for id, in := range inputs {
		g.humans[id] += in.D
	}
	if g.tick%2 == 0 {
		pos := make(map[uint32]int, len(g.humans))
		for id, p := range g.humans {
			pos[uint32(id)] = p
		}
		out.Snap(Snap{T: "snap", Tick: g.tick, Pos: pos})
	}
}

func (g *Game) ChatScope(room.PlayerID) func(room.PlayerID) bool { return func(room.PlayerID) bool { return true } }

func (g *Game) Info() room.Info[Info] {
	if g.panicked && g.s.PanicClose {
		panic("fakegame: info")
	}
	return room.Info[Info]{Humans: len(g.humans), Seats: g.s.Seats, Listed: g.s.Listed, Game: Info{Color: g.color}}
}

func (g *Game) Label() string { return "fake" }
func (g *Game) FlushStats()   { g.rec.Flushes++ }

func (g *Game) Close() {
	g.rec.Closes++
	if g.panicked && g.s.PanicClose {
		panic("fakegame: close")
	}
}
```

`core/internal/fakegame/fakegame_test.go`:

```go
package fakegame

import (
	"errors"
	"testing"

	"playground/core/room"
)

type box struct{ to, all, snaps []any; changed int }

func (b *box) To(_ room.PlayerID, v any) { b.to = append(b.to, v) }
func (b *box) All(v any)                 { b.all = append(b.all, v) }
func (b *box) Snap(v room.Acker)         { b.snaps = append(b.snaps, v.WithAck(1)) }
func (b *box) Changed()                  { b.changed++ }

func TestFakeGameContract(t *testing.T) {
	g := New(Settings{Seats: 1}, nil)
	id, err := g.Join(room.Who{Name: "a"})
	if err != nil || id != 1 {
		t.Fatal(id, err)
	}
	if _, err := g.Join(room.Who{}); !errors.Is(err, room.ErrFull) {
		t.Fatalf("full: %v", err)
	}
	b := &box{}
	g.Step(map[room.PlayerID]Input{1: {D: 2}}, b)
	g.Step(map[room.PlayerID]Input{1: {D: 3}}, b)
	if len(b.snaps) != 1 || b.snaps[0].(Snap).Pos[1] != 5 || b.snaps[0].(Snap).Ack != 1 {
		t.Fatalf("%+v", b.snaps)
	}
	g.Handle(1, Msg{T: "color", Color: "blue"}, b)
	if b.changed != 1 || g.Info().Game.Color != "blue" {
		t.Fatal("color")
	}
}
```

- [ ] **Step 6: Verify and commit**

Run: `go test ./core/room ./core/internal/fakegame -v -run 'TestQueue|TestFake|TestSession|TestDropped' && go build ./... && go vet ./... && go test ./... -race -short && go test ./internal/golden -count=1`
Expected: PASS; golden PASS.

```bash
git add core/room/game.go core/room/queue.go core/room/queue_test.go core/room/session.go core/room/session_test.go core/room/room.go core/room/stats.go core/room/seats.go core/internal/fakegame/fakegame.go core/internal/fakegame/fakegame_test.go
.tools/gc -m "core/room: the Game contract, a generic input queue and a fake game" -m "game.go states what a game must provide (Join, Welcome, Leave, Handle, Step, ChatScope, Info, Label, FlushStats, Close) and what it gets (Outbox, Acker). The seat queue is generic over the input's Latch/Held; Dogfight's sessions use it. core/internal/fakegame is the game core tests will drive." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: `internal/match` — Dogfight as a `room.Game` (not wired yet)

**Files:**
- Create: `internal/match/match.go` (type, constructor, Join/Welcome/Leave/Handle/Step/ChatScope/Info/Label)
- Create: `internal/match/tally.go` (stats tallies, moved logic of `core/room/stats.go`)
- Create: `internal/match/team.go` (team choice + notices, moved logic of `core/room/team.go`)
- Create: `internal/match/match_test.go`

**Interfaces:**
- Consumes: `room.Game`, `room.Outbox`, `room.Who`, `room.Info`, `room.ErrFull`, `room.PlayerID` (Task 10); `protocol.Snap.WithAck`, `netproto.NewNotice` (Task 8).
- Produces:

```go
type StatsSink interface{ Record(stats.Delta) bool } // must not block
type Info struct{ Mode, Map, Weather, Phase string; LeftS, NATO, Soviet int }
type Match struct{ /* unexported */ }
func New(s game.Settings, sink StatsSink) *Match // sink nil = not counted
func Factory(sink StatsSink) func(game.Settings) (room.Game[protocol.ClientMsg, sim.Input, Info], error)
const SnapEvery, RoundEvery, MatchTicks = 2, 60, 60 * 60
```

- [ ] **Step 1: Failing unit tests**

`internal/match/match_test.go`:

```go
package match

import (
	"errors"
	"testing"

	"playground/core/netproto"
	"playground/core/room"
	"playground/internal/bot"
	"playground/internal/game"
	"playground/internal/mode"
	"playground/internal/protocol"
	"playground/internal/sim"
)

// box records what the match sends, in order, as type names.
type box struct {
	log     []string
	changed int
}

func name(v any) string {
	switch m := v.(type) {
	case protocol.Welcome:
		return "welcome"
	case protocol.Snap:
		return "snap"
	case protocol.PlayersMsg:
		return "players"
	case protocol.RoundMsg:
		return "round"
	case netproto.NoticeMsg:
		return "notice:" + m.Code
	}
	return "?"
}

func (b *box) To(id room.PlayerID, v any) { b.log = append(b.log, "to "+name(v)) }
func (b *box) All(v any)                  { b.log = append(b.log, "all "+name(v)) }
func (b *box) Snap(v room.Acker)          { b.log = append(b.log, "snap "+name(v.WithAck(1))) }
func (b *box) Changed()                   { b.changed++ }

var ffa4 = game.Settings{Mode: mode.FFA, Size: 4, Difficulty: bot.Easy, Seed: 1}

func TestWelcomeOrderAndFull(t *testing.T) {
	m := New(game.Settings{Mode: mode.FFA, Size: 2, Difficulty: bot.Easy, Seed: 1}, nil)
	b := &box{}
	a, err := m.Join(room.Who{Name: "a"})
	if err != nil {
		t.Fatal(err)
	}
	m.Welcome(a, "ABCD", "", b)
	if got := b.log; len(got) != 3 || got[0] != "to welcome" || got[1] != "all players" || got[2] != "to round" {
		t.Fatalf("welcome order %v", got)
	}
	if _, err := m.Join(room.Who{Name: "b"}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Join(room.Who{Name: "c"}); !errors.Is(err, room.ErrFull) || !errors.Is(err, game.ErrFull) {
		t.Fatalf("third join: %v", err)
	}
	if in := m.Info(); in.Humans != 2 || in.Seats != 2 || in.Game.Mode != "ffa" || in.Game.Phase != "playing" {
		t.Fatalf("info %+v", in)
	}
}

func TestStepOrderSnapEveryOtherTickThenRosterThenRound(t *testing.T) {
	m := New(ffa4, nil)
	b := &box{}
	a, _ := m.Join(room.Who{Name: "a"})
	m.Step(map[room.PlayerID]sim.Input{a: {Throttle: 1}}, b) // tick 1: roster changed (join), round key new
	m.Step(nil, b)                                           // tick 2: snapshot
	want := []string{"all players", "all round", "snap snap"}
	if len(b.log) < 3 || b.log[0] != want[0] || b.log[1] != want[1] || b.log[2] != want[2] {
		t.Fatalf("step order %v", b.log)
	}
}

func TestTeamRefusalIsANoticeAndSuccessRepublishes(t *testing.T) {
	m := New(game.Settings{Mode: mode.Team, Size: 4, Difficulty: bot.Easy, Seed: 1}, nil)
	b := &box{}
	a, _ := m.Join(room.Who{Name: "a"})
	cur, other := "nato", "soviet"
	if m.teams()[sim.ID(a)] == sim.TeamSoviet {
		cur, other = "soviet", "nato"
	}
	m.Handle(a, protocol.ClientMsg{T: protocol.TTeam, Team: other}, b)
	m.Handle(a, protocol.ClientMsg{T: protocol.TTeam, Team: cur}, b) // back, inside the cooldown
	if b.changed != 1 || len(b.log) != 1 || b.log[0] != "to notice:"+protocol.CodeTeamCooldown {
		t.Fatalf("changed=%d log=%v", b.changed, b.log)
	}
	ffa := New(ffa4, nil)
	f, _ := ffa.Join(room.Who{Name: "f"})
	b2 := &box{}
	ffa.Handle(f, protocol.ClientMsg{T: protocol.TTeam, Team: "nato"}, b2)
	if len(b2.log) != 1 || b2.log[0] != "to notice:"+protocol.CodeTeamNone {
		t.Fatalf("ffa team %v", b2.log)
	}
}

func TestChatScope(t *testing.T) {
	m := New(game.Settings{Mode: mode.Team, Size: 4, Difficulty: bot.Easy, Seed: 1}, nil)
	a, _ := m.Join(room.Who{Name: "a"})
	mine := m.teams()[sim.ID(a)]
	var foe room.PlayerID
	for _, p := range m.g.Players() {
		if p.Team != mine {
			foe = room.PlayerID(p.ID)
		}
	}
	to := m.ChatScope(a)
	if foe == 0 || !to(a) || to(foe) {
		t.Fatalf("team chat scope: foe %d, self %v, foe reached %v", foe, to(a), to(foe))
	}
	ffa := New(ffa4, nil)
	x, _ := ffa.Join(room.Who{Name: "x"})
	if !ffa.ChatScope(x)(x + 1) {
		t.Fatal("ffa chat must reach everyone")
	}
}
```

Run: `go test ./internal/match` → FAIL (`undefined: New`).

- [ ] **Step 2: `internal/match/match.go`**

```go
// Package match is Dogfight's room.Game: it wraps game.Game for the room
// actor, encodes Dogfight's messages, tallies pilot stats and turns refused
// team choices into notices. Every method runs on the room goroutine.
package match

import (
	"errors"
	"fmt"
	"math"

	"playground/core/room"
	"playground/internal/game"
	"playground/internal/mode"
	"playground/internal/protocol"
	"playground/internal/sim"
	"playground/internal/stats"
)

const (
	tickRate   = 60
	SnapEvery  = 2                // ticks between snapshots
	RoundEvery = 60               // ticks between periodic round broadcasts
	MatchTicks = 60 * tickRate    // presence in a round's play (plus airborne once) that counts as a match
)

// StatsSink takes a pilot's tally; it must not block (spec §10.3 of v2).
type StatsSink interface{ Record(stats.Delta) bool }

// Info is Dogfight's part of the lobby summary.
type Info struct {
	Mode, Map, Weather, Phase string // phase: playing|ended
	LeftS                     int    // seconds left in the round
	NATO, Soviet              int    // humans per team (team and base modes)
}

type roundKey struct {
	phase                                game.Phase
	nato, soviet, totalKills, totalScore int
	objNATO, objSoviet                   int // base attack HP in 10 HP steps: bars move without a flood of updates
}

// human is one seated human's tally state.
type human struct {
	pilot      string // token hash; "" = not counted
	name       string // roster name, reported with the tally
	tally      stats.Delta
	roundTicks int
	airborne   bool
}

// Match is not safe for concurrent use; the room goroutine owns it.
type Match struct {
	g         *game.Game
	static    protocol.Static // welcome terrain and map, encoded once
	stats     StatsSink
	seats     int // every seat, bots included
	humans    map[sim.ID]*human
	events    []protocol.EventJSON
	rosterVer int
	round     roundKey
}

var (
	_ room.Game[protocol.ClientMsg, sim.Input, Info] = (*Match)(nil)
	_ room.Acker                                     = protocol.Snap{}
)

// New builds the game (every seat a bot). sink nil: nothing is counted.
func New(s game.Settings, sink StatsSink) *Match {
	g := game.New(s)
	return &Match{g: g, static: protocol.NewStatic(g), stats: sink, seats: len(g.Players()),
		humans: map[sim.ID]*human{}, rosterVer: g.RosterVersion()}
}

// Factory is the lobby's room factory for Dogfight.
func Factory(sink StatsSink) func(game.Settings) (room.Game[protocol.ClientMsg, sim.Input, Info], error) {
	return func(s game.Settings) (room.Game[protocol.ClientMsg, sim.Input, Info], error) { return New(s, sink), nil }
}

func (m *Match) Join(who room.Who) (room.PlayerID, error) {
	id, err := m.g.AddHuman(who.Name)
	if errors.Is(err, game.ErrFull) {
		return 0, fmt.Errorf("%w: %w", room.ErrFull, err)
	}
	if err != nil {
		return 0, err
	}
	h := &human{pilot: who.Pilot}
	for _, p := range m.g.Players() {
		if p.ID == id {
			h.name = p.Name // the roster's cleaned name
		}
	}
	m.humans[id] = h
	return room.PlayerID(id), nil
}

func (m *Match) Welcome(id room.PlayerID, code, newToken string, out room.Outbox) {
	w := protocol.NewWelcome(sim.ID(id), code, m.g, m.static)
	w.Tok = newToken
	out.To(id, w)
	m.broadcastPlayers(out)
	out.To(id, protocol.NewRound(m.g.Round()))
}

func (m *Match) Leave(id room.PlayerID) {
	sid := sim.ID(id)
	if h, ok := m.humans[sid]; ok {
		m.leaveCount(h)
		delete(m.humans, sid)
	}
	m.g.RemoveHuman(sid)
}

func (m *Match) Handle(id room.PlayerID, msg protocol.ClientMsg, out room.Outbox) {
	sid := sim.ID(id)
	switch msg.T {
	case protocol.TPick:
		if lo, ok := sim.ParseLoadout(msg.Lo); ok { // before Pick: a respawning pick takes it at once
			m.g.SetLoadout(sid, lo)
		}
		if k, ok := sim.ParseKind(msg.Kind); ok {
			_ = m.g.Pick(sid, k) // a kind the team may not fly is ignored
		}
	case protocol.TTeam:
		m.team(id, msg.Team, out)
	}
}

// Step runs one tick and sends, in this order: the snapshot (every
// SnapEvery ticks, with the events since the last one), the roster when it
// changed, the round when its key changed or every RoundEvery ticks.
func (m *Match) Step(inputs map[room.PlayerID]sim.Input, out room.Outbox) {
	in := make(map[sim.ID]sim.Input, len(inputs))
	for id, v := range inputs {
		in[sim.ID(id)] = v
	}
	evs := m.g.Step(in)
	m.countEvents(evs)
	tick := m.g.Tick()
	m.events = append(m.events, protocol.NewEvents(evs, tick)...)
	rd := m.g.Round()
	if tick%SnapEvery == 0 {
		world := m.g.Snapshot()
		m.countFlight(world, rd.Phase)
		snap := protocol.NewSnap(world, m.events, tick)
		m.events = nil // snap owns the old slice; sessions share it read-only
		out.Snap(snap)
	}
	if m.g.RosterVersion() != m.rosterVer {
		m.broadcastPlayers(out)
	}
	key := roundKey{phase: rd.Phase, nato: rd.NATO, soviet: rd.Soviet,
		objNATO: int(math.Ceil(rd.ObjNATO / 10)), objSoviet: int(math.Ceil(rd.ObjSoviet / 10))}
	for _, l := range rd.Board {
		key.totalKills += l.Kills
		key.totalScore += l.Score // +2 for a destroyed target is not a kill
	}
	if rd.Phase == game.Playing {
		m.countPresence()
	}
	if m.round.phase == game.Playing && rd.Phase == game.Ended {
		m.roundOver(rd)
	}
	if key != m.round || tick%RoundEvery == 0 {
		m.round = key
		out.All(protocol.NewRound(rd))
	}
}

func (m *Match) broadcastPlayers(out room.Outbox) {
	m.rosterVer = m.g.RosterVersion()
	out.All(protocol.NewPlayers(m.g.Players()))
}

// ChatScope: team-only in team and base modes, everyone in FFA. Scoped by
// the room's mode, not the sender's team: a sender missing from the roster
// (TeamNone) must not reach both teams.
func (m *Match) ChatScope(from room.PlayerID) func(to room.PlayerID) bool {
	teams := m.teams()
	team, ffa := teams[sim.ID(from)], m.g.Settings().Mode == mode.FFA
	return func(to room.PlayerID) bool { return ffa || (team != sim.TeamNone && teams[sim.ID(to)] == team) }
}

// teams maps every seated player to its team (TeamNone in FFA).
func (m *Match) teams() map[sim.ID]sim.Team {
	ps := m.g.Players()
	out := make(map[sim.ID]sim.Team, len(ps))
	for _, p := range ps {
		out[p.ID] = p.Team
	}
	return out
}

func (m *Match) Info() room.Info[Info] {
	st := m.g.Settings()
	rd := m.g.Round()
	phase := "playing"
	if rd.Phase == game.Ended {
		phase = "ended"
	}
	nato, soviet := m.g.HumanTeams()
	return room.Info[Info]{Humans: m.g.Humans(), Seats: m.seats, Listed: st.Listed, Game: Info{
		Mode: st.Mode.String(), Map: st.Map.String(), Weather: st.Weather.String(), Phase: phase,
		LeftS: rd.TicksLeft / tickRate, NATO: nato, Soviet: soviet}}
}

func (m *Match) Label() string { return m.g.Settings().Mode.String() }
```

- [ ] **Step 3: `internal/match/tally.go`**

Copy from `core/room/stats.go` the bodies of `counted`, `countEvents`, `countFlight`, `countPresence`, `played`, `newRound`, `roundOver`, `leaveCount`, `flush` with these exact renames and nothing else:

| in `core/room/stats.go` | in `internal/match/tally.go` |
|---|---|
| `func (r *Room) …` | `func (m *Match) …` |
| `r.sessions` | `m.humans` |
| `*session`, `s *session` | `*human`, `h *human` (and `s.` → `h.` on those values) |
| `r.stats` | `m.stats` |
| `r.game` | `m.g` |
| `r.teams()` | `m.teams()` |
| `SnapEvery`, `MatchTicks` | same names (now in `match`) |
| `counted(id sim.ID) (*session, bool)` | `counted(id sim.ID) (*human, bool)` |

`leaveCount(s)` loses its `s.id` use: it becomes

```go
// leaveCount closes a leaving pilot's tally: a round it played counts as a
// match without a win, so leaving cannot dodge a loss.
func (m *Match) leaveCount(h *human) {
	if h.pilot != "" && m.stats != nil && h.played() {
		h.tally.Matches++
	}
	h.newRound()
	m.flush(h)
}
```

Add the two room-facing methods:

```go
// FlushStats hands every seated pilot's open tally over as a leave would (a
// played round counts as a match, without a win); players stay seated.
func (m *Match) FlushStats() {
	for _, h := range m.humans {
		m.leaveCount(h)
	}
}

// Close hands over every open tally as the room stops.
func (m *Match) Close() {
	for _, h := range m.humans {
		m.flush(h)
	}
}
```

- [ ] **Step 4: `internal/match/team.go`**

Copy `msgTeam*` constants and `teamMsg` from `core/room/team.go` verbatim (with `protocol.CodeTeam*` codes); the choice becomes

```go
// team applies a player's team choice ("nato", "soviet" or "auto"); a
// refusal comes back as a notice to that player only.
func (m *Match) team(id room.PlayerID, choice string, out room.Outbox) {
	want, valid := protocol.ParseTeam(choice)
	if !valid {
		return
	}
	if err := m.g.ChooseTeam(sim.ID(id), want); err != nil {
		if code, msg := teamMsg(err); msg != "" {
			out.To(id, netproto.NewNotice(code, msg))
		}
		return
	}
	out.Changed() // the lobby lists humans per team
}
```

- [ ] **Step 5: Verify and commit**

Run: `go test ./internal/match -v && go build ./... && go vet ./... && go test ./... -race -short`
Expected: PASS. If the first team switch in `TestTeamRefusalIsANoticeAndSuccessRepublishes` is itself refused (e.g. `team_uneven` for this seed), use the seed and size of the existing `TestTeamSwitchChatSummaryNotice` in `core/room/team_test.go`, whose first switch succeeds; record it in the report.

```bash
git add internal/match/match.go internal/match/tally.go internal/match/team.go internal/match/match_test.go
.tools/gc -m "match: Dogfight as a room.Game" -m "Wraps game.Game for the generic room: welcome/roster/round order, snapshot every second tick with the events since the last, team notices, chat scope, lobby info, and the pilot tallies the room used to keep. Not wired yet; the room still runs its own copy." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: The room drives a `Game` (switch-over)

This is the largest task: the room becomes generic, its Dogfight code is deleted (it lives in `match` since Task 11), Dogfight's room tests move to `internal/match`, and the room's own tests run on the fake game. Everything lands in one commit so no test is ever orphaned.

**Files:**
- Rewrite: `core/room/room.go`, `core/room/seats.go`, `core/room/session.go`, `core/room/chat.go`, `core/room/drainflush.go`, `core/room/summary.go`
- Delete: `core/room/stats.go`, `core/room/team.go` (`git rm`)
- Create: `core/room/outbox.go`
- Move to `internal/match/` (`git mv`, then edit): `core/room/stats_test.go`, `core/room/team_test.go`, `core/room/chat_test.go`, `core/room/book_rules_test.go`, `core/room/roundend_test.go`, `core/room/summary_test.go`, `core/room/drainflush_test.go`
- Rewrite on fakegame (`package room_test`): `core/room/room_test.go`, `core/room/metrics_test.go`, `core/room/panic_test.go`, `core/room/session_test.go` → `core/room/seat_test.go`
- Create: `internal/match/types.go` (aliases), `internal/match/room_test.go` (helpers + `TestNoInputKeepsSpawnThrottle`, `TestDroppedPressSurvivesBothLatches`)
- Modify: `internal/lobby/lobby.go`, `internal/lobby/*_test.go`, `internal/server/*.go` (types), `cmd/dogfight/main.go`, `internal/golden/room_test.go` (`newRoom` line only), `internal/golden/boundary_test.go` (drop `core/room`)

**Interfaces:**
- Consumes: Tasks 10–11.
- Produces:

```go
func New[M Msg[In], In Input[In], X any](code string, g Game[M, In, X], o Options) *Room[M, In, X]
type Options struct { Seq int64; Metrics *metrics.Registry; TickRate int; EmptyTimeout, UnusedTimeout time.Duration; PublishEvery, ChatMax, ChatCooldown int }
func (r *Room[M, In, X]) Code() string; Label() string; Done() <-chan struct{}; Run(ctx); Join(ctx, Who, Sender) (*Seat[M], error); FlushStats(ctx) bool; Summary() Summary[X]
type Seat[M any] struct{ /* unexported */ } // ID() PlayerID; Done() <-chan struct{}; Input(m M); Leave()
type Summary[X any] struct { Code string; Seq int64; Info[X] }
var ErrClosed error
// internal/match/types.go
type Room = room.Room[protocol.ClientMsg, sim.Input, Info]
type Seat = room.Seat[protocol.ClientMsg]
type Summary = room.Summary[Info]
```

- [ ] **Step 1: Rewrite the room's own tests on the fake game (failing)**

`core/room/room_test.go` (`package room_test`) — port every generic test from today's file, replacing Dogfight types with the fake game; keep the names and assertions. Helpers:

```go
package room_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"playground/core/internal/fakegame"
	"playground/core/netproto"
	"playground/core/room"
)

type fakeSender struct {
	mu     sync.Mutex
	msgs   []any
	closed bool
}

func (f *fakeSender) Send(v any) bool { f.mu.Lock(); defer f.mu.Unlock(); f.msgs = append(f.msgs, v); return true }
func (f *fakeSender) Close()          { f.mu.Lock(); defer f.mu.Unlock(); f.closed = true }

func (f *fakeSender) count(t string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, m := range f.msgs {
		switch v := m.(type) {
		case fakegame.Snap:
			if t == "snap" {
				n++
			}
		case netproto.Pong:
			if t == "pong" {
				n++
			}
		case netproto.ChatMsg:
			if t == "chat" {
				n++
			}
		case netproto.NoticeMsg:
			if t == "notice" {
				n++
			}
		case map[string]any:
			if v["t"] == t {
				n++
			}
		}
	}
	return n
}

func (f *fakeSender) lastSnap() (fakegame.Snap, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := len(f.msgs) - 1; i >= 0; i-- {
		if s, ok := f.msgs[i].(fakegame.Snap); ok {
			return s, true
		}
	}
	return fakegame.Snap{}, false
}

type fakeRoom = room.Room[fakegame.Msg, fakegame.Input, fakegame.Info]

func start(t *testing.T, s fakegame.Settings, rec *fakegame.Recorder) (*fakeRoom, context.CancelFunc) {
	r := room.New("ABCD", fakegame.New(s, rec), room.Options{})
	ctx, cancel := context.WithCancel(t.Context())
	go r.Run(ctx)
	return r, cancel
}
```

Tests to port (same scenario, fake types): `TestJoinReceivesWelcomeAndSnaps` (welcome 1, snaps ≥ 25 in 1 s), `TestAckAdvances` (inputs seq 1..10 then a stale 3 → last snap ack 10), `TestPingAndBadPick` → `TestPingAndUnknownGameMessage` (ping → 1 pong; `{T:"color"}` with empty color is ignored; room alive), `TestEmptyRoomCloses`, `TestCancelClosesSessions`, `TestFullRoom` (`Seats: 1`, second join `errors.Is(err, room.ErrFull)`), `TestUnusedRoomCloses`. New ones:

```go
func TestChatCooldownAndScope(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, cancel := start(t, fakegame.Settings{}, nil)
		defer cancel()
		a, b := &fakeSender{}, &fakeSender{}
		sa, _ := r.Join(t.Context(), room.Who{Name: "a"}, a)
		_, _ = r.Join(t.Context(), room.Who{Name: "b"}, b)
		sa.Input(fakegame.Msg{T: netproto.TChat, Chat: 1})
		sa.Input(fakegame.Msg{T: netproto.TChat, Chat: 2}) // inside 2 s: dropped
		sa.Input(fakegame.Msg{T: netproto.TChat, Chat: 9}) // over ChatMax: dropped
		time.Sleep(time.Second)
		synctest.Wait()
		if a.count("chat") != 1 || b.count("chat") != 1 {
			t.Fatalf("chat a=%d b=%d", a.count("chat"), b.count("chat"))
		}
		time.Sleep(2 * time.Second)
		sa.Input(fakegame.Msg{T: netproto.TChat, Chat: 3})
		time.Sleep(time.Second / 10)
		synctest.Wait()
		if b.count("chat") != 2 {
			t.Fatalf("after cooldown b=%d", b.count("chat"))
		}
	})
}

func TestChangedRepublishesSummary(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, cancel := start(t, fakegame.Settings{Listed: true}, nil)
		defer cancel()
		s, _ := r.Join(t.Context(), room.Who{Name: "a"}, &fakeSender{})
		if sum := r.Summary(); sum.Humans != 1 || sum.Code != "ABCD" || !sum.Listed || sum.Game.Color != "red" {
			t.Fatalf("%+v", sum)
		}
		s.Input(fakegame.Msg{T: "color", Color: "blue"})
		time.Sleep(time.Second / 120)
		synctest.Wait()
		if r.Summary().Game.Color != "blue" {
			t.Fatal("Changed did not republish")
		}
	})
}

func TestFlushStatsAndLeaveReachTheGame(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		rec := &fakegame.Recorder{}
		r, cancel := start(t, fakegame.Settings{}, rec)
		s, _ := r.Join(t.Context(), room.Who{Name: "a"}, &fakeSender{})
		if !r.FlushStats(t.Context()) {
			t.Fatal("flush not acknowledged")
		}
		s.Leave()
		synctest.Wait()
		cancel()
		<-r.Done()
		if rec.Flushes != 1 || rec.Leaves != 1 || rec.Closes != 1 {
			t.Fatalf("%+v", *rec)
		}
		if !r.FlushStats(t.Context()) {
			t.Fatal("a stopped room reports flushed")
		}
	})
}
```

`core/room/panic_test.go` (`package room_test`): port `TestRoomPanicClosesRoom` onto `fakegame.Settings{PanicStep: true}` and add Review Focus 2:

```go
func TestPanickingGameStillClosesEverySeat(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		reg := metrics.New("t", nil)
		r := room.New("ABCD", fakegame.New(fakegame.Settings{PanicStep: true, PanicClose: true}, nil), room.Options{Metrics: reg})
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		out := &fakeSender{}
		done := make(chan struct{})
		go func() { defer close(done); r.Run(ctx) }()
		_, _ = r.Join(t.Context(), room.Who{Name: "a"}, out) // may race the first Step panic: either way the room ends
		<-done
		if !out.closed && out.count("welcome") == 1 {
			t.Fatal("a seated session was not closed")
		}
		if reg.Humans.Load() != 0 || reg.Bots.Load() != 0 {
			t.Fatalf("gauges humans=%d bots=%d", reg.Humans.Load(), reg.Bots.Load())
		}
	})
}
```

(Import `playground/core/metrics`. When `Info` panics during teardown the gauges cannot be read; the room then returns them from the last published summary — see Step 2's `closeAll`.)

`core/room/metrics_test.go`: port onto the fake game (gauges: `Bots` = seats at `New`, `+1/-1` on join, back on leave, both to 0 on close; tick histogram observed).

`core/room/seat_test.go`: port `TestSeatInboxBounded` (seat drops beyond 16 in flight).

Delete the generic tests' old Dogfight versions from these files. Run: `go test ./core/room` → FAIL to compile (`room.New` has the old signature).

- [ ] **Step 2: Rewrite the room**

`core/room/room.go`:

```go
// Package room runs one match as an actor: a single goroutine owns the
// game and talks to connections only through channels and Sender.
package room

import (
	"context"
	"errors"
	"log/slog"
	"sync/atomic"
	"time"

	"playground/core/metrics"
	"playground/core/netproto"
)

// Option defaults.
const (
	DefaultTickRate      = 60
	DefaultEmptyTimeout  = 60 * time.Second
	DefaultUnusedTimeout = 15 * time.Second // a room no human has ever joined (S11)
	DefaultPublishEvery  = 60               // ticks between periodic summary publishes
	DefaultChatMax       = 6
	// seatInbox bounds one seat's messages in flight to the room; with at
	// most a dozen seats the shared queue never fills, so one flooding
	// client cannot crowd out the others' inputs.
	seatInbox  = 16
	inputQueue = 256
)

var ErrClosed = errors.New("room: closed")

// Sender is the outbound side of a connection. Send must not block.
type Sender interface {
	Send(v any) bool
	Close()
}

// Options are a room's ties to its lobby and its clock; zero fields take
// the defaults.
type Options struct {
	Seq           int64             // lobby creation order (newer rooms list first on equal humans)
	Metrics       *metrics.Registry // nil = not measured
	TickRate      int
	EmptyTimeout  time.Duration // no humans this long: the room ends
	UnusedTimeout time.Duration // no human ever joined this long: the room ends
	PublishEvery  int           // ticks between periodic summary publishes
	ChatMax       int           // highest quick-chat preset id
	ChatCooldown  int           // ticks between two relayed chats of one player; default 2 s
}

func (o Options) withDefaults() Options {
	if o.TickRate <= 0 {
		o.TickRate = DefaultTickRate
	}
	if o.EmptyTimeout <= 0 {
		o.EmptyTimeout = DefaultEmptyTimeout
	}
	if o.UnusedTimeout <= 0 {
		o.UnusedTimeout = DefaultUnusedTimeout
	}
	if o.PublishEvery <= 0 {
		o.PublishEvery = DefaultPublishEvery
	}
	if o.ChatMax <= 0 {
		o.ChatMax = DefaultChatMax
	}
	if o.ChatCooldown <= 0 {
		o.ChatCooldown = 2 * o.TickRate
	}
	return o
}

type inputMsg[M any] struct {
	seat *Seat[M]
	msg  M
}

type Room[M Msg[In], In Input[In], X any] struct {
	code    string
	label   string // game.Label at New: readable from any goroutine
	game    Game[M, In, X]
	o       Options
	summary atomic.Pointer[Summary[X]]
	joins   chan joinReq
	leaves  chan PlayerID
	inputs  chan inputMsg[M]
	flushes chan chan struct{} // FlushStats requests; closed reply = done
	done    chan struct{}

	// owned by the Run goroutine
	sessions   map[PlayerID]*session[In]
	ticks      int
	emptySince time.Time
	joined     bool // a human has been seated at least once
}

func New[M Msg[In], In Input[In], X any](code string, g Game[M, In, X], o Options) *Room[M, In, X] {
	r := &Room[M, In, X]{
		code: code, label: g.Label(), game: g, o: o.withDefaults(),
		joins:    make(chan joinReq),
		leaves:   make(chan PlayerID),
		inputs:   make(chan inputMsg[M], inputQueue),
		flushes:  make(chan chan struct{}),
		done:     make(chan struct{}),
		sessions: map[PlayerID]*session[In]{},
	}
	r.publish()
	r.gauge(0, int64(r.Summary().Seats)) // every seat starts as a bot
	return r
}

func (r *Room[M, In, X]) Code() string          { return r.code }
func (r *Room[M, In, X]) Label() string         { return r.label }
func (r *Room[M, In, X]) Done() <-chan struct{} { return r.done }

// Run is the actor loop. It returns on ctx cancel, after EmptyTimeout with
// no humans (UnusedTimeout if none ever joined), or on a panic; every
// session is closed on the way out.
func (r *Room[M, In, X]) Run(ctx context.Context) {
	defer close(r.done)
	defer r.closeAll()
	defer func() {
		if v := recover(); v != nil {
			slog.Error("room panic", "code", r.code, "panic", v)
		}
	}()
	t := time.NewTicker(time.Second / time.Duration(r.o.TickRate))
	defer t.Stop()
	r.emptySince = time.Now()
	for {
		select {
		case <-ctx.Done():
			return
		case req := <-r.joins:
			r.join(req)
		case id := <-r.leaves:
			r.leave(id)
		case in := <-r.inputs:
			<-in.seat.slots
			r.input(in.seat.id, in.msg)
		case ack := <-r.flushes:
			r.game.FlushStats()
			close(ack)
		case now := <-t.C:
			if len(r.sessions) == 0 && now.Sub(r.emptySince) >= r.emptyTimeout() {
				return
			}
			r.tick()
		}
	}
}

func (r *Room[M, In, X]) emptyTimeout() time.Duration {
	if r.joined {
		return r.o.EmptyTimeout
	}
	return r.o.UnusedTimeout
}

// closeAll closes every session and returns the gauges. The game may have
// panicked already: a second panic in Close or Info is logged, and the
// gauges then come from the last published summary.
func (r *Room[M, In, X]) closeAll() {
	r.safely("close", r.game.Close)
	for _, s := range r.sessions {
		s.out.Close()
	}
	in := r.Summary().Info
	r.safely("info", func() { in = r.game.Info() })
	r.gauge(-int64(in.Humans), -int64(in.Seats-in.Humans))
}

func (r *Room[M, In, X]) safely(what string, f func()) {
	defer func() {
		if v := recover(); v != nil {
			slog.Error("room panic", "code", r.code, "in", what, "panic", v)
		}
	}()
	f()
}

// gauge moves the server-wide human and bot gauges.
func (r *Room[M, In, X]) gauge(humans, bots int64) {
	if r.o.Metrics != nil {
		r.o.Metrics.Humans.Add(humans)
		r.o.Metrics.Bots.Add(bots)
	}
}

func (r *Room[M, In, X]) input(id PlayerID, m M) {
	s, ok := r.sessions[id]
	if !ok {
		return
	}
	switch h := m.Head(); h.T {
	case netproto.TIn:
		s.q.push(h.Seq, m.Input())
	case netproto.TPing:
		s.out.Send(netproto.NewPong(h.TS))
	case netproto.TChat:
		r.chat(id, h.Chat)
	default:
		r.game.Handle(id, m, outbox[M, In, X]{r})
	}
}

func (r *Room[M, In, X]) tick() {
	if r.o.Metrics != nil {
		start := time.Now()
		defer func() {
			d := time.Since(start)
			r.o.Metrics.TickSeconds.Observe(d.Seconds())
			if d > time.Second/time.Duration(r.o.TickRate) {
				r.o.Metrics.TickOverruns.Inc()
			}
		}()
	}
	inputs := make(map[PlayerID]In, len(r.sessions))
	for id, s := range r.sessions {
		in, _ := s.q.next()
		if s.q.started() { // before its first input the seat keeps its own controls
			inputs[id] = in
		}
	}
	r.game.Step(inputs, outbox[M, In, X]{r})
	r.ticks++
	if r.ticks%r.o.PublishEvery == 0 {
		r.publish()
	}
}
```

Note on `closeAll`: today the gauge reads `game.Humans()`/`len(game.Players())` after the per-session flush; reading `Info()` (same numbers) keeps the metric values identical.

`core/room/outbox.go`:

```go
package room

// outbox is the game's view of the seated humans during one call.
type outbox[M Msg[In], In Input[In], X any] struct{ r *Room[M, In, X] }

func (b outbox[M, In, X]) To(id PlayerID, v any) {
	if s, ok := b.r.sessions[id]; ok {
		s.out.Send(v)
	}
}

func (b outbox[M, In, X]) All(v any) {
	for _, s := range b.r.sessions {
		s.out.Send(v)
	}
}

func (b outbox[M, In, X]) Snap(v Acker) {
	for _, s := range b.r.sessions {
		s.out.Send(v.WithAck(s.q.ack))
	}
}

func (b outbox[M, In, X]) Changed() { b.r.publish() }
```

`core/room/session.go`:

```go
package room

// session is one connected human, owned by the room goroutine.
type session[In Input[In]] struct {
	out    Sender
	q      queue[In]
	chatAt int // room tick of the last chat relayed; 0 = never
}

func newSession[In Input[In]](out Sender) *session[In] {
	return &session[In]{out: out, q: newQueue[In]()}
}
```

`core/room/seats.go`: keep `joinReq`, `joinResp` (with `id PlayerID`), `Join`, `Seat`, `join`, `leave` with these changes — `Seat` becomes `Seat[M any]` holding the channels it needs instead of the room:

```go
// Seat is one joined human's handle on the room, used by its connection
// goroutine only.
type Seat[M any] struct {
	id     PlayerID
	slots  chan struct{} // messages in flight; the room frees one per message
	inputs chan<- inputMsg[M]
	leaves chan<- PlayerID
	done   <-chan struct{}
}

func (s *Seat[M]) ID() PlayerID { return s.id }

// Done is closed when the room stops.
func (s *Seat[M]) Done() <-chan struct{} { return s.done }

// Input hands a client message to the room. It drops the message if this
// seat already has seatInbox messages waiting, or the room is busy.
func (s *Seat[M]) Input(m M) {
	select {
	case s.slots <- struct{}{}:
	default:
		return
	}
	select {
	case s.inputs <- inputMsg[M]{s, m}:
	case <-s.done:
	default:
		<-s.slots
	}
}

func (s *Seat[M]) Leave() {
	select {
	case s.leaves <- s.id:
	case <-s.done:
	}
}
```

`Join` returns `&Seat[M]{id: resp.id, slots: make(chan struct{}, seatInbox), inputs: r.inputs, leaves: r.leaves, done: r.done}`; its doc comment says it fails with `ErrClosed`, an error wrapping `ErrFull`, or ctx's error. The actor side:

```go
func (r *Room[M, In, X]) join(req joinReq) {
	id, err := r.game.Join(req.who)
	if err != nil {
		req.reply <- joinResp{err: err}
		return
	}
	r.sessions[id] = newSession[In](req.out)
	r.joined = true
	r.gauge(+1, -1) // the human took a bot's seat
	r.publish()     // before the reply: a lobby read after Join sees the seat
	req.reply <- joinResp{id: id}
	r.game.Welcome(id, r.code, req.who.NewToken, outbox[M, In, X]{r})
}

func (r *Room[M, In, X]) leave(id PlayerID) {
	if _, ok := r.sessions[id]; !ok {
		return
	}
	delete(r.sessions, id)
	r.game.Leave(id)
	r.gauge(-1, +1) // a bot takes the seat back
	if len(r.sessions) == 0 {
		r.emptySince = time.Now()
	}
	r.publish()
}
```

`core/room/chat.go`:

```go
package room

import "playground/core/netproto"

// chat relays preset id from a player to the game's chat scope. Chats inside
// the cooldown, or with an id outside 1..ChatMax, are dropped silently.
func (r *Room[M, In, X]) chat(from PlayerID, id int) {
	s, ok := r.sessions[from]
	if !ok || id < 1 || id > r.o.ChatMax || (s.chatAt != 0 && r.ticks-s.chatAt < r.o.ChatCooldown) {
		return
	}
	s.chatAt = max(1, r.ticks)
	to := r.game.ChatScope(from)
	msg := netproto.NewChat(from, id)
	for sid, o := range r.sessions {
		if to(sid) {
			o.out.Send(msg)
		}
	}
}
```

`core/room/drainflush.go`: `FlushStats` unchanged except the receiver (`(r *Room[M, In, X])`); delete `flushAll` (the actor calls `r.game.FlushStats()`, Step 2 `Run`). Keep its doc comment, replacing "every session's open tally to the stats sink as a leave would (a played round counts as a match, without a win)" with "the game's open tallies to its stats sink (Game.FlushStats)".

`core/room/summary.go`:

```go
package room

// Summary is what the lobby lists of a room: published by the actor,
// readable from any goroutine.
type Summary[X any] struct {
	Code string
	Seq  int64 // lobby creation order
	Info[X]
}

// publish stores a fresh summary; called by the actor only (and by New
// before the actor starts).
func (r *Room[M, In, X]) publish() {
	r.summary.Store(&Summary[X]{Code: r.code, Seq: r.o.Seq, Info: r.game.Info()})
}

// Summary is the latest published summary; safe from any goroutine.
func (r *Room[M, In, X]) Summary() Summary[X] { return *r.summary.Load() }
```

Delete: `git rm core/room/stats.go core/room/team.go`.

- [ ] **Step 3: Dogfight's room tests move to `match`**

```bash
for f in stats_test team_test chat_test book_rules_test roundend_test summary_test drainflush_test; do git mv core/room/$f.go internal/match/$f.go; done
```

In each moved file: `package room` → `package match`; build rooms with the helper below instead of `New(...)`/`start(...)`; replace room internals with the match's: `r.sessions[id]` → `m.humans[id]`, `*session` → `*human`, `seatCounted(t, r, name)` returns `*human` from `m.humans`; Dogfight messages are the same types (`protocol.Welcome`, `protocol.Snap`, …) and `protocol.NewChat`/`ChatMsg` became `netproto.ChatMsg`; `room.Summary` fields used by `summary_test.go` read `s.Humans`, `s.Game.NATO` etc. `book_rules_test.go` keeps its relative client path (`internal/match` is as deep as `core/room`). Keep every assertion.

`internal/match/types.go`:

```go
package match

import (
	"playground/core/room"
	"playground/internal/protocol"
	"playground/internal/sim"
)

// The generic core types instantiated for Dogfight.
type (
	Room    = room.Room[protocol.ClientMsg, sim.Input, Info]
	Seat    = room.Seat[protocol.ClientMsg]
	Summary = room.Summary[Info]
)
```

`internal/match/room_test.go`:

```go
package match

import (
	"context"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"playground/core/room"
	"playground/internal/game"
	"playground/internal/protocol"
	"playground/internal/sim"
)

// fakeSender records what one seat received (moved from core/room's tests).
type fakeSender struct {
	mu     sync.Mutex
	msgs   []any
	closed bool
}

func (f *fakeSender) Send(v any) bool { f.mu.Lock(); defer f.mu.Unlock(); f.msgs = append(f.msgs, v); return true }
func (f *fakeSender) Close()          { f.mu.Lock(); defer f.mu.Unlock(); f.closed = true }

// startMatch runs a Dogfight room; tests reach the match's state (m.humans)
// after synctest.Wait, as they reached the room's before.
func startMatch(t *testing.T, s game.Settings, sink StatsSink) (*Room, *Match, context.CancelFunc) {
	m := New(s, sink)
	r := room.New("ABCD", m, room.Options{})
	ctx, cancel := context.WithCancel(t.Context())
	go r.Run(ctx)
	return r, m, cancel
}
```

Move `fakeSender`'s `count`, `typeOf`, `lastSnap`, `notices` helpers here from the old `core/room/room_test.go` / `team_test.go` (they switch on Dogfight types), and move `TestNoInputKeepsSpawnThrottle` here (Dogfight-specific), on `startMatch`. Replace the Task 8 version of `TestDroppedPressSurvivesBothLatches` (it used the room's unexported session) with a black-box one:

```go
// Review Focus 4: a press latched by the connection (ClientMsg.Latch) rides
// an admitted input into the room, where a backlog trim (Input.Latch) keeps it.
func TestDroppedPressSurvivesBothLatches(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, m, cancel := startMatch(t, ffa4, nil)
		defer cancel()
		seat, err := r.Join(t.Context(), room.Who{Name: "a"}, &fakeSender{})
		if err != nil {
			t.Fatal(err)
		}
		time.Sleep(5 * time.Second) // spawned and flying
		synctest.Wait()
		before := m.g.Snapshot()
		dropped := protocol.ClientMsg{T: protocol.TIn, Seq: 2, Th: 1, FL: true}
		seat.Input(protocol.ClientMsg{T: protocol.TIn, Seq: 1, Th: 1})
		seat.Input(protocol.ClientMsg{T: protocol.TIn, Seq: 3, Th: 1}.Latch(dropped))
		for seq := uint32(4); seq <= 9; seq++ { // 8 queued: the next tick drops the 4 oldest
			seat.Input(protocol.ClientMsg{T: protocol.TIn, Seq: seq, Th: 1})
		}
		synctest.Wait()
		time.Sleep(time.Second / 6)
		synctest.Wait()
		after := m.g.Snapshot()
		id := sim.ID(seat.ID())
		var b, a int
		for _, p := range before.Planes {
			if p.ID == id {
				b = p.Flares
			}
		}
		for _, p := range after.Planes {
			if p.ID == id {
				a = p.Flares
			}
		}
		if a != b-1 {
			t.Fatalf("flares %d → %d: the latched press must fire exactly once", b, a)
		}
	})
}
```

(If the plane is not alive at 5 s with `ffa4` — e.g. still on the pick screen — send a `pick` first and wait for `Alive`; if a flare has a cooldown that swallows it, count `"flare"` events in the snapshots the seat received instead. The point is "exactly once"; record the choice in the report.)

- [ ] **Step 4: Wire lobby, server, cmd and golden**

- `internal/lobby/lobby.go`: `Options.Stats room.StatsSink` → `match.StatsSink`; `newRoom` becomes `func(code string, s game.Settings, o room.Options) *match.Room`, default `func(code string, s game.Settings, o room.Options) *match.Room { return room.New(code, match.New(s, l.stats), o) }` (set in `New` after `l` exists); `rooms map[string]*match.Room`; `Create`, `Get`, `live`, `Quick`, `build` use `*match.Room`; `List` returns `[]match.Summary`; `build` passes `room.Options{Seq: seq, Metrics: l.m}`; logs use `r.Label()` for `"mode"`. Lobby tests: replace `*room.Room` with `*match.Room`, `room.Summary` with `match.Summary`, summary fields `s.Mode` → `s.Game.Mode`; the build-panic test's `newRoom` stub gets the new signature.
- `internal/server`: `*room.Room` → `*match.Room`, `*room.Seat` → `*match.Seat`, `room.Summary` → `match.Summary` (`apiRooms` reads `x.Game.Mode`, `x.Game.Map`, `x.Game.Weather`, `x.Game.Phase`, `x.Game.LeftS`, `x.Game.NATO`, `x.Game.Soviet`); `errors.Is(err, game.ErrFull)` stays valid (match wraps both); `var _ wsconn.Carrier = protocol.Snap{}` in `server.go` stays (still valid; Task 16 moves it). Server tests: same type renames; `room.New("GONE", listedFFA2, room.Options{})` → `room.New("GONE", match.New(listedFFA2, nil), room.Options{})`.
- `cmd/dogfight/main.go`: `var sink room.StatsSink` → `var sink match.StatsSink`.
- `internal/golden/room_test.go`: the constructor line becomes `return room.New(code, match.New(s, sink), room.Options{Seq: 1})` and `type sink` stays (it satisfies `match.StatsSink`); `*room.Room`/`*room.Seat` fields in `h` become `*match.Room`/`*match.Seat`. No other line changes.
- `internal/golden/boundary_test.go`: delete the `"core/room"` entry.

- [ ] **Step 5: Verify**

Run: `go build ./... && go vet ./... && go test ./... -race -short && go test ./internal/golden -count=1 -v 2>&1 | grep -E '^(--- |ok|FAIL)'`
Expected: PASS; every `TestGoldenRoom*` and `TestGoldenServer*` PASS byte-identical; `TestCoreImportsNothingFromDogfight` PASS with no `core/room` allowance. If a golden room transcript differs: the order of sends inside a tick or the publish timing changed — compare `match.Step` with the deleted `room.tick` line by line; never update the golden file.

- [ ] **Step 6: Commit**

```bash
git add core/room internal/match internal/lobby internal/server cmd/dogfight/main.go internal/golden/room_test.go internal/golden/boundary_test.go
git status --short   # every deleted/moved/edited file of this task, nothing else
.tools/gc -m "core/room: the room drives a Game; Dogfight's room logic lives in match" -m "Room, Seat and Summary are generic over the game's message, input and summary types; the actor keeps seats, input queues, ping, chat relay, timeouts, panic recovery, summaries, gauges and the flush handshake, and hands everything else to room.Game. Dogfight's room tests moved to internal/match; the room's own tests run on core/internal/fakegame. Wire byte-identical (golden)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 4 — Generic lobby

### Task 13: `core/lobby`

**Files:**
- Move: `internal/lobby/*` → `core/lobby/` (`git mv`), then edit `core/lobby/lobby.go`
- Rewrite: `core/lobby/lobby_test.go`, `core/lobby/drain_test.go` on fakegame (`package lobby_test`)
- Create: `internal/match/lobby.go` (`Lobby` alias, `NewLobby`), `internal/match/lobby_test.go` (Dogfight lobby tests that need real games: `TestStatsSinkReachesRooms`)
- Modify: `internal/server/*.go` + tests (types), `cmd/dogfight/main.go`, `internal/golden/server_test.go` (constructor line)

**Interfaces:**
- Produces:

```go
type Options[S any, M room.Msg[In], In room.Input[In], X any] struct {
	MaxRooms int                                  // rooms running at once; 0 = no limit
	Metrics  *metrics.Registry                    // nil = not measured
	Room     room.Options                         // template; Seq and Metrics are set per room
	New      func(s S) (room.Game[M, In, X], error) // the game factory; a panic is an error
}
func New[S any, M room.Msg[In], In room.Input[In], X any](ctx context.Context, o Options[S, M, In, X]) *Lobby[S, M, In, X]
func (l *Lobby[S, M, In, X]) Create(s S) (*room.Room[M, In, X], error)
func (l *Lobby[S, M, In, X]) Get(code string) (*room.Room[M, In, X], bool)
func (l *Lobby[S, M, In, X]) List() []room.Summary[X]
func (l *Lobby[S, M, In, X]) Quick() (*room.Room[M, In, X], bool)
func (l *Lobby[S, M, In, X]) Drain(on bool); FlushStats(ctx) bool; Wait()
func NormalizeCode(code string) (string, bool)
var ErrNoCode, ErrBusy, ErrDraining error
// internal/match/lobby.go
type Lobby = lobby.Lobby[game.Settings, protocol.ClientMsg, sim.Input, Info]
func NewLobby(ctx context.Context, maxRooms int, reg *metrics.Registry, sink StatsSink) *Lobby
```

- [ ] **Step 1: Move; failing generic tests**

```bash
git mv internal/lobby core/lobby
```

Rewrite `core/lobby/lobby_test.go` as `package lobby_test` on the fake game, porting every test except `TestStatsSinkReachesRooms` (Dogfight-specific: moves to `internal/match/lobby_test.go` on `match.NewLobby`, assertions unchanged). Helper:

```go
type fakeLobby = lobby.Lobby[fakegame.Settings, fakegame.Msg, fakegame.Input, fakegame.Info]

func newLobby(ctx context.Context, maxRooms int, reg *metrics.Registry) *fakeLobby {
	return lobby.New(ctx, lobby.Options[fakegame.Settings, fakegame.Msg, fakegame.Input, fakegame.Info]{
		MaxRooms: maxRooms, Metrics: reg,
		New: func(s fakegame.Settings) (room.Game[fakegame.Msg, fakegame.Input, fakegame.Info], error) {
			return fakegame.New(s, nil), nil
		},
	})
}
```

Ported tests and their fake settings: `TestCreateGetAndRemove`, `TestCodesUnique`, `TestNormalizeCode`, `TestMaxRooms`, `TestListAndQuick` (listed rooms `fakegame.Settings{Listed: true, Seats: 2}`; ordering by humans then newest; private room never listed; full room never picked), `TestBuildPanicIsAnError` (`fakegame.Settings{BadNew: true}`: `Create` returns an error, the code is free again and `Wait` does not hang), `TestRoomsGauge`; new:

```go
func TestFactoryErrorReleasesTheCode(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	calls := 0
	l := lobby.New(ctx, lobby.Options[fakegame.Settings, fakegame.Msg, fakegame.Input, fakegame.Info]{
		MaxRooms: 1,
		New: func(fakegame.Settings) (room.Game[fakegame.Msg, fakegame.Input, fakegame.Info], error) {
			calls++
			return nil, errors.New("no")
		},
	})
	if _, err := l.Create(fakegame.Settings{}); err == nil {
		t.Fatal("factory error must fail Create")
	}
	if _, err := l.Create(fakegame.Settings{}); err == nil || errors.Is(err, lobby.ErrBusy) || calls != 2 {
		t.Fatalf("the failed room must not hold the only slot: %v calls=%d", err, calls)
	}
	cancel()
	l.Wait()
}
```

`core/lobby/drain_test.go`: port both tests onto `newLobby`; `TestFlushStatsReachesEveryRoom` asserts each room's `fakegame.Recorder.Flushes == 1` (pass one recorder per room through a factory closure that appends them to a slice under a mutex).

Run: `go test ./core/lobby` → FAIL to compile (`lobby.Options` is not generic).

- [ ] **Step 2: Make the lobby generic**

`core/lobby/lobby.go` — package doc and code alphabet unchanged; replace `Options`, `Lobby`, `New`, `build` with:

```go
// Options configure a lobby.
type Options[S any, M room.Msg[In], In room.Input[In], X any] struct {
	MaxRooms int               // rooms running at once; 0 = no limit
	Metrics  *metrics.Registry // nil = not measured
	Room     room.Options      // template; Seq and Metrics are set per room
	New      func(s S) (room.Game[M, In, X], error)
}

type Lobby[S any, M room.Msg[In], In room.Input[In], X any] struct {
	ctx      context.Context
	maxRooms int
	m        *metrics.Registry
	ro       room.Options
	newGame  func(S) (room.Game[M, In, X], error)
	running  sync.WaitGroup
	mu       sync.Mutex
	rooms    map[string]*room.Room[M, In, X]
	seq      int64 // rooms created so far; a room's Seq is its rank
	closed   bool  // Wait has begun: no room may start (running.Add would race Wait)
	draining bool  // Drain(true): no room starts, quick play picks none
}

// New returns a lobby whose rooms stop when ctx is cancelled.
func New[S any, M room.Msg[In], In room.Input[In], X any](ctx context.Context, o Options[S, M, In, X]) *Lobby[S, M, In, X] {
	return &Lobby[S, M, In, X]{ctx: ctx, maxRooms: o.MaxRooms, m: o.Metrics, ro: o.Room, newGame: o.New,
		rooms: map[string]*room.Room[M, In, X]{}}
}

// build makes the game and its room for a reserved code. A factory error or
// panic is an error, and the reservation is released so the code (and a
// room slot) is not burned.
func (l *Lobby[S, M, In, X]) build(code string, s S, seq int64) (r *room.Room[M, In, X], err error) {
	defer func() {
		if v := recover(); v != nil {
			slog.Error("room build panic", "code", code, "panic", v)
			err = fmt.Errorf("lobby: building room: %v", v)
		}
		if err != nil {
			l.mu.Lock()
			delete(l.rooms, code)
			l.mu.Unlock()
			r = nil
		}
	}()
	g, err := l.newGame(s)
	if err != nil {
		return nil, fmt.Errorf("lobby: building room: %w", err)
	}
	o := l.ro
	o.Seq, o.Metrics = seq, l.m
	return room.New(code, g, o), nil
}
```

Every other method keeps its body; change the receivers to `(l *Lobby[S, M, In, X])`, `Create(s game.Settings)` → `Create(s S)`, `*room.Room` → `*room.Room[M, In, X]`, `[]room.Summary` → `[]room.Summary[X]` (`List`'s sort reads `Humans` and `Seq`, which `Summary[X]` promotes from `Info`), the two log lines use `"mode", r.Label()`. Delete the `Stats` option and field and the `newRoom` test hook (tests now inject through `Options.New`). Imports: drop `playground/internal/game`, `playground/internal/match`.

- [ ] **Step 3: Dogfight's lobby**

`internal/match/lobby.go`:

```go
package match

import (
	"context"

	"playground/core/lobby"
	"playground/core/metrics"
	"playground/internal/game"
	"playground/internal/protocol"
	"playground/internal/sim"
)

// Lobby is the generic lobby instantiated for Dogfight.
type Lobby = lobby.Lobby[game.Settings, protocol.ClientMsg, sim.Input, Info]

// NewLobby is Dogfight's lobby: rooms build a Match recording into sink
// (nil = not counted).
func NewLobby(ctx context.Context, maxRooms int, reg *metrics.Registry, sink StatsSink) *Lobby {
	return lobby.New(ctx, lobby.Options[game.Settings, protocol.ClientMsg, sim.Input, Info]{
		MaxRooms: maxRooms, Metrics: reg, New: Factory(sink),
	})
}
```

Callers: `cmd/dogfight/main.go` `lobby.New(ctx, lobby.Options{MaxRooms: cfg.maxRooms, Stats: sink, Metrics: reg})` → `match.NewLobby(ctx, cfg.maxRooms, reg, sink)`; `internal/server` `*lobby.Lobby` → `*match.Lobby`, server tests `lobby.New(ctx, lobby.Options{MaxRooms: n})` → `match.NewLobby(ctx, n, nil, nil)` (and with stats: `match.NewLobby(ctx, 0, nil, sink)`); `lobby.ErrBusy`/`ErrDraining`/`NormalizeCode` keep their names under `playground/core/lobby`. Golden: in `internal/golden/server_test.go` the constructor line becomes `s := server.New(match.NewLobby(ctx, maxRooms, nil, nil), o)`.

- [ ] **Step 4: Verify and commit**

Run: `go build ./... && go vet ./... && go test ./... -race -short && go test ./internal/golden -count=1`
Expected: PASS; golden PASS; boundary PASS (core/lobby imports only core).

```bash
git add core/lobby internal/match/lobby.go internal/match/lobby_test.go internal/server cmd/dogfight/main.go internal/golden/server_test.go
git status --short   # the lobby move, the edited callers, nothing else
.tools/gc -m "core/lobby: generic over the game's settings and room types" -m "Rooms are built through a game factory; a factory error or panic releases the reserved code. Dogfight's lobby is match.NewLobby. Wire unchanged (golden)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 5 — Generic server

### Task 14: Move server into core (still coupled)

**Files:**
- Move: `internal/server/*` → `core/server/`
- Modify: importers (`cmd/dogfight/*.go`, `internal/golden/server_test.go`) — import path only
- Modify: `internal/golden/boundary_test.go` (`coreAllow["core/server"]`)

- [ ] **Step 1: Move**

```bash
git mv internal/server core/server
grep -rl --include='*.go' '"playground/internal/server"' . | xargs sed -i '' 's#"playground/internal/server"#"playground/core/server"#'
```

- [ ] **Step 2: Failing boundary test, allowlist**

Run: `go test ./internal/golden -run TestCoreImports -count=1` → FAIL listing `core/server/...` imports (expect `internal/bot`, `game`, `maps`, `match`, `mode`, `protocol`, `sim`, `stats`, `weather`). Add exactly those to `coreAllow["core/server"]`, each `// until Task 16`.

- [ ] **Step 3: Verify and commit**

Run: `go build ./... && go vet ./... && go test ./... -race -short && go test ./internal/golden -count=1` → PASS.

```bash
git add core/server internal/golden/boundary_test.go $(git diff --name-only)
.tools/gc -m "core: move server under core (still Dogfight-coupled)" -m "Path-only move; the boundary test allows its Dogfight imports until the server is generic." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 15: Server contracts; `internal/front` as Dogfight's Kit (not wired yet)

**Files:**
- Create: `core/server/kit.go` (contracts)
- Create: `core/internal/fakekit/kit.go` (fake `Kit`; its own package so `fakegame` never imports `core/server`)
- Create: `internal/front/front.go` (Kit), `internal/front/settings.go` (create/quick settings, moved from `core/server/handshake.go`), `internal/front/stats.go` (`NewStats`), `internal/front/front_test.go`

**Interfaces:**
- Produces (`core/server/kit.go`):

```go
type Msg[M, In any] interface { room.Msg[In]; Latch(dropped M) M }
type Class uint8
const ( ClassAll Class = iota; ClassChoice ) // choice: the small pick bucket (kicks), then the shared one
type Kit[S, M, X any] interface {
	Version() int
	Decode(b []byte) (M, error)
	Settings(create M, now time.Time) (S, bool)
	QuickSettings(now time.Time) S
	Class(t string) Class
	InRoom(m M) bool
	Row(s room.Summary[X]) any
}
type Stats interface { Ready() bool; Periods() []string; Board(period string) []byte; Me(pilotHash string) ([]byte, bool) }
```

- Produces (`internal/front`): `type Kit struct{}` implementing `server.Kit[game.Settings, protocol.ClientMsg, match.Info]`; `func NewStats(s *stats.Slot) server.Stats` (nil slot → nil interface); unexported `settings`, `quickSettings`, `parseStart`, `parseVis`, `orDefault` (moved).
- Produces (`core/internal/fakekit`): `type Kit struct{}` implementing `server.Kit[fakegame.Settings, fakegame.Msg, fakegame.Info]`.

- [ ] **Step 1: Failing tests**

`internal/front/front_test.go`:

```go
package front

import (
	"encoding/json"
	"testing"
	"time"

	"playground/core/room"
	"playground/core/server"
	"playground/internal/match"
	"playground/internal/protocol"
)

var _ server.Kit[game.Settings, protocol.ClientMsg, match.Info] = Kit{}

func TestKitClassesAndInRoom(t *testing.T) {
	k := Kit{}
	if k.Class(protocol.TPick) != server.ClassChoice || k.Class(protocol.TTeam) != server.ClassChoice || k.Class(protocol.TChat) != server.ClassAll {
		t.Fatal("classes")
	}
	for m, want := range map[protocol.ClientMsg]bool{
		{T: protocol.TTeam, Team: "nato"}: true,
		{T: protocol.TPick, Kind: "su27"}:  true,
		{T: protocol.TPick, Kind: "x"}:     false,
		{T: protocol.TQuick}:               false,
		{T: protocol.THello}:               false,
	} {
		if k.InRoom(m) != want {
			t.Errorf("InRoom(%+v) != %v", m, want)
		}
	}
	if k.Version() != 2 {
		t.Fatal("version")
	}
}

func TestRowBytes(t *testing.T) {
	team := room.Summary[match.Info]{Code: "ABCD", Info: room.Info[match.Info]{Humans: 1, Seats: 4,
		Game: match.Info{Mode: "team", Map: "ada", Weather: "acik", Phase: "playing", LeftS: 42, NATO: 1}}}
	b, _ := json.Marshal(Kit{}.Row(team))
	if string(b) != `{"code":"ABCD","mode":"team","map":"ada","wx":"acik","humans":1,"seats":4,"phase":"playing","left":42,"teams":[1,0]}` {
		t.Fatal(string(b))
	}
	ffa := team
	ffa.Game.Mode = "ffa"
	b, _ = json.Marshal(Kit{}.Row(ffa))
	if string(b) != `{"code":"ABCD","mode":"ffa","map":"ada","wx":"acik","humans":1,"seats":4,"phase":"playing","left":42}` {
		t.Fatal(string(b))
	}
}

// Review Focus 3: stats off must be a nil interface, not a typed nil.
func TestNewStatsNilIsNilInterface(t *testing.T) {
	if NewStats(nil) != nil {
		t.Fatal("NewStats(nil) must be a nil server.Stats")
	}
}

func TestQuickSettings(t *testing.T) {
	s := Kit{}.QuickSettings(time.Unix(0, 7))
	if s.Seed != 7 || !s.Listed || s.Size != 2 {
		t.Fatalf("%+v", s)
	}
}
```

(add the `playground/internal/game` import.) Move `core/server/settings_test.go` to `internal/front/settings_test.go` with `git mv` (it tests the unexported `settings`, which moves here); change its package to `front`.

Run: `go test ./internal/front` → FAIL (`undefined: Kit`).

- [ ] **Step 2: `core/server/kit.go`**

```go
package server

import (
	"time"

	"playground/core/room"
)

// Msg is a decoded client message as the server sees it.
type Msg[M, In any] interface {
	room.Msg[In]
	Latch(dropped M) M // m plus the one-shot presses of an input dropped over its rate
}

// Class is the rate class of a game message type (core types have their own).
type Class uint8

const (
	ClassAll    Class = iota // only the connection's shared bucket
	ClassChoice              // the small choice bucket (pick-like; refusal kicks), then the shared one
)

// Kit is what a game plugs into the server. Its methods run on connection
// and HTTP goroutines: they must not touch shared state.
type Kit[S, M, X any] interface {
	Version() int                               // protocol version a hello must carry
	Decode(b []byte) (M, error)                 // one whole frame; the core reads Head()
	Settings(create M, now time.Time) (S, bool) // room settings of a create message; false = bad_room
	QuickSettings(now time.Time) S              // the room quick play makes when none is free
	Class(t string) Class                       // rate class of a game message type
	InRoom(m M) bool                            // a game message allowed after the handshake
	Row(s room.Summary[X]) any                  // one /api/rooms row
}

// Stats serves the pilot API; nil = stats off (503). Safe for concurrent use.
type Stats interface {
	Ready() bool
	Periods() []string                  // allowed ?period= values
	Board(period string) []byte         // leaderboard body for an allowed period
	Me(pilotHash string) ([]byte, bool) // the caller's body; false = unknown pilot
}
```

- [ ] **Step 3: `internal/front`**

`internal/front/front.go`:

```go
// Package front is Dogfight's server.Kit: decoding, create and quick-play
// settings, the in-room message whitelist, /api/rooms rows, and the pilot
// stats API over stats.Slot.
package front

import (
	"time"

	"playground/core/room"
	"playground/core/server"
	"playground/internal/game"
	"playground/internal/match"
	"playground/internal/protocol"
	"playground/internal/sim"
)

type Kit struct{}

var _ server.Kit[game.Settings, protocol.ClientMsg, match.Info] = Kit{}

func (Kit) Version() int                                      { return protocol.Version }
func (Kit) Decode(b []byte) (protocol.ClientMsg, error)       { return protocol.DecodeClient(b) }
func (Kit) Settings(m protocol.ClientMsg, now time.Time) (game.Settings, bool) { return settings(m, now) }
func (Kit) QuickSettings(now time.Time) game.Settings         { return quickSettings(now) }

// Class: a team choice opens the pick screen, so pick and team share the
// choice bucket.
func (Kit) Class(t string) server.Class {
	if t == protocol.TPick || t == protocol.TTeam {
		return server.ClassChoice
	}
	return server.ClassAll
}

// InRoom: team (DecodeClient whitelisted its value) and pick of a known kind.
func (Kit) InRoom(m protocol.ClientMsg) bool {
	switch m.T {
	case protocol.TTeam:
		return true
	case protocol.TPick:
		_, ok := sim.ParseKind(m.Kind)
		return ok
	}
	return false
}

type roomJSON struct {
	Code   string  `json:"code"`
	Mode   string  `json:"mode"`
	Map    string  `json:"map"`
	Wx     string  `json:"wx"`
	Humans int     `json:"humans"`
	Seats  int     `json:"seats"`
	Phase  string  `json:"phase"`
	Left   int     `json:"left"`            // seconds left in the round
	Teams  *[2]int `json:"teams,omitempty"` // humans on NATO, Soviet (team and base modes)
}

func (Kit) Row(x room.Summary[match.Info]) any {
	g := x.Game
	row := roomJSON{x.Code, g.Mode, g.Map, g.Weather, x.Humans, x.Seats, g.Phase, g.LeftS, nil}
	if g.Mode != "ffa" {
		row.Teams = &[2]int{g.NATO, g.Soviet}
	}
	return row
}
```

`internal/front/settings.go`: move `settings`, `orDefault`, `parseStart`, `parseVis` verbatim from `core/server/handshake.go`, and `quickSettings` (same body). Do not delete them from `core/server` yet (Task 16 does).

`internal/front/stats.go`:

```go
package front

import (
	"encoding/json"

	"playground/core/server"
	"playground/internal/stats"
)

const boardSize = 20

type statsAPI struct{ slot *stats.Slot }

// NewStats is the pilot API over slot; nil slot (stats off) is a nil
// server.Stats, never a typed nil.
func NewStats(slot *stats.Slot) server.Stats {
	if slot == nil {
		return nil
	}
	return statsAPI{slot}
}

func (a statsAPI) Ready() bool       { return a.slot.Ready() }
func (statsAPI) Periods() []string   { return []string{"week", "all"} }

// Board is GET /api/leaderboard's body: {"period","week","top"}.
func (a statsAPI) Board(name string) []byte {
	period, _ := stats.ParsePeriod(name) // the server only passes allowed names
	top, week := a.slot.Top(period, boardSize)
	if top == nil {
		top = []stats.Entry{}
	}
	b, _ := json.Marshal(struct {
		Period string        `json:"period"`
		Week   string        `json:"week"`
		Top    []stats.Entry `json:"top"`
	}{name, week, top})
	return b
}

// Me is GET /api/me's body for a known pilot: {"pilot":{card…,"favorite"}}.
func (a statsAPI) Me(hash string) ([]byte, bool) {
	p, ok := a.slot.Me(hash)
	if !ok {
		return nil, false
	}
	b, _ := json.Marshal(struct {
		Pilot any `json:"pilot"`
	}{struct {
		stats.Pilot
		Favorite string `json:"favorite"`
	}{p, p.Favorite()}})
	return b, true
}
```

`core/internal/fakekit/kit.go`:

```go
// Package fakekit plugs core/internal/fakegame into the server.
package fakekit

import (
	"time"

	"playground/core/internal/fakegame"
	"playground/core/room"
	"playground/core/server"
)

type (
	Settings = fakegame.Settings
	Msg      = fakegame.Msg
	Info     = fakegame.Info
)

// Kit: create carries "seats"; the in-room game message is "color".
type Kit struct{}

var _ server.Kit[Settings, Msg, Info] = Kit{}

func (Kit) Version() int                     { return 1 }
func (Kit) Decode(b []byte) (Msg, error)     { return fakegame.Decode(b) }
func (Kit) QuickSettings(time.Time) Settings { return Settings{Seats: 2, Listed: true} }
func (Kit) Class(t string) server.Class {
	if t == "color" {
		return server.ClassChoice
	}
	return server.ClassAll
}
func (Kit) InRoom(m Msg) bool { return m.T == "color" }
func (Kit) Settings(m Msg, _ time.Time) (Settings, bool) {
	return Settings{Seats: m.Seats, Listed: true}, m.Seats >= 1 && m.Seats <= 8
}
func (Kit) Row(s room.Summary[Info]) any {
	return map[string]any{"code": s.Code, "humans": s.Humans, "seats": s.Seats, "color": s.Game.Color}
}
```

(`fakegame` imports only `core/room` and `core/netproto`, so `core/server`'s internal tests may use it; `fakekit` imports `core/server`, so only external tests (`package server_test`) may use it.)

- [ ] **Step 4: Verify and commit**

Run: `go test ./internal/front ./core/internal/... -v && go build ./... && go vet ./... && go test ./... -race -short`
Expected: PASS.

```bash
git add core/server/kit.go core/internal/fakekit/kit.go internal/front/front.go internal/front/settings.go internal/front/stats.go internal/front/front_test.go internal/front/settings_test.go
git status --short   # also shows the git mv of settings_test.go
.tools/gc -m "front: Dogfight's server Kit and stats API; server contracts" -m "core/server/kit.go states what a game plugs into the server (decode, create/quick settings, rate class, in-room whitelist, /api/rooms row) and the stats API it serves. internal/front implements them for Dogfight; fakegame for core tests. Not wired yet." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 16: The server runs any game (switch-over)

**Files:**
- Modify: `core/server/server.go`, `handshake.go`, `socket.go`, `inbound.go`, `guard.go`, `api.go`, `drain.go`, `codes.go`
- Move to `internal/front/` (`git mv`, `package front`, integration tests): `server_test.go`, `limits_test.go`, `flood_test.go`, `drain_test.go`, `joins_test.go`, `metrics_test.go`, `tokenlog_test.go`, `team_test.go`, the leaderboard/me/rooms tests of `api_test.go` (split the file)
- Stay in `core/server` (unit, `package server`): `ceiling_test.go`, `clientip_test.go`, `conngate_test.go`, `guard_check_test.go`, `codes_test.go`, `assets_test.go`
- Rewrite in `core/server` on fakegame (`package server_test`): `http_test.go`, `apimethod_test.go`, the quick-play race tests of `api_test.go` → `core/server/quick_test.go`; create `core/server/core_test.go` (fake-game smoke suite)
- Create: `internal/front/server.go` (`Server` alias, `NewServer`), `internal/front/helpers_test.go`
- Modify: `cmd/dogfight/main.go`, `cmd/dogfight/config.go`, `internal/match/match.go` (`wsconn.Carrier` assertion), `internal/golden/server_test.go` (constructor line), `internal/golden/boundary_test.go` (drop `core/server`; map now empty)

**Interfaces:**
- Consumes: Task 15.
- Produces:

```go
type Server[S any, M Msg[M, In], In room.Input[In], X any] struct{ /* unexported */ }
func New[S any, M Msg[M, In], In room.Input[In], X any](l *lobby.Lobby[S, M, In, X], k Kit[S, M, X], o Options) *Server[S, M, In, X]
// Options.Stats is now server.Stats (was *stats.Slot); every other field unchanged.
// internal/front/server.go
type Server = server.Server[game.Settings, protocol.ClientMsg, sim.Input, match.Info]
func NewServer(l *match.Lobby, o server.Options) *Server
```

- [ ] **Step 1: Core smoke suite on the fake game (failing)**

`core/server/core_test.go` (`package server_test`):

```go
package server_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"playground/core/internal/fakegame"
	"playground/core/internal/fakekit"
	"playground/core/lobby"
	"playground/core/room"
	"playground/core/server"
)

type fakeServer = server.Server[fakegame.Settings, fakegame.Msg, fakegame.Input, fakegame.Info]

func newFake(t *testing.T, o server.Options, maxRooms int) (*httptest.Server, *fakeServer) {
	t.Helper()
	if o.Limits == (server.Limits{}) {
		o.Limits = server.Limits{MaxConnsIP: 1000, CreatePerMinIP: 1000, JoinFailPerMinIP: 1000, JoinPerMinIP: 1000}
	}
	ctx, cancel := context.WithCancel(context.Background())
	l := lobby.New(ctx, lobby.Options[fakegame.Settings, fakegame.Msg, fakegame.Input, fakegame.Info]{
		MaxRooms: maxRooms,
		New: func(s fakegame.Settings) (room.Game[fakegame.Msg, fakegame.Input, fakegame.Info], error) {
			return fakegame.New(s, nil), nil
		},
	})
	s := server.New(l, fakekit.Kit{}, o)
	srv := httptest.NewServer(s)
	t.Cleanup(func() { cancel(); srv.Close() })
	return srv, s
}

func dialFake(t *testing.T, srv *httptest.Server, msgs ...string) *websocket.Conn {
	t.Helper()
	ws, _, err := websocket.Dial(t.Context(), "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ws.CloseNow() })
	for _, m := range msgs {
		if err := ws.Write(t.Context(), websocket.MessageText, []byte(m)); err != nil {
			t.Fatal(err)
		}
	}
	return ws
}

// until reads frames until one of type typ; it returns that frame's JSON.
func until(t *testing.T, ws *websocket.Conn, typ string) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	for {
		_, b, err := ws.Read(ctx)
		if err != nil {
			t.Fatalf("waiting for %s: %v", typ, err)
		}
		var m map[string]any
		_ = json.Unmarshal(b, &m)
		if m["t"] == typ {
			return m
		}
	}
}

func TestFakeGameCreateJoinQuickAndPlay(t *testing.T) {
	srv, _ := newFake(t, server.Options{}, 0)
	a := dialFake(t, srv, `{"t":"hello","v":1,"name":"a"}`, `{"t":"create","seats":2}`)
	code := until(t, a, "welcome")["code"].(string)
	b := dialFake(t, srv, `{"t":"hello","v":1,"name":"b"}`, `{"t":"join","code":"`+strings.ToLower(code)+`"}`)
	until(t, b, "welcome")
	_ = b.Write(t.Context(), websocket.MessageText, []byte(`{"t":"in","seq":1,"d":5}`))
	_ = b.Write(t.Context(), websocket.MessageText, []byte(`{"t":"color","color":"blue"}`))
	until(t, b, "notice")
	c := dialFake(t, srv, `{"t":"hello","v":1,"name":"c"}`, `{"t":"quick"}`) // the room is full: quick creates
	if w := until(t, c, "welcome"); w["code"] == code {
		t.Fatal("quick joined a full room")
	}
	res, err := http.Get(srv.URL + "/api/rooms")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.Contains(string(body), `"color":"blue"`) || res.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("rooms: %s", body)
	}
}

func TestFakeGameRefusals(t *testing.T) {
	srv, s := newFake(t, server.Options{}, 0)
	for name, c := range map[string]struct {
		msgs []string
		code string
	}{
		"version":  {[]string{`{"t":"hello","v":2}`}, "version"},
		"badRoom":  {[]string{`{"t":"hello","v":1}`, `{"t":"create","seats":99}`}, "bad_room"},
		"noRoom":   {[]string{`{"t":"hello","v":1}`, `{"t":"join","code":"ZZZZ"}`}, "no_room"},
		"badFirst": {[]string{`{"t":"quick"}`}, "bad_msg"},
	} {
		ws := dialFake(t, srv, c.msgs...)
		if e := until(t, ws, "error"); e["code"] != c.code {
			t.Errorf("%s: %v", name, e)
		}
	}
	s.Drain(true)
	ws := dialFake(t, srv, `{"t":"hello","v":1}`, `{"t":"quick"}`)
	_, _, err := ws.Read(t.Context())
	var ce websocket.CloseError
	if !errors.As(err, &ce) || ce.Code != websocket.StatusServiceRestart {
		t.Fatalf("draining: %v", err)
	}
}

func TestStatsOffIs503(t *testing.T) {
	srv, _ := newFake(t, server.Options{}, 0)
	for _, p := range []string{"/api/leaderboard?period=week", "/api/me"} {
		res, err := http.Get(srv.URL + p)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != 503 || !strings.Contains(string(b), `"stats_off"`) {
			t.Fatalf("%s: %d %s", p, res.StatusCode, b)
		}
	}
}
```

`core/server/quick_test.go` (`package server`, internal: it swaps `quickPick`): port `TestQuickJoinsTheBusiestRoom`, `TestQuickSkipsFullListedRoom`, `TestQuickFallsBackWhenPickedRoomFills`, `TestQuickFallsBackWhenPickedRoomCloses` onto `fakegame` (importable here). It cannot import `fakekit` (that imports `core/server`), so it declares `type quickKit struct{}` with the seven `Kit` methods over `fakegame`, bodies copied from `core/internal/fakekit/kit.go` (about 25 lines; the one accepted duplicate, said so in its comment). Keep every assertion of the ported tests.

`core/server/http_test.go`, `apimethod_test.go`: switch their server construction to `newFake` (as `package server_test`), assertions unchanged.

Run: `go test ./core/server` → FAIL to compile (`server.New` is not generic).

- [ ] **Step 2: Make the server generic**

`core/server/server.go`:
- `Options.Stats *stats.Slot` → `Stats Stats // nil = /api/leaderboard and /api/me answer 503`.
- `Server` becomes `Server[S any, M Msg[M, In], In room.Input[In], X any]` with fields `lobby *lobby.Lobby[S, M, In, X]`, `kit Kit[S, M, X]`, `boards map[string]*apiCache`, `quickPick func() (*room.Room[M, In, X], bool)`; other fields unchanged.
- `New` gains `k Kit[S, M, X]` as second parameter; `boards` is built from `o.Stats.Periods()` when `o.Stats != nil` (`map[string]*apiCache{}` otherwise).
- Delete `var _ wsconn.Carrier = protocol.Snap{}`; add `_ wsconn.Carrier = protocol.Snap{}` to the `var` block of `internal/match/match.go` (import `playground/core/wsconn`): the snapshot's eviction contract is Dogfight's to keep.
- Every method's receiver becomes `(s *Server[S, M, In, X])`.

`core/server/socket.go`: `peer` becomes `peer[M any]` with `held M` (one-shot presses of dropped inputs); `next` decodes with `s.kit.Decode(b)` and asks the guard `p.guard.check(h.T, s.kit.Class(h.T))` where `h := m.Head()`; `admit`:

```go
	case errors.Is(err, errDropped):
		p.held = p.held.Latch(m)
		p.drops.note(p.guard.now(), p.ip)
		return m, false, nil
	case err != nil:
		return m, false, err
	}
	if m.Head().T == netproto.TIn {
		m = m.Latch(p.held)
		var zero M
		p.held = zero
	}
	return m, true, nil
```

`pump`'s switch becomes:

```go
			switch m.Head().T {
			case netproto.TIn, netproto.TPing, netproto.TChat:
			default:
				if !s.kit.InRoom(m) {
					return msgBad
				}
			}
			seat.Input(m)
```

`fail` uses `netproto.NewError(errCode(msg), msg)`.

`core/server/guard.go`: `check(t string)` → `check(t string, c Class)`:

```go
func (g *msgGuard) check(t string, c Class) (verdict, string) {
	now := g.now()
	switch {
	case t == netproto.TIn:
		if !g.in.Allow(now) {
			return drop, "in"
		}
		return pass, ""
	case c == ClassChoice:
		if !g.pick.Allow(now) {
			return kick, "pick"
		}
	case t == netproto.TPing:
		if !g.ping.Allow(now) {
			return kick, "ping"
		}
	}
	if !g.all.Allow(now) {
		return kick, "all"
	}
	return pass, ""
}
```

(`guard_check_test.go` passes `ClassChoice` where it passed `"pick"`/`"team"` and `ClassAll` otherwise.)

`core/server/handshake.go`: read the header (`h := m.Head()`) for `T`, `V`, `Name`, `Tok`, `Code`; version check `h.V != s.kit.Version()`; `identify(netproto.CleanName(h.Name), h.Tok)` returns `room.Who`; create `st, ok := s.kit.Settings(m, s.o.Now())`; quick fallback `s.kit.QuickSettings(s.o.Now())`; join `s.lobby.Get(h.Code)`; `case errors.Is(err, room.ErrFull): return nil, msgFull`; `create(p, st S)`; `quickJoin` returns `*room.Seat[M]`; `recv` answers pings with `netproto.NewPong(h.TS)`. Delete `settings`, `orDefault`, `parseStart`, `parseVis`, `quickSettings` (in `front` since Task 15) and the `bot`, `game`, `maps`, `mode`, `sim`, `weather`, `protocol` imports.

`core/server/api.go`: delete `roomJSON`; `apiRooms` builds `out.Rooms` as `[]any` of `s.kit.Row(x)` per summary (`Rooms []any \`json:"rooms"\``); `apiLeaderboard`:

```go
	if s.o.Stats == nil || !s.o.Stats.Ready() {
		writeJSON(w, http.StatusServiceUnavailable, errorJSON(msgStatsOff))
		return
	}
	name := r.URL.Query().Get("period")
	c, ok := s.boards[name] // whitelisted before it is echoed
	if !ok {
		writeJSON(w, http.StatusBadRequest, errorJSON(msgBadPeriod))
		return
	}
	writeJSON(w, http.StatusOK, c.get(s.o.Now(), boardTTL, func() []byte { return s.o.Stats.Board(name) }))
```

`apiMe` keeps the token check, the dummy hash and `noPilot`, and ends:

```go
	body, ok := s.o.Stats.Me(pilot.Hash(tok))
	if !valid || !ok {
		writeJSON(w, http.StatusOK, noPilot)
		return
	}
	writeJSON(w, http.StatusOK, body)
```

Delete `boardSize` (in `front`) and the `stats` import.

`core/server/drain.go`: `roomConn` holds `draining func() bool` instead of `*Server`:

```go
type roomConn struct {
	*wsconn.Conn
	draining func() bool
}

func (c roomConn) Close() {
	if c.draining() {
		c.Restart(msgUpdating)
		return
	}
	c.Conn.Close()
}
```

(handshake builds `roomConn{p.conn, s.draining}`); `updating` returns `(*room.Seat[M], string)`.

`core/server/codes.go`: `protocol.Code*` → `netproto.Code*`.

- [ ] **Step 3: Dogfight's server and its integration tests**

`internal/front/server.go`:

```go
package front

import (
	"playground/core/server"
	"playground/internal/game"
	"playground/internal/match"
	"playground/internal/protocol"
	"playground/internal/sim"
)

// Server is the generic server instantiated for Dogfight.
type Server = server.Server[game.Settings, protocol.ClientMsg, sim.Input, match.Info]

// NewServer is Dogfight's HTTP handler.
func NewServer(l *match.Lobby, o server.Options) *Server { return server.New(l, Kit{}, o) }
```

Move the black-box tests:

```bash
for f in server_test limits_test flood_test drain_test joins_test metrics_test tokenlog_test team_test; do git mv core/server/$f.go internal/front/$f.go; done
git mv core/server/api_test.go internal/front/api_test.go
```

In each moved file: `package server` → `package front`; `New(lobby.New(ctx, lobby.Options{…}), o)` / `New(l, o)` → `NewServer(match.NewLobby(ctx, …), o)`; `Options`, `Limits`, `DefaultLimits` → `server.Options`, `server.Limits`, `server.DefaultLimits`; `*Server` → `*Server` (the alias); `Options{Stats: sl}` → `server.Options{Stats: NewStats(sl)}`. Unexported identifiers of `core/server` they used get test-local copies in `internal/front/helpers_test.go`:

```go
package front

// The server's user-facing texts the integration tests compare (core/server's
// unexported msg* constants, copied: the wire must not change).
const (
	msgVersion  = "sürüm uyuşmuyor, sayfayı yenile"
	msgNoRoom   = "oda bulunamadı"
	msgBadRoom  = "geçersiz oda ayarı"
	msgFull     = "oda dolu"
	msgBad      = "geçersiz mesaj"
	msgBusy     = "sunucu dolu"
	msgCreates  = "çok fazla oda kurdun, biraz bekle"
	msgJoins    = "çok fazla deneme, biraz bekle"
	msgFlood    = "çok fazla mesaj"
	msgConns    = "çok fazla bağlantı"
	msgTimeout  = "zaman aşımı"
	msgUpdating = "sunucu güncelleniyor, yeniden bağlan"
)
```

(keep only the constants the moved tests use; `go vet` reports unused ones? It does not for constants — delete unused ones by hand.) Remove from `internal/front/api_test.go` the four quick-play tests now in `core/server/quick_test.go`; `quickServer` goes with them. If another moved test touches an unexported field of the server, rewrite it through `server.Options` (`Now`, `Limits`) or move it to `core/server` on the fake game; record which in the report.

- [ ] **Step 4: Wire cmd and golden; empty allowlist**

- `cmd/dogfight/main.go`: `server.New(lb, o)` → `front.NewServer(lb, o)`.
- `cmd/dogfight/config.go`: `func (c config) server(web fs.FS, st *stats.Slot) server.Options` sets `Stats: front.NewStats(st)`.
- `internal/golden/server_test.go`: constructor lines become `s := front.NewServer(match.NewLobby(ctx, maxRooms, nil, nil), o)` with `o.Stats = front.NewStats(st)` when `st != nil`; the return type `*server.Server` → `*front.Server`.
- `internal/golden/boundary_test.go`: delete the `"core/server"` entry; `coreAllow` is now `map[string][]string{}`.

- [ ] **Step 5: Verify**

Run: `go build ./... && go vet ./... && go test ./... -race -short && go test ./internal/golden -count=1 -v 2>&1 | grep -E '^(--- |ok|FAIL)' && go list -deps ./core/... | grep 'playground/internal' ; echo "exit $?"`
Expected: PASS everywhere; every golden test PASS; the last `grep` prints nothing (`exit 1`).

- [ ] **Step 6: Commit**

```bash
git add core/server internal/front internal/match/match.go cmd/dogfight/main.go cmd/dogfight/config.go internal/golden/server_test.go internal/golden/boundary_test.go
git status --short   # moved tests, edited server files, nothing else
.tools/gc -m "core/server: the server runs any game through a Kit" -m "Handshake, limits, guard, API, drain and the stats endpoints are generic over the game's settings, message, input and summary types; Dogfight plugs in internal/front (Kit, NewStats, NewServer). Black-box server tests run as Dogfight integration tests in internal/front; core/server tests its own helpers and a fake game. core/ imports nothing from internal/. Wire byte-identical (golden)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 6 — Load-test harness

### Task 17: `core/loadtest` — plan, histograms, rates

**Files:**
- Create: `core/loadtest/plan.go` (from `cmd/loadtest/plan.go`: `assign`, `humansPerRoom`, `startAt`, `wsURL`, `snapTick`), `core/loadtest/hist.go` (`git mv cmd/loadtest/hist.go`), `core/loadtest/stats.go` (`git mv cmd/loadtest/stats.go`)
- Create: `core/loadtest/plan_test.go`, `core/loadtest/stats_test.go` (generic tests moved from `cmd/loadtest`)
- Modify: `cmd/loadtest/plan.go` (keeps `stick`, `r3`, `pickKind`, cycle constants), `cmd/loadtest/plan_test.go` (keeps `TestStick*`, `TestPickKindMatchesTeam`, `TestSnapTickMatchesServerEncoding`), `cmd/loadtest/stats_test.go` (deleted if empty), `cmd/loadtest/main.go`, `cmd/loadtest/player.go` (qualified names)

**Interfaces:**
- Produces (exported renames, bodies unchanged):

```go
type Slot struct{ Room int; Creator bool } // Room < 0: quick play
func Assign(players, rooms int) []Slot
func HumansPerRoom(players, rooms int) int
func StartAt(i, n int, ramp time.Duration) time.Duration
func WSURL(raw string) (string, error)
func SnapTick(b []byte) (tick int, ok bool) // reads {"t":"snap","tick":N without decoding
type Hist struct{…}; func (h *Hist) Observe(d time.Duration); func (h *Hist) Snapshot() Counts
type Counts [HistMax + 1]uint64 // Sub, Total, Quantile, Above
type Stats struct{ Conns atomic.Int64; MsgsIn, MsgsOut, BytesIn, BytesOut, Snaps, Gaps atomic.Uint64; SnapIv, RTT, Handshake Hist; … }
func NewStats() *Stats; (*Stats).Disconnect(reason string); ReasonCounts() map[string]int; Sample(at) Sample
type Sample struct{…}; func Line(prev, cur Sample) string; func Summary(from, to Sample, hs Counts, reasons map[string]int) string
func PerClientKB(bytesPerSec float64, conns int64) float64
func Reason(err error, serverMsg string) string
```

- [ ] **Step 1: Move and export; failing build**

```bash
mkdir -p core/loadtest
git mv cmd/loadtest/hist.go core/loadtest/hist.go
git mv cmd/loadtest/stats.go core/loadtest/stats.go
```

In both: `package main` → `package loadtest` (doc comment: `// Package loadtest is a game-agnostic WebSocket load-test harness: slots and ramp, histograms, per-second rates, disconnect reasons and the player loop (player.go).` on `hist.go`), then export exactly the identifiers listed above (`hist` → `Hist`, `counts` → `Counts`, `histMax` → `HistMax`, `stats` → `Stats` with its fields capitalised, `newStats` → `NewStats`, `sample` → `Sample`, `line` → `Line`, `summary` → `Summary`, `perClientKB` → `PerClientKB`, `reason` → `Reason`). Create `core/loadtest/plan.go` with `Slot`, `Assign`, `HumansPerRoom`, `StartAt`, `WSURL`, `snapPrefix` and `SnapTick` cut from `cmd/loadtest/plan.go` (bodies unchanged; `slot{room, creator}` → `Slot{Room, Creator}`).

Move the generic tests with them: from `cmd/loadtest/plan_test.go` `TestAssignRoundRobinWithOneCreatorPerRoom`, `TestAssignQuickPlay`, `TestStartAtSpreadsOverRamp`, `TestWsURL` → `core/loadtest/plan_test.go`; all of `cmd/loadtest/stats_test.go` except `TestRoomCodeHandsOverOnce` (moves in Task 18) → `core/loadtest/stats_test.go`; rename identifiers as above, assertions unchanged.

Run: `go build ./cmd/loadtest` → FAIL (`undefined: assign`, …).

- [ ] **Step 2: cmd uses the package**

`cmd/loadtest`: import `playground/core/loadtest`; `assign(` → `loadtest.Assign(`, `startAt(` → `loadtest.StartAt(`, `wsURL(` → `loadtest.WSURL(`, `snapTick(` → `loadtest.SnapTick(`, `newStats()` → `loadtest.NewStats()`, `*stats` → `*loadtest.Stats`, `st.msgsIn` → `st.MsgsIn` (etc.), `summary(`/`line(`/`reason(` → `loadtest.Summary(`/`loadtest.Line(`/`loadtest.Reason(`, `sl.room`/`sl.creator` → `sl.Room`/`sl.Creator`.

- [ ] **Step 3: Verify and commit**

Run: `go build ./... && go vet ./... && go test ./... -race -short && go test ./core/loadtest ./cmd/loadtest -v -run . 2>&1 | tail -5`
Expected: PASS; `TestSnapTickMatchesServerEncoding` (still in cmd, uses `protocol.Snap`) PASS.

```bash
git add core/loadtest cmd/loadtest
.tools/gc -m "core/loadtest: slots, ramp, histograms and rate lines" -m "The game-agnostic half of the load test moves to core and is exported; cmd/loadtest keeps Dogfight's stick, pick and settings." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 18: `core/loadtest` player loop and `Script`

**Files:**
- Create: `core/loadtest/player.go` (from `cmd/loadtest/player.go`), `core/loadtest/run.go` (from `cmd/loadtest/main.go`'s `run` and `report`), `core/loadtest/player_test.go`
- Create: `cmd/loadtest/script.go` (Dogfight's `Script`)
- Modify: `cmd/loadtest/main.go` (flags, `settings`, bench stay), delete `cmd/loadtest/player.go` (`git mv` to core first, then edit)

**Interfaces:**
- Produces:

```go
// Script is what a game tells the load test.
type Script interface {
	Hello(i int) any               // player i's hello
	Create() any                   // a creator's create message
	Input(i int, seq uint32) any   // player i's input number seq (60 Hz)
	React(i, you int, t string, raw []byte) any // a reply to a server message other than snap/pong/error, or nil
}
type Config struct {
	URL                          string
	Players, Rooms               int
	Duration, Ramp, Settle, Every time.Duration
}
func Run(ctx context.Context, c Config, sc Script) // prints per-Every lines and the summary, as today
```

Core sends `{"t":"join","code":…}`, `{"t":"quick"}` and `{"t":"ping","ts":…}` itself (`netproto` types), reads `t`, `tick`, `code`, `you`, `msg`, `ts` of every message (the fast path for snapshots stays), and hands every other message to `React`.

- [ ] **Step 1: Failing test**

`core/loadtest/player_test.go`:

```go
package loadtest

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

type script struct{ reacted atomic.Int32 }

func (*script) Hello(i int) any            { return map[string]any{"t": "hello", "v": 1, "name": "p"} }
func (*script) Create() any                { return map[string]any{"t": "create", "seats": 2} }
func (*script) Input(i int, seq uint32) any { return map[string]any{"t": "in", "seq": seq} }
func (s *script) React(i, you int, t string, raw []byte) any {
	if t == "roster" {
		s.reacted.Add(1)
		return map[string]any{"t": "color", "color": "blue"}
	}
	return nil
}

// echoServer: welcome, one roster, snapshots at 30 Hz, pongs; counts colors.
func echoServer(t *testing.T, colors *atomic.Int32) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer ws.CloseNow()
		ctx := r.Context()
		ws.Read(ctx) // hello
		ws.Read(ctx) // entry
		ws.Write(ctx, websocket.MessageText, []byte(`{"t":"welcome","you":1,"code":"ABCD"}`))
		ws.Write(ctx, websocket.MessageText, []byte(`{"t":"roster"}`))
		go func() {
			for tick := 2; ctx.Err() == nil; tick += 2 {
				ws.Write(ctx, websocket.MessageText, []byte(`{"t":"snap","tick":`+itoa(tick)+`}`))
				time.Sleep(33 * time.Millisecond)
			}
		}()
		for {
			_, b, err := ws.Read(ctx)
			if err != nil {
				return
			}
			var m map[string]any
			json.Unmarshal(b, &m)
			switch m["t"] {
			case "ping":
				ws.Write(ctx, websocket.MessageText, []byte(`{"t":"pong","ts":`+itoa(int(m["ts"].(float64)))+`}`))
			case "color":
				colors.Add(1)
			}
		}
	}))
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

func TestRunDrivesAScript(t *testing.T) {
	var colors atomic.Int32
	srv := echoServer(t, &colors)
	defer srv.Close()
	sc := &script{}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	Run(ctx, Config{URL: "ws" + strings.TrimPrefix(srv.URL, "http"), Players: 2, Rooms: 1,
		Duration: 1500 * time.Millisecond, Ramp: 100 * time.Millisecond, Every: 500 * time.Millisecond}, sc)
	if sc.reacted.Load() != 2 || colors.Load() != 2 {
		t.Fatalf("reacted=%d colors=%d", sc.reacted.Load(), colors.Load())
	}
}
```

Run: `go test ./core/loadtest -run TestRunDrivesAScript` → FAIL (`undefined: Run`).

- [ ] **Step 2: Implement**

```bash
git mv cmd/loadtest/player.go core/loadtest/player.go
```

`core/loadtest/player.go` (`package loadtest`): `player` gets `sc Script` instead of `entry protocol.ClientMsg`; `inbound` drops `List`; the entry is `sc.Create()` for a creator, `netproto`-shaped `struct{T string \`json:"t"\`; Code string \`json:"code"\`}{"join", code}` for a joiner and `struct{T string \`json:"t"\`}{"quick"}` for quick play; hello is `sc.Hello(p.i)`; `send` writes `sc.Input(p.i, seq)` each tick and `struct{T string \`json:"t"\`; TS float64 \`json:"ts"\`}{"ping", ts}` every `pingEvery`; `write(ctx, conn, v any)` marshals any value; `recv` returns the raw bytes too; `read` replaces the `"players"` case with

```go
		default:
			if reply := p.sc.React(p.i, you, m.T, raw); reply != nil {
				select {
				case replies <- reply:
				default: // one reply in flight at most; the game repeats if it must
				}
			}
```

and `send` writes from `replies` (a `chan any`, cap 1) where it wrote picks. `roomCode` moves unchanged; `TestRoomCodeHandsOverOnce` moves to `core/loadtest/player_test.go`.

`core/loadtest/run.go`: `Config`, `Run` (today's `run` with `c.url` → `c.URL` etc. and `p := &player{…, sc: sc}`; the header line prints `url`, `players`, `rooms`, `ramp`, `duration` — Dogfight's mode/map line moves to `cmd/loadtest/main.go`, printed just before `loadtest.Run`), and `report` unchanged.

`cmd/loadtest/script.go`:

```go
package main

import (
	"encoding/json"
	"fmt"

	"playground/internal/protocol"
)

// dogfight is the load test's Dogfight player: hello, the create message
// from the flags, the scripted stick, and one aircraft pick once the
// roster names the player's team.
type dogfight struct{ create protocol.ClientMsg }

func (d dogfight) Hello(i int) any {
	return protocol.ClientMsg{T: protocol.THello, V: protocol.Version, Name: fmt.Sprintf("lt%d", i)}
}
func (d dogfight) Create() any                  { return d.create }
func (d dogfight) Input(i int, seq uint32) any  { return stick(i, seq) }

func (d dogfight) React(i, you int, t string, raw []byte) any {
	if t != "players" {
		return nil
	}
	var m struct {
		List []struct {
			ID   int    `json:"id"`
			Team string `json:"team"`
		} `json:"list"`
	}
	if json.Unmarshal(raw, &m) != nil {
		return nil
	}
	for _, e := range m.List {
		if e.ID == you {
			return protocol.ClientMsg{T: protocol.TPick, Kind: pickKind(e.Team, i)}
		}
	}
	return nil
}
```

The "pick once" rule: today `read` keeps a `picked` flag. Keep it in `dogfight` as a per-player set guarded by nothing (each player calls `React` from its own goroutine with its own `i`): use `picked []atomic.Bool` sized to `players`, created in `main` (`dogfight{create: …, picked: make([]atomic.Bool, c.players)}`) and checked with `CompareAndSwap(false, true)` before returning the pick.

`cmd/loadtest/main.go`: `run(ctx, c, create)` → print the Dogfight header line, then `loadtest.Run(ctx, loadtest.Config{URL: c.url, Players: c.players, Rooms: c.rooms, Duration: c.duration, Ramp: c.ramp, Settle: c.settle, Every: c.every}, dogfight{create: create, picked: …})`; delete `run`, `report`.

- [ ] **Step 3: Verify and commit**

Run: `go test ./core/loadtest ./cmd/loadtest -v 2>&1 | tail -5 && go build ./... && go vet ./... && go test ./... -race -short`
Expected: PASS. Smoke (optional, cheap): start a local server with raised limits (`go run ./cmd/dogfight -addr 127.0.0.1:18080 -max-conns-ip 1000 -max-conns 1000 -create-per-min-ip 1000 -join-per-min-ip 1000 -join-fail-per-min-ip 1000`, run in the background) and `go run ./cmd/loadtest -url ws://127.0.0.1:18080/ws -players 8 -rooms 2 -duration 10s`; the summary shows 0 disconnects and snapshot intervals near 33 ms. Stop the server afterwards.

```bash
git add core/loadtest cmd/loadtest
.tools/gc -m "core/loadtest: the player loop runs a game's Script" -m "Dial, handshake, 60 Hz sends, pings, snapshot timing and disconnect reasons are generic; a game supplies hello, create, input and replies. cmd/loadtest is Dogfight's script plus its flags and the in-process bench." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 7 — Client core

Client tasks keep every existing import path working: a Dogfight module that moved becomes a thin re-export or instance of its core counterpart, so call sites change only where a type became generic.

### Task 19: `client/src/core` foundation — store, dom, codes, boundary

**Files:**
- Create: `client/src/core/store.ts`, `client/src/core/ui/dom.ts`, `client/src/core/net/code.ts`, `client/src/core/net/pilot.ts`, `client/src/core/net/codes.ts`, `client/src/core/boundary.test.ts`, `client/src/core/store.test.ts`, `client/src/storekeys.test.ts`
- Modify: `client/src/ui/dom.ts`, `client/src/net/code.ts`, `client/src/net/pilot.ts`, `client/src/net/codes.ts` (thin), `internal/protocol/codes_test.go` (reads both client files)

**Interfaces:**
- Produces:

```ts
// core/store.ts
export type Store = Pick<Storage, "getItem" | "setItem">;
export function safeStore(): Store | null;
export type Slot = { readonly key: string; get(store?: Pick<Storage, "getItem"> | null): string | null; set(v: string, store?: Pick<Storage, "setItem"> | null): void };
export function slot(key: string): Slot; // the full key, e.g. "dogfight.lang"
// core/ui/dom.ts: h, append, fill, text, clock, type Attrs, type Child (moved verbatim)
// core/net/code.ts: normalizeCode (moved verbatim)
// core/net/pilot.ts
export const TOKEN_RE: RegExp;
export function tokenStore(s: Slot): { load(store?): string; save(tok: string, store?): void };
// core/net/codes.ts: ERROR_CODES, ErrorCode, ROOM_GONE, RECOVERABLE, isErrorCode (moved)
```

- [ ] **Step 1: Failing tests**

`client/src/core/boundary.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const core = dirname(fileURLToPath(import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

test("core imports only core (no game modules, no three)", () => {
  const bad: string[] = [];
  for (const f of files(core)) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\bfrom\s+"([^"]+)"/g)) {
      const spec = m[1];
      if (spec.startsWith("node:")) continue; // tests only
      const target = resolve(dirname(f), spec);
      if (!spec.startsWith(".") || relative(core, target).startsWith("..")) bad.push(`${relative(core, f)} → ${spec}`);
    }
  }
  assert.deepEqual(bad, []);
});
```

`client/src/core/store.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { slot } from "./store.ts";

test("slot reads and writes its exact key and survives blocked storage", () => {
  const m = new Map<string, string>();
  const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  const s = slot("game.x");
  s.set("1", st);
  assert.equal(m.get("game.x"), "1");
  assert.equal(s.get(st), "1");
  const blocked = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); } };
  assert.equal(s.get(blocked), null);
  s.set("2", blocked); // no throw
});
```

`client/src/storekeys.test.ts` (Review Focus 5):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initialLang } from "./i18n/index.ts";
import { loadToken } from "./net/pilot.ts";
import { lastChapter } from "./book/book.ts";
import { CHAPTERS } from "./book/chapters.ts";

const KEYS = ["dogfight.lang", "dogfight.name", "dogfight.pilot", "dogfight.settings", "dogfight.book.chapter",
  "dogfight.hint.ground", "dogfight.coach.takeoff"];

test("stored user data keeps its localStorage keys", () => {
  const m = new Map<string, string>([["dogfight.lang", "en"], ["dogfight.pilot", "AAAAAAAAAAAAAAAAAAAAA1"],
    ["dogfight.book.chapter", CHAPTERS[1].id]]);
  const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  assert.equal(initialLang(["tr-TR"], st), "en");
  assert.equal(loadToken(st), "AAAAAAAAAAAAAAAAAAAAA1");
  assert.equal(lastChapter(CHAPTERS, st), 1);
  // Every key is still spelled out once in the sources (settings, name, coach hints included).
  const src = ["ui/dom.ts", "ui/coach.ts", "net/pilot.ts", "input/schemes.ts", "book/book.ts", "i18n/index.ts"]
    .map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
  for (const k of KEYS) assert.ok(src.includes(`"${k}"`), `${k} missing from the sources`);
});
```

Run: `export PATH="$PWD/.tools/node/bin:$PATH"; cd client && node --experimental-strip-types --no-warnings --test src/core/*.test.ts src/storekeys.test.ts`
Expected: FAIL (`Cannot find module …/core/store.ts`); `storekeys.test.ts` passes already (it pins today's behaviour) — that is intended: it must still pass after Step 2.

- [ ] **Step 2: Implement**

`client/src/core/store.ts`:

```ts
// localStorage access that never throws: blocked storage (privacy modes)
// reads as empty and drops writes.
export type Store = Pick<Storage, "getItem" | "setItem">;

export function safeStore(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked storage throws on access
  }
}

export type Slot = {
  readonly key: string;
  get(store?: Pick<Storage, "getItem"> | null): string | null;
  set(v: string, store?: Pick<Storage, "setItem"> | null): void;
};

/** One stored string under its full key (games prefix their keys: "dogfight.lang"). */
export function slot(key: string): Slot {
  return {
    key,
    get(store = safeStore()) {
      try {
        return store?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(v, store = safeStore()) {
      try {
        store?.setItem(key, v);
      } catch {
        // storage blocked: the value lives for this page only
      }
    },
  };
}
```

`client/src/core/ui/dom.ts`: move `Attrs`, `Child`, `h`, `append`, `fill`, `text`, `clock` verbatim from `client/src/ui/dom.ts` (with its header comment). `client/src/ui/dom.ts` becomes:

```ts
// Dogfight's DOM helpers: the core ones plus the stored player name.
import { slot } from "../core/store.ts";

export { append, clock, fill, h, text, type Attrs, type Child } from "../core/ui/dom.ts";

const NAME = slot("dogfight.name");

export function storedName(): string {
  return NAME.get()?.trim() ?? "";
}

export function storeName(name: string): void {
  NAME.set(name);
}
```

`client/src/core/net/code.ts`: `client/src/net/code.ts` moved verbatim; the old file becomes `export { normalizeCode } from "../core/net/code.ts";`.

`client/src/core/net/pilot.ts`:

```ts
// The pilot token: issued by the server in welcome, kept in localStorage,
// sent back in hello and in the X-Pilot-Token header only (never in URLs).
import type { Slot } from "../store.ts";

export const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

export function tokenStore(s: Slot) {
  return {
    /** The stored token, "" when absent or invalid. */
    load(store?: Pick<Storage, "getItem"> | null): string {
      const t = s.get(store) ?? "";
      return TOKEN_RE.test(t) ? t : "";
    },
    /** Stores tok; invalid tokens are ignored. */
    save(tok: string, store?: Pick<Storage, "setItem"> | null): void {
      if (TOKEN_RE.test(tok)) s.set(tok, store);
    },
  };
}
```

`client/src/net/pilot.ts`:

```ts
import { slot } from "../core/store.ts";
import { tokenStore } from "../core/net/pilot.ts";

export { TOKEN_RE } from "../core/net/pilot.ts";

const tokens = tokenStore(slot("dogfight.pilot"));

/** The stored token, "" when absent or invalid. */
export const loadToken = (store?: Pick<Storage, "getItem"> | null): string => tokens.load(store);
/** Stores tok; invalid tokens are ignored. */
export const storeToken = (tok: string, store?: Pick<Storage, "setItem"> | null): void => tokens.save(tok, store);
```

(Passing `undefined` makes `slot`'s default `safeStore()` apply, as today's default parameter did.)

`client/src/core/net/codes.ts`: move `ERROR_CODES`, `ErrorCode`, `ROOM_GONE`, `RECOVERABLE`, `isErrorCode` from `client/src/net/codes.ts` (header comment: "Core error codes (core/netproto/codes.go); TestCodesMatchClient keeps the lists equal"). `client/src/net/codes.ts` keeps `NOTICE_CODES`, `NoticeCode`, `isNoticeCode` and adds `export { ERROR_CODES, ROOM_GONE, RECOVERABLE, isErrorCode, type ErrorCode } from "../core/net/codes.ts";`.

`internal/protocol/codes_test.go` `TestCodesMatchClient`: read `ERROR_CODES` from `../../client/src/core/net/codes.ts` (against `netproto.ErrorCodes()`) and `NOTICE_CODES` from `../../client/src/net/codes.ts` (against `NoticeCodes()`):

```go
	for _, c := range []struct{ file, name string; want []string }{
		{"../../client/src/core/net/codes.ts", "ERROR_CODES", netproto.ErrorCodes()},
		{"../../client/src/net/codes.ts", "NOTICE_CODES", NoticeCodes()},
	} {
		b, err := os.ReadFile(c.file)
		if err != nil {
			t.Fatal(err)
		}
		m := regexp.MustCompile(`(?s)export const ` + c.name + ` = \[(.*?)\] as const`).FindSubmatch(b)
		if m == nil {
			t.Fatalf("%s lacks %s", c.file, c.name)
		}
		var got []string
		for _, q := range regexp.MustCompile(`"([a-z_]+)"`).FindAllSubmatch(m[1], -1) {
			got = append(got, string(q[1]))
		}
		if !slices.Equal(got, c.want) {
			t.Fatalf("%s: client %v, server %v", c.name, got, c.want)
		}
	}
```

- [ ] **Step 3: Verify and commit**

Run: `export PATH="$PWD/.tools/node/bin:$PATH"; (cd client && npm run check && npm test && npm run build) && go test ./internal/protocol -run TestCodesMatchClient`
Expected: PASS; `src/golden/*` PASS.

```bash
git add client/src/core/store.ts client/src/core/store.test.ts client/src/core/boundary.test.ts client/src/core/ui/dom.ts client/src/core/net/code.ts client/src/core/net/pilot.ts client/src/core/net/codes.ts client/src/storekeys.test.ts client/src/ui/dom.ts client/src/net/code.ts client/src/net/pilot.ts client/src/net/codes.ts internal/protocol/codes_test.go
.tools/gc -m "client/core: store, dom, room code, pilot token and core error codes" -m "Game-agnostic client modules start under client/src/core (imports only core, tested); Dogfight's modules re-export or instantiate them, so call sites and localStorage keys are unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 20: Generic socket and shaper

**Files:**
- Create: `client/src/core/net/shaper.ts`, `client/src/core/net/socket.ts`, `client/src/core/net/socket.test.ts`, `client/src/core/net/shaper.test.ts`
- Modify: `client/src/net/shaper.ts` (Dogfight's policy only), `client/src/net/socket.ts` (Dogfight instance), `client/src/net/socket.test.ts`, `client/src/net/shaper.test.ts`, `client/src/ui/app.ts`, `client/src/debug/terrain.ts`, `client/src/debug/world.ts`, `client/src/ui/banner.ts` (Status type import), `client/src/golden/wire.test.ts` (Socket construction line only)

**Interfaces:**
- Produces:

```ts
// core/net/shaper.ts
export type Envelope = { t: string };
export type ShaperPolicy<M extends Envelope> = {
  isInput(m: M): boolean;           // newest-wins while the connection is backed up
  latch(held: M, next: M): M;       // next plus held's one-shot presses
  gapped(m: M): boolean;            // at most one per gapMs; the newest waiting one is sent
  gapMs: number;
};
export class Shaper<M extends Envelope> { constructor(env: ShaperEnv<M>, policy: ShaperPolicy<M>); received(): void; send(m: M): boolean; dispose(): void }
export const MAX_BUFFERED: number, STALL_MS: number;
// core/net/socket.ts
export type Status = "connecting" | "updating" | "open" | "closed";
export type Join = { t: "join"; code: string }; export type Quick = { t: "quick" };
export type SocketOpts<C extends Envelope> = { version: number; policy: ShaperPolicy<C> };
export class Socket<C extends Envelope, S extends Envelope> {
  constructor(url: string, name: string, entry: C | Join | Quick, h: Handlers<S>, o: SocketOpts<C>, env?: Env);
  code(): string; setToken(tok: string): void; send(m: C): boolean; retry(): void; close(): void;
}
export function socketURL(loc): string; export const RECONNECT_MS, FIRST_TRIES, PING_MS, CLOSE_RESTART;
// net/socket.ts (Dogfight)
export type Socket = core.Socket<ClientMsg, ServerMsg>;
export function openSocket(url: string, name: string, entry: Create | Join | Quick, h: Handlers<ServerMsg>, env?: Env): Socket;
```

- [ ] **Step 1: Failing core tests**

`client/src/core/net/shaper.test.ts` and `socket.test.ts`: copy today's `net/shaper.test.ts` and `net/socket.test.ts`, then make them game-free: messages are `{ t: "in"; seq: number; shot?: boolean }`, `{ t: "pick"; k: string }`, `{ t: "chat"; id: number }`; the policy under test is

```ts
const policy: ShaperPolicy<M> = {
  isInput: (m) => m.t === "in",
  latch: (held, m) => (m.t === "in" && held.t === "in" ? { ...m, shot: !!(m.shot || held.shot) } : m),
  gapped: (m) => m.t === "pick",
  gapMs: 500,
};
```

and the socket is `new Socket<M, S>("ws://x/ws", "Ace", entry, handlers, { version: 7, policy }, env)` (assert the hello carries `"v":7`). Keep every scenario: reconnect backoff, first-tries give-up, 1012 → updating → join by code, `room_gone`, recoverable `flood`, ping interval, no queuing while reconnecting, backed-up input held and merged, pick gap.

Run: `cd client && node --experimental-strip-types --no-warnings --test src/core/net/*.test.ts` → FAIL (module not found).

- [ ] **Step 2: Implement**

`client/src/core/net/shaper.ts`: today's `net/shaper.ts` with `ClientMsg`/`In`/`Pick` replaced by the type parameter and the policy:

```ts
export class Shaper<M extends Envelope> {
  private readonly env: ShaperEnv<M>;
  private readonly p: ShaperPolicy<M>;
  private lastRecv: number;
  private heldIn: M | null = null;
  private lastGap = -Infinity;
  private heldGap: M | null = null;
  private gapTimer: unknown = null;

  constructor(env: ShaperEnv<M>, policy: ShaperPolicy<M>) {
    this.env = env;
    this.p = policy;
    this.lastRecv = env.now();
  }

  send(m: M): boolean {
    if (this.p.isInput(m)) return this.input(m);
    if (this.p.gapped(m)) return this.gap(m);
    return this.env.write(m);
  }

  private input(m: M): boolean {
    const held = this.heldIn;
    const out = held ? this.p.latch(held, m) : m;
    if (this.backedUp()) {
      this.heldIn = out;
      return true;
    }
    this.heldIn = null;
    return this.env.write(out);
  }
  // received, dispose, backedUp unchanged; gap() is today's pick() with
  // PICK_GAP_MS → this.p.gapMs and lastPick/heldPick/pickTimer renamed.
}
```

`ShaperEnv<M>` is today's `ShaperEnv` with `write: (m: M) => boolean`.

`client/src/core/net/socket.ts`: today's `net/socket.ts` with `ClientMsg` → `C`, `ServerMsg` → `S`, `Create` → `C`, `VERSION` → `this.o.version`, `new Shaper({...})` → `new Shaper<C>({...}, this.o.policy)`; `Handlers<S>` generic in `onMsg`; `receive` reads `m.t`, `(m as { code?: string }).code`, `(m as { msg?: string }).msg` for `"error"` and `(m as { code: string }).code` for `"welcome"`. The hello, ping and join messages are written as plain objects (`{ t: "hello", v, name, tok? }`, `{ t: "ping", ts }`, `{ t: "join", code }`) — byte-identical to today's (same key order).

`client/src/net/shaper.ts` (Dogfight's policy):

```ts
// Dogfight's outbound shaping: inputs merge their one-shot presses, picks keep a gap.
import type { ShaperPolicy } from "../core/net/shaper.ts";
import type { ClientMsg } from "./protocol.ts";

export { MAX_BUFFERED, STALL_MS } from "../core/net/shaper.ts";
export const PICK_GAP_MS = 500;

export const POLICY: ShaperPolicy<ClientMsg> = {
  isInput: (m) => m.t === "in",
  latch: (held, m) =>
    m.t === "in" && held.t === "in" ? { ...m, m: m.m || held.m, fl: m.fl || held.fl, bo: !!(m.bo || held.bo) } : m,
  gapped: (m) => m.t === "pick",
  gapMs: PICK_GAP_MS,
};
```

(The latch expression is today's, character for character: key order of the written JSON depends on it.)

`client/src/net/socket.ts`:

```ts
// Dogfight's socket: the core socket with Dogfight's messages, version and shaping.
import { Socket as CoreSocket, type Env, type Handlers, type Join, type Quick } from "../core/net/socket.ts";
import { VERSION, type ClientMsg, type Create, type ServerMsg } from "./protocol.ts";
import { POLICY } from "./shaper.ts";

export { socketURL, RECONNECT_MS, FIRST_TRIES, PING_MS, CLOSE_RESTART, type Conn, type Env, type Status } from "../core/net/socket.ts";
export type Socket = CoreSocket<ClientMsg, ServerMsg>;
export type { Handlers };

export function openSocket(url: string, name: string, entry: Create | Join | Quick, h: Handlers<ServerMsg>, env?: Env): Socket {
  return new CoreSocket<ClientMsg, ServerMsg>(url, name, entry, h, { version: VERSION, policy: POLICY }, env);
}
```

Call sites: `new Socket(` → `openSocket(` in `ui/app.ts`, `debug/terrain.ts`, `debug/world.ts`, `net/socket.test.ts`, and the marked line of `golden/wire.test.ts`. `Shaper` tests in `net/shaper.test.ts` construct `new Shaper(env, POLICY)` from `../core/net/shaper.ts`.

- [ ] **Step 3: Verify and commit**

Run: `export PATH="$PWD/.tools/node/bin:$PATH"; cd client && npm run check && npm test && npm run build`
Expected: PASS, including `golden/wire.test.ts` (byte-identical outbound strings) and `core/boundary.test.ts`.

```bash
git add client/src/core/net/shaper.ts client/src/core/net/socket.ts client/src/core/net/shaper.test.ts client/src/core/net/socket.test.ts client/src/net/shaper.ts client/src/net/socket.ts client/src/net/shaper.test.ts client/src/net/socket.test.ts client/src/ui/app.ts client/src/debug/terrain.ts client/src/debug/world.ts client/src/ui/banner.ts client/src/golden/wire.test.ts
.tools/gc -m "client/core: generic reconnecting socket and outbound shaper" -m "Handshake, backoff, 1012 handover, fatal codes and ping are game-free; a game gives its protocol version and a shaping policy (which messages are inputs and how their presses merge, which keep a gap). Outbound bytes unchanged (golden)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 21: Generic interpolation and server clock

**Files:**
- Create: `client/src/core/predict/interp.ts`, `client/src/core/predict/interp.test.ts`
- Modify: `client/src/predict/interp.ts` (Dogfight instance), `client/src/game/state.ts`, `client/src/game/loop.ts` (only if a type name changes)

**Interfaces:**
- Produces:

```ts
export type Mix<S> = (a: S, b: S, u: number) => S;       // u in [0, 1]
export type Ahead<S> = (s: S, seconds: number) => S;      // carry s along its own motion
export class InterpBuffer<S> { constructor(mix: Mix<S>); push(serverTimeMs: number, s: S): void; newest(): { t: number; fs: S } | undefined; size(): number; sample(renderTimeMs: number): S | null }
export function extrapolate<S>(buf: InterpBuffer<S>, serverTimeMs: number, ahead: Ahead<S>): S | null;
export class ServerClock { constructor(tickMs?: number /* 1000/60 */, delayMs?: number /* 100 */); observe(tick, nowMs): void; serverMs(tick): number; renderTime(nowMs): number }
```

Note `ServerClock.serverMs` becomes an instance method (tick length is per game); Dogfight keeps a static-compatible export (below).

- [ ] **Step 1: Failing core test**

`client/src/core/predict/interp.test.ts`: today's `predict/interp.test.ts` scenarios on a number state (`new InterpBuffer<number>((a, b, u) => a + (b - a) * u)`, `extrapolate(b, t, (s, sec) => s + 10 * sec)`), plus `new ServerClock(50, 0)` mapping tick 3 to 150 ms. Run → FAIL (module not found).

- [ ] **Step 2: Implement**

`client/src/core/predict/interp.ts`: today's file with `FlightState` → `S`; `sample`'s inner return becomes `return this.mix(a.fs, b.fs, u);`; `extrapolate` returns `{ ...last.fs, pos: … }` today — it becomes `return ahead(last.fs, s);`; `ServerClock` takes `tickMs` and `delayMs` (defaults 1000/60 and 100) and uses them where `TICK_MS` and `INTERP_DELAY_MS` were. Constants `RELAX_EVERY_MS`, `RELAX_MS`, `MAX_ENTRIES`, `MAX_AHEAD_MS` stay in core.

`client/src/predict/interp.ts` (Dogfight):

```ts
// Interpolation of remote planes: the core buffer over FlightState.
import { InterpBuffer as Core, ServerClock as CoreClock, extrapolate as coreExtrapolate } from "../core/predict/interp.ts";
import type { FlightState } from "../sim/flight.ts";
import { add, lerp, qSlerp, scale } from "../sim/vec.ts";

export const INTERP_DELAY_MS = 100;
const TICK_MS = 1000 / 60;

const mix = (a: FlightState, b: FlightState, u: number): FlightState => ({
  pos: lerp(a.pos, b.pos, u),
  rot: qSlerp(a.rot, b.rot, u),
  vel: lerp(a.vel, b.vel, u),
  th: a.th + (b.th - a.th) * u,
});

export class InterpBuffer extends Core<FlightState> {
  constructor() {
    super(mix);
  }
}

export function extrapolate(buf: InterpBuffer, serverTimeMs: number): FlightState | null {
  return coreExtrapolate(buf, serverTimeMs, (s, sec) => ({ ...s, pos: add(s.pos, scale(s.vel, sec)) }));
}

export class ServerClock extends CoreClock {
  constructor() {
    super(TICK_MS, INTERP_DELAY_MS);
  }
  /** Server time (ms) for a tick (static, as call sites use it). */
  static serverMs(tick: number): number {
    return tick * TICK_MS;
  }
}
```

(Two constructor-only subclasses keep `new InterpBuffer()` / `new ServerClock()` / `ServerClock.serverMs` working at the four call sites; they add no behaviour. The `mix` and `ahead` expressions are today's, character for character.)

- [ ] **Step 3: Verify and commit**

Run: `export PATH="$PWD/.tools/node/bin:$PATH"; cd client && npm run check && npm test && npm run build`
Expected: PASS including `golden/predict.test.ts` "interpolation numeric transcript" (bit-exact).

```bash
git add client/src/core/predict/interp.ts client/src/core/predict/interp.test.ts client/src/predict/interp.ts
.tools/gc -m "client/core: generic interpolation buffer and server clock" -m "The buffer is generic over the state and its mix; extrapolation over an ahead function; the clock over tick length and render delay. Dogfight's instances keep their names and numbers (golden)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 22: Generic prediction/reconciliation

**Files:**
- Create: `client/src/core/predict/reconcile.ts`, `client/src/core/predict/reconcile.test.ts`, `client/src/core/predict/sessionmodel.ts` (generic over the input)
- Modify: `client/src/predict/predictor.ts` (Dogfight's model + smoother over the core), `client/src/predict/sessionmodel.ts` (re-export)

**Interfaces:**
- Produces:

```ts
export type Model<S, I, E> = { step(s: S, inp: I, env: E, tick: number): S }; // one fixed step ending at world tick `tick`
export interface Smoother<S> {
  rebase(drawnFrom: S, to: S): void; // the physics state jumps: keep drawing the old one, then fade
  draw(s: S, dtS: number): S;        // s plus the decaying correction; dtS = frame time
  reset(): void;
}
export class Reconciler<S, I, E> {
  constructor(model: Model<S, I, E>, smoother: Smoother<S>, initial: S);
  tickFor(seq: number): number;
  push(seq: number, inp: I, tick: number, env: E): void;
  reconcile(server: S, ack: number, snapTick: number, env: E): void;
  ahead(): number; pendingCount(): number; state(): S; render(dtS: number): S;
  reset(s: S, snapTick?: number, ack?: number): void;
}
export class SessionModel<I> { push(seq: number, inp: I): void; next(): { inp: I | null; fresh: boolean }; ack: number }
```

- [ ] **Step 1: Failing core test**

`client/src/core/predict/reconcile.test.ts`: a 1-D model (`step: (s, i) => s + i`, `Smoother<number>` with an offset that `rebase` sets to `drawnFrom - to + offset` and `draw` decays by `exp(-dt/0.1)`), and the scenarios of today's `predictor.test.ts` that do not depend on flight: exact replay of unacked inputs, server repeats (snapTick − ack drifting by ±1 under jitter does not move the state), a lasting latency step re-anchors once, `pendingCount` capped at 120, `ahead()` counts. Run → FAIL (module not found).

- [ ] **Step 2: Implement**

`client/src/core/predict/reconcile.ts`: today's `Predictor` minus everything flight-specific:
- fields `spec`, `offset`, `rotOffset` go; `model`, `smoother` come in; `phys: S` starts at `initial`;
- `push`: `this.phys = this.model.step(this.phys, inp, env, tick);`
- `reconcile`: the replay loops call `this.model.step(corrected, repeat, env, snapTick + j)` and `this.model.step(corrected, p.inp, env, this.tickFor(p.seq))`; the visual correction block (offset, rotOffset, teleport) becomes `this.smoother.rebase(this.phys, corrected);` placed exactly where the block was (before `this.phys = corrected`);
- `render(dtS)` → `return this.smoother.draw(this.phys, dtS);`
- `reset(s, snapTick?, ack?)`: as today, with `this.smoother.reset()` replacing the two offset resets;
- `quartiles`, `MAX_PENDING`, `MAX_LAG`, `BASE_WINDOW` and every comment about base/shift stay verbatim.

`client/src/core/predict/sessionmodel.ts`: today's `predict/sessionmodel.ts` with `StickInput` → `I` (class `SessionModel<I>`); the Dogfight file becomes `export { SessionModel } from "../core/predict/sessionmodel.ts";` (its users pass `StickInput` via inference or `new SessionModel<StickInput>()`).

`client/src/predict/predictor.ts` (Dogfight):

```ts
// Client-side prediction of the local plane: the core reconciler with the
// flight model and a position + attitude smoother.
import { Reconciler, type Smoother } from "../core/predict/reconcile.ts";
import { stepFlight, type FlightMods, type FlightState, type Spec, type StickInput } from "../sim/flight.ts";
import type { GroundSample } from "../sim/ground.ts";
import { add, len, qConj, qIdentity, qMul, qNorm, qSlerp, scale, sub, v3, type Q, type V3 } from "../sim/vec.ts";

const SMOOTH_S = 0.1;  // visual correction time constant
const TELEPORT_M = 50; // larger corrections snap instead of smoothing

/** What the world adds to a flight step: turbo, the ground under a point, the wind at a world tick. */
export type FlightEnv = { turbo: boolean; ground(x: number, z: number): GroundSample; wind(tick: number): V3 };

/** p's flight modifiers for the step that ends at tick (sampled at the start, like sim.World.mods). */
function mods(env: FlightEnv, fs: FlightState, tick: number): FlightMods {
  return { turbo: env.turbo, wind: env.wind(tick), ground: env.ground(fs.pos.x, fs.pos.z) };
}

/** Render pos − physics pos and drawn rot = rotOffset * physics rot, fading with SMOOTH_S. */
class FlightSmoother implements Smoother<FlightState> {
  private offset: V3 = v3(0, 0, 0);
  private rotOffset: Q = qIdentity();

  rebase(prev: FlightState, corrected: FlightState): void {
    this.offset = add(this.offset, sub(prev.pos, corrected.pos));
    // Keep drawing the old attitude: drawn = rotOffset' * corrected.rot.
    this.rotOffset = qNorm(qMul(qMul(this.rotOffset, prev.rot), qConj(corrected.rot)));
    if (len(this.offset) > TELEPORT_M) this.reset();
  }

  draw(s: FlightState, dtS: number): FlightState {
    const k = Math.exp(-dtS / SMOOTH_S);
    this.offset = scale(this.offset, k);
    this.rotOffset = qSlerp(qIdentity(), this.rotOffset, k);
    return { ...s, pos: add(s.pos, this.offset), rot: qNorm(qMul(this.rotOffset, s.rot)) };
  }

  reset(): void {
    this.offset = v3(0, 0, 0);
    this.rotOffset = qIdentity();
  }
}

export class Predictor {
  private spec: Spec;
  private readonly r: Reconciler<FlightState, StickInput, FlightEnv>;

  constructor(spec: Spec) {
    this.spec = spec;
    const model = { step: (s: FlightState, i: StickInput, env: FlightEnv, tick: number) => stepFlight(s, i, this.spec, mods(env, s, tick)) };
    this.r = new Reconciler(model, new FlightSmoother(), { pos: v3(0, 0, 0), rot: qIdentity(), vel: v3(0, 0, 0), th: 0 });
  }

  /** Aircraft changed (respawn). */
  setSpec(spec: Spec): void { this.spec = spec; }
  tickFor(seq: number): number { return this.r.tickFor(seq); }
  push(seq: number, inp: StickInput, tick: number, env: FlightEnv): void { this.r.push(seq, inp, tick, env); }
  reconcile(server: FlightState, ack: number, snapTick: number, env: FlightEnv): void { this.r.reconcile(server, ack, snapTick, env); }
  ahead(): number { return this.r.ahead(); }
  pendingCount(): number { return this.r.pendingCount(); }
  state(): FlightState { return this.r.state(); }
  render(dtS: number): FlightState { return this.r.render(dtS); }
  reset(fs: FlightState, snapTick?: number, ack?: number): void { this.r.reset(fs, snapTick, ack); }
}
```

Check against today's code before running: the teleport test in today's `reconcile` runs after both offsets are updated and resets both (here: `this.reset()` inside `rebase`, same order); `render` decays before drawing (same); `reset` zeroes both (same). Any reordering changes floats and the golden test will say so.

- [ ] **Step 3: Verify and commit**

Run: `export PATH="$PWD/.tools/node/bin:$PATH"; cd client && npm run check && npm test && npm run build`
Expected: PASS including `golden/predict.test.ts` "predictor numeric transcript" bit-exact, `predict/*.test.ts` unchanged and green.

```bash
git add client/src/core/predict/reconcile.ts client/src/core/predict/reconcile.test.ts client/src/core/predict/sessionmodel.ts client/src/predict/predictor.ts client/src/predict/sessionmodel.ts
.tools/gc -m "client/core: generic prediction and reconciliation" -m "Pending inputs, ack, the median step offset and replay are generic over state, input and environment; a game supplies its fixed step and a visual smoother. Dogfight's Predictor is the flight model plus its position/attitude smoother; numbers unchanged (golden)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 23: i18n core

**Files:**
- Create: `client/src/core/i18n/i18n.ts`, `client/src/core/i18n/types.ts` (moved), `client/src/core/i18n/live.ts` (moved), `client/src/core/i18n/format.ts` (number/time helpers), `client/src/core/i18n/i18n.test.ts`
- Modify: `client/src/i18n/index.ts` (Dogfight instance), `client/src/i18n/types.ts`, `client/src/i18n/live.ts` (re-exports), `client/src/i18n/format.ts` (units over core helpers)

**Interfaces:**
- Produces:

```ts
export type I18nOptions<L extends string, K extends string> = {
  dicts: Record<L, Readonly<Record<K, Msg>>>;
  source: L;                 // the complete dictionary; missing keys fall back to it
  langs: readonly L[];
  storeKey: string;          // e.g. "dogfight.lang"
  detect(prefs: readonly string[]): L;
};
export type I18n<L extends string, K extends string> = {
  lang(): L; isLang(v: unknown): v is L; detectLang(prefs: readonly string[]): L;
  initialLang(prefs: readonly string[], store?: Store | null): L; setLang(l: L, store?: Store | null): void;
  onLang(f: () => void): () => void; t(key: K, params?: Params): string; tIn(l: L, key: K): string;
  lt(key: K, params?: Params): Text; lattr<E extends Element>(e: E, name: string, key: K, params?: Params): E;
};
export function createI18n<L extends string, K extends string>(o: I18nOptions<L, K>): I18n<L, K>; // closures: safe to destructure
```

- [ ] **Step 1: Failing core test**

`client/src/core/i18n/i18n.test.ts`: a two-language instance over a tiny dictionary (`{ a: "A {n}", p: { one: "{n} item", other: "{n} items" } }` and a partial second dictionary) — fallback to `source`, params, plurals by `Intl.PluralRules`, `setLang` stores under `storeKey` and notifies listeners once, `initialLang` prefers the stored value and else `detect`, blocked storage does not throw, destructured functions work (`const { t } = i18n`). Run → FAIL.

- [ ] **Step 2: Implement**

`client/src/core/i18n/i18n.ts`: the body of today's `i18n/index.ts` inside `createI18n`, with `state`, `DICTS`, `STORE_KEY`, `TR` (fallback) and `isLang`/`detectLang` taken from the options; every function is a closure over that state (no `this`), and the object returned lists them. `live.ts` and `types.ts` move verbatim (`git mv`) and the old paths re-export. `core/i18n/format.ts` holds `num(x, digits)` and `fixed(x, digits)` (moved; they read `lang()` → they take an `I18n` instance's `lang` as a parameter: `makeFormat(lang: () => string)` returns `{ num, fixed }`).

`client/src/i18n/index.ts` (Dogfight):

```ts
// UI language: Turkish (the source) and English, on the core i18n.
import { createI18n } from "../core/i18n/i18n.ts";
import { EN } from "./en/index.ts";
import { TR, type Key } from "./tr/index.ts";

export type { Key } from "./tr/index.ts";
export type { Params } from "../core/i18n/types.ts";
export type Lang = "tr" | "en";
export const LANGS: readonly Lang[] = ["tr", "en"];

const i18n = createI18n<Lang, Key>({
  dicts: { tr: TR, en: EN }, source: "tr", langs: LANGS, storeKey: "dogfight.lang",
  /** Browser preferences → language: any tr* first choice wins Turkish, everything else English. */
  detect: (prefs) => (/^tr\b/i.test(prefs.find((p) => p.trim() !== "") ?? "") ? "tr" : "en"),
});

export const { lang, isLang, detectLang, initialLang, setLang, onLang, t, tIn, lt, lattr } = i18n;
```

`client/src/i18n/format.ts`: `num`/`fixed` from `makeFormat(lang)`; Dogfight's units (`kmh`, `speed`, `sec`, `pct`, `dist`) stay here.

- [ ] **Step 3: Verify and commit**

Run: `export PATH="$PWD/.tools/node/bin:$PATH"; cd client && npm run check && npm test && npm run build`
Expected: PASS; `i18n/*.test.ts` (dictionary completeness, scan, messages) unchanged and green; `storekeys.test.ts` green.

```bash
git add client/src/core/i18n client/src/i18n/index.ts client/src/i18n/types.ts client/src/i18n/live.ts client/src/i18n/format.ts
.tools/gc -m "client/core: i18n factory" -m "Dictionaries, fallback, params, plurals, live labels, storage and listeners are a core factory; Dogfight's i18n is one instance (tr source, en, its detection rule and storage key) exporting the same functions." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 24: UI shells — modal, error card, banner, language toggle, key labels

**Files:**
- Create: `client/src/core/ui/modal.ts` (`tabMove`, `trapIndex` moved from `book/book.ts`), `client/src/core/ui/errorcard.ts`, `client/src/core/ui/banner.ts`, `client/src/core/ui/lang.ts`, `client/src/core/ui/keys.ts`, `client/src/core/ui/ui.test.ts`
- Modify: `client/src/book/book.ts` (imports `tabMove`, `trapIndex`), `client/src/ui/errorcard.ts`, `client/src/ui/banner.ts`, `client/src/ui/lang.ts`, `client/src/input/bindings.ts` (thin over core)

**Interfaces:**
- Produces:

```ts
// core/ui/modal.ts
export function tabMove(key: string, i: number, n: number): number | null;
export function trapIndex(cur: number, n: number, shift: boolean): number;
// core/ui/errorcard.ts
export function errorCard(ui: HTMLElement, brand: string, home: string, title: string, msg: string, ...actions: HTMLElement[]): void;
// core/ui/banner.ts
export type BannerTexts = { updating(): string; lost(): string }; // plus one field per other t(...) the banner calls today
export class Banner { constructor(el: HTMLElement, texts: BannerTexts); status(s: Status): void; fatal(msg: string): void; /* rest as today */ }
// core/ui/lang.ts
export function langToggle<L extends string>(i: Pick<I18n<L, string>, "lang" | "setLang" | "tIn" | "t">, langs: readonly L[], label: () => string, switched?: (l: L) => void): HTMLElement;
// core/ui/keys.ts
export type Codes = readonly string[];
export type KeyRow = [string, string];
export function keyName(code: string, mouse: (code: "Mouse0" | "Mouse1" | "Mouse2") => string): string;
export function keys(mouse: (code: "Mouse0" | "Mouse1" | "Mouse2") => string, ...codes: Codes[]): string;
```

- [ ] **Step 1: Failing core test**

`client/src/core/ui/ui.test.ts`: `tabMove`/`trapIndex` cases from `book/book.test.ts` (moved, not copied: delete them there); `keyName("KeyW", m) === "W"`, `keyName("Escape", m) === "Esc"`, `keyName("Mouse2", () => "R") === "R"`, `keys(m, ["KeyW"], ["KeyS", "KeyW"]) === "W / S"`. (DOM-building functions are covered by the existing `ui/ui.test.ts`, which keeps running against the Dogfight wrappers.) Run → FAIL.

- [ ] **Step 2: Implement**

Move the bodies verbatim; parameterise only what was Dogfight's: `errorCard`'s `"DOGFIGHT"` brand and `t("common.home")` → `brand`, `home` arguments; `Banner`'s `t("banner.updating")`/`t("banner.lost")` and every other `t(...)` in `ui/banner.ts` → fields of `texts` (named after the key's last segment); `langToggle`'s `lang`, `setLang`, `tIn`, `t("lang.label")`, `LANGS` → parameters; `keyName`'s `t(\`key.${code}\`)` → `mouse(code)`. Dogfight wrappers keep today's signatures:

```ts
// client/src/ui/errorcard.ts
import { errorCard as core } from "../core/ui/errorcard.ts";
import { t } from "../i18n/index.ts";
export function errorCard(ui: HTMLElement, title: string, msg: string, ...actions: HTMLElement[]): void {
  core(ui, "DOGFIGHT", t("common.home"), title, msg, ...actions);
}
// unreachableCard unchanged (uses errorCard)
```

```ts
// client/src/ui/banner.ts
import { Banner as CoreBanner } from "../core/ui/banner.ts";
import { t } from "../i18n/index.ts";
export class Banner extends CoreBanner {
  constructor(el: HTMLElement) {
    super(el, { updating: () => t("banner.updating"), lost: () => t("banner.lost") });
  }
}
```

(constructor-only subclass, as in Task 21.) `ui/lang.ts`: `export const langToggle = (switched?: (l: Lang) => void) => core(i18nFns, LANGS, () => t("lang.label"), switched);`. `input/bindings.ts`: `const mouse = (c: "Mouse0" | "Mouse1" | "Mouse2") => t(\`key.${c}\`); export const keyName = (code: string) => coreKeyName(code, mouse); export const keys = (...c: Codes[]) => coreKeys(mouse, ...c);` — everything else in `bindings.ts` stays.

- [ ] **Step 3: Verify and commit**

Run: `export PATH="$PWD/.tools/node/bin:$PATH"; cd client && npm run check && npm test && npm run build`
Expected: PASS; `ui/ui.test.ts`, `book/book.test.ts`, `input/bindings.test.ts`, `ui/lang.test.ts` green.

```bash
git add client/src/core/ui client/src/book/book.ts client/src/book/book.test.ts client/src/ui/errorcard.ts client/src/ui/banner.ts client/src/ui/lang.ts client/src/input/bindings.ts
.tools/gc -m "client/core: modal keys, error card, banner, language toggle, key labels" -m "The shells move to core with their texts and brand as parameters; Dogfight's wrappers keep their signatures and texts." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 25: Audio shell

**Files:**
- Create: `client/src/core/audio/shell.ts`, `client/src/core/audio/shell.test.ts`
- Modify: `client/src/audio/audio.ts` (composes the shell)

**Interfaces:**
- Produces:

```ts
export type Voices = { start(ctx: AudioContext, master: GainNode, noise: AudioBuffer): void }; // the game builds its continuous voices once
export type Filter = { type: BiquadFilterType; f0: number; f1?: number; q: number };
export class AudioShell {
  constructor(voices: Voices, win?: Pick<Window, "addEventListener" | "removeEventListener">, doc?: Pick<Document, "addEventListener" | "removeEventListener" | "hidden">);
  live(): boolean;                    // a running context
  setVolume(v: number): void;
  burst(f: Filter, seconds: number, gain: number, attack?: number): void; // filtered noise burst
  tone(type: OscillatorType, f0: number, f1: number, seconds: number, gain: number, delay?: number): void;
  context(): AudioContext | null;
  dispose(): void;
}
export function falloff(d: number): number;
```

- [ ] **Step 1: Failing core test**

`client/src/core/audio/shell.test.ts`: with fake `win`/`doc` objects (listener maps, `hidden` flag) and no `AudioContext` in Node (the constructor of the context throws → the shell stays silent): every call before a gesture is a no-op; `dispose` removes exactly the three listeners it added; `falloff(0) === 1`, `falloff(500) === 0.5`. (Today's `audio/audio.test.ts` keeps testing Dogfight's voices.) Run → FAIL.

- [ ] **Step 2: Implement**

Move from `client/src/audio/audio.ts` into `AudioShell`: `ctx`, `master`, `noise`, `vol`, `off`, the constructor's gesture/visibility listeners, `setVolume`, `live`, `burst`, `tone`, `dispose`, the context/master/limiter/noise creation part of `start()`, `LIMITER_TRIM`, `SMOOTH`, `falloff`. `start()` ends with `this.voices.start(ctx, master, noise)`. `AudioEngine` keeps every public method and builds `JetEngine`, `Flybys`, the lock tone and the missile warning inside its `Voices.start`; `cannon`, `missileLaunch`, `explosion`, `hit`, `hurt`, `pickup`, `evaded`, `flare` call `this.shell.burst`/`this.shell.tone` with today's numbers. `falloff` stays exported from `audio/audio.ts` as a re-export.

- [ ] **Step 3: Verify and commit**

Run: `export PATH="$PWD/.tools/node/bin:$PATH"; cd client && npm run check && npm test && npm run build`
Expected: PASS; `audio/*.test.ts` green.

```bash
git add client/src/core/audio/shell.ts client/src/core/audio/shell.test.ts client/src/audio/audio.ts
.tools/gc -m "client/core: audio shell" -m "Gesture unlock, hidden-tab suspend, master gain with limiter trim, volume, noise bursts and tones are core; Dogfight's engine builds its jet, flyby, lock and warning voices on it." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 8 — Close-out

### Task 26: Final checks, README, empty allowlist guard

**Files:**
- Modify: `internal/golden/boundary_test.go` (assert `coreAllow` empty)
- Modify: `README.md` (section "Project layout": `core/` and `client/src/core/`; one paragraph "Shared core" pointing to the spec)

- [ ] **Step 1: Failing guard**

Append to `internal/golden/boundary_test.go`:

```go
// The extraction is complete: no core package may import Dogfight.
func TestCoreAllowlistIsEmpty(t *testing.T) {
	if len(coreAllow) != 0 {
		t.Fatalf("core still allowed to import Dogfight: %v", coreAllow)
	}
}
```

Run: `go test ./internal/golden -run TestCoreAllowlistIsEmpty` → PASS if Task 16 emptied it (if it fails, Task 16 is incomplete: stop and report).

- [ ] **Step 2: README**

In `README.md` "Project layout", add `core/` (wsconn, limit, pilot, metrics, netproto, room, lobby, server, loadtest, internal/fakegame, internal/fakekit) and `client/src/core/` with one line each, and `internal/match`, `internal/front`, `internal/golden`; add under it:

```markdown
### Shared core

`core/` (Go) and `client/src/core/` (TypeScript) are the game-agnostic multiplayer stack: rooms,
lobby, handshake, limits, blue/green drain, pilot tokens, metrics, load test; reconnecting socket,
prediction, interpolation, i18n and UI shells. Dogfight is one game on it (`internal/match`,
`internal/front`). Neither tree may import game code; tests enforce it. Design:
`docs/superpowers/specs/2026-10-07-core-extraction-design.md`.
```

- [ ] **Step 3: Full verification**

Run, from the repo root:

```bash
go build ./... && go vet ./... && go test ./... -race -short
go test ./internal/golden -count=1 -v 2>&1 | grep -E '^(--- |ok|FAIL)'
go list -deps ./core/... | grep 'playground/internal' ; echo "core→internal imports: exit $? (1 = none)"
export PATH="$PWD/.tools/node/bin:$PATH"; (cd client && npm run check && npm test && npm run build)
go build -o "$TMPDIR/dogfight-check" ./cmd/dogfight && "$TMPDIR/dogfight-check" -version && rm "$TMPDIR/dogfight-check"
git diff --stat main~$(git rev-list --count HEAD ^$(git merge-base HEAD main) 2>/dev/null || echo 0) -- deploy scripts Dockerfile.runtime
```

Expected: every command PASS; golden tests PASS (not SKIP) on the generating arch; `exit 1` for the import grep; the binary prints its version; the last diff over `deploy/`, `scripts/`, `Dockerfile.runtime` is empty. (No `scripts/release.sh` and no Docker build here: the shared machine's resource rule; `TestDockerfileCopiesEveryGoDir` covers the Dockerfile.)

- [ ] **Step 4: Commit**

```bash
git add internal/golden/boundary_test.go README.md
.tools/gc -m "core: extraction complete; README layout" -m "Guard that no core package keeps a Dogfight import; README describes core/ and client/src/core/." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## F1 readiness checklist

Run through this before the F1 plan's first task; every line is a yes/no with the evidence named.

- [ ] `TestCoreAllowlistIsEmpty` and `TestCoreImportsNothingFromDogfight` pass; `go list -deps ./core/... | grep playground/internal` prints nothing.
- [ ] `client/src/core/boundary.test.ts` passes; nothing under `client/src/core` imports `three` or a Dogfight module.
- [ ] `core/internal/fakegame` + `fakekit` run through the real room, lobby and server in core's own tests (create, join by code, quick play, full room, drain 1012, stats off, chat cooldown, panic teardown).
- [ ] All Phase 0 golden files unchanged since Tasks 1, 2 and 4 (`git log --format=%h -- internal/golden/testdata client/src/golden/*.json` shows only those commits).
- [ ] `deploy/`, `scripts/`, `Dockerfile.runtime` unchanged since before Task 1; metric names `dogfight_*`; localStorage keys `dogfight.*`.
- [ ] Contracts F1 must implement are written down and stable: `room.Game`, `room.Input`, `room.Msg`, `server.Kit`, `server.Msg`, `server.Stats` (optional), `loadtest.Script`, client `ShaperPolicy`, `Model` + `Smoother`, `Mix`/`Ahead`, `createI18n` options.
- [ ] Decisions to take at F1 kickoff, each with an owner answer: monorepo move as task 1 (spec §10) — repo rename to `arcade`, `games/dogfight`, `games/f1`, shared `package.json`; F1 tick rate and snapshot cadence (room `Options.TickRate`; game `Step` decides snapshot cadence); F1 notice codes registered through `netproto.NewCodes`; metrics namespace `f1`; storage prefix `f1.`; F1 stats schema (own store, or extract `core/ledger` now that a second schema exists, spec §11); whether F1 has rounds/teams that justify a core lifecycle hook (spec [D3]); deploy parameterisation (`APP` in `scripts/deploy.sh`, per-game compose project, volume, nginx vhost).
- [ ] A throwaway spike proves the client contracts with a non-flight state: `Reconciler<CarState, CarInput, TrackEnv>` with a 2-D car step and a yaw-only smoother, `InterpBuffer<CarState>`, in a test only.
- [ ] A load test of F1 is possible: an F1 `loadtest.Script` sketch exists (hello, create, steering/throttle input, no pick).

## Self-review (done while writing)

- **Spec coverage:** layout and consumption (§3, §10) → Tasks 5–18, F1 checklist; Game contract (§4) → 10–12; codec (§5) → 7–8, 15–16, 19–20; lobby/server/metrics/stats/loadtest (§6) → 6, 13–18; generics vs interfaces (§7) → contracts in 10, 13, 15, 20–22; concurrency (§8) → doc comments in `game.go`, `kit.go`, `fakegame` tests, room actor unchanged; compatibility (§9) → 1–4 freeze, every task's golden run, 26's checks; not extracted (§11) → nothing in the plan touches stats schema, rounds, teams, bots, world, game UI; risks (§12) → determinism self-check (1), arch tag (1), Step order (11–12), test relocation (12, 16), typed nil (15), float order (22), storage keys (19).
- **Placeholders:** none; moves name their source, renames are tabulated, new code is shown.
- **Type consistency:** `room.Game[M, In, X]`, `room.Summary[X]` (Task 12), `server.Kit[S, M, X]`, `server.Msg[M, In]`, `lobby.Options[S, M, In, X]`, aliases `match.Room/Seat/Summary/Lobby`, `front.Server/NewServer/NewStats`, `fakegame.New(Settings, *Recorder)`, `fakekit.Kit` are used with the same names throughout.
- **Review Focus:** each of the five has its test in its owning task (1, 12, 15, 8→12, 19).
