# Dogfight

A 3D arcade multiplayer jet dogfight that runs in the browser. The server is written in Go and
is the only authority over the game (60 Hz simulation). The client is written in TypeScript with
Three.js; it is compiled and embedded into the Go binary, so the whole server ships as a single
file.

UI languages: Turkish and English (switch in settings).

Live demo: https://dogfight.ahmetbirinci.dev

## Features

- **17 jets:** nine NATO (F-16, F-15, F-22, F-14, A-10, Rafale, Typhoon, F/A-18, F-4) and eight
  Soviet (MiG-29, Su-27, Su-57, MiG-31, Su-25, MiG-21, Su-30, MiG-23), each with a role (light,
  all-rounder, 5th gen, interceptor, attack, ...) and its own speed, turn rates, hit points,
  missile and flare load, balanced by a bot round-robin. The pick screen is a hangar: cards with
  thumbnails of the models and a turning 3D preview with stat bars.
- **Weapons:** cannon (overheats on long bursts), missiles, flares; bombs in Base Attack.
- **Missile loadouts**, chosen on the aircraft pick screen:
  - **IR** (short range): fire-and-forget heat seekers. Flares can decoy them.
  - **Radar** (medium range, about 2.2× the IR lock range, half the missile count):
    semi-active, so the launcher must keep the target within 60° of its nose. No lock inside
    1 km. Flares do nothing; the target breaks the track by *beaming*: about 1 s with the
    missile at its 3 or 9 o'clock (within roughly ±18° at 250 m/s).
  - **Mixed** (*Karışık*): half the IR missiles plus one radar missile. `Q` (mouse) or `Z`
    (keyboard) picks the kind the missile key fires; the HUD frames the picked kind. When it runs
    out the other kind fires. Touch has no pick: radar beyond IR range, IR inside it.
  - The HUD warns of incoming missiles with their kind, distance and clock position, an arrow
    round the reticle toward the nearest one and a ringed red dot on the radar: a blinking `FLARE!`
    against an IR missile, `DİK UÇ!` ("beam it!") with the way to turn against a radar missile and
    a bar that fills while the beam holds (full: the track breaks).
    A lock on you before any missile is fired reads `KİLİTLENDİN` ("locked on").
- **Hit zones:** every missile and gun hit rolls where it struck: a critical hit downs the plane
  outright (15 % of missile hits, 0.5 % of rounds), engine, controls and avionics hits leave
  lasting damage (lower top speed, slower turns, slower locks) until a new life, a rearm or the
  repair power-up. The HUD lights the damaged parts.
