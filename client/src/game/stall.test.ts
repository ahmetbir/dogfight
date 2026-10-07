// A network stall, end to end on the client path: the real OwnPlane (input
// sequencing, prediction, smoother), the real core Shaper and link monitor,
// against a server path computed with the Go-parity models (the session
// queue of core/room/queue.go and the shared flight model). Both directions
// go dark for 1.5 s; TCP then delivers what was sent meanwhile in one burst.
// The drawn plane must not jump on recovery.
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
const LAT = 9;           // ticks one way (150 ms, 300 ms round trip)
const STALL_AT = 240;    // tick the network goes dark (after 4 s of flight)
const STALL_TICKS = 90;  // 1.5 s
const END = STALL_AT + STALL_TICKS + 300;

type Pilot = (t: number) => StickInput;
type Run = { posJerk: number; rotStep: number; rotJerk: number; maxOffset: number; correction: number };

const toWire = (fs: FlightState): PlaneJSON => ({
  id: 1, k: "f16", tm: "none", p: [fs.pos.x, fs.pos.y, fs.pos.z], q: [fs.rot.w, fs.rot.x, fs.rot.y, fs.rot.z],
  v: [fs.vel.x, fs.vel.y, fs.vel.z], th: fs.th, hp: 100, a: true, ht: 0, oh: false, ms: 4, fl: 6,
  gr: fs.gear, gd: fs.ground, w: fs.w ? [fs.w.x, fs.w.y, fs.w.z] : undefined, abh: fs.abh, abl: fs.abl,
});
const angle = (a: Q, b: Q) => 2 * Math.acos(Math.min(1, Math.abs(a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z)));
const deg = (r: number) => (r * 180) / Math.PI;

/** When a packet sent at tick t with one-way latency LAT arrives (TCP: in order, held through the stall). */
function arrival(t: number): number {
  const at = t + LAT;
  if (at < STALL_AT) return at;
  if (t < STALL_AT + STALL_TICKS) return STALL_AT + STALL_TICKS + LAT; // retransmitted after the stall
  return at;
}

function fly(pilot: Pilot): Run {
  const s0: FlightState = { pos: v3(0, 2000, 0), rot: qIdentity(), vel: v3(0, 0, -220), th: 1 };
  const own = new OwnPlane(() => AIR_ENV);
  const link = new LinkMonitor(0);
  const up: { at: number; m: In }[] = [];
  const down: { at: number; fs: FlightState; ack: number; tick: number }[] = [];
  let now = 0;
  const shaper = new Shaper<ClientMsg>({
    now: () => now, setTimeout: () => 0, clearTimeout: () => {}, buffered: () => 0,
    write: (m) => { up.push({ at: arrival(now / TICK_MS), m: m as In }); return true; },
  }, POLICY);
  const q = new SessionModel<StickInput>();
  let server = s0;
  let spawned = false;
  const run: Run = { posJerk: 0, rotStep: 0, rotJerk: 0, maxOffset: 0, correction: 0 };
  let prevPos: V3 | null = null, prevStep: V3 | null = null, prevRot: Q | null = null, prevSpin: Q | null = null;
  for (let t = 1; t <= END; t++) {
    now = t * TICK_MS;
    // Server tick t: inputs that arrived, one step, a snapshot every 2 ticks.
    while (up.length && up[0].at <= t) {
      const m = up.shift()!.m; // arrival() is monotonic: TCP order
      q.push(m.seq, { p: m.p, r: m.r, y: m.y, th: m.th, ab: m.ab, g: m.g, br: m.br });
    }
    const n = q.next();
    if (n.inp) server = stepFlight(server, n.inp, SPEC, { turbo: false, wind: AIR_ENV.wind(t), ground: AIR_ENV.ground(server.pos.x, server.pos.z) });
    if (t % 2 === 0) down.push({ at: arrival(t), fs: server, ack: q.ack, tick: t });
    // Client frame t: messages that arrived, then one input tick, then draw.
    while (down.length && down[0].at <= t) {
      const s = down.shift()!;
      link.received(now);
      shaper.received();
      const before = own.state();
      own.snap(toWire(s.fs), s.ack, !spawned, aircraft, s.tick);
      spawned = true;
      const after = own.state();
      if (before && after && t > STALL_AT) run.correction = Math.max(run.correction, dist(before.pos, after.pos));
    }
    own.tick({ stick: pilot(t), fire: false, missile: false, flare: false, bomb: false }, { send: (m) => shaper.send(m) }, link.silentMs(now));
    const drawn = own.render(1 / 60);
    if (!drawn) continue;
    if (t > 120) {
      run.maxOffset = Math.max(run.maxOffset, dist(drawn.pos, own.state()!.pos));
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

const fmt = (r: Run) => Object.entries(r).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(" ");

// Bounds per drawn frame (60 Hz). The pre-v3 client reached 20 m / 70° here:
// a 0.1 s correction of the recovery burst and a teleport above 50 m.
const POS_JERK_M = 2.5; // change of the frame step, m
const ROT_JERK_DEG = 2.5; // change of the frame rotation, degrees
const ROT_STEP_DEG = 6;   // F-16 roll rate 4.2 rad/s = 4°/frame plus a 2°/frame correction

test("a 1.5 s stall the pilot steers through: recovery glides, no jump", (t) => {
  const r = fly(changes);
  t.diagnostic(fmt(r));
  assert.ok(r.posJerk < POS_JERK_M, `position jerk ${r.posJerk.toFixed(2)} m/frame`);
  assert.ok(r.rotJerk < ROT_JERK_DEG, `rotation jerk ${r.rotJerk.toFixed(2)}°/frame`);
  assert.ok(r.rotStep < ROT_STEP_DEG, `rotation step ${r.rotStep.toFixed(2)}°/frame`);
});

test("a 1.5 s stall in a steady turn: prediction stays on the server path", (t) => {
  const r = fly(holds);
  t.diagnostic(fmt(r));
  // The server's queue drops part of the burst: a tick or two of timing (3.7 m each) is re-anchored.
  assert.ok(r.correction < 8, `recovery correction ${r.correction.toFixed(2)} m`);
  assert.ok(r.posJerk < 0.5, `position jerk ${r.posJerk.toFixed(2)} m/frame`);
});
