import { test } from "node:test";
import assert from "node:assert/strict";
import { repickNeeded, SKIN_SETTLE_MS, SkinSync, type Timers } from "./skinsync.ts";

/** A clock the test moves. */
function clock() {
  let now = 0;
  let next = 1;
  const due = new Map<number, { at: number; f: () => void }>();
  const timers: Timers = {
    set: (f, ms) => { const h = next++; due.set(h, { at: now + ms, f }); return h; },
    clear: (h) => { due.delete(h as number); },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const [h, t] = [...due].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0] ?? [];
      if (!t) break;
      now = t.at;
      due.delete(h!);
      t.f();
    }
    now = end;
  };
  return { timers, advance };
}

test("20 paint changes in quick succession send one pick, after they settle", () => {
  const c = clock();
  const sent: string[] = [];
  const s = new SkinSync((k) => sent.push(k), c.timers);
  for (let i = 0; i < 20; i++) {
    s.later("f16");
    c.advance(80); // a held arrow key
  }
  assert.deepEqual(sent, []);
  c.advance(SKIN_SETTLE_MS);
  assert.deepEqual(sent, ["f16"]);
  c.advance(10_000);
  assert.equal(sent.length, 1);
});

test("closing the screen sends a settling paint at once; a pick that carries it cancels it", () => {
  const c = clock();
  const sent: string[] = [];
  const s = new SkinSync((k) => sent.push(k), c.timers);
  s.later("f14");
  s.flush();
  assert.deepEqual(sent, ["f14"]);
  s.flush(); // nothing left
  s.later("f14");
  s.cancel(); // Fly or a loadout click sent a pick with the paint
  c.advance(5000);
  assert.deepEqual(sent, ["f14"]);
});

test("mend: a seat in another paint asks once per (kind, paint), settled", () => {
  const c = clock();
  const sent: string[] = [];
  const s = new SkinSync((k) => sent.push(k), c.timers);
  // reconnect / timeout spawn: the roster says standard, my F-16 is desert
  for (let i = 0; i < 30; i++) { s.mend("f16", "standard", "desert"); c.advance(100); } // the 10 Hz tick
  assert.deepEqual(sent, ["f16"], "one pick, not one per tick");
  s.mend("f16", "desert", "desert"); // the roster caught up
  s.mend("f16", "desert", "winter"); // a new choice is another ask
  c.advance(SKIN_SETTLE_MS);
  assert.deepEqual(sent, ["f16", "f16"]);
  // team switch: a new kind is a new ask too
  s.mend("su27", "standard", "flanker");
  s.mend("su27", "flanker", "flanker"); // already worn before it settled: dropped
  c.advance(SKIN_SETTLE_MS);
  assert.deepEqual(sent, ["f16", "f16"]);
});

test("mend never doubles a paint the player is still browsing", () => {
  const c = clock();
  const sent: string[] = [];
  const s = new SkinSync((k) => sent.push(k), c.timers);
  s.later("f16");
  c.advance(300);
  s.mend("f16", "standard", "night"); // the roster still shows the old paint
  c.advance(SKIN_SETTLE_MS);
  assert.deepEqual(sent, ["f16"]);
});

test("reconnect: the pick goes out again when the new seat lacks my jet, loadout or paint", () => {
  assert.equal(repickNeeded({ kind: "f16" }, "f16", "ir", "standard"), false);
  assert.equal(repickNeeded({ kind: "f16" }, "f16", "ir", "desert"), true, "the paint alone (I1)");
  assert.equal(repickNeeded({ kind: "f16", skin: "desert" }, "f16", "ir", "desert"), false);
  assert.equal(repickNeeded({ kind: "f16" }, "f15", "ir", "standard"), true);
  assert.equal(repickNeeded({ kind: "f16" }, "f16", "radar", "standard"), true);
});