- **Afterburner heat:** about 15 s of continuous afterburner, then a lockout while it cools down.
- **3 power-ups:** missiles, repair, turbo.
- **3 game modes:** team deathmatch, free-for-all (FFA) and **Base Attack** (destroy the enemy
  base's 6 structures, or have more structure HP left when the 10-minute round ends).
- **Bots** at three difficulties (easy, normal, hard). Bots take off from the runway, land and
  rearm. Empty seats in a room are filled with bots.
- **4 procedural maps** (seeded): Island, City, Desert, Mountain.
- **6 weather types:** Clear, Cloudy, Fog, Rain, Storm, Night. Wind affects flight; bad weather
  shortens the missile lock range.
- **Two starts:** **Air** (default; the teams spawn at opposite ends of the map) or **Runway**
  (spawn in the hangar, taxi and take off).
- Landing gear, wheel brake and taxiing; land at your own base and come to a stop to rearm and
  repair in 3 s.
- Room list, **Quick Play** (joins a suitable public room or creates one), public / private rooms,
  share links (`/r/CODE`).
- **Lobby** for created rooms: the room waits until its host presses **Start**. Everyone who comes
  by the link picks a side (NATO / Soviet; friends may all take one side against bots, otherwise a
  side may be at most one human ahead) and an aircraft; bots fill the empty seats on Start. After
  each round the room returns to the lobby with sides kept. Late joiners enter a running round as
  before; Quick Play rooms start at once.
- Quick chat: 6 canned messages (keys 1–6; team-only in team modes). No free text.
- Persistent pilot card (anonymous token, no account) and a weekly / all-time leaderboard.
- **Pilot's manual** (*Pilot El Kitabı*): an in-game book with chapters on getting started,
  controls, flight, ground handling, weapons, HUD, game modes, the world and tips. It opens from
  the home page and from the in-game menu, and quotes gameplay numbers that tests keep in sync
  with the server.
- **Connection indicator:** signal bars under the score line (good / fair / poor / lost from
  the round-trip time, server silence and lost snapshots; the RTT in ms on hover or tap, and
  always when the link is not good) and a "connection unstable" banner after
  1 s without server traffic. While inputs cannot reach the server, the own plane is predicted on
  the last input the server got, and the correction after a stall is drawn as a glide instead of
  a jump.
- Mobile: landscape touch stick, throttle and buttons; optional tilt aiming.
- Missile camera (picture-in-picture), killcam, spectator mode and a replay of the last 10 s.
- Procedural jet audio (engine, afterburner, wind) and low-poly models (custom `.glb` models are
  supported).

## Requirements

- Go 1.26 (see `go.mod`).
- Node 22 and npm, only to build the client.
- A current browser with WebGL (Chrome, Firefox, Safari).

The Go side has one external dependency, `github.com/coder/websocket`. The client's only runtime
dependency is `three`; its build tools are `esbuild` and `typescript`.

## Build

```sh
cd client && npm install && npm run build   # writes cmd/dogfight/web/ (DEBUG=false)
cd .. && go build ./cmd/dogfight            # single binary with the client embedded: ./dogfight
```

`npm run build`:
- bundles `client/src` with esbuild into `cmd/dogfight/web/app.js` (minified, no source map;
  a stale `app.js.map` left by `watch` is removed),
- copies everything under `client/static/` (`index.html`, `style.css`, `favicon.svg`, `models/`)
  into `cmd/dogfight/web/`,
- writes `cmd/dogfight/web/models/manifest.json`.

A server built without the client says so on its home page.

## Run

```sh
go run ./cmd/dogfight                  # http://localhost:8080
go run ./cmd/dogfight -addr :9000      # another port
go run ./cmd/dogfight -lag 100ms       # test with artificial latency
```

Open `http://localhost:8080`, enter a name and create a room: it opens in the lobby. Send the room
code, or the `/r/CODE` link from the copy-link button, to a friend, pick sides and aircraft, and
press Start.

### Playing over a LAN

The server listens on all interfaces by default (`-addr :8080`). From another device on the same
network open `http://<machine-ip>:8080`, or the `http://<machine-ip>:8080/r/CODE` link directly.
Allow port 8080 in the firewall if needed. With `-origin` empty, the WebSocket is accepted only
from the host the page was loaded from, which is all a LAN needs.

### Flags

| Flag | Default | Description |
|---|---|---|
| `-addr` | `:8080` | Listen address |
| `-lag` | `0` | Artificial server-to-client latency (e.g. `100ms`); testing only |
| `-origin` | empty | Comma-separated allowed WebSocket origin hosts. Empty = same host only |
| `-trust-proxy` | empty | Comma-separated CIDRs of proxies whose `X-Real-IP` header is trusted. Empty = trust none |
| `-public-origin` | empty | Extra CSP `connect-src` sources (e.g. `wss://dogfight.example.com`) |
| `-log` | `text` | Log format: `text` or `json` |
| `-version` | | Print the build version and exit |
| `-healthcheck URL` | | GET the URL; exit 0 on 200, else 1 (container health probe) |
| `-get URL` | | GET the URL and print the body (at most 1 MiB); exit 0 on 200, else 1 (the distroless image has no curl) |
| `-max-rooms` | `16` | Rooms running at once (`0` = no limit) |
| `-max-conns` | `128` | Open game sockets, server-wide |
| `-max-conns-ip` | `6` | Open game sockets per client address |
| `-max-conns-net` | `24` | Open game sockets per IPv6 /48, all its addresses together |
| `-create-per-min-ip` | `3` | Room creations per address per minute |
| `-join-fail-per-min-ip` | `10` | Failed joins per address per minute |
| `-join-per-min-ip` | `20` | Successful joins per address per minute |
| `-msg-rate` | `90` | Inbound messages per second per connection |
| `-msg-burst` | `120` | Inbound message burst per connection (about 2 s of input) |
| `-data` | empty | Directory for pilot stats (`pilots.jsonl` journal, `pilots.snap.json` snapshot; directory 0700, files 0600). Empty = stats off. If the directory cannot be opened or written, the server logs `stats disabled` and the game runs without stats |
| `-metrics-addr` | empty | Listener for `GET /metrics` in Prometheus text format (e.g. `127.0.0.1:9090`). Empty = off. Never expose it publicly |
| `-drain-max` | `30m` | After `SIGUSR1` (drain), exit at the latest after this long; earlier once the last game socket closes |
| `-stats-wait` | `40m` | Wait at most this long for another server to release the `-data` lock (`stats.lock`), then `stats disabled` |

For the limit flags other than `-max-rooms`, `0` selects the default.

### HTTP API

`/api/*` endpoints (GET/HEAD only, JSON, `no-store`, a shared limit of 120 requests per minute per
address):
- `/api/rooms`: public rooms (cached 1 s).
- `/api/leaderboard?period=week|all`: top 20 (cached 10 s).
- `/api/me`: your own pilot card, given the `X-Pilot-Token` header; `{"pilot":null}` when the token
  is missing, invalid or unknown. With stats off, `leaderboard` and `me` answer 503.

Other routes: `/` (the client), `/r/{code}` (room link), `/healthz`, `/ws` (game socket).

### Signals

- `SIGINT` / `SIGTERM`: stop accepting connections, close the rooms, send close frames to players
  and exit within 9 s.
- `SIGUSR1`: **drain** (the old color in a blue/green deploy). Players in rooms keep playing; every
  new socket is closed with `1012` ("server restarting, reconnect") and `/api/*` answers 503. The
  stats store closes at once (final snapshot written, `stats.lock` released) so the new version's
  store can open. The server exits when the last game socket closes or after `-drain-max`; the
  remaining players then also get `1012`. On `1012` the client shows a reconnecting notice and
  rejoins the same room code; if the room does not exist on the new server, it offers to return
  to the home page.
- `SIGUSR2`: undo a drain (rollback): accept new players again and wait for the stats lock.

The stats store locks the `-data` directory with `flock`, so only one server writes it at a time.
A server started while the lock is held starts the game immediately; its store opens once the
lock is free. Until then scores wait in memory (at most 512 records).

## Controls

Pick the scheme in the settings menu (Esc). The default is mouse aim; touch devices start in the
touch scheme. Settings are stored in `localStorage`: scheme, mouse sensitivity, mouse as a lever,
inverted Y, G effects, performance mode, tilt aiming and sound. With *mouse as a lever* the aim
keeps its offset from the nose, so a mouse held off centre keeps the plane turning. Every key list (settings menu, pilot's manual)
is generated from `client/src/input/bindings.ts`.

**Mouse aim** (pointer lock; click the canvas to capture the mouse)

| Key | Action |
|---|---|
| Mouse | Aim. The autopilot turns the nose toward the cursor; the aim stays within a 60° cone around the nose |
| W / S | Throttle up / down |
| Shift | Afterburner |
| A / D | Extra roll, left / right |
| Left click | Cannon |
| Right click / E | Missile (needs a lock; on a Mac trackpad: two-finger click or ctrl+click) |
| Q | Missile kind: IR / radar (Mixed loadout) |
| Space | Flare |
| L | Landing gear up / down |
| B (hold) | Wheel brake |
| H / middle click | Bomb (Base Attack) |

**Keyboard**

| Key | Action |
|---|---|
| W / S | Pitch: W pushes the nose down (flight-sim convention); the "inverted Y" setting swaps it |
| A / D | Roll left / right |
| Q / E | Yaw left / right |
| R / F | Throttle up / down |
| X | Afterburner |
| Space | Cannon |
| V | Missile (needs a lock) |
| Z | Missile kind: IR / radar (Mixed loadout) |
| G | Flare |
| L | Landing gear up / down |
| B (hold) | Wheel brake |
| H | Bomb (Base Attack) |

**Both keyboard schemes**

| Key | Action |
|---|---|
| 1–6 | Quick chat: "I'm on your six!", "Need help!", "Attacking the target", "Returning to base", "OK", "Thanks" (one per 2 s) |
| C | Look back |
| Tab (hold) | Scoreboard |
| P | Aircraft pick. Applies at once during spawn protection, otherwise on the next spawn |
| Esc | Settings menu (also releases the pointer lock in mouse aim) |
| R | When shot down: start / skip the replay of the last 10 s (in the keyboard scheme, R is also throttle up while flying) |
| ← / → | While waiting to respawn: switch the spectated plane |

**Touch** (hold the phone in landscape; labels below are the Turkish UI's)

| Control | Action |
|---|---|
| Left half (floating stick) | Pitch / roll; centers on release |
| Left edge (`GAZ`) | Throttle slider |
| `ATEŞ` | Cannon (hold) |
| `FÜZE` / `FLARE` / `BOMBA` | Missile / flare / bomb, single tap (`BOMBA` shows only in Base Attack) |
| `AB` | Afterburner on / off |
| `TEKER` / `FREN` | Landing gear / brake |
| `SOHBET` | Quick chat menu (6 messages) |
| `GERİ` | Look back (hold) |
| `MENÜ` / `UÇAK` / `SKOR` | Settings / aircraft pick / scoreboard (hold) |
| Tilt | With "tilt aiming" on, device tilt aims while the stick is idle |
| `TEKRAR` / `GEÇ` | When shot down: replay of the last 10 s / skip |
| Tap the screen | While waiting to respawn: switch the spectated plane |

### Flight notes

- On a runway start the plane waits in the hangar with the parking brake set; throttle releases
  it. Open the throttle, raise the nose at rotate speed, and retract the gear (L) once airborne.
- Off the runway the engine cannot push the plane past 28 m/s (~100 km/h) on the ground. Touching
  down off the runway above 35 m/s, or a hard landing, destroys the plane.
- Stopping on your own base (≤ 3 m/s) refills missiles, flares, bombs and hit points in 3 s.
- A player joining a room spawns with their first aircraft pick. Without a pick within 15 s they
  spawn in their team's default aircraft; the HUD counts this down.

The pilot's manual covers the rest (stall speed, ceiling, lock times, damage, Base Attack
structures and anti-aircraft fire).

## Custom `.glb` models

Every aircraft comes with a procedurally built low-poly model. To use your own model instead:

1. Put it at `client/static/models/<kind>.glb`, where `<kind>` is a kind of `internal/sim`
   (`f16`, `f15`, `mig29`, `su27`, `f22`, `su57`, `f14`, `mig31`, `a10`, `su25`, `rafale`,
   `typhoon`, `mig21`, `f18`, `su30`, `f4`, `mig23`; the node contract is
   `tools/blender/contract.json`).
   - Orientation: nose along local **−Z**, right wing **+X**, up **+Y**.
   - Units are meters; the origin is the aircraft's center.
2. Run `cd client && npm run build`. The build copies the file to `cmd/dogfight/web/models/` and
   lists that aircraft in `models/manifest.json`.
3. Rebuild the Go binary (`go build ./cmd/dogfight` or `go run ./cmd/dogfight`); models are
   embedded in the binary.

The client requests only the models listed in the manifest, so a missing file costs no request.
If a listed model fails to load, the client logs a warning and falls back to the built-in model.
Team color, afterburner flame and name tag are drawn on both. Browsers cache models for a day.

## Development

Notes for contributors and coding agents (layout, headless testing, invariants) are in
[AGENTS.md](AGENTS.md); `scripts/smoke.sh` runs a headless end-to-end check against a real server.

Use two terminals:

```sh
# 1) client: DEBUG build, rebuilt on every save
cd client && npm run build && npm run watch

# 2) server
go run ./cmd/dogfight
```

- `npm run watch` regenerates only `app.js` (`DEBUG=true`, with a source map).
  - After changes under `client/static/` (`index.html`, `style.css`, models), run
    `npm run build` again.
  - The web files are embedded with Go `embed`, so restart `go run` after they change.
- A DEBUG build exposes a `debugGame` object in the console (`state`, `renderer`).
- DEBUG builds also open serverless test scenes:
  - `?debug=fly`: single-plane flight over flat ground.
  - `?debug=terrain`: terrain scene.
  - `?debug=world&map=sehir&wx=gece&cam=base`: a map and weather from a chosen camera
    (`cam=base|runway|plane|hangar|city|high|low`, `side=0|1`).
  - `?debug=models`: the four original aircraft side by side (`&glb=1&kinds=f14,mig23&sweep=0,1`
    lines up any kinds as .glb models, swing wings posed).
  - `?debug=fx`: effects scene.
- Before committing or deploying, return `cmd/dogfight/web` to a production build
  (`DEBUG=false`) with `npm run build`.

## Testing

```sh
go build ./... && go vet ./... && go test ./... -race     # Go: all packages
go test ./... -short                                        # skips the long match simulations
go test ./internal/game/ -run TestBalance -v -balance       # balance: hard-bot round-robin over all 17 kinds, 200 duels per pair; every kind within ±15% of the mean win rate
# The gate judges seeds 1000..1199; the specs were tuned on 0..199 (-balance-from 0 to tune). Phase 4:
# tuning seeds 47.7-51.4 %, gate seeds 45.4-52.9 % (band 42.5-57.5 %).

cd client && npm run check && npm test && npm run build     # TS type check, node --test, production build
```

The flight model is written with the same formulas in Go (`internal/sim/flight.go`) and
TypeScript (`client/src/sim/flight.ts`). Go writes shared flight scenarios to
`testdata/vectors/flight.json`, and the TS tests replay the same trajectories within a `1e-3`
tolerance (terrain and map vectors work the same way). After changing the sim, regenerate the
vectors:

```sh
go test ./internal/sim/ -run TestFlightVectors -update
```

The terrain and map vectors use the same `-update` flag in `internal/terrain` and
`internal/protocol`.

### Load test

`cmd/loadtest` drives simulated players over WebSocket. Each one does the real handshake, sends
60 Hz input with cannon bursts, missiles and flares, pings once a second and reads every server
message. It reports per-second throughput, snapshot timing and disconnects.

```sh
go run ./cmd/loadtest -url ws://127.0.0.1:8080/ws -players 24 -rooms 4 -mode team -size 6 -duration 2m
go run ./cmd/loadtest -bench    # no server: time one all-bot room's tick and snapshot encoding on this CPU
```

Other flags: `-diff easy|normal|hard`, `-map ada|sehir|col|dag`,
`-wx acik|bulutlu|sisli|yagmurlu|firtina|gece`, `-start hava|pist`, `-ramp`, `-settle`, `-every`,
`-bench-ticks`, `-bench-clients` (`-rooms 0` uses Quick Play).

The per-address limits refuse a load test from one machine. Run it only against a **test**
instance with raised limits on a private network, never against a public deployment:

```sh
dogfight -max-conns-ip 1000 -max-conns 1000 -create-per-min-ip 1000 \
         -join-per-min-ip 1000 -join-fail-per-min-ip 1000 -max-rooms 64
```

## Deployment

The provided scripts deploy a static `linux/arm64` binary into Docker containers behind nginx
and a CDN/proxy, with zero-downtime blue/green switching:

```
CDN / proxy (TLS) → nginx container → live color (dogfight-blue | dogfight-green)
```

All host-specific values live in `deploy/deploy.env`, which is gitignored. Copy the template and
fill it in:

```sh
cp deploy/deploy.env.example deploy/deploy.env
```

| Key | Meaning |
|---|---|
| `DEPLOY_HOST` | ssh destination of the server (an alias from `~/.ssh/config`), or `local` to run every command on this machine |
| `DEPLOY_DIR` | Directory on the server for compose/env files, the deploy lock and backups (e.g. `/srv/dogfight`) |
| `NGINX_CONTAINER` | Name of the nginx container that proxies the game |
| `NGINX_CONF` | The vhost file on the server holding the `set $dogfight_upstream ...;` line (bind-mounted into the container as a single file) |
| `EDGE_NETWORK` | Docker network the dogfight containers share with nginx and nothing else (see [Edge network](#edge-network)); created by the deploy if missing |
| `PUBLIC_HOST` | Public host name of the game (used for `-origin` and `-public-origin=wss://…`) |
| `DRAIN_MAX` | How long a draining color keeps its players (e.g. `30m`) |

If the file is missing or a key is unset, `scripts/deploy.sh` stops without doing anything. A
variable set in the environment wins over the file; `DEPLOY_ENV` points to another file.

### 1. Release

```sh
scripts/release.sh
```

Refuses a dirty working tree and a Go other than the `toolchain` in `go.mod`, runs `npm ci && npm run build`, builds a static `linux/arm64`
binary at `dist/dogfight-linux-arm64` and writes the version (`git describe`) to `dist/VERSION`.
`dist/` is gitignored.

### 2. Deploy (blue/green)

```sh
scripts/deploy.sh                       # make the dist/ build live
scripts/deploy.sh --status              # live color, versions, open sockets
scripts/deploy.sh --doctor              # check invariants (exit 1 on a problem)
scripts/deploy.sh --rollback <version>  # make a version already on the server live again
scripts/deploy.sh --preflight-network [host:port | https://url ...]  # set up and prove EDGE_NETWORK
```

nginx decides which color is live through the single
`set $dogfight_upstream http://dogfight-<color>:8080;` line in `NGINX_CONF`. A deploy:

1. uploads the binary, `Dockerfile.runtime`, a versioned compose file and the helper scripts to
   `DEPLOY_DIR`, and builds the image `dogfight:<version>`;
2. starts the new version in the **idle** color and waits for its health check; if it never gets
   healthy, it is stopped and the live color never changes;
3. checks that nginx reaches the new color's `/healthz` over its docker networks (a throwaway
   busybox in nginx's network namespace); if not, the new color is stopped and nothing switches;
4. switches nginx to the new color (`deploy/switch-upstream.sh`: rewrites the file in place,
   then `nginx -t`, `nginx -T`, `nginx -s reload`; any failure restores the old file). A reload
   does not cut open WebSockets;
5. drains the old color with `SIGUSR1`: its players finish their rooms, the stats lock moves to
   the new color at once, and the old container exits on its own;
6. confirms the new color opened its stats store (`stats opened` in the log) and prunes images
   older than the two colors.

Deploy, rollback and `switch-upstream.sh` hold a `flock` on `$DEPLOY_DIR/deploy.lock`, so a
second run stops immediately. A new deploy is refused while the idle color still drains another
version. A rollback to a version that is still draining sends it `SIGUSR2` and switches nginx back
without restarting it. The scripts touch only the containers `dogfight-blue` and `dogfight-green`
(by exact name) and the `dogfight:<version>` images; the upstream line must name one of the two
colors.

### 3. Deploy from CI (optional)

`.github/workflows/ci.yml` deploys main after an approval:

1. Create a GitHub environment `production` with yourself as the required reviewer and `main` as
   the only deployment branch. Protect `main` (pull requests only).
2. On the server, install `deploy/ci-deploy.sh` as `<DEPLOY_DIR>/ci/ci-deploy.sh` (root, mode
   700) next to a `deploy.env` that has `DEPLOY_HOST=local`.
3. Generate a dedicated ed25519 key and add its public half to the deploy user's
   `authorized_keys` as `command="<DEPLOY_DIR>/ci/ci-deploy.sh",restrict ssh-ed25519 …`: it can
   run nothing else, open no shell and forward nothing.
4. Store `DEPLOY_SSH_KEY` (the private key), `DEPLOY_SSH_HOST` and `DEPLOY_KNOWN_HOSTS` (the
   server's host key line) as secrets of the `production` environment, not of the repository.

The release job uploads a tar of the binary, `dist/VERSION`, `Dockerfile.runtime`,
`deploy/compose.yml`, `deploy/switch-upstream.sh` and `scripts/deploy.sh`; `ci-deploy.sh`
refuses anything else, then runs the same blue/green deploy as above. Rollbacks stay manual
(`scripts/deploy.sh --rollback <version>`).

### Container settings (`deploy/compose.yml`)

- Read-only root filesystem, non-root user (65532), `cap_drop: ALL`, `no-new-privileges`.
- Limits: 256 MB memory (`GOMEMLIMIT=200MiB`), 1 CPU, 128 pids. Both colors run side by side
  during a deploy.
- No published ports: the container joins `EDGE_NETWORK` under its own name, and only that
  network's IPv4 subnet is passed as `-trust-proxy` (looked up on the server at deploy time).
  See [Edge network](#edge-network).
- `-max-conns=72 -max-rooms=8`. On a small arm64 VM (1 CPU limit) about 64 concurrent players
  stayed healthy in load tests; measure your own hardware with `cmd/loadtest`.
- JSON logs, rotated (10 MB × 3).
- `-data=/data` on the external volume `dogfight-data` (the deploy creates it if missing); both
  colors mount it and the lock keeps one writer. Deploys never remove it; never run `down -v`.
- `-metrics-addr=127.0.0.1:9090`: readable only from inside the container, e.g.
  `docker exec dogfight-<color> /dogfight -get http://127.0.0.1:9090/metrics`. A `stats` summary
  line is also logged every 60 s.

### Edge network

Give the game its own docker network, shared only with nginx. If `EDGE_NETWORK` does not exist,
every deploy and rollback creates it as

```sh
docker network create --driver bridge --internal -o com.docker.network.bridge.inhibit_ipv4=true <EDGE_NETWORK>
```

and connects `NGINX_CONTAINER` to it (`docker network connect`; nginx keeps its other networks).
`--internal` leaves the network without a route out (the game needs no egress), and without an
IPv4 address on the bridge the containers cannot reach the host's own ports either. So a dogfight
container can reach nginx and the other color, and nothing else: no other container, no host
service, no internet. `-trust-proxy` then covers only nginx and the two colors.

If nginx is recreated by its own compose project, `docker network connect` is lost: list the
network there as an external network of the nginx service. `scripts/deploy.sh --doctor` reports
when nginx shares no network with the live color, and the next deploy reconnects it.

Before the first deploy onto a new network, `scripts/deploy.sh --preflight-network` sets it up and
proves it without touching the game. The arguments are services the game must not reach (other
containers' IPs, the host's public IP, as `host:port`) and URLs of other sites behind the same nginx.
It checks that nginx's default route is unchanged, that nginx reaches a throwaway server on the
network, that this server reaches none of the targets (or `1.1.1.1:443`), each one next to nginx
reaching it as a control, that every URL answers 200 before and after, and that `nginx -t` passes.
On a failure it undoes what it added.

An existing network named in `EDGE_NETWORK` is used as it is (the deploy prints a note if it is
not internal). To move from a network shared with other services, set `EDGE_NETWORK` to a new
name and deploy: the new color starts on the new network, nginx (now on both) switches to it,
and the old color drains on the old network as usual. Nothing is disconnected, so this is as
zero-downtime as any deploy. A rollback afterwards also starts on the new network; one that
undrains a color still running on the old network keeps it there until its next start.

Back up `/data` with a throwaway container that tars the volume (stop the live color first for a
fully consistent copy); restore into a stopped setup and `chown -R 65532:65532 /data`.

### nginx

`deploy/nginx-dogfight.conf` is a sample vhost, included at nginx's `http{}` level. Replace
`server_name` (`dogfight.example.com`) and the certificate paths with your own. It:
- redirects 80 → 443 and serves 443 with an origin certificate;
- accepts only Cloudflare's IP ranges (`geo` on `$realip_remote_addr`), takes the client IP from
  `CF-Connecting-IP` and forwards it as `X-Real-IP` (the Cloudflare list appears twice, in `geo`
  and `set_real_ip_from`; update both together, or adapt them to your proxy);
- resolves the upstream through docker DNS (`resolver 127.0.0.11`), so nginx starts even while the
  container is down;
- proxies `/ws` with upgrade, a 120 s timeout and `proxy_buffering off`;
- ships Cloudflare Authenticated Origin Pulls commented out. To enable it, upload a client
  certificate for your hostname in Cloudflare (SSL/TLS → Origin Server → Authenticated Origin
  Pulls, per-hostname), place its public certificate at the `ssl_client_certificate` path,
  uncomment `ssl_client_certificate` and `ssl_verify_client optional`, confirm requests through
  Cloudflare verify, then uncomment the `if` that answers 403 to everyone else.

Always run `nginx -t` before reloading: if the `http{}` context is shared with other vhosts, a
broken include takes them all down. Certificates and keys never enter the repository
(`.gitignore`: `*.pem`, `*.key`).

### Reproducible Docker build (optional)

```sh
docker buildx build --platform linux/arm64 --build-arg VERSION=$(git describe --always --dirty) -t dogfight:dev .
```

This uses the multi-stage `Dockerfile`; base images are pinned by digest.

## Security notes

The game runs on the public internet, and the server does not trust the client.

- **Authority:** the whole simulation runs on the server. The client sends only input; input is
  clamped and NaN/Inf are neutralized. An unknown aircraft type or a malformed message closes the
  connection.
- **Connection limits:** 128 sockets server-wide, 6 per address; at most 16 rooms; 3 room
  creations per address per minute (a failed creation costs no token); 10 failed and 20
  successful joins per address per minute. An "address" is one IPv4 address or one IPv6 /64;
  on top of that, all /64s of one IPv6 /48 share 24 sockets (`-max-conns-net`), so a cheap /48
  cannot fill the server.
- **Message limits:** 90 messages/s per connection, burst 120; at most 2 KB per message; pick and
  ping have their own tighter limits. Exceeding a limit closes the connection with a
  policy-violation code.
- **Timeouts:** 5 s handshake. A connection silent for 30 s is closed; the client pings every
  15 s, and once a second in a match to measure the round-trip time. The writer queue holds 64 messages and drops the oldest snapshot when full (its events
  move into the next snapshot); a queue full for 2 s closes the connection. A room never used
  closes after 15 s, an emptied room after 60 s.
- **Origin:** the WebSocket is accepted only from hosts in `-origin` (or the same host when empty).
- **Proxy:** `X-Real-IP` is honored only from `-trust-proxy` CIDRs.
- **HTTP headers:** strict CSP (`default-src 'self'`, `object-src 'none'`,
  `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy` and `Cross-Origin-Opener-Policy`. No directory listing. HSTS is left to
  the TLS-terminating proxy.
- **Names:** control and invisible/bidi characters are stripped; at most 16 characters. The name
  "Berabere" ("Draw") is reserved.
- **Panics:** a panic in a room closes only that room and is logged; the process stays up.
- **`/api/*`:** GET/HEAD only; a shared limit of 120 per minute per address (burst 30, real IP via
  `-trust-proxy`); response caching (1 s / 10 s) bounds query cost; no CORS; `no-store`; the only
  query parameter is `period` (allow-listed).
- **Pilot token:** 128 bits from `crypto/rand`, stored in the browser's `localStorage`. The server
  keeps only its SHA-256 hash; the raw token never reaches logs (the log handler also masks it),
  metrics, URLs or disk. Over HTTP it travels only in the `X-Pilot-Token` header, and its format
  (22 characters, base64url) is checked before hashing. `/api/me` gives the same
  `{"pilot":null}` answer for an invalid, unknown or oversized token. There are no accounts:
  losing the token loses the card, and whoever holds the token can see the card.
- **Stats store:** a single actor; journal lines ≤ 4 KB; at most 20,000 pilots, pilots unseen for
  180 days are dropped; file 0600, directory 0700; crash-safe via atomic rename plus `seq`, bad
  lines are skipped. To resist farming, the leaderboard counts only human kills in public (listed)
  rooms; bot and private-room kills go only to the personal card. A match or win counts only after
  staying at least 60 s in the round and taking off once.
- **Public names:** the home-page leaderboard shows player-chosen names. They are rendered as text
  nodes (no XSS), but there is no profanity filter.
- **Quick chat:** no free text, only IDs 1–6; one message per 2 s per player; team-only in team
  modes.
- **Room list / Quick Play:** public rooms only, codes and counts only; private room codes are never
  listed. Quick Play counts against the normal join and create limits.
- **Metrics listener:** loopback only in the sample deployment, never published; fixed label
  sets with no IPs, names or tokens; `ReadHeaderTimeout` 5 s.
- **`/data` volume:** the root filesystem stays read-only; only `/data` is writable, owned by uid
  65532.
- **Touch / tilt:** `Permissions-Policy` enables only `accelerometer=(self), gyroscope=(self)`;
  camera, microphone and geolocation stay off. Tilt permission is requested on a user tap.
- **Known limitation (enemy visibility):** enemy name tags show up close (1.2 km) or near the gun
  line, radar dots within 2.5 km. This is hidden only on the client: every snapshot carries the
  position of every plane in the room, so a modified client can see enemies at any range.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Project layout

```
cmd/dogfight/        main: flags, HTTP server, embedded web/, graceful shutdown, stats handoff, -healthcheck
cmd/loadtest/        WebSocket load generator and CPU bench
internal/match/      Dogfight on core: room, seat, summary and lobby aliases, game adapter
internal/front/      Dogfight's HTTP front: server wiring, stats API
internal/golden/     frozen wire-format goldens
internal/protocol/   JSON message types and conversions
internal/game/       one room's match: world, rules, scoreboard, bots, roster
internal/mode/       team / FFA / Base Attack rules, scoreboard, structure HP
internal/bot/        bot brain: evade > collect > attack > patrol, taxi/takeoff/landing, autopilot
internal/sim/        pure, deterministic simulation: flight, ground/taxi/landing, missiles, radar,
                     flares, rearm, structures, bombs, anti-aircraft
internal/maps/       4 map generators: base layout, runway, hangars, buildings, surface index
internal/terrain/    heightmap from a seed, flattening, bilinear sampling
internal/weather/    6 weather types: wind, gusts, missile lock range multiplier (visuals in the client)
internal/rng/        seeded splitmix (no global randomness)
internal/stats/      pilot stats store: actor, JSONL journal + snapshot, leaderboard
internal/geom/       vectors and quaternions
client/src/          net (socket), predict (prediction + interpolation), render (Three.js),
                     input (mouse, keyboard, touch, tilt), audio (Web Audio jet sound),
                     ui (DOM), game (loop, cameras, killcam, replay), sim (TS flight/ground port),
                     book (pilot's manual), debug (DEBUG-only scenes)
testdata/vectors/    flight, terrain and map vectors written by Go, checked by TS
deploy/, scripts/    compose, nginx vhost, release and deploy scripts
docs/superpowers/    design specs and implementation plans (in Turkish)
```

- **Rooms:** each room is an actor. It talks to the outside world only through channels and holds
  no shared state.
- **Netcode:** JSON over WebSocket.
  - Your own plane is predicted on the client. When a server snapshot arrives, unacknowledged
    inputs are replayed (once per frame, on the newest snapshot) and the correction glides:
    0.15–0.6 s depending on its size, at most 150 m/s and 120°/s.
  - Other planes are drawn from an interpolation buffer.
  - Bullets are simulated on the client from `fire` events; missiles arrive in snapshots.
- **Design docs:** `docs/superpowers/specs/2026-10-06-dogfight-design.md` (v1) and
  `docs/superpowers/specs/2026-10-07-dogfight-v2-design.md` (v2); implementation plans under
  `docs/superpowers/plans/`.

### Shared core

The game-agnostic multiplayer stack lives in its own repository,
[roomkit](https://github.com/ahmetbir/roomkit): rooms, lobby, handshake, limits, blue/green drain,
pilot tokens, metrics, load test; reconnecting socket, prediction, interpolation, i18n and UI
shells. Dogfight is one game on it (`internal/match`, `internal/front`) and pins a roomkit tag in
`go.mod` and `client/package.json`. Design: `docs/superpowers/specs/2026-10-07-core-extraction-design.md`
and `docs/superpowers/specs/2026-10-07-roomkit-design.md`.

## Contributing

Pull requests are welcome. Before opening one, run the test commands from [Testing](#testing)
(Go build, vet and race tests; client type check, tests and production build) and make sure they
pass. If you change the simulation, regenerate the shared vectors and keep the Go and TypeScript
sides in sync.

## License

[MIT](LICENSE).
