# Core extraction: shared multiplayer infrastructure

Date: 2026-10-07 · Status: proposed · Plan: `docs/superpowers/plans/2026-10-07-core-extraction.md`

Owner request: "room, lobby, server, protocol are good candidates; pave the way now." The next
game is F1 racing, then possibly DTM and tanks. This spec defines which parts of Dogfight's
multiplayer stack become shared packages, the contracts between them and a game, and the
guarantees that keep Dogfight's wire, behaviour and deployment unchanged while it happens.
Decisions are numbered `[D1]`… and listed in §13.

## 1. Goal and scope

**Goal.** A second game gets rooms, lobby, quick play, handshake, limits, drain/blue-green,
pilot tokens, metrics, reconnecting socket, prediction/reconciliation, interpolation, i18n and
UI primitives by implementing a small set of interfaces. It does not copy files.

**Success criterion.** After the plan: (1) `core/` (Go) and `client/src/core/` (TS) import
nothing from Dogfight (enforced by tests); (2) a fake game in `core/internal/fakegame` runs
through the real room, lobby and server in core's own tests; (3) Dogfight's wire transcripts are
byte-identical to the transcripts frozen before the first refactor; (4) `scripts/release.sh`,
`scripts/deploy.sh` and `deploy/` work unchanged.

**Out of scope.** Moving to a monorepo (§10 describes it; it is the first task of the F1 plan),
F1 itself, any wire or gameplay change, renaming the repo or the Go module, deploy-script
parameterisation, a generic stats schema (§11).

## 2. Current state (measured, main @ c3ab2ac)

Go import map of the four packages the owner named:

| package | imports (playground/...) | game coupling |
|---|---|---|
| `internal/room` | game, metrics, mode, protocol, sim, stats | input queue latches `sim.Input` one-shots; chat scope by `sim.Team`/`mode.FFA`; stats tallies read `sim.Event`; round key reads `game.Round`; summary reads `game.Settings` |
| `internal/lobby` | game, metrics, room | `Create(game.Settings)`; otherwise generic |
| `internal/server` | bot, game, limit, lobby, maps, metrics, mode, pilot, protocol, room, sim, stats, weather, wsconn | create-settings parsing, quick-play settings, pick-kind check, team bucket, `/api/rooms` row shape, leaderboard/me bodies |
| `internal/protocol` | game, geom, maps, mode, sim, terrain, weather | envelope (`t`, `v`, `name`, `tok`, `code`, `seq`, `ts`, `id`), pong/error/notice/chat, codes and `CleanName` are generic; everything else is Dogfight payload |

Packages described as "already game-agnostic", checked:

| package | verdict |
|---|---|
| `internal/wsconn` | Agnostic. Only `coder/websocket`. `Send(any)` JSON-encodes on the writer goroutine; `Replaceable`/`Carrier` are interfaces a game's snapshot implements. |
| `internal/limit` | Agnostic. |
| `internal/pilot` | Agnostic (token, hash, log redaction). |
| `internal/metrics` | Agnostic except the hard-coded `dogfight_` name prefix in `text.go`. Deploy scripts read `dogfight_conns` (`scripts/deploy.sh`, `deploy/legacy-handoff.sh`). |
| `internal/stats` | **Not** agnostic despite having no imports. `Delta`/`Pilot` carry Dogfight's schema (kills, bot kills, crashes, fired, hits, airborne ticks, aircraft kinds), ranking is by kills, `Favorite()` is an aircraft. The journal/snapshot/lock/slot mechanics are generic, but they are intertwined with the schema. It stays in Dogfight (§11). |

`cmd/loadtest` mixes a generic harness (plan, histograms, rate lines, dial/handshake loop) with
Dogfight's scripted stick and aircraft pick. `deploy/` and `scripts/` hard-code the `dogfight`
name in container, network, volume and nginx-variable names; that is cheap to parameterise later
and is not touched now ([D12]).

Client (`client/src`), sorted by what is generic:

