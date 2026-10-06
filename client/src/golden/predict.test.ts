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
