import { test } from "node:test";
import assert from "node:assert/strict";
import type { MissileJSON } from "../net/protocol.ts";
import { v3 } from "../sim/vec.ts";
import {
  ammoParts, beamCue, incoming, incomingIR, kindOf, loadoutCounts, loadoutOf, missileText, otherKind, PICK_WIRE, pickedKind, reach, ranges, warnText,
} from "./loadout.ts";

test("loadout counts mirror sim.LoadoutCounts (same table as the Go test)", () => {
  const want: Record<number, [[number, number], [number, number], [number, number]]> = {
    5: [[5, 0], [0, 2], [2, 1]], 6: [[6, 0], [0, 3], [3, 1]], 4: [[4, 0], [0, 2], [2, 1]], 1: [[1, 0], [0, 1], [0, 1]],
  };
  for (const [n, rows] of Object.entries(want)) {
    assert.deepEqual(loadoutCounts(Number(n), "ir"), rows[0]);
    assert.deepEqual(loadoutCounts(Number(n), "radar"), rows[1]);
    assert.deepEqual(loadoutCounts(Number(n), "mixed"), rows[2]);
  }
});

test("wire numbers: lo index, mk/lkk 1 = radar, missing = IR", () => {
  assert.equal(loadoutOf(undefined), "ir");
  assert.equal(loadoutOf(1), "radar");
  assert.equal(loadoutOf(2), "mixed");
  assert.equal(loadoutOf(9), "ir");
  assert.equal(kindOf(undefined), "ir");
  assert.equal(kindOf(1), "radar");
});

test("missile text per loadout", () => {
  assert.equal(missileText(5, 0, "ir"), "5");
  assert.equal(missileText(0, 2, "radar"), "2 R");
  assert.equal(missileText(2, 1, "mixed"), "2 IR + 1 R");
});

test("ranges: radar ×2.2; reach is the longest kind left", () => {
  assert.deepEqual(ranges(1000), { ir: 1000, radar: 2200 });
  assert.equal(reach(1000, 2, 1), 2200);
  assert.equal(reach(1000, 2, 0), 1000);
  assert.equal(reach(1000, 0, 0), 0);
});

test("incoming kind, the IR-only flare distance and the beam cue", () => {
  const me = v3(0, 0, 0);
  const m = (tg: number, z: number, mk?: number): MissileJSON => ({ id: z, tg, p: [0, 0, z], v: [0, 0, 0], ...(mk ? { mk } : {}) });
  const list = [m(1, 500, 1), m(1, 900), m(2, 100)];
  assert.deepEqual(incoming(me, list, 1), { kind: "radar", dist: 500 });
  assert.equal(incomingIR(me, list, 1), 900);
  assert.equal(beamCue(true, list, 1), true);
  assert.equal(beamCue(false, list, 1), false, "dead");
  assert.equal(beamCue(true, [m(1, 900)], 1), false, "IR only: flare, not beam");
  assert.equal(incoming(me, [], 1), null);
  assert.equal(warnText({ kind: "radar", dist: 1200 }, (d) => `${d} m`), "FÜZE UYARISI · RADAR · 1200 m");
  assert.equal(warnText(null, String), "FÜZE UYARISI");
  assert.equal(warnText({ kind: "ir", dist: 650 }, (d) => `${d} m`, 7), "FÜZE UYARISI · IR · 650 m · SAAT 7");
  assert.equal(warnText({ kind: "lock", dist: 900 }, String, 4), "KİLİTLENDİN · SAAT 4");
});

test("a pick fires its kind while it lasts, the other after (sim.pickedKind)", () => {
  assert.equal(pickedKind("ir", 2, 1), "ir");
  assert.equal(pickedKind("radar", 2, 1), "radar");
  assert.equal(pickedKind("ir", 0, 1), "radar");
  assert.equal(pickedKind("radar", 2, 0), "ir");
  assert.equal(pickedKind("ir", 0, 0), "ir");
  assert.equal(pickedKind("radar", 0, 0), "radar");
  assert.equal(otherKind("ir"), "radar");
  assert.deepEqual(PICK_WIRE, { ir: 1, radar: 2 }); // sim.PickIR, sim.PickRadar
});

test("HUD ammo: each kind aboard with its count, the fired one on", () => {
  assert.deepEqual(ammoParts(5, 0, "ir", "ir"), [{ kind: "ir", text: "IR 5", on: true }]);
  assert.deepEqual(ammoParts(0, 2, "radar", "radar"), [{ kind: "radar", text: "RADAR 2", on: true }]);
  assert.deepEqual(ammoParts(2, 1, "mixed", "radar"), [
    { kind: "ir", text: "IR 2", on: false }, { kind: "radar", text: "RADAR 1", on: true },
  ]);
});

test("lock range readout: Mixed shows the picked kind's range, both without a pick", async () => {
  const { rangeText } = await import("./hudtext.ts");
  const v = { lockRange: 1000, missiles: 2, radars: 1, loadout: "mixed" as const, fires: "radar" as const };
  assert.equal(rangeText({ ...v, picked: true }), rangeText({ ...v, loadout: "radar", picked: false }));
  assert.ok(rangeText({ ...v, picked: false }).includes(" / "));
  assert.equal(rangeText({ ...v, fires: "ir", picked: true }), rangeText({ ...v, loadout: "ir", picked: false }));
});
