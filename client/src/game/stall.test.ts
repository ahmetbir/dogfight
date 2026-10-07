// Bad links, end to end on the client path: the real OwnPlane (input
// sequencing, prediction, smoother), the real core Shaper and link monitor,
// against a server path computed with the Go-parity models (the session
// queue of core/room/queue.go and the shared flight model). Each direction
// has its own delivery: TCP holds what is sent during a stall and delivers
// it in one burst. The drawn plane must not jump, and corrections must keep
// coming (a skipped snapshot must never starve reconciliation).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Shaper } from "roomkit/net/shaper";
import { OwnPlane } from "./own.ts";
import { AIR_ENV } from "./env.ts";
import { LinkMonitor } from "../net/link.ts";
import { POLICY } from "../net/shaper.ts";
import type { AircraftInfo, ClientMsg, In, PlaneJSON } from "../net/protocol.ts";
import { SessionModel } from "../predict/sessionmodel.ts";
import { stepFlight, type FlightState, type Spec, type StickInput } from "../sim/flight.ts";
import { dist, len, qConj, qIdentity, qMul, sub, v3, type Q, type V3 } from "../sim/vec.ts";

const F16: AircraftInfo = { kind: "f16", name: "F-16", team: "nato", maxHP: 100, maxSpeed: 230, maxSpeedAB: 290, accel: 48,
  rollRate: 4.2, pitchRate: 1.6, yawRate: 0.5, cornerSpeed: 170, lockRange: 1200, missiles: 4, flares: 6, rotateSpeed: 78 };
const SPEC: Spec = F16;
const aircraft = new Map([["f16", F16]]);
const TICK_MS = 1000 / 60;
const LAT = 9;        // ticks one way (150 ms, 300 ms round trip)
const STALL_AT = 240; // tick the stall starts (after 4 s of flight)

type Pilot = (t: number) => StickInput;
/** Arrival tick of a packet sent at tick t (must not decrease: TCP order). */
type Arrival = (t: number) => number;
type Run = { posJerk: number; rotStep: number; rotJerk: number; correction: number; corrections: number };

const toWire = (fs: FlightState): PlaneJSON => ({
  id: 1, k: "f16", tm: "none", p: [fs.pos.x, fs.pos.y, fs.pos.z], q: [fs.rot.w, fs.rot.x, fs.rot.y, fs.rot.z],
  v: [fs.vel.x, fs.vel.y, fs.vel.z], th: fs.th, hp: 100, a: true, ht: 0, oh: false, ms: 4, fl: 6,
  gr: fs.gear, gd: fs.ground, w: fs.w ? [fs.w.x, fs.w.y, fs.w.z] : undefined, abh: fs.abh, abl: fs.abl,
});
const angle = (a: Q, b: Q) => 2 * Math.acos(Math.min(1, Math.abs(a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z)));
const deg = (r: number) => (r * 180) / Math.PI;

const plain: Arrival = (t) => t + LAT;
/** Dark from STALL_AT for n ticks; what was sent meanwhile arrives right after. */
const stall = (n: number): Arrival => (t) => {
  const at = t + LAT;
  if (at < STALL_AT) return at;
  if (t < STALL_AT + n) return STALL_AT + n + LAT;
  return at;
};
/** Delivered in clumps every `every` ticks until `until`, then steady. */
const clumpy = (every: number, until: number): Arrival => (t) =>
  t < until ? Math.ceil((t + LAT) / every) * every : Math.max(t + LAT, Math.ceil((until - 1 + LAT) / every) * every);
/** Every `period` ticks the link holds for `hold` ticks, else flows. */
const gappy = (period: number, hold: number): Arrival => (t) => {
  const a = t + LAT;
  const ph = a % period;
  return ph < hold ? a - ph + hold : a;
};

/**
 * Flies `end` ticks; metrics count from tick `from`. drift moves the server
 * plane sideways by that many metres per tick, which the client cannot
 * predict: only reconciliation keeps the two together.
 */
