// The client game loop: fixed-step input + prediction, interpolated remote
// planes, effects and the chase camera, once per animation frame.
import { t } from "../i18n/index.ts";
import { InputState } from "../input/input.ts";
import { makeScheme, planeView, type Frame, type Settings } from "../input/schemes.ts";
import type { TouchState } from "../input/touch.ts";
import type { Socket } from "../net/socket.ts";
import { Effects } from "../render/effects.ts";
import { PlaneViews } from "../render/planes.ts";
import { Props } from "../render/props.ts";
import { StructureViews } from "../render/structures.ts";
import type { Renderer } from "../render/renderer.ts";
import { extrapolate, ServerClock } from "../predict/interp.ts";
import { DT } from "../sim/flight.ts";
import { add, len, qForward, qRotate, scale } from "../sim/vec.ts";
import { unpackDamage } from "./damage.ts";
import { Bullets } from "./bullets.ts";
import { airframe } from "./airframe.ts";
import { Cams } from "./cams.ts";
import { dispatchEvents, mergeHooks, pruneDecoys, type FxSink, type GameHooks } from "./events.ts";
import type { Feed, Listener } from "./feed.ts";
import { flightEnv } from "./env.ts";
import { flaresAt } from "./flares.ts";
import { OwnPlane } from "./own.ts";
import { drawAhead } from "./ahead.ts";
import { toFlight, type GameState } from "./state.ts";
import { planeRenders } from "./view.ts";
import { buildWorld } from "./world.ts";
import { effectiveRange } from "../ui/lockinfo.ts";
import { kindOf, loadoutOf, noLockNotice, otherKind, PICK_WIRE, pickedKind, type MissileKind } from "../ui/loadout.ts";

const MAX_STEPS = 5;      // ticks simulated per frame before dropping the backlog
const MAX_FRAME_S = 0.25;
const MUZZLE_MS = 50; // muzzle flash after each own round

const NO_FX: FxSink = { sparks: () => {}, explosion: () => {}, puff: () => {} };

export type GameCtx = {
  socket: Socket; renderer: Renderer; state: GameState; settings: Settings;
  feed: Feed;          // applied server messages (state is updated before emit)
  hooks?: GameHooks;
  /** True while a menu covers the game: input is ignored (the plane holds its course). */
  blocked?: () => boolean;
  /** The touch overlay's state (ui/touchpad), read by the touch scheme. */
  touch?: TouchState;
  /** The plane picked to watch while I have none yet (ui/app: click, ← →). */
  spectate?: () => number | null;
  /** Milliseconds since the server was last heard (net/link): prediction eases during a stall. */
  silentMs?: () => number;
};

/** The running game, as the in-game screens drive it. */
export type Game = {
  stop(): void;
  replayKey(): boolean;  // R: start the replay while down, or skip it; true if it did either
  skipReplay(): boolean; // Esc: true if a replay was playing
  replaying(): boolean;
};

