# roomkit: the shared core as its own repository

Date: 2026-10-07 · Status: approved in conversation · Supersedes [D1] and [D10] of
`2026-10-07-core-extraction-design.md`

Owner decisions (conversation, 2026-10-07): the shared core leaves this repo and becomes its own
repository, imported by each game as a framework; every game is its own repo (portfolio). Name:
`roomkit` — deliberately modest, the big name is kept for a future engine. No git submodule.
No repo creation, push, tag or release on weekdays 09:00–18:00 Europe/Istanbul: work is done
locally and published after 18:00. Contents approved as listed in §2.

## 1. Goal

`github.com/ahmetbir/roomkit` holds what `core/` and `client/src/core/` hold today. Dogfight
consumes it as a tagged dependency and keeps its wire, behaviour, goldens and deploy unchanged.
The F1 game (separate spec) is the second consumer. Four seams F1 needs are added in v0.2.0 (§5).

**Success criterion.** (1) roomkit's own tests pass (Go unit + fake-game suites, TS tests, dist
check); (2) Dogfight with `core/` and `client/src/core/` deleted passes every golden, unit, client
and smoke test unchanged, against roomkit v0.1.0 and again against v0.2.0; (3) the published
Dogfight is deployed from a commit that pins tagged roomkit versions (no `replace`, no `file:`).

## 2. Layout

```
roomkit/                     github.com/ahmetbir/roomkit, MIT
  go.mod                     module github.com/ahmetbir/roomkit; requires only coder/websocket
  wsconn/ limit/ pilot/ metrics/ netproto/ room/ lobby/ server/ drain/ loadtest/
  internal/tsconst/ internal/fakegame/ internal/fakekit/
  package.json               name "roomkit", type module, exports "./*" → dist/*.js + dist/*.d.ts
  tsconfig.json              rewriteRelativeImportExtensions, declaration, outDir dist
  ts/                        the TS core (moved from client/src/core), tests beside the sources
  dist/                      compiled JS + .d.ts, COMMITTED (see below)
  scripts/check.sh           go vet+test, npm test, tsc, dist is current, import rules
  AGENTS.md CLAUDE.md README.md LICENSE
```

Go packages move verbatim; only import paths change (`playground/core/x` →
`github.com/ahmetbir/roomkit/x`) and `tsconst` reads `ts/` instead of `client/src/core`.

**TS is shipped compiled [R1].** Node refuses to strip types from files under `node_modules`, so a
consumer's `node --test` could not import roomkit's `.ts`. roomkit commits `dist/` built by
`tsc` (`rewriteRelativeImportExtensions` turns `./x.ts` into `./x.js`); `scripts/check.sh`
rebuilds into a temp dir and fails if it differs from the committed `dist/`. Consumers import
`roomkit/net/socket` (resolved through `exports`), esbuild bundles it. Rejected: an npm `prepare`
build on install (slow, needs the dev toolchain inside every consumer build, fragile in Docker).

**Fresh history [R2].** The repo starts with one commit "extracted from dogfight @ <sha>"; the
history stays readable in Dogfight's repo. (`git subtree split` cannot merge two prefixes into one
tree without rewriting tools that are not installed; the extracted history is ~30 commits of a
public repo anyway.)

**Import rules.** roomkit's go.mod has one requirement, so Go code cannot import a game; a test
keeps `ts/**` importing only `ts/**` (no `three`), moved from `client/src/core/boundary.test.ts`.
Dogfight's `coreAllow` test is deleted together with `core/`; the compiler now enforces it.

## 3. Consumption

- **Go:** `require github.com/ahmetbir/roomkit vX.Y.Z`. Local development before a tag exists: a
  `replace github.com/ahmetbir/roomkit => ../roomkit` line on a local branch only; the commit that
  is pushed pins the tag. `scripts/release.sh` refuses a go.mod with a `replace` and sets
  `GOWORK=off`, so a stray `go.work` can never put unreleased core code into a release.
- **TS:** `"roomkit": "github:ahmetbir/roomkit#vX.Y.Z"` in `client/package.json` (lockfile pins
  the commit). Local: `file:../roomkit` on the same local branch only.
- **Dockerfile:** `COPY core/ core/` goes; the module is fetched by `go mod download`, the client
  dependency by `npm ci` (both need network, as `three` already does).
- **Changing core:** edit roomkit, test it, tag, bump in each game. While iterating, the local
  `replace`/`file:` pair.

## 4. Versions

- **v0.1.0** — pure extraction: identical behaviour; Dogfight's goldens unchanged.
- **v0.2.0** — the F1 seams (§5); Dogfight adapts without any wire change, goldens unchanged.

## 5. v0.2.0: seams for the second game

From the core-extraction final review (M8):

1. **Room settings in the list.** Already possible: create payload → `Kit.Settings` → `S`; the
   list shows the game's `Summary.Game` through `Kit.Row`. No change.
2. **Refusal reasons.** `room.Refuse(code string) error` returns a `*room.Refusal`; a game's
   `Join` may return it (e.g. F1: `racing` — a race is running). The server answers
   `{"t":"error","code":code,"msg":code}` and closes 1008, like other handshake errors; quick play
   treats a refusal like `full` (try the next room, else create). `room.ErrFull` stays. A game's
   refusal codes join its notice-code collision test.
3. **Leaderboard keys.** `Stats.Periods()` becomes `Stats.Boards() []BoardID` with
   `BoardID{Period, Key string}`; `Board(id BoardID) []byte`. Query: `?period=…&key=…`, key absent
   = `""`; a pair not in the whitelist → 400 `bad_period` (unchanged body). Dogfight returns
   `{week,""}`, `{all,""}`: its URLs and bodies do not change. F1: per-track lap boards.
4. **Bots are reported, not inferred.** `room.Info` gains `Bots int`; the bot gauge reads it
   instead of `Seats - Humans`. `Seats` stays the capacity quick play compares against. Dogfight
   sets `Bots = Seats - Humans` (unchanged metrics); F1 reports its real grid.

## 6. Risks

| risk | mitigation |
|---|---|
| Committed `dist/` drifts from `ts/` | `check.sh` rebuild-and-diff; Dogfight's client goldens catch behavioural drift |
| A release built against a local core | release.sh refuses `replace`, sets `GOWORK=off` |
| tsc emit changes float expressions (predictor goldens) | target ES2022, no downlevel; Dogfight's exact-equality client goldens run against the compiled package |
| roomkit cannot be fetched before it is public | migration lives on a local branch until the 18:00 publish; deploy only after |