function fly(pilot: Pilot, upA: Arrival, downA: Arrival, end: number, from = 120, drift = 0): Run {
  const s0: FlightState = { pos: v3(0, 2000, 0), rot: qIdentity(), vel: v3(0, 0, -220), th: 1 };
  const own = new OwnPlane(() => AIR_ENV);
  const link = new LinkMonitor(0);
  const up: { at: number; m: In }[] = [];
  const down: { at: number; fs: FlightState; ack: number; tick: number }[] = [];
  let now = 0;
  const shaper = new Shaper<ClientMsg>({
    now: () => now, setTimeout: () => 0, clearTimeout: () => {}, buffered: () => 0,
    write: (m) => { up.push({ at: upA(now / TICK_MS), m: m as In }); return true; },
  }, POLICY);
  const q = new SessionModel<StickInput>();
  let server = s0;
  let spawned = false;
  const run: Run = { posJerk: 0, rotStep: 0, rotJerk: 0, correction: 0, corrections: 0 };
  let prevPos: V3 | null = null, prevStep: V3 | null = null, prevRot: Q | null = null, prevSpin: Q | null = null;
  for (let t = 1; t <= end; t++) {
    now = t * TICK_MS;
    // Server tick t: inputs that arrived, one step, a snapshot every 2 ticks.
    while (up.length && up[0].at <= t) {
      const m = up.shift()!.m;
      q.push(m.seq, { p: m.p, r: m.r, y: m.y, th: m.th, ab: m.ab, g: m.g, br: m.br });
    }
    const n = q.next();
    if (n.inp) server = stepFlight(server, n.inp, SPEC, { turbo: false, wind: AIR_ENV.wind(t), ground: AIR_ENV.ground(server.pos.x, server.pos.z) });
    if (drift) server = { ...server, pos: { ...server.pos, x: server.pos.x + drift } };
    if (t % 2 === 0) down.push({ at: downA(t), fs: server, ack: q.ack, tick: t });
    // Client frame t: messages that arrived, then one input tick, then draw.
    const before = own.state();
    let got = false;
    while (down.length && down[0].at <= t) {
      const s = down.shift()!;
      link.received(now);
      shaper.received();
      own.snap(toWire(s.fs), s.ack, !spawned, aircraft, s.tick);
      spawned = true;
      got = true;
    }
    const after = own.state(); // the frame's reconcile (snapshots are coalesced per frame)
    if (got && before && after && t > from) {
      const c = dist(before.pos, after.pos);
      run.correction = Math.max(run.correction, c);
      if (c > 0.01) run.corrections++;
    }
    own.tick({ stick: pilot(t), fire: false, missile: false, flare: false, bomb: false }, { send: (m) => shaper.send(m) }, link.silentMs(now));
    const drawn = own.render(1 / 60);
    if (!drawn) continue;
    if (t > from) {
      if (prevPos && prevStep) run.posJerk = Math.max(run.posJerk, len(sub(sub(drawn.pos, prevPos), prevStep)));
      if (prevRot) {
        const spin = qMul(drawn.rot, qConj(prevRot));
        run.rotStep = Math.max(run.rotStep, deg(angle(drawn.rot, prevRot)));
        if (prevSpin) run.rotJerk = Math.max(run.rotJerk, deg(angle(spin, prevSpin)));
        prevSpin = spin;
      }
    }
    prevStep = prevPos ? sub(drawn.pos, prevPos) : null;
    prevPos = drawn.pos;
    prevRot = drawn.rot;
  }
  return run;
}

const gentle: StickInput = { p: 0.3, r: 0.15, y: 0, th: 1, ab: false };
/** Turning gently, then during the stall the pilot rolls the other way and pulls hard. */
const changes: Pilot = (t) => (t >= STALL_AT + 10 && t < STALL_AT + 70 ? { p: 1, r: -0.8, y: 0.3, th: 0.5, ab: false } : gentle);
/** One steady turn throughout: the server's repeat is exactly what the pilot holds. */
const holds: Pilot = () => gentle;
/** Weaving: rolls left and right every second. */
const weave: Pilot = (t) => ({ p: 0.6, r: Math.floor(t / 60) % 2 ? 0.7 : -0.7, y: 0, th: 1, ab: false });

const fmt = (r: Run) => Object.entries(r).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(" ");
const check = (r: Run, max: Partial<Run>) => {
  for (const [k, v] of Object.entries(max) as [keyof Run, number][]) assert.ok(r[k] <= v, `${k} ${r[k].toFixed(2)} > ${v} (${fmt(r)})`);
};