| area | generic | game-shaped |
|---|---|---|
| `net/` | `socket.ts` (reconnect, backoff, 1012, fatal codes, ping) except message types; `shaper.ts` except which messages are inputs/picks and the one-shot merge; `code.ts`; `pilot.ts`; `api.ts` fetch helper | `protocol.ts`; `api.ts` row/board/me parsing |
| `predict/` | `interp.ts` `ServerClock` fully, `InterpBuffer` except the lerp/slerp of `FlightState`; `predictor.ts` pending/ack/median-shift/replay algorithm; `sessionmodel.ts` | flight step, ground/wind env, position+rotation visual smoothing |
| `i18n/` | `index.ts` mechanism (dictionaries, plurals, params, live labels, storage, listeners), `live.ts`, `types.ts`, number/time helpers in `format.ts`, code→key mapping pattern in `messages.ts` | dictionaries, `Lang` list, Turkish-first detection rule, unit formats (km/h) |
| `ui/` | `dom.ts` (`h`, `append`, `fill`, `text`, `clock`), `errorcard.ts`, `banner.ts`, `lang.ts`, `link.ts`, `ChatThrottle` in `chat.ts` | HUD, radar, reticle, pick, team, loadout, rooms/leaderboard screens, settings rows |
| `book/` | modal shell: `tabMove`, `trapIndex`, chapter tabs, remembered chapter; `kit.ts` paragraph/table/SVG helpers | chapters, aircraft table |
| `input/` | key-label helpers in `bindings.ts` (`keyName`, `keys`, `KeyRow`) | schemes, touch layout, tilt aim, all bindings |
| `audio/` | `AudioEngine` shell: lazy `AudioContext` on first gesture, suspend while hidden, master gain + limiter trim, volume | jet engine, flybys, lock tone, missile warning |
| `render/`, `game/`, `sim/`, `debug/` | — (Three.js scene and flight model are game) | all |

Local-storage keys (`dogfight.lang`, `dogfight.name`, `dogfight.pilot`, `dogfight.settings`,
`dogfight.book.chapter`, `dogfight.hint.ground`, `dogfight.coach.takeoff`) are user data and must
not change.

## 3. Target layout

```
core/                         Go, same module `playground`, imports only stdlib + coder/websocket
  wsconn/  limit/  pilot/     moved verbatim from internal/
  metrics/                    moved; name prefix is a constructor argument
  netproto/                   envelope header, core message types, core codes, CleanName
  room/                       generic room actor, seats, input queue, chat relay, Game contract
  lobby/                      generic lobby (codes, list, quick pick, drain, flush)
  server/                     generic HTTP+WS server (handshake, limits, guard, API, drain, CSP)
  loadtest/                   generic load-test harness driven by a Script
  internal/fakegame/          a tiny game used by core's own tests (visible only under core/)
internal/                     Dogfight
  sim maps terrain weather geom rng bot mode game stats   unchanged
  protocol/                   Dogfight payloads; aliases the core envelope
  match/                      Dogfight's room.Game (wraps game.Game, tallies, team notices)
  front/                      Dogfight's server.Kit (decode, create settings, rows, stats API)
  golden/                     characterization tests: frozen wire transcripts, import rules
cmd/dogfight  cmd/loadtest    composition roots (wire core + match + front)
client/src/core/              TS, imports nothing outside core/, no `three`
  store.ts                    namespaced localStorage
  net/        socket.ts shaper.ts codes.ts code.ts pilot.ts
  predict/    reconcile.ts interp.ts sessionmodel.ts
  i18n/       i18n.ts live.ts types.ts format.ts
  ui/         dom.ts modal.ts errorcard.ts banner.ts lang.ts keys.ts
  audio/      shell.ts
client/src/…                  Dogfight, unchanged paths; thin instances over core where needed
```

**Why `core/` inside this repo first [D1].** One module, one `go.mod`, one dependency list (the
single-external-dependency rule holds without a ruling), atomic commits across core and game, no
versioning or tagging, and Dogfight stays the live test of every core change. Go's `internal/`
rule already makes `core/internal/fakegame` invisible to games, and `core/` may import nothing
from `internal/` (enforced by a parse-based test, §9). A separate module would need a second
`require` (forbidden today), tags for every core change and a `replace`/`go.work` dance for local
work, all to serve one consumer.

