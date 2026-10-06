import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assign, blastGain, crackle, doppler, edgeFade, listenerUp, nearest, pinkNoise, roarCutoff, roarGain,
  spool, whineFreq, whineGain, windFreq, windGain, FLYBY_RANGE_M,
} from "./jetmath.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test("roar opens from a dull idle hiss to a broadband roar", () => {
  near(roarCutoff(0), 400);
  near(roarCutoff(1), 6000);
  assert.ok(roarCutoff(0.5) > 1000 && roarCutoff(0.5) < 2500, "exponential sweep");
  assert.ok(roarGain(0) > 0, "idle is not silent");
  assert.ok(roarGain(1) > 2 * roarGain(0));
  assert.ok(blastGain(1) > 4 * blastGain(0));
  near(roarCutoff(5), roarCutoff(1)); // clamped
});

test("turbine whine sits in 1.5–4.5 kHz and is audible at idle", () => {
  near(whineFreq(0), 1500);
  near(whineFreq(1), 4500);
  assert.ok(whineGain(0) > 0);
  assert.ok(whineGain(1) > whineGain(0));
});

test("spool follows the throttle with a ~1–2 s time constant", () => {
  let r = 0;
  for (let i = 0; i < 60; i++) r = spool(r, 1, 1 / 60); // 1 s up
  assert.ok(r > 0.4 && r < 0.65, `after 1 s up: ${r}`);
  for (let i = 0; i < 300; i++) r = spool(r, 1, 1 / 60);
  assert.ok(r > 0.97, "settles");
  let d = 1;
  for (let i = 0; i < 60; i++) d = spool(d, 0, 1 / 60); // 1 s down
  assert.ok(d > 0.3 && d < 0.5, `after 1 s down: ${d}`);
  assert.equal(spool(0.3, 1, 0), 0.3, "no time, no change");
  assert.ok(spool(0, 1, 10) <= 1, "a long frame never overshoots");
});

test("wind rises with airspeed, silent when parked", () => {
  assert.equal(windGain(0), 0);
  assert.equal(windGain(15), 0);
  assert.ok(windGain(150) > 0);
  assert.ok(windGain(300) > windGain(150));
  near(windGain(1000), windGain(320));
  assert.ok(windFreq(300) > windFreq(50));
});

test("nearest picks the 3 closest living planes inside the range", () => {
  const at = (id: number, x: number) => ({ id, pos: { x, y: 0, z: 0 } });
  const ear = { x: 0, y: 0, z: 0 };
  const got = nearest(ear, [at(1, 500), at(2, 50), at(3, 700), at(4, 100), at(5, 300), at(6, -20)], 3);
  assert.deepEqual(got.map((p) => p.id), [6, 2, 4]);
  assert.deepEqual(nearest(ear, [at(1, FLYBY_RANGE_M + 1)], 3), []);
  assert.deepEqual(nearest(ear, [], 3), []);
});

test("flyby gain fades to zero at the range edge", () => {
  assert.equal(edgeFade(0), 1);
  assert.equal(edgeFade(400), 1);
  assert.ok(edgeFade(500) > 0 && edgeFade(500) < 1);
  assert.equal(edgeFade(FLYBY_RANGE_M), 0);
  assert.equal(edgeFade(5000), 0);
});

test("doppler raises pitch while closing, lowers it while opening", () => {
  const ear = { x: 0, y: 0, z: 0 };
  const still = { x: 0, y: 0, z: 0 };
  near(doppler({ x: 100, y: 0, z: 0 }, { x: -100, y: 0, z: 0 }, ear, still), 343 / 243);
  near(doppler({ x: 100, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, ear, still), 343 / 443);
  near(doppler({ x: 100, y: 0, z: 0 }, { x: 0, y: 50, z: 0 }, ear, still), 1); // crossing
  const f = doppler({ x: 1, y: 0, z: 0 }, { x: -400, y: 0, z: 0 }, ear, still);
  assert.ok(f <= 2, "clamped near Mach 1");
  near(doppler(ear, { x: -400, y: 0, z: 0 }, ear, still), 1); // same point
});

test("listener up is unit, perpendicular to forward, and survives a vertical forward", () => {
  for (const f of [{ x: 0, y: 0, z: -1 }, { x: 0.6, y: 0.8, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }]) {
    const u = listenerUp(f);
    near(Math.hypot(u.x, u.y, u.z), 1, 1e-9);
    near(u.x * f.x + u.y * f.y + u.z * f.z, 0, 1e-9);
  }
});

test("pink noise is normalized and loops without a seam click", () => {
  let s = 1;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const n = 48000;
  const x = pinkNoise(n, 4000, rand);
  assert.equal(x.length, n);
  let sq = 0;
  let step = 0;
  for (let i = 0; i < n; i++) {
    sq += x[i] * x[i];
    if (i > 0) step += Math.abs(x[i] - x[i - 1]);
  }
  near(Math.sqrt(sq / n), 0.3, 1e-3);
  const meanStep = step / (n - 1);
  assert.ok(Math.abs(x[0] - x[n - 1]) < 6 * meanStep, "seam step is like any other step");
});

test("crackle is sparse pops, not continuous noise", () => {
  const rand = Math.random;
  const sr = 8000;
  const x = crackle(sr * 4, sr, rand);
  let zero = 0;
  let peak = 0;
  for (const v of x) {
    if (v === 0) zero++;
    peak = Math.max(peak, Math.abs(v));
  }
  assert.ok(zero / x.length > 0.5, `mostly silence: ${zero / x.length}`);
  assert.ok(zero / x.length < 0.97, "but it does pop");
  assert.ok(peak <= 1 && peak > 0.2);
});

test("assign keeps a plane on its voice, fills free voices, drops the rest", () => {
  assert.deepEqual(assign([0, 0, 0], [5, 7]), [5, 7, 0]);
  assert.deepEqual(assign([5, 7, 9], [9, 5, 7]), [5, 7, 9], "same set: nobody moves");
  assert.deepEqual(assign([5, 7, 9], [9, 4, 5]), [5, 4, 9], "7 left: 4 takes its voice");
  assert.deepEqual(assign([5, 7, 9], []), [0, 0, 0]);
  assert.deepEqual(assign([0, 0], [1, 2, 3]), [1, 2], "more picks than voices");
});