/** Starts the game on the room in ctx.state (welcome applied). */
export function startGame(ctx: GameCtx): Game {
  const { renderer: r, state, socket } = ctx;
  if (!state.terrain) throw new Error("startGame before welcome");
  const world = buildWorld(r.scene, state.terrain, state.map, state.weather, ctx.settings.perf, state.heights ?? undefined);
  const fx = new Effects(r.scene, ctx.settings.perf);
  const views = new PlaneViews(r.scene, r.camera, fx);
  const props = new Props(r.scene, state.terrain.spots);
  const structs = state.map?.structs ? new StructureViews(r.scene, state.map.structs) : null;
  const cams = new Cams({
    renderer: r, state, settings: ctx.settings, solids: world.solids, spectate: ctx.spectate,
    ground: (x, z) => flightEnv(state, false).ground(x, z).h,
  });
  const hooks = mergeHooks(ctx.hooks ?? {}, {
    missileLaunch: (_t, _atMe, id, mine) => cams.launched(id, mine, performance.now()),
  });
  const input = new InputState(r.canvas, {
    onLockLost: () => hooks.lockLost?.(), touch: ctx.touch, wantsLock: () => ctx.settings.scheme !== "touch",
  });
  input.playing = true;
  let scheme = makeScheme(ctx.settings); // rebuilt when the settings switch schemes
  const own = new OwnPlane((turbo) => flightEnv(state, turbo));
  const renderTick = () => (state.clock.renderTime(performance.now()) * 60) / 1000;
  const bullets = new Bullets(renderTick);

  let acc = 0;
  let last = performance.now();
  let paused = document.hidden;
  let raf = 0;
  let ctl: Frame | null = null; // last tick's controls
  let pick: MissileKind = "ir";  // the pick key's choice (mouse, keyboard); touch picks by range
  let lastShotAt = -Infinity;
  let perf = ctx.settings.perf; // the menu can switch it mid-game
  const t0 = last;
  const decoys = new Set<number>(); // decoyed missiles still flying (events.ts)

  const onMsg: Listener = (m, evs) => {
    if (m.t === "welcome") { // reconnect: new player on the server
      own.reset();
      bullets.reset();
      decoys.clear();
      scheme.reset();
      cams.reset();
      acc = 0;
      return;
    }
    if (m.t !== "snap") return;
    const spawned = dispatchEvents(evs, {
      you: state.you, fx: cams.replaying() ? NO_FX : fx, bullets, hooks, decoys, // live blasts stay out of the replay
    });
    pruneDecoys(decoys, state.missiles); // after dispatch: this snapshot's mgone already used the set
    cams.events(evs, performance.now());
    if (spawned) cams.respawned();
    if (own.snap(state.planes.get(state.you), state.ack, spawned, state.aircraft, state.wt)) {
      scheme.reset();
      cams.snap();
    }
  };
  const unsubscribe = ctx.feed.on(onMsg);

  const onVisibility = () => {
    if (document.hidden) {
      own.neutral(socket); // the server repeats the last input while we are away
      paused = true;
      input.clear();
    } else {
      paused = false;
      acc = 0;
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  const step = () => {
    if (scheme.kind !== ctx.settings.scheme) scheme = makeScheme(ctx.settings);
    const menu = !!ctx.blocked?.() || cams.replaying(); // the replay holds the controls neutral
    input.playing = !menu; // menus keep Tab/Space/arrows for focus and buttons
    if (menu) input.clear();
    const fs = own.state();
    ctl = scheme.frame(input, planeView(fs), DT);
    const picks = scheme.kind !== "touch";
    const me = state.planes.get(state.you);
    if (ctl.pick && picks) {
      pick = otherKind(pick);
      if (me && loadoutOf(me.lo) === "mixed") hooks.notice?.(t("lo.picked", { k: t(pick === "ir" ? "lo.kindIr" : "lo.kindRadar") }));
    }
    if (ctl.missile && fs) {
      // The server fires only with a lock and ammo; say why nothing happened.
      if (me && me.ms + (me.rm ?? 0) <= 0) hooks.notice?.(t("lo.none"));
      else if (me && !me.ld) hooks.notice?.(noLockNotice(loadoutOf(me.lo), picks ? pickedKind(pick, me.ms, me.rm ?? 0) : undefined));
    }
    const shot = own.tick(picks ? { ...ctl, sel: PICK_WIRE[pick] } : ctl, socket, ctx.silentMs?.() ?? 0);
    if (shot) {
      bullets.spawn(shot.pos, shot.vel, 0, true);
      lastShotAt = performance.now();
      hooks.sound?.("cannon", shot.pos);
    }
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(Math.max((now - last) / 1000, 0), MAX_FRAME_S);
    last = now;
    if (!paused) {
      acc += dt;
      let n = 0;
      while (acc >= DT && n < MAX_STEPS) {
        acc -= DT;
        n++;
        step();
      }
      if (n === MAX_STEPS) acc = 0;
    }
    draw(dt, now);
  };

  const draw = (dt: number, now: number) => {
    if (perf !== ctx.settings.perf) {
      perf = ctx.settings.perf;
      world.setPerf(perf);
      fx.setPerf(perf);
    }
    const rt = state.clock.renderTime(now);
    const drawn = own.render(dt);
    // Physics advances in whole ticks; carry the leftover frame time so the
    // plane moves and turns smoothly at any display rate (e.g. 120 Hz).
    const env = flightEnv(state, false);
    const mine = drawn && drawAhead(drawn, own.spin(), acc, (x, z) => env.ground(x, z).h);
    const rs = cams.replayScene(now); // the replay draws recorded planes and missiles instead
    views.setViewHeight(r.canvas.clientHeight);
    views.sync(rs?.planes ?? planeRenders(state, rt, { fs: mine, gForce: own.gForce(), ab: !!ctl?.stick.ab && !mine?.abl, stick: ctl?.stick }), state.players.get(state.you)?.team);
    props.syncMissiles(rs?.missiles ?? state.missiles, rs ? 0 : (now - state.snapAt) / 1000, fx);
    props.syncBombs(state.bombs, (now - state.snapAt) / 1000);
    fx.flares(rs ? [] : flaresAt(state.flares, (now - state.snapAt) / 1000), dt);
    structs?.sync(state.structs, now, { smoke: (at) => fx.wreckSmoke(at) });
    props.syncPowerups(state.powerups, (now - t0) / 1000);
    props.muzzle(mine && now - lastShotAt < MUZZLE_MS ? add(mine.pos, scale(qForward(mine.rot), airframe(state.planes.get(state.you)?.k ?? "").muzzle)) : null);
    if (!rs) bullets.update(dt, fx); // live tracers wait (or expire) while the replay plays
    const me = state.planes.get(state.you);
    const fs = mine ?? (me ? toFlight(me) : null);
    const view = cams.place(dt, now, rt, { fs, live: !!mine, lookBack: !!ctl?.lookBack, aimDir: ctl?.aimDir ?? null }, rs);
    hooks.camera?.(view); // after place: an optional call would skip evaluating it
    fx.update(dt);
    world.update(dt, r.camera.position);
    r.render();
    const backdrop = r.backdrop(now, ctx.settings.hud === "military"); // before the inset, which is not the world behind the HUD
    cams.inset(now);
    if (me && fs) {
      hooks.hud?.({
        alive: !!mine, speed: len(fs.vel), alt: fs.pos.y,
        hp: me.hp, maxHP: state.aircraft.get(me.k)?.maxHP ?? 100,
        th: ctl?.stick.th ?? me.th, ab: !!ctl?.stick.ab && !!mine && !mine.abl, heat: me.ht, overheated: me.oh,
        missiles: me.ms, radars: me.rm ?? 0, loadout: loadoutOf(me.lo), lockKind: kindOf(me.lkk),
        picked: scheme.kind !== "touch", damage: unpackDamage(me.dm),
        fires: scheme.kind !== "touch" ? pickedKind(pick, me.ms, me.rm ?? 0) : kindOf(me.lkk),
        flares: me.fl, respawnS: (me.rs ?? 0) / 60,
        lockProgress: me.lp ?? 0, locked: !!me.ld, oobS: me.oob ?? 0,
        scheme: ctx.settings.scheme, pointerLocked: input.locked(),
        invertY: ctx.settings.invertY, rotateSpeed: state.aircraft.get(me.k)?.rotateSpeed ?? 0, muzzle: airframe(me.k).muzzle,
        gLoad: own.gLoad(), gfx: ctx.settings.gfx,
        protected: !!me.pr, lockTarget: me.lk ?? 0,
        lockRange: effectiveRange(state.aircraft.get(me.k)?.lockRange ?? 0, state.weather?.lockMul ?? 1),
        gear: !!mine?.gear, gearWanted: !!ctl?.stick.g, brake: !!ctl?.stick.br, onGround: !!mine?.ground,
        rearm: me.rr ?? 0, bombs: me.bm ?? 0, baseMode: state.mode === "base",
        abHeat: fs.abh ?? 0, abLocked: !!fs.abl,
        pos: fs.pos, vel: fs.vel, fwd: qForward(fs.rot), up: qRotate(fs.rot, { x: 0, y: 1, z: 0 }), aimDir: mine ? ctl?.aimDir ?? null : null,
        project: (p) => r.project(p),
        backdrop,
        planeAt: (id) => {
          const p = state.planes.get(id);
          const s = p?.a ? state.interp.get(id)?.sample(rt) : null;
          return s ? { pos: s.pos, vel: s.vel } : null;
        },
        planeNow: (id) => {
          const buf = state.planes.get(id)?.a ? state.interp.get(id) : null;
          const s = buf ? extrapolate(buf, ServerClock.serverMs(state.tick + own.ahead()) + acc * 1000) : null;
          return s ? { pos: s.pos, vel: s.vel } : null;
        },
      });
    }
  };
  raf = requestAnimationFrame(frame);

  return {
    stop: () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      input.dispose();
    },
    replayKey: () => cams.replayKey(performance.now()),
    skipReplay: () => cams.skipReplay(),
    replaying: () => cams.replaying(),
  };
}