**Why not `go.work` now.** It only helps when there are several modules; there is one. It is
ignored by builds that do not copy it (the Dockerfile), so it would also create a second way to
build.

## 4. The room contract (Go)

The room actor stays exactly one goroutine that owns the game ([D2]). It owns seats, the per-seat
input queue (seq, ack, backlog trim, one-shot latch), ping/pong, quick-chat relay with cooldown,
timeouts (empty, never used), panic recovery, the published lobby summary, metrics gauges and the
stats-flush handshake. Everything else is the game's.

```go
package room // core/room

type PlayerID = netproto.PlayerID // uint32 on the wire, same as sim.ID

// Input is one tick of one player's controls.
type Input[In any] interface {
	Latch(dropped In) In // this input plus the one-shot presses of an older, dropped one
	Held() In            // this input without its one-shot presses (repeated while starved)
}

// Msg is a decoded client message: the core reads the header, the game the rest.
type Msg[In any] interface {
	Head() netproto.Header
	Input() In // the message as a tick input (meaningful for T == "in")
}

// Outbox is how the game talks to the seated humans during a call; it must
// not be kept after the call returns.
type Outbox interface {
	To(id PlayerID, v any) // one seated human
	All(v any)             // every seated human
	Snap(v Acker)          // every seated human, each with its own input ack
	Changed()              // the game's Info changed: republish the lobby summary
}

// Acker is a snapshot that carries the receiving player's input ack.
type Acker interface{ WithAck(ack uint32) any }

type Who struct{ Name, Pilot, NewToken string } // Pilot = pilot.Hash(token), "" = not counted

type Info[X any] struct {
	Humans, Seats int // Seats is constant for the room's life; every seat without a human is a bot
	Listed        bool
	Game          X // game-specific summary (a value type: it is copied across goroutines)
}

type Summary[X any] struct {
	Code string
	Seq  int64 // lobby creation order
	Info[X]
}

// Game is one match. Every method is called on the room goroutine only;
// none may block, start goroutines or keep the Outbox.
type Game[M Msg[In], In Input[In], X any] interface {
	Join(who Who) (PlayerID, error) // ErrFull (wrapped) when no seat is left
	Welcome(id PlayerID, code, newToken string, out Outbox)
	Leave(id PlayerID)
	Handle(id PlayerID, m M, out Outbox) // in-room messages other than in, ping and chat
	Step(inputs map[PlayerID]In, out Outbox)
	ChatScope(from PlayerID) func(to PlayerID) bool
	Info() Info[X]
	Label() string // for logs (Dogfight: the mode)
	FlushStats()   // hand open tallies to the stats sink; players stay seated
	Close()        // the room stops: final tallies
}
```

How the owner's list maps to it:

- **Fixed-tick Step with per-player inputs → snapshot + events.** `Step` gets the humans' inputs
  for this tick (only seats that have sent at least one input, as today) and emits through the
  `Outbox` in its own order. Dogfight's order inside a tick (snapshot every 2nd tick with the
  events since the last one, then roster, then round) is preserved byte for byte because it moves
  as code into `match.Step`. Per-player ack is generic: `Outbox.Snap` asks the snapshot for a
  copy with that player's ack (`protocol.Snap.WithAck`).
- **Join/leave/seat policies.** `Join`/`Leave`; the game decides seats, names, bots; the core
  maps `ErrFull` to the `full` error. Teams are not a core concept: a team switch is a game
  message routed through `Handle`, its refusal a game notice.
- **Round lifecycle hooks.** None in the core [D3]. Today the only round-dependent behaviour in
  the room (match counting, round broadcasts, the round key) is Dogfight-specific and moves into
  `match`. A racing game's lifecycle (grid → race → podium) has a different shape; a hook API
  with one implementation would guess it. Revisit with F1 (§11).
- **Bots as input producers.** Inside `Step`, as today: seats without a human are the game's.
  The core only promises that `inputs` holds humans.
