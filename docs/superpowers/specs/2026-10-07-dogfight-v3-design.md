# Dogfight v3 — calm netcode, a pre-match lobby, a hangar of sixteen jets with skins

Owner requests (2026-10-07):
1. "When my connection is bad the plane does weird things. Can it be handled more calmly, or at
   least show the connection state?"
2. "More detailed low-poly planes, more aircraft types, skins" — models made in Blender by us, at
   the level of a PS1-style low-poly F-16 (a few thousand triangles, small panel textures, moving
   control surfaces and gear). Types: the existing four plus F-22, Su-57, F-14, MiG-31, A-10,
   Su-25, Rafale, Eurofighter, MiG-21 "and more if there are any".
3. "I want to be on the same team as a friend against bots": a room does not start when it is
   created; everyone who comes by the link picks a side on a lobby screen; the creator presses
   Start. A late joiner may still join a running match (as today).

Delivered in four phases, each merged and deployed on its own (a playable build every phase).

## Phase 1 — calm netcode and a connection indicator

Measured causes (survey of the client and roomkit):
- During a stall (≥ 1 s without server traffic) the shaper holds inputs while the client keeps
  predicting them and the server repeats the last input; on recovery the correction is large and
  is drawn in 0.1 s (`predict/predictor.ts` SMOOTH_S), or teleported above 50 m.
- A lasting latency step is absorbed only after ~0.75 s (roomkit Reconciler median window), then
  corrected at once.
- Frame hitches drop the tick backlog (`game/loop.ts`), desyncing draw-ahead.
- Nothing tells the player the connection is bad (ping is a keepalive; pong is never read).

Design:
- **Indicator.** RTT from ping/pong at 1 Hz while in a match (pong is already in the protocol),
  plus "server silent for N ms" and snapshot loss (gaps in snapshot ticks). HUD corner: bars
  (good / fair / poor / lost) with the RTT in ms on hover/tap; a "Connection unstable" banner
  after 1 s of silence, cleared on recovery. tr + en.
- **Calm corrections.** Correction time scales with the correction size (0.15 s for small, up to
  0.6 s for large) for position, and rotation corrections are rate-limited (deg/s) so the nose
  never whips; the teleport threshold rises (50 m → 150 m) and applies only to real resets
  (respawn/kind change), which already reset.
- **Stall behaviour.** While the server is silent beyond a threshold (e.g. 250 ms), prediction
  eases the stick toward neutral and holds the throttle, instead of extrapolating the player's
  full input for seconds; inputs are still sent when traffic resumes. The divergence to correct
  on recovery is small.
- Tests: the smoother's time constants and rate limits (unit), a simulated stall (prediction
  with a gap in snapshots) stays within a bound of the server path, the indicator's thresholds.

## Phase 2 — pre-match lobby with sides and Start

- New game phase **Lobby** before Playing. A created room starts in Lobby: no world tick, no
  bots flying, no round clock. Quick play rooms keep starting immediately (unchanged).
- **Creator**: the first human of the room; if they leave, the next human who joined earliest.
  Shown as host in the lobby.