// Bounds come from the pre-v3 client on this same harness (main at b45324a):
// where it did better, the bound is its number. Per 60 Hz frame:
//                                   pos jerk  rot jerk  max correction
//   two-way 1.5 s, steering          202 m     108°      217 m
//   two-way 1.5 s, steady turn       164 m      31°      164 m
//   two-way 3 s, steering            858 m     134°      852 m
//   downlink-only 1.5 s, steering    3.3 m     5.3°      21.2 m
//   downlink-only 0.6 s, steering    0.47 m    0.2°      3.0 m
//   clumps 300 / 400 ms              0.48 / 0.52 m       3.19 / 3.39 m
//   300 ms hold every 600 ms         0.49 m              3.19 m
//   repeated 1.2 s two-way stalls    96.5 m    174°      95.8 m
// A reconcile changes the physics velocity at once (only position and
// attitude are smoothed), so a steering stall still shows a few metres of
// jerk on the recovery frame: 2.5 m/frame of glide plus the velocity change.

test("a 1.5 s two-way stall the pilot steers through: recovery glides, no jump", (t) => {
  const r = fly(changes, stall(90), stall(90), 630);
  t.diagnostic(fmt(r));
  check(r, { posJerk: 6, rotJerk: 3, rotStep: 6 }); // F-16 roll 4.2 rad/s = 4°/frame plus a 2°/frame correction
});

test("a 1.5 s two-way stall in a steady turn: prediction stays on the server path", (t) => {
  const r = fly(holds, stall(90), stall(90), 630);
  t.diagnostic(fmt(r));
  // The server's queue drops part of the burst: a tick or two of timing (3.7 m each) is re-anchored.
  check(r, { correction: 8, posJerk: 0.5 });
});

test("a 3 s two-way stall: at most one snap, smaller than before", (t) => {
  const r = fly(changes, stall(180), stall(180), 720);
  t.diagnostic(fmt(r));
  // The pilot pulled for the first second while the server repeated the gentle turn:
  // ~600 m apart, beyond the 300 m glide, so the position snaps once; the nose still turns at 120°/s.
  check(r, { correction: 852, posJerk: 857, rotJerk: 3 });
});

// Downlink-only quiet: the server keeps getting inputs until the shaper
// holds them (1 s); prediction keeps the pilot's stick until then.
test("a 1.5 s downlink-only stall corrects no more than before", (t) => {
  const r = fly(changes, plain, stall(90), 630);
  t.diagnostic(fmt(r));
  check(r, { correction: 21.2, posJerk: 3.3, rotJerk: 5.3 });
});

test("a 0.6 s downlink-only stall corrects no more than before", (t) => {
  const r = fly(changes, plain, stall(36), 630);
  t.diagnostic(fmt(r));
  check(r, { correction: 3.0, posJerk: 0.47, rotJerk: 0.22 }); // main: 0.21° (rounded)
});

// Clumpy and gappy delivery (review C1): reconciliation must never starve.
// The server drifts 3 m/s sideways (unpredictable), so every reconcile
// corrects a little; starved, the drift piles up.
const DRIFT = 0.05;
for (const [every, mainCorr, mainJerk] of [[18, 3.19, 0.48], [24, 3.39, 0.52]]) {
  test(`downlink in ${every * 1000 / 60} ms clumps for 10 s reconciles every clump, then no jump`, (t) => {
    const during = fly(weave, plain, clumpy(every, 720), 720, 120, DRIFT);
    t.diagnostic(`during: ${fmt(during)}`);
    assert.ok(during.corrections >= 600 / every - 2, `only ${during.corrections} corrections in 10 s`);
    check(during, { correction: mainCorr, posJerk: mainJerk });
    const after = fly(weave, plain, clumpy(every, 720), 900, 720, DRIFT);
    t.diagnostic(`after: ${fmt(after)}`);
    check(after, { correction: 3, posJerk: 0.5 });
  });
}

test("a 300 ms hold every 600 ms: corrections as small as before", (t) => {
  const r = fly(weave, plain, gappy(36, 18), 720, 120, DRIFT);
  t.diagnostic(fmt(r));
  assert.ok(r.corrections >= 150, `only ${r.corrections} corrections in 10 s`);
  check(r, { correction: 3.19, posJerk: 0.49 });
});

test("repeated 1.2 s two-way stalls: corrections keep coming and glide", (t) => {
  const r = fly(weave, gappy(90, 72), gappy(90, 72), 1320, 120, DRIFT);
  t.diagnostic(fmt(r));
  assert.ok(r.corrections >= 100, `only ${r.corrections} corrections in 20 s`);
  check(r, { correction: 150, posJerk: 6, rotJerk: 3 });
});
