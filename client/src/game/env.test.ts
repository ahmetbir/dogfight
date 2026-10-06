import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GameState } from "./state.ts";
import { flightEnv } from "./env.ts";
import { Predictor } from "../predict/predictor.ts";
import { stepFlight, type FlightState } from "../sim/flight.ts";
import { windAt } from "../sim/wind.ts";

const vec = JSON.parse(readFileSync(new URL("../../../testdata/vectors/maps.json", import.meta.url), "utf8")).maps[0];

function stateWithMap(): GameState {
  const s = new GameState();
  s.apply({ t: "welcome", you: 1, code: "ABCD", mode: "team", aircraft: [], tick: 0,
    terrain: { size: vec.size, res: vec.res, heights: vec.heights, spots: [], seed: "1" }, map: vec.map } as never, 0);
  return s;
}

test("flightEnv samples the runway and pavement", () => {
  const env = flightEnv(stateWithMap(), false);
  const b = vec.map.bases[0];
  const g = env.ground(b.c[0], b.c[2]);
  assert.equal(g.surf, 1);
  assert.ok(Math.abs(g.h - b.c[1]) < 1e-6, `elevation ${g.h} vs ${b.c[1]}`); // c is rounded to 1 cm on the wire
  assert.deepEqual(env.wind(100), { x: 0, y: 0, z: 0 });
});

// Wiring only: Go parity of stepFlight/ground comes from flight.json and maps.json.
test("predictor taxis on the map ground like TS stepFlight", () => {
  const env = flightEnv(stateWithMap(), false);
  const b = vec.map.bases[0];
  const spec = { maxSpeed: 230, maxSpeedAB: 290, accel: 48, rollRate: 4.2, pitchRate: 1.6, yawRate: 0.5, cornerSpeed: 170, rotateSpeed: 78 };
  const start = { pos: { x: b.c[0], y: b.c[1] + 2.5, z: b.c[2] }, rot: { w: 1, x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, th: 0, gear: true, ground: true };
  const pr = new Predictor(spec);
  pr.reset(start);
  const inp = { p: 0, r: 0, y: 0, th: 0.3, ab: false, g: true };
  let want: FlightState = start;
  for (let seq = 1; seq <= 30; seq++) {
    pr.push(seq, inp, seq, env);
    want = stepFlight(want, inp, spec, { turbo: false, ground: env.ground(want.pos.x, want.pos.z), wind: env.wind(seq) });
  }
  assert.deepEqual(pr.state(), want);
  assert.equal(pr.state().ground, true);
  assert.ok(Math.abs(pr.state().pos.y - (b.c[1] + 2.5)) < 1e-6, "rolls on the runway, not at sea level");
});

test("without a map the env is flat sea", () => {
  const env = flightEnv(new GameState(), true);
  assert.equal(env.turbo, true);
  assert.deepEqual(env.ground(10, 20), { h: 0, surf: 0 });
});

test("flightEnv wind follows the welcome weather", () => {
  const s = stateWithMap();
  s.weather = { kind: "firtina", wind: [6, 0, -4], gust: 2, lockMul: 0.7 };
  const env = flightEnv(s, false);
  assert.deepEqual(env.wind(600), windAt({ x: 6, y: 0, z: -4 }, 2, 600));
});
