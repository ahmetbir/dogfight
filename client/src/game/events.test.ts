import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchEvents, pruneDecoys, type EventCtx } from "./events.ts";
import type { ServerEvent } from "./state.ts";

function ctx(you = 1) {
  const log: string[] = [];
  const c: EventCtx = {
    you,
    fx: { sparks: () => void log.push("sparks"), explosion: (_a, big) => void log.push(`boom:${big}`), puff: () => void log.push("puff") },
    bullets: { spawn: (_p, _v, tick, mine) => void log.push(`bullet:${tick}:${mine}`) },
    hooks: {
      hurt: (d) => void log.push(`hurt:${d}`), kill: (v, k, w) => void log.push(`kill:${v}:${k}:${w}`),
      lockedOn: (by) => void log.push(`lock:${by}`), missileLaunch: (_t, me) => void log.push(`mlaunch:${me}`),
      pickup: (it, mine) => void log.push(`pickup:${it}:${mine}`), hitConfirm: () => void log.push("confirm"),
      sound: (n) => { if (n === "flare") log.push("sound:flare"); }, decoy: (atMe, mine) => void log.push(`decoy:${atMe}:${mine}`),
    },
    decoys: new Set<number>(),
  };
  return { c, log };
}
const P: [number, number, number] = [0, 100, 0];

test("own fire events are ignored, others become tracers", () => {
  const { c, log } = ctx();
  dispatchEvents([
    { k: "fire", tick: 5, a: 1, p: P, v: P },
    { k: "fire", tick: 6, a: 2, p: P, v: P },
  ], c);
  assert.deepEqual(log, ["bullet:6:false"]);
});

test("hit/kill/lock/missile/pickup/flare map to effects and hooks", () => {
  const { c, log } = ctx();
  const evs: ServerEvent[] = [
    { k: "hit", tick: 1, a: 1, b: 2, p: P, val: 6 },
    { k: "hit", tick: 1, a: 3, b: 1, p: P, val: 6 },
    { k: "kill", tick: 1, a: 3, b: 1, p: P, w: "cannon" },
    { k: "lock", tick: 1, a: 2, b: 1 },
    { k: "lock", tick: 1, a: 2, b: 3 },
    { k: "mlaunch", tick: 1, a: 9, b: 1, p: P },
    { k: "mgone", tick: 1, a: 9, p: P },
    { k: "pickup", tick: 1, a: 1, p: P, item: "repair" },
    { k: "flare", tick: 1, a: 2, p: P },
  ];
  assert.equal(dispatchEvents(evs, c), false);
  assert.deepEqual(log, [
    "sparks", "hurt:6", "sparks", "confirm", "boom:true", "kill:3:1:cannon", "lock:2",
    "mlaunch:true", "boom:false", "pickup:repair:true", "sound:flare",
  ]);
});

test("a spawn of mine is reported", () => {
  const { c } = ctx(4);
  assert.equal(dispatchEvents([{ k: "spawn", tick: 1, a: 3, p: P, v: P }], c), false);
  assert.equal(dispatchEvents([{ k: "spawn", tick: 1, a: 4, p: P, v: P }], c), true);
});

test("a decoy tells the target and the shooter apart; the decoyed missile ends in a puff, others in a blast", () => {
  const decoy = (you: number) => {
    const { c, log } = ctx(you);
    dispatchEvents([
      { k: "decoy", tick: 1, a: 9, b: 2, o: 3, p: P },
      { k: "mgone", tick: 2, a: 9, p: P },
      { k: "mgone", tick: 2, a: 10, p: P },
    ], c);
    return log;
  };
  assert.deepEqual(decoy(2), ["decoy:true:false", "puff", "boom:false"]); // the target
  assert.deepEqual(decoy(3), ["decoy:false:true", "puff", "boom:false"]); // the shooter
  assert.deepEqual(decoy(4), ["decoy:false:false", "puff", "boom:false"]);
});

test("base attack events drive effects and hooks", () => {
  const calls: string[] = [];
  const fx = { sparks: () => calls.push("sparks"), explosion: (_: unknown, big: boolean) => calls.push(`exp:${big}`), puff: () => {} };
  const spawned: boolean[] = [];
  const bullets = { spawn: (_p: unknown, _v: unknown, _t: number, _m: boolean, aa?: boolean) => { spawned.push(!!aa); } };
  const hooks = { structDown: (id: number, by: number) => calls.push(`down:${id}:${by}`), rearm: (mine: boolean) => calls.push(`rearm:${mine}`) };
  dispatchEvents([
    { k: "boom", tick: 1, a: 99, o: 7, p: [0, 0, 0] },
    { k: "sdown", tick: 1, a: 4194304, b: 7, p: [1, 2, 3] },
    { k: "rearm", tick: 1, a: 5 },
    { k: "fire", tick: 1, a: 0, b: 4194309, w: "aa", p: [0, 0, 0], v: [1, 0, 0] },
  ], { you: 5, fx, bullets, hooks });
  assert.deepEqual(calls, ["exp:true", "exp:true", "down:4194304:7", "rearm:true"]);
  assert.deepEqual(spawned, [true]);
});

test("bomb drops, blasts and AA fire reach the hooks and sounds", () => {
  const log: string[] = [];
  const hooks = {
    bombDrop: (mine: boolean) => void log.push(`bdrop:${mine}`),
    rearm: (mine: boolean) => void log.push(`rearm:${mine}`),
    sound: (name: string, at: { x: number }) => void log.push(`sound:${name}:${at.x}`),
  };
  const spawned: [number, boolean, boolean | undefined][] = [];
  dispatchEvents([
    { k: "bdrop", tick: 1, a: 33554432, o: 5, p: [4, 0, 0], v: [0, -2, -200] },
    { k: "bdrop", tick: 1, a: 33554433, o: 6, p: [5, 0, 0], v: [0, -2, -200] },
    { k: "boom", tick: 2, a: 33554432, o: 5, p: [6, 0, 0] },
    { k: "rearm", tick: 3, a: 6 },
    { k: "fire", tick: 4, a: 0, b: 4194309, w: "aa", p: [7, 0, 0], v: [450, 0, 0] },
    { k: "shit", tick: 4, a: 4194309, b: 5, p: [8, 0, 0], val: 1.5 },
  ], {
    you: 5,
    fx: { sparks: () => void log.push("sparks"), explosion: () => {}, puff: () => {} },
    bullets: { spawn: (_p, _v, tick, mine, aa) => void spawned.push([tick, mine, aa]) },
    hooks,
  });
  assert.deepEqual(log, [
    "bdrop:true", "sound:bomb:4", "bdrop:false", "sound:bomb:5", "sound:explosion:6", "rearm:false", "sound:aa:7", "sparks",
  ]);
  assert.deepEqual(spawned, [[4, false, true]]);
});

test("decoyed missile ids are forgotten once they leave the snapshot (mgone or round reset)", () => {
  const decoys = new Set([9, 10, 11]);
  pruneDecoys(decoys, [{ id: 10 }, { id: 12 }]);
  assert.deepEqual([...decoys], [10]);
  pruneDecoys(decoys, []); // ResetAll: missiles cleared without mgone
  assert.equal(decoys.size, 0);
});
