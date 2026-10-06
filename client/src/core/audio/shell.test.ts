import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioShell, falloff } from "./shell.ts";

const fakeTarget = () => {
  const l = new Map<string, Set<() => void>>();
  return {
    l,
    addEventListener: (t: string, f: () => void) => void (l.get(t) ?? l.set(t, new Set()).get(t)!).add(f),
    removeEventListener: (t: string, f: () => void) => void l.get(t)?.delete(f),
  };
};
const count = (x: { l: Map<string, Set<() => void>> }) => [...x.l.values()].reduce((n, s) => n + s.size, 0);

test("before and without a context every call is a no-op; a gesture without Web Audio stays silent", () => {
  const win = fakeTarget();
  const doc = { ...fakeTarget(), hidden: false };
  let started = 0;
  const a = new AudioShell({ start: () => void started++ }, win as never, doc as never);
  assert.equal(a.live(), false);
  assert.equal(a.context(), null);
  a.setVolume(0.5);
  a.burst({ type: "lowpass", f0: 500, q: 1 }, 0.1, 1);
  a.tone("sine", 400, 800, 0.1, 1);
  for (const f of win.l.get("pointerdown") ?? []) f(); // no AudioContext in Node: stays silent
  for (const f of doc.l.get("visibilitychange") ?? []) f();
  assert.equal(a.live(), false);
  assert.equal(a.context(), null);
  assert.equal(started, 0);
  a.dispose();
});

test("dispose removes exactly the three listeners it added", () => {
  const win = fakeTarget();
  const doc = { ...fakeTarget(), hidden: false };
  const a = new AudioShell({ start: () => {} }, win as never, doc as never);
  assert.deepEqual([count(win), count(doc)], [2, 1]);
  assert.deepEqual([...win.l.keys()].sort(), ["keydown", "pointerdown"]);
  a.dispose();
  assert.deepEqual([count(win), count(doc)], [0, 0]);
});

test("falloff: full volume at the source, half at 500 m", () => {
  assert.equal(falloff(0), 1);
  assert.equal(falloff(-5), 1);
  assert.equal(falloff(500), 0.5);
});
