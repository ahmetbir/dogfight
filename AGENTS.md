# AGENTS.md

Notes for coding agents and new contributors: how this repo is laid out, how to run it, how to
test it without a browser, and the invariants that are easy to break. It complements
[README.md](README.md); where the README already has the full list (flags, controls, deploy), this
file links to it instead of repeating it.

## What this is

A browser multiplayer jet dogfight. A Go server is the only authority over the game (60 Hz
simulation); a TypeScript + Three.js client is bundled by esbuild and embedded into the Go binary
(`cmd/dogfight/web`, Go `embed`), so the server ships as one file. Go module path: `playground`.

### Map of the tree

| Path | What lives there |
|---|---|
| `core/` | Game-agnostic Go multiplayer stack: `wsconn`, `limit`, `pilot`, `metrics`, `netproto`, `room`, `lobby`, `server`, `drain`, `loadtest`; test doubles in `core/internal/fakegame`, `fakekit` |
| `internal/match` | Dogfight as a `room.Game` (room adapter, stats tally, notices) |
| `internal/front` | Dogfight's `server.Kit` (protocol version, decode, rate classes, room settings) and stats API |
| `internal/protocol` | Dogfight's JSON messages and conversions |
| `internal/game`, `mode`, `bot`, `sim`, `maps`, `terrain`, `weather`, `rng`, `geom` | The game itself: rules, bots, deterministic simulation, world generation |
| `internal/stats` | Pilot stats store (single-writer actor, JSONL journal + snapshot) |
| `internal/golden` | Frozen wire-format goldens and the core import-boundary tests |
| `cmd/dogfight` | Main: flags, HTTP server, embedded `web/`, signals, stats handoff |
| `cmd/loadtest` | WebSocket load generator and CPU bench (Dogfight's `loadtest.Script`) |
| `client/src/core` | Game-agnostic TS: reconnecting socket, shaper, prediction/reconcile, interpolation, i18n, store, UI shells |
| `client/src/*` | The game client: `net`, `predict`, `render`, `input`, `audio`, `ui`, `game`, `sim` (TS port of the flight model), `book`, `debug` |
| `testdata/vectors` | Flight, terrain and map vectors written by Go, replayed by the TS tests |
| `client/src/golden` | Client goldens: socket wire strings, prediction and interpolation numbers |
| `deploy/`, `scripts/` | Compose, sample nginx vhost, release/deploy/smoke scripts |
| `docs/superpowers/` | Design specs and implementation plans (mostly Turkish) |

### The one rule: core never imports game code

- `core/**` (tests included) imports only the standard library, `github.com/coder/websocket` and
  `core/**`. Enforced by `TestCoreImportsNothingFromDogfight` and `TestCoreAllowlistIsEmpty` in
  `internal/golden/boundary_test.go`. The allowlist is empty and must stay empty.
- `client/src/core/**` imports only `client/src/core/**` (no game modules, no `three`; `node:`
  imports only in tests). Enforced by `client/src/core/boundary.test.ts`.
- If core needs something from the game, add it to a core interface (`room.Game`, `server.Kit`,
  `loadtest.Script`, a TS policy/model type) and implement it on the game side.

## Setup

- **Go:** `go.mod` says `go 1.26`, `toolchain go1.26.8`. Let the go command fetch the toolchain;
  do not set `GOTOOLCHAIN=local` with an older Go. `scripts/release.sh` refuses any other
  version.
- **Node 22** is required. The client tests run `node --experimental-strip-types --test`; Node 20
  fails with `bad option: --experimental-strip-types`. If the system Node is older, unpack a Node
  22 release from nodejs.org into `.tools/node/` (gitignored; `scripts/release.sh` uses exactly
  that path) and put it first on `PATH` for client commands:

  ```sh
  export PATH="$PWD/.tools/node/bin:$PATH"   # from the repo root
  node --version                             # v22.x
  ```

- **Client deps:** `cd client && npm ci` (lockfile is committed). Runtime dependency: `three`;
  build tools: `esbuild`, `typescript`. Do not add dependencies casually; the Go side has exactly
  one (`coder/websocket`).
- **Git worktrees:** run `npm ci` in each worktree's own `client/`. Do not symlink `node_modules`
  from another checkout: `npm ci` (also run by `scripts/release.sh`) deletes and rebuilds
  `node_modules`.

## Run locally

See README [Run](README.md#run) and [Development](README.md#development). Short version:

```sh
cd client && npm run build && npm run watch   # terminal 1: DEBUG bundle, rebuilt on save
go run ./cmd/dogfight                         # terminal 2: http://localhost:8080
go run ./cmd/dogfight -lag 100ms              # artificial server-to-client latency
```

- `web/` is embedded: restart `go run` after the bundle changes. `npm run watch` rebuilds only
  `app.js`; after changes under `client/static/` run `npm run build` again.
- DEBUG builds have serverless or single-room test scenes: `?debug=fly`, `?debug=models`,
  `?debug=fx` (no server needed), `?debug=terrain`, `?debug=world&map=sehir&wx=gece&cam=base`
  (these two create a room on the running server). The console has `debugGame`.
- **Before committing, return `cmd/dogfight/web` to a production build** (`npm run build`,
  `DEBUG=false`). `cmd/dogfight/web/*` is gitignored, but goldens and anyone running the binary
  from your tree see what is there.

## Headless testing, cheapest first

All of this runs without a browser. Run the client commands with Node 22 on `PATH`.

### 1. Go unit tests

```sh
go vet ./... && go test ./... -short -count=1   # fast: skips the long match simulations
go test ./... -race -count=1                     # full, with the race detector
go test ./internal/game/ -run TestBalance -v -balance   # bot balance, slow, opt-in
```

### 2. Golden suite (`internal/golden`)

Characterization tests that freeze Dogfight's observable behaviour byte for byte:

- room transcripts per session for seeded FFA, team, Base Attack and round-end scenarios, driven
  through the public room API under `testing/synctest` (`room_*.golden`);
- server WebSocket frames: handshake errors, close codes (`server_frames`), limit refusals
  (`server_limits`);
- `/api/*` bodies (`server_api`), routes with their status, security headers and cache policy
  (`server_routes`), and the Prometheus exposition (`metrics_text`).

Rules:

- Files are tagged by architecture: `<name>.arm64.golden`, plus `<name>.arm64-race.golden` where
  a race build reaches different floats (only `room_round` today). On another `GOARCH` the tests
  only check that two runs are identical and **skip** with a message saying so. A green run on
  amd64 therefore proves determinism, not wire compatibility; check on arm64.
- **Never regenerate a golden to make a test pass.** A mismatch writes the actual output to
  `$TMPDIR/golden-actual-<name>.txt` and names the first differing line: diff it and find the
  cause. Unintended wire changes break old clients and blue/green deploys.
- Only when a behaviour change is intended and reviewed, regenerate on arm64 in its own commit,
  and say why in the message:

  ```sh
  go test ./internal/golden/ -count=1 -update          # plain arm64 files
  go test ./internal/golden/ -count=1 -race -update    # writes a -race file only where it differs
  git diff --stat internal/golden/testdata              # review every changed line
  ```

  (The flag's help text says "Phase 0 tasks only": that was the freeze. Treat any later update as
  an owner decision, not a fix.)
- Client goldens (`client/src/golden/*.json`: socket wire strings, prediction and interpolation
  numbers, compared with `deepStrictEqual`, no tolerance) follow the same rule. They are written
  only with `UPDATE_GOLDEN=1 npm test`.

### 3. Go to TS shared vectors

Go writes `testdata/vectors/{flight,terrain,maps}.json`; the TS tests replay them.

- Tolerances: TS flight vs Go `1e-3`; Go self-check `1e-6` (arm64 fuses multiply-add, amd64 does
  not); TS terrain heights `1e-9`.
- `TestV1VectorCheckpointsFrozen` (`internal/sim/vectors_frozen_test.go`) pins a SHA-256 of the first ten (v1) flight scenarios'
  checkpoints. If it fails, the air path of the flight model drifted; that is a behaviour change,
  not a stale file.
- After an intended sim change, regenerate and then run the TS side:

  ```sh
  go test ./internal/sim/ -run TestFlightVectors -update
  go test ./internal/terrain/ -run TestTerrainVectors -update
  go test ./internal/protocol/ -run TestMapVectors -update
  ```

  The flight model exists twice (`internal/sim/flight.go`, `client/src/sim/flight.ts`): change
  both, in the same commit.

### 4. Client

```sh
cd client && npm run check && npm test && npm run build   # tsc --noEmit, node --test, production bundle
```

### 5. CPU bench (no network)

```sh
go run ./cmd/loadtest -bench    # one all-bot room's tick + snapshot encoding on this CPU
```

### 6. End-to-end: real server, real handshakes

```sh
scripts/smoke.sh                               # 4 players, 10 s
PLAYERS=8 DURATION=30s scripts/smoke.sh
SERVER_ARGS="-lag 100ms" scripts/smoke.sh      # same, with server-to-client latency
```

It builds `cmd/dogfight` and `cmd/loadtest` into a temp dir, starts the server on a free
loopback port with raised per-address limits (one machine looks like one abuser otherwise),
waits for `/healthz`, runs `cmd/loadtest` (bots doing hello, create/join, 60 Hz input with
weapons, pings, reading every message), and fails unless the summary shows `disconnects: none`,
`gaps=0` in the snapshot interval line and every player connected in the steady window. A trap
kills only the server PID it started and removes its temp files. Needs only `go` and `curl`.

For bigger runs use `cmd/loadtest` directly (README [Load test](README.md#load-test)); only
against your own test instance, never a public deployment.

### 7. Browser checks

Use the DEBUG scenes above, and whatever browser automation you have locally (Playwright, a
headless Chrome over CDP) pointed at `http://localhost:8080`. Do not add browser test
dependencies to this repo.

## Invariants and gotchas

### Concurrency

- **A room is one actor goroutine.** It owns the `Game`; every `room.Game` method runs on it and
  must not block, do I/O, start goroutines or keep the `Outbox` (`core/room/game.go`). The stats
  sink's `Record` must not block.
- **Nothing blocks the room on a client.** `wsconn.Conn.Send` never blocks: the outbound queue
  holds 64 messages; when full, the oldest snapshot is evicted (its events carried into the next,
  `wsconn.Carrier`); other messages are never evicted; a queue full for 2 s closes the connection.
  `Conn.Close` never blocks and is safe from any goroutine. `Conn.Wait` blocks: never call it on
  an actor goroutine.
- `server.Kit` methods and `Msg.Latch` run on connection and HTTP goroutines: keep them pure.
- Cross-goroutine state is limited to the room summary (atomic pointer), the lobby map (mutex),
  metrics (atomics) and channels. No globals.

### Determinism

- Fixed 60 Hz tick (`room.DefaultTickRate`); snapshots every 2 ticks = 30 Hz
  (`match.SnapEvery`).
- The sim's only randomness is `sim.RNG` (splitmix64) seeded from the room's settings; maps and
  weather use `internal/rng`. The room seed comes from the clock once, at creation, outside the
  sim. No `time.Now`, no goroutines and no map-order iteration inside `internal/sim`, `game`,
  `mode`, `bot`: the world iterates planes through a sorted ID slice.
- The room broadcasts by ranging over a map, so only the order within one session is defined; the
  goldens record sessions separately for that reason.
- Goldens and vectors depend on all of this. Float results differ between arm64 and amd64 (FMA),
  which is why goldens are per-architecture.

### Netcode

- The server is authoritative; the client sends only input (clamped, NaN/Inf neutralized
  server-side).
- The client predicts its own plane and reconciles on each snapshot: unacknowledged inputs are
  replayed (`client/src/core/predict/reconcile.ts`, baseline = median offset over ~30 snapshots),
  corrections are smoothed with a 0.1 s time constant and corrections over 50 m snap
  (`client/src/predict/predictor.ts`). Other planes are interpolated 100 ms behind
  (`INTERP_DELAY_MS`).
- **Instant mocks hide ordering races.** Netcode that passes with zero-latency fakes can still
  fail under real delay. Test it with latency: `client/src/predict/converge.test.ts` and
  `jitter.test.ts` (delay steps, stalls, bursty delivery), and `SERVER_ARGS="-lag 100ms"
  scripts/smoke.sh` against a real server.

### Rate limits

Server (`core/server/guard.go`, `inbound.go`, defaults in `server.go`):

- Inputs (`in`) have their own bucket (90/s, burst 120) and are only ever **dropped** over rate,
  never kicked; a dropped input's one-shot presses carry over to the next one.
- `ping`: 2/s, burst 4, then the shared bucket. Game types with `ClassChoice` (Dogfight's
  `pick` and `team`): 2/s, burst 4, then the shared bucket. Everything else but `in`: the shared bucket
  (90/s, burst 120). Refusal by any of these closes the connection with code `flood`.
- Hard ceiling before decoding: more than 300 messages/s or 64 KB/s averaged over 5 s ends the
  connection. Inbound frames are capped at 2048 bytes (`wsconn` read limit).

Client (`client/src/core/net/shaper.ts`, Dogfight policy `client/src/net/shaper.ts`): while the
socket has more than 8 KB buffered or the server has been silent for 1 s, only the newest input
is held; picks go out at most every 500 ms; pings every 15 s (server idle-closes at 30 s);
chat through `ChatThrottle`.

**Adding a client message type:** give it a rate class in `internal/front` (`Kit.Class`), allow
it in `Kit.InRoom` if it is sent in a room, and make the client send it no faster than its
bucket; otherwise players get kicked with `flood`. Core types (`hello`, `create`, `join`,
`quick`, `in`, `ping`, `chat`) are rated by core and a game cannot reclassify them.

### Error codes and texts

- Error codes are stable strings shared by Go and TS: `core/netproto/codes.go` and
  `client/src/core/net/codes.ts` (error and API codes), game notice codes in
  `internal/protocol/codes.go` and `client/src/net/codes.ts`. Pinned by
  `TestErrorCodesMatchClientCore` (`core/netproto/crosslang_test.go`) and
  `TestNoticeCodesMatchClient` (`internal/protocol/codes_test.go`). Other cross-language pins:
  `TestWelcomeMatchesClientCore`, `TestRestartCodeMatchesClientCore`,
  `TestPingIntervalUnderIdleTimeout`, `TestQueueSizesMatchClientCore`.
- **Never rename or reuse a code**; add new ones. The client shows its own i18n text by code
  (`client/src/i18n/{tr,en}/errors.ts`). The server's `msg` texts stay Turkish for old clients
  that predate codes; do not translate them.

### Wire compatibility across deploys

- Blue/green keeps already-open tabs on the old server until it drains; then they reconnect to
  the new one with their old bundle. Protocol changes must be backward compatible (add optional
  fields, never repurpose one), or bump the protocol version: `internal/protocol.Version`
  (returned by `front.Kit.Version`) and `VERSION` in `client/src/net/protocol.ts`, together. A
  hello with any other version is refused with code `version` ("reload the page").
- The goldens are the safety net for this; see the golden rules above.

### Static assets and caching

- `client/static/index.html` references fixed names (`/app.js`, `/style.css`, `/hud.css`,
  `/mobile.css`). The server rewrites them to content-hashed URLs (`/app.js?v=<sha256 prefix>`)
  when serving the page (`core/server/assets.go`). Versioned URLs are served `immutable`, bare
  names `no-cache`.
- A CDN may apply its own browser cache TTL to fixed names regardless of `no-cache`, so a bundle
  referenced without the hash can stay stale for hours. A new bundle file must be added to the
  `bundle` list in `core/server/assets.go`, and referenced in `index.html` exactly as
  `"/<name>"` (double quotes, leading slash) or it will not be fingerprinted.

### Drain and blue/green

- `SIGUSR1` drains: rooms keep playing, open stats tallies are flushed, the stats store writes its
  final snapshot and releases `stats.lock` at once, new sockets are closed with `1012`
  ("server restarting"), `/api/*` answers 503; the process exits when the last game socket
  closes or after `-drain-max`. `SIGUSR2` undrains (rollback). See `core/drain/drain.go`.
- The client treats `1012` as "updating" and rejoins the same room code.
- An nginx reload keeps open WebSockets on the old workers only if `worker_shutdown_timeout` is
  not set; with it set, a reload cuts long-lived sockets.

### Security posture (lives in core; a game cannot override it)

- WebSocket origin check by the library, never skipped (`-origin`, empty = same host).
- `X-Real-IP` is trusted only from `-trust-proxy` CIDRs; in the sample deploy that is the edge
  docker network's subnet only.
- Per-address limits key on one IPv4 address or one IPv6 /64; all /64s of a /48 share an
  aggregate socket cap (`core/server/clientip.go`, `conngate.go`).
- `/api/me` answers the same `{"pilot":null}` for a missing, invalid, unknown or oversized
  token. The server keeps only the token's SHA-256; the raw token never reaches logs, metrics,
  URLs or disk (`core/pilot`).
- Never commit `deploy/deploy.env`, `.env*`, keys or certificates (`.gitignore` covers
  `*.pem`, `*.key`). Use `deploy/deploy.env.example` placeholders in docs and examples.

### Build, release, deploy

- `scripts/release.sh` refuses a dirty tree and any Go other than the `toolchain` in `go.mod`,
  needs Node 22 at `.tools/node/bin`, runs `npm ci && npm run build`, and writes
  `dist/dogfight-linux-arm64` and `dist/VERSION`.
- Deploy: README [Deployment](README.md#deployment). All host-specific settings come from the
  gitignored `deploy/deploy.env`; `scripts/deploy.sh` stops if it is missing.
- `TestDockerfileCopiesEveryGoDir` fails if a new top-level Go directory is not `COPY`'d in the
  `Dockerfile`.

### Input

- Mouse aim: missile is right click or `E`. On a Mac trackpad, two-finger click or ctrl+click
  also fires a missile (`client/src/input/input.ts`). Key lists in the settings menu and the
  pilot's manual are generated from `client/src/input/bindings.ts`; change bindings there.

## How to make a change

1. Small, focused commits; one purpose per PR.
2. Keep goldens green. A golden or frozen-hash failure is a finding, not a chore.
3. Before pushing:

   ```sh
   go vet ./... && go test ./... -race -count=1
   (cd client && npm run check && npm test && npm run build)
   scripts/smoke.sh
   ```

4. Sim changes: update Go and TS together and regenerate the vectors (above).
5. Behaviour, flags or limits changed: update README and this file in the same change. Gameplay
   numbers quoted by the pilot's manual are kept in sync by tests.
6. Design records: `docs/superpowers/specs/` (designs, each ending in a decisions section) and
   `docs/superpowers/plans/` (task-by-task plans).

### Adding a second game on core

Read `docs/superpowers/specs/2026-10-07-core-extraction-design.md` (sections 4 to 10 and 13).
In short, a game provides:

- a `room.Game` (`core/room/game.go`) for one match;
- a `server.Kit` (`core/server/kit.go`): protocol version, decode, room settings, rate classes,
  in-room messages, lobby row; optionally a `server.Stats`;
- a `loadtest.Script` (`core/loadtest/run.go`) for `cmd/loadtest`-style tests;
- on the client, instances of `client/src/core`: `Socket` with its `{ version, policy }`, a
  `ShaperPolicy`, `Reconciler` with its `Model`, `InterpBuffer`, i18n and UI shells.

Stats schema, rounds, teams, bots, world model and game UI deliberately stay out of core until a
second game shows what is shared (spec section 11).

## Where the know-how lives

- **Design decisions and rulings:** `docs/superpowers/specs/` (the "Decisions"/"Kararlar"
  section at the end of each spec) and the plans in `docs/superpowers/plans/`.
- **Behavioural contracts:** the tests named above (boundary, golden, cross-language, vectors,
  frozen hash) and code comments at the definitions.
- **Operational gotchas:** this file. If you learn something the hard way, add it here.