- **Lobby screen** (everyone in the room, live): two columns NATO / Soviet (FFA: one list), each
  human with name, chosen aircraft and skin; empty seats shown as "Bot". Each player picks side
  (balance rule: a side may not exceed the other by more than one human; bots fill the rest),
  aircraft (from their side's list) and skin. The room link is shown with a copy button.
  Creator sees **Start**; others see "Waiting for the host". Start is allowed with ≥ 1 human.
- On Start: bots fill empty seats per side, everyone spawns per the room's start mode, the round
  clock runs.
- Late joiner (match running): today's flow — pick screen, joins the smaller side or the side
  they choose under the existing ChooseTeam rules, replaces a bot.
- After a round ends: back to the Lobby (same room, same sides kept), creator presses Start again.
- Protocol: `lobby` state message (players, sides, picks, host, phase), client→server `side`,
  `pick` (exists), `start` (host only, Lobby only). Codes for refusals (not host, not lobby,
  side full). Protocol version bump.
- Tests: Go (phase gating, host succession, balance, start fills bots, late join), TS (lobby
  screen model, start visibility), browser check with two tabs.

## Phase 3 — Blender model pipeline, the four existing jets remade, skins

- `tools/blender/` (in the repo): a Python generator run headless
  (`blender -b -P tools/blender/build.py -- <kind|all>`) that builds each jet from a per-type
  parameter file with shared part builders (fuselage loft from cross-sections, nose/radome,
  canopy with frame, intakes with dark mouths, wings/strakes/LERX, tails, nozzles with petals,
  pylons with missiles, gear doors, panel-line texture). Output `client/static/models/<kind>.glb`
  (+ manifest via the existing script). Deterministic (same input → same file).
- Budget per jet: 1,500–4,000 triangles, one 256×256 texture atlas (panel lines, markings,
  numbers, intake warning stripes; nearest-filtered for the PS1 look), ≤ 150 kB per .glb.
- Named nodes the client animates: `aileron_l/r`, `elevator_l/r` (or `stab_l/r`), `rudder`
  (twin: `rudder_l/r`), `flap_l/r`, `gear` (+ doors), `canopy`, engine exits `ab_*`/`idle_*`
  markers (positions for the existing flame/glow), nose toward −Z, true metres. Control surfaces
  follow stick/rudder input (own plane: input; others: from snapshot rates).
- Materials by role: `body`, `secondary`, `stripe` (team colour, always kept), `canopy`, `dark`,
  `metal`. The client sets colours per skin and team.
- **Skins** (free choice, in the pick/lobby screen and the hangar): per jet a set of schemes —
  e.g. default grey, two-tone air superiority, desert, winter, naval, splinter camo, black — a
  scheme is body/secondary colours plus an optional camo pattern texture generated in the client
  (canvas, seeded) and multiplied over the atlas. Team colour stays on stripe/fin tip/roundels so
  friend and foe never mix. The choice is stored per jet in localStorage and sent with `pick`
  (server validates the id, relays it in snapshots/roster so others see it).
- The procedural builders stay as the fallback when a .glb fails to load.
- Tests: generator smoke (all kinds build; triangle and size budgets; required node names) run
  in CI only where Blender exists (local check script), client tests for skin validation and
  material mapping; screenshots of every jet and skin.

## Phase 4 — twelve new types and balance

- New kinds (NATO / Soviet pairs): F-22 / Su-57 (stealthy 5th gen: agile, fast, fewer missiles),
  F-14 / MiG-31 (interceptors: fastest, longest lock range, sluggish roll), A-10 / Su-25 (attack:
  slow, very tough, extra ordnance useful against bases), Rafale and Eurofighter / MiG-21 (light,
  agile; MiG-21 cheap and fragile), plus F/A-18 / Su-30 and F-4 / MiG-23 ("more if any") —
  sixteen kinds in all, eight per side.
- Each gets a `sim.Spec` row (stats balanced so no kind dominates: a bot-vs-bot round-robin
  harness reports kill ratios per kind, target within ±15 % of the mean), a model from the
  generator, skins, i18n names and a one-line role description in the pick screen.
- Bots pick kinds round-robin within their side (existing rule) over the larger list.
- Protocol: kind ids extend (wire carries kind strings; unknown kinds refused as today).

## Global constraints

- Determinism of the sim is unchanged; Go↔TS flight model parity tests extended to new kinds.
- Assets served from `/models/` (cached 1 day; the manifest no-cache), fingerprinting unchanged.
- No new runtime dependencies besides Blender as a dev-only tool (not in CI).
- Public repo: no infrastructure names, paths or secrets in commits; no Claude-Session trailer;
  commits stamped outside weekday 09:00–18:00 Europe/Istanbul.
- Each phase: branch → PR → owner-approved merge → deploy.

## Phase 1b — a military HUD style (opt-in)

Owner: "could the on-screen symbology look like a real fighter's HUD? The current one is fine, I
don't want to break it — an improvement." Reference: a monochrome green, thin-line HUD (heading
tape on top, speed and altitude boxes left/right, flight path marker, pitch ladder, small mission
text top-left, target boxes).
- A second HUD style, selectable in Settings ("Classic" default / "Military"); the classic HUD is
  untouched. Stored per browser.
- Military style: heading tape + numeric heading (top); speed (kt or km/h per setting) and
  altitude boxes (left/right) with G, Mach, throttle and vertical speed beneath; flight path
  marker (velocity vector) and a pitch ladder (5° rungs, dashed below the horizon, labelled) that
  roll with the aircraft; the gun pipper / missile reticle and lock symbology redrawn in the same
  style (diamond target designator with range; filled when locked; missile warnings flash); radar
  and mission text keep their roles but in the same thin monochrome look.
- One colour (HUD green by default, with an amber option), monospace, 1 px lines with a faint
  glow; legible in day/night/weather; scales with the viewport; mobile keeps the classic layout's
  touch areas.
- Rendered on a 2D canvas overlay (or SVG), one draw per frame, no layout thrash.
- Tests: the projection maths (FPM, ladder angles, heading tape) as pure functions; screenshots
  of both styles in day/night.
- Starts after Phase 1 merges (both touch the HUD).

## Rulings made while building (2026-10-08)

- Phase 1: during a stall prediction flies the input the server repeats (not neutral); corrections
  glide at ≤ 150 m/s and snap (position and attitude) only beyond 300 m; one link ping in flight.
- Phase 2: side balance lets every human share one side (two friends against bots); with humans on
  both sides one side may lead by one. Created rooms are kept out of Quick Play (they report their
  human count as seats; a roomkit "no quick play" flag would be cleaner). A lobby still waiting when
  its server drains closes after 10 s with a "lobby closed" card.
- Phase 3: real sizes kept (15–23 m); hit, ram and wall spheres, muzzle, camera and effects follow
  each airframe. Every paint carries a team-coloured band on the rear fuselage.
- Phase 4: seventeen kinds (Rafale and Typhoon both built); teammates fly through each other;
  the original four jets' numbers changed for balance (every kind 45–53 % on unseen seeds).