- **Settings validation.** Two layers, both game-side: `server.Kit.Settings` whitelists a create
  message on the connection goroutine; the game constructor may still panic on a programming
  error, which the lobby recovers (as today).
- **Welcome payload.** `Welcome` sends whatever the game needs; Dogfight keeps its per-room
  encoded static payload (`protocol.Static`) inside `match`.
- **Stats tallies via a game-provided reporter.** The room no longer knows stats. `Who.Pilot`
  reaches the game in `Join`; the game tallies and records on `Leave`, at round end, on
  `FlushStats` and on `Close`. Dogfight's `match.StatsSink` is today's `room.StatsSink`.

Room options (defaults = today's constants): `TickRate` 60, `EmptyTimeout` 60 s,
`UnusedTimeout` 15 s, `PublishEvery` 60 ticks, `ChatMax` 6, `ChatCooldown` 2 s, `Seq`, `Metrics`.
The input queue keeps its cap 8 / keep 4 (the client's `SessionModel` mirrors them).

The room's own tick counter replaces `game.Tick()` for chat cooldown and summary publishing; both
advance once per `Step`, so the values are equal.

## 5. Codec boundary

The wire stays flat JSON objects with a `"t"` type field ([D4]); nothing is wrapped. The split is
by field, not by nesting:

| shared by every game (`core/netproto`) | game-specific |
|---|---|
| client: `t`, `v` (hello), `name`, `tok`, `code` (join), `seq` (in), `ts` (ping), `id` (chat) | all other client fields (create settings, stick, pick, team, …) |
| client types: `hello`, `create`, `join`, `quick`, `in`, `ping`, `chat` | other client types (`pick`, `team`) |
| server: `pong`, `error` (`msg`, `code`), `notice` (`msg`, `code`), `chat` (`from`, `id`) | `welcome`, `snap`, `players`, `round`, … |
| close 1012 + reason on drain; 1008 after an `error` | — |

- **Decoding [D5].** The game owns the decoder (`Kit.Decode`) and its message type `M`, which
  exposes `Head() netproto.Header`. One `json.Unmarshal` per frame on the connection goroutine,
  as today; no double decode, no boxing in the 60 Hz path. `netproto.CheckHeader` gives every
  game the generic checks (finite `ts`, chat id range).
- **Protocol version.** Per game (`Kit.Version()`); Dogfight stays 2.
- **seq/ack.** Client `seq` from 1 on inputs; snapshots carry `ack` = last applied seq per player.
  A game's snapshot implements `Acker` (and `wsconn.Replaceable`/`Carrier` if it may be evicted).
- **Snapshot convention.** A snapshot message starts `{"t":"snap","tick":N` (the load-test fast
  path and the client clock rely on `tick`). Documented in `netproto`, not enforced.
- **Error codes [D6].** One registry: `netproto` owns the core error codes (`version`, `no_room`,
  `bad_room`, `full`, `bad_msg`, `no_create`, `busy`, `creates`, `joins`, `flood`, `conns`,
  `timeout`, `updating`) and API codes (`stats_off`, `bad_period`, `not_found`, `rate`); a game
  registers its notice codes (Dogfight: `team_*`) through `netproto.NewCodes(notices...)`, which
  refuses duplicates and collisions with core codes. Wire `msg` texts stay the server's Turkish
  texts (kept for old clients), owned by `core/server`. The client mirrors the lists
  (`client/src/core/net/codes.ts` for core, `client/src/net/codes.ts` for game notices); a Go
  test keeps both files equal to the registry.
- **Chat presets.** Ids only on the wire (1..`ChatMax`); texts are client i18n. Scope is the
  game's (`ChatScope`).
- **Room and lobby messages, quick play, drain.** `create` (game payload), `join` (`code`),
  `quick` (no payload) are core handshake types; quick play falls back to `Kit.QuickSettings`.
  Drain closes new and ending sockets with 1012 + the `updating` reason, `/api/*` answers 503.

## 6. Lobby, server, metrics, stats (Go)

**Lobby** (`core/lobby`) is generic over settings `S` and the room's type parameters, built with
a factory `New func(S) (room.Game[M, In, X], error)` and a `room.Options` template. Codes,
reservations, max rooms, drain, quick pick (most humans first, then newest, free seat), flush and
`Wait` are unchanged. `Summary[X]` replaces today's flat summary; `X` for Dogfight is
`match.Info{Mode, Map, Weather, Phase, LeftS, NATO, Soviet}`.

**Server** (`core/server`) is generic over the same parameters plus a game adapter:

```go
type Msg[M, In any] interface {
	room.Msg[In]
	Latch(dropped M) M // one-shot presses of an input dropped over its rate
}

type Kit[S, M, X any] interface {
	Version() int
	Decode(b []byte) (M, error)                // whole frame; the core reads Head()
	Settings(create M, now time.Time) (S, bool) // false = bad_room
	QuickSettings(now time.Time) S
	Class(t string) Class // rate class of a game message type: ClassAll or ClassChoice
	InRoom(m M) bool      // a game message allowed after the handshake (pick, team)
	Row(s room.Summary[X]) any // one /api/rooms row
}

type Stats interface { // nil = stats off (503)
	Ready() bool
	Periods() []string                  // allowed ?period= values
	Board(period string) []byte         // leaderboard body for an allowed period
	Me(pilotHash string) ([]byte, bool) // the caller's card body; false = {"pilot":null}
}
```

Handshake, per-address and per-/48 connection gates, create/join/join-fail/API rate limits,
the inbound guard (frame ceiling, input bucket that only drops, choice and ping buckets that
kick, shared bucket), reject log, CSP and security headers, static files and fingerprinting,
`/healthz`, `/api/rooms` (TTL cache), `/api/leaderboard` and `/api/me` (TTL cache per period,
token checked before hashing, dummy hash for bad tokens, one body for missing/unknown), drain
and `FlushStats` all stay in core, unchanged. `Limits` keeps its field names, so the flags in
`cmd/dogfight` do not change.

**Metrics [D7].** `metrics.New(namespace, statsDropped)`; Dogfight passes `"dogfight"`, so every
exposed name stays `dogfight_*` and the deploy scripts keep working. The owner suggested a `game`
label; it is deferred: each game runs as its own binary and container, so the namespace already
separates them, and a label would change every exposed line (the deploy scripts match
`$1 == "dogfight_conns"`). A label becomes useful only if one process ever hosts two games.

**Stats.** `internal/stats` stays in Dogfight (§2, §11). The core's seams are the game-side tally
(§4) and the server's `Stats` interface, which takes bodies the game builds, so `/api/*` bytes
stay identical.

**Load test.** `core/loadtest` keeps the plan (slots, ramp, URL), histograms, rate lines, summary,
disconnect reasons and the dial/handshake/read/send loop; a game supplies a `Script` (hello,
create entry, 60 Hz input, reaction to a received message). `cmd/loadtest` keeps its flags and
output.

## 7. Generics vs interfaces, per boundary [D8]

| boundary | choice | reason |
|---|---|---|
| tick input (`In`) | type parameter with a self-referential constraint `Input[In]` | values in a per-seat ring at 60 Hz: no boxing, latch/held typed and inlinable |
| client message (`M`) | type parameter, constraint `Msg`/`server.Msg` | flows connection goroutine → room by value through a channel, as today |
| game behaviour (`Game`, `Kit`) | interfaces (generic interfaces) | polymorphism of behaviour; one implementation per game; fakes in tests |
| lobby summary extension (`X`) | type parameter on `Summary[X]` | typed `/api/rooms` rows without assertions; copied by value |
| outbound messages | `any` | wsconn already encodes `any`; snapshots opt into `Acker`, `Replaceable`, `Carrier` interfaces |
| stats API | interface returning JSON bodies | the schema is the game's; the core only caches and serves |
| room factory | `func` value | one method; a func is the smallest interface |
| error codes | data (registry struct) | nothing to dispatch |

Dogfight hides the instantiations behind aliases (`match.Room`, `match.Lobby`, `front.Server`),
so call sites read like today. Type parameters never leak into Dogfight's packages beyond those
aliases.

## 8. Concurrency ownership

- **Room goroutine:** every `Game` method, the input queues, sessions, chat cooldowns. The game
  must not block (no I/O; the stats sink's `Record` stays non-blocking), not start goroutines and
  not keep the `Outbox`.
- **Connection goroutine (one per socket):** `Kit.Decode`, `Kit.Class`, `Kit.InRoom`,
  `Kit.Settings`, `Msg.Latch`, the guard and latch state. These must be pure (no shared state).
- **Handshake goroutine:** the lobby factory (`New(S)`) runs outside the lobby lock, as `game.New`
  does today; it must not touch shared state.
- **HTTP goroutines:** `Kit.Row` on `Summary` copies; `Stats` methods must be safe for concurrent
  use (`stats.Slot` is).
- **Cross-goroutine state:** only the summary (`atomic.Pointer`), the lobby map (mutex, as today),
  metrics (atomics) and channels. No new shared state, no globals.

## 9. Compatibility guarantees

1. **Wire byte-identical [D9].** Before any refactor, characterization ("golden") tests freeze:
   per-session transcripts of real rooms (welcome, snapshots, players, round, pong, chat, notices)
   for three seeded scenarios, driven through the public room API under `testing/synctest`; the
   stats deltas those rooms record; handshake error frames and close codes; `/api/*` bodies;
   `/healthz`; security headers; the metrics exposition. Snapshots are stored as hashes (size),
   small messages in full. Later tasks may not regenerate a golden file; a mismatch is a bug in
   the task. Golden files are tagged with the `GOARCH` they were produced on (float results may
   differ across architectures through FMA); on another architecture the tests check determinism
   only and say so.
2. **Client byte-identical outbound.** A golden test freezes the exact strings the socket writes
   (hello, create, join on reconnect after 1012, ping, inputs through the shaper with one-shot
   merges, gapped picks) and the predictor's/interpolator's numeric output for a fixed scenario
   (`assert.deepStrictEqual`, no tolerance).
3. **No behaviour change.** Existing tests move with their code; none is deleted without a
   replacement. The room republishes its summary after a game message only when the game says so
   (`Outbox.Changed`), exactly when it does today (a successful team switch); log lines keep their
   keys (`mode` comes from `Game.Label`).
4. **Deploy unchanged.** `deploy/`, `scripts/`, flags, metric names, container names, storage
   keys and the release binary path are untouched. The reproducible `Dockerfile` gains one line
   (`COPY core/ core/`); a test asserts that every top-level Go source directory the server
   builds from is copied.
5. **Import rules (tests).** `core/**` imports only the standard library, `coder/websocket` and
   `core/**`; `client/src/core/**` imports only `client/src/core/**` (no `three`).

## 10. How the second game consumes core [D10]

**Stage 1 (this plan):** `core/` and `client/src/core/` in this repo.

**Stage 2 (first task of the F1 plan):** the repo becomes a monorepo:

```
arcade/                          GitHub rename of ahmetbir/dogfight (old URLs redirect)
  go.mod                         one module (path `playground` kept; renaming it is a separate mechanical change)
  core/                          Go core, unchanged
  core/client/                   TS core (moved from client/src/core), its own tsconfig for `tsc --noEmit`
  games/dogfight/                cmd/, internal/, client/, deploy/, Dockerfile*, testdata/
  games/f1/                      cmd/f1, internal/…, client/, deploy/
  package.json                   one shared toolchain (three, esbuild, typescript): build:dogfight, build:f1, test
  scripts/                       release.sh/deploy.sh taking the game (APP) as argument
```

- **Go:** one module, no `go.work`. F1 imports `playground/core/room` etc. Go's `internal/` rule
  then enforces game isolation for free: `games/f1/...` cannot import
  `games/dogfight/internal/...`, and core cannot import either.
- **Client:** game sources import core with relative paths (`../../../core/client/src/net/socket.ts`);
  esbuild bundles them into each game's single `app.js`; `node --test` and `tsc` resolve relative
  imports without configuration. No npm package, no new dependency.
- **Build/deploy:** one Dockerfile per game copying `core/` and its own tree; one container,
  compose project, data volume and nginx vhost per game; scripts take the game name where they now
  hard-code `dogfight`.
- **Separate module later?** Only if a consumer outside the monorepo appears. Then
  `core/go.mod` (`github.com/ahmetbir/arcade/core`) with tags; that needs an owner ruling on the
  single-dependency rule.

## 11. What not to extract yet (rule of three) [D11]

Kept in Dogfight until F1 shows the second shape:

- **Stats schema and store** (`internal/stats`): a racing pilot card has laps, best lap, podiums.
  Candidate later: `core/ledger[D, R]`, a journaled, single-writer store of game-typed deltas
  folded into game-typed records, with the lock/handoff/compaction mechanics from today's store.
- **Round/phase lifecycle and scoreboard** (`game.Round`, `mode`): different per genre.
- **Bot framework** (`internal/bot`), **world model** (`sim`, `geom`, `terrain`, `maps`, `weather`).
- **Team concept**: only Dogfight has teams so far.
- **Client:** settings menu, schemes, touch layout and tilt, HUD, rooms/leaderboard screens,
  render/Three.js scene, replay/spectate/killcam, procedural jet audio. The settings *shell* is
  not extracted: around Dogfight's rows it is an overlay with click-outside-to-resume (a few
  lines); a module waits for F1's menu to show what the two share. The key-binding *framework*
  moves only as key labels (`keyName`, `keys`, `KeyRow`); bindings and schemes stay. The book
  moves only its modal key handling (`tabMove`, `trapIndex`).
- **Generic but single-use client helpers** (`api.ts` fetch helper, `ChatThrottle`, `link.ts`,
  book `kit.ts`): identified in §2, moved when F1 is their second user.
- **Deploy scripts:** parameterise with the F1 deploy, not now.

## 12. Risks

| risk | mitigation |
|---|---|
| Golden tests are not deterministic (map order, timers), so they guard nothing | each golden test runs its scenario twice and requires equal transcripts before comparing with the file; synctest fixes time |
| Arch-dependent floats make golden files fail elsewhere | `GOARCH`-tagged files; other arch → determinism check only, explicit skip message |
| Generic room changes message order inside a tick | the order moves as code into `match.Step`; transcripts compare every message in order |
| Server test suite relies on unexported fields | black-box tests move to `internal/front` as integration tests; unit tests of unexported helpers stay in `core/server`; core gets a fake-game smoke suite |
| Typed-nil `Stats` interface when stats are off | `front.NewStats(nil)` returns a nil interface; test |
| Predictor float drift after generification | numeric golden with exact equality; the flight smoother keeps today's expressions in today's order |
| Users lose settings when storage helpers move | store helper takes the full key prefix; test asserts every key string |
| Too many type parameters make code unreadable | aliases in Dogfight; core constraint names document intent |
| Work stalls halfway | every task leaves main green and deployable; phases are independently useful |

## 13. Decisions

- **[D1]** `core/` in this repo and module now; monorepo `arcade` as the first F1 task; separate module only on demand.
- **[D2]** The room actor stays one goroutine owning the game; the game sees an `Outbox`, never connections.
- **[D3]** No round lifecycle hooks in core; rounds are inside `Game.Step`.
- **[D4]** Wire stays flat JSON with `"t"`; core/game split by field, not by envelope nesting.
- **[D5]** The game decodes the whole frame; core reads `Head()`; one decode per frame.
- **[D6]** One error-code registry in `netproto`; games add notice codes; client mirrors, tested.
- **[D7]** Metrics namespace per game (`dogfight`); no `game` label now.
- **[D8]** Type parameters for values on hot paths (`In`, `M`, `X`); interfaces for behaviour (`Game`, `Kit`, `Stats`).
- **[D9]** Golden transcripts frozen first; no later task regenerates them.
- **[D10]** Second game: monorepo, one module, relative TS imports bundled by esbuild.
- **[D11]** Stats schema, rounds, teams, bots, world, game UI stay in Dogfight until F1.
- **[D12]** `deploy/` and `scripts/` untouched; only the Dockerfile gains `COPY core/ core/`.
