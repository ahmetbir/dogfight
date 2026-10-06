import { test } from "node:test";
import assert from "node:assert/strict";
import { GameState, toFlight } from "./state.ts";
import type { PlaneJSON, Snap, Welcome } from "../net/protocol.ts";

const welcome = (you: number): Welcome => ({
  t: "welcome", you, code: "ABCD", mode: "ffa", tick: 10,
  aircraft: [{ kind: "f16", name: "F-16", team: "nato", maxHP: 100, maxSpeed: 230, maxSpeedAB: 290, accel: 48,
    rollRate: 4.2, pitchRate: 1.6, yawRate: 0.5, cornerSpeed: 170, lockRange: 1200, missiles: 4, flares: 6, rotateSpeed: 78 }],
  terrain: { size: 10000, res: 2, heights: "", spots: [], seed: "1" },
  map: { kind: "ada", bases: [], bld: [] },
  weather: { kind: "firtina", wind: [6, 0, -4], gust: 6, lockMul: 0.7 }, start: "hava",
});
const plane = (id: number, x: number, a = true): PlaneJSON => ({
  id, k: "f16", tm: "none", p: [x, 1500, 0], q: [1, 0, 0, 0], v: [0, 0, -200], th: 1, hp: 100,
  a, ht: 0, oh: false, ms: 4, fl: 6,
});
const snap = (tick: number, planes: PlaneJSON[], ev: Snap["ev"] = []): Snap =>
  ({ t: "snap", tick, wt: tick, ack: tick, planes, missiles: [], pu: [], ev });

test("welcome stores identity and aircraft, and resets room state", () => {
  const s = new GameState();
  s.apply(welcome(3), 0);
  s.apply(snap(12, [plane(3, 0), plane(4, 10)]), 100);
  s.apply({ t: "players", list: [{ id: 4, name: "Bot", team: "none", kind: "f16", bot: true }] }, 100);
  assert.equal(s.you, 3);
  assert.equal(s.code, "ABCD");
  assert.equal(s.map!.kind, "ada");
  assert.equal(s.aircraft.get("f16")!.maxHP, 100);
  assert.equal(s.players.get(4)!.name, "Bot");
  assert.equal(s.interp.size, 1);
  s.apply(welcome(7), 200); // reconnect: new player id, fresh state
  assert.equal(s.you, 7);
  assert.equal(s.planes.size, 0);
  assert.equal(s.interp.size, 0);
  assert.equal(s.players.size, 0);
});

test("snapshots feed interpolation of remote planes only and return their events", () => {
  const s = new GameState();
  s.apply(welcome(1), 0);
  const ev = [{ k: "fire" as const, tick: 2, a: 2, p: [0, 0, 0] as [number, number, number], v: [0, 0, 1] as [number, number, number] }];
  assert.deepEqual(s.apply(snap(2, [plane(1, 0), plane(2, 0)], ev), 1000), ev);
  s.apply(snap(4, [plane(1, 5), plane(2, 10)]), 1033);
  assert.ok(!s.interp.has(1));
  const mid = s.interp.get(2)!.sample((3 * 1000) / 60)!;
  assert.ok(Math.abs(mid.pos.x - 5) < 1e-9);
  assert.equal(s.planes.get(1)!.p[0], 5);
  assert.equal(s.tick, 4);
  assert.equal(s.snapAt, 1033);
  s.apply(snap(6, [plane(1, 5)]), 1066);
  assert.ok(!s.interp.has(2), "gone planes drop their buffer");
});

test("a respawn starts a fresh buffer (no streak from the wreck to the spawn)", () => {
  const s = new GameState();
  s.apply(welcome(1), 0);
  s.apply(snap(2, [plane(2, 0)]), 0);
  s.apply(snap(4, [plane(2, 0, false)]), 33);
  s.apply(snap(6, [plane(2, 3000)]), 66);
  assert.equal(s.interp.get(2)!.size(), 1);
  assert.equal(s.interp.get(2)!.sample(0)!.pos.x, 3000);
});

test("toFlight reorders the wire quaternion", () => {
  const p = plane(1, 0);
  p.q = [0.5, 0.1, 0.2, 0.3];
  assert.deepEqual(toFlight(p).rot, { w: 0.5, x: 0.1, y: 0.2, z: 0.3 });
});

test("toFlight carries gear and ground", () => {
  const p = { id: 1, k: "f16", tm: "nato", p: [0, 0, 0], q: [1, 0, 0, 0], v: [0, 0, 0], th: 0, hp: 90, a: true,
    ht: 0, oh: false, ms: 4, fl: 8, gr: true, gd: true } as PlaneJSON;
  const fs = toFlight(p);
  assert.equal(fs.gear, true);
  assert.equal(fs.ground, true);
});

test("welcome keeps the weather; snapshots keep the world tick apart from the game tick", () => {
  const s = new GameState();
  s.apply(welcome(1), 0);
  assert.deepEqual(s.weather, { kind: "firtina", wind: [6, 0, -4], gust: 6, lockMul: 0.7 });
  s.apply({ ...snap(1210, [plane(1, 0)]), wt: 610 }, 0);
  assert.equal(s.tick, 1210);
  assert.equal(s.wt, 610);
  s.apply({ ...welcome(1), weather: undefined } as never, 10); // no weather on the wire: calm
  assert.equal(s.weather, null);
  assert.equal(s.wt, 0);
});

test("base attack snapshots carry bombs and structure HP", () => {
  const s = new GameState();
  s.apply(welcome(1), 0);
  s.apply({ ...snap(2, [plane(1, 0)]), bo: [{ id: 33554432, p: [1, 2, 3], v: [0, -2, -200] }], st: [{ id: 4194306, hp: 250 }, { id: 4194307, hp: 0 }] }, 0);
  assert.equal(s.bombs.length, 1);
  assert.deepEqual(s.bombs[0].p, [1, 2, 3]);
  assert.equal(s.structs.get(4194306), 250);
  assert.equal(s.structs.get(4194307), 0);
  assert.equal(s.structs.size, 2);
  s.apply(snap(4, [plane(1, 0)]), 33); // no base attack fields: none left over
  assert.equal(s.bombs.length, 0);
  assert.equal(s.structs.size, 0);
  s.apply({ ...snap(6, [plane(1, 0)]), st: [{ id: 4194306, hp: 10 }] }, 66);
  s.apply(welcome(1), 100);
  assert.equal(s.structs.size, 0, "welcome resets structures");
});
