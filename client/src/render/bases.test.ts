import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { BaseInfo } from "../net/protocol.ts";
import { buildBases, centerDashes, hangarParts, runwayLights, thresholdBars } from "./bases.ts";
import { surfaceAt } from "../sim/surface.ts";

type MapVec = { kind: string; map: { bases: BaseInfo[] }; hangarBoxes: number[][][] };
const maps: MapVec[] = JSON.parse(readFileSync(new URL("../../../testdata/vectors/maps.json", import.meta.url), "utf8")).maps;
const bases: BaseInfo[] = maps[1].map.bases;

test("hangar parts surround each hangar floor", () => {
  for (const b of bases) {
    const parts = hangarParts(b);
    assert.equal(parts.length, 4 * b.hangars.length);
    for (const p of parts) assert.ok(p.cy > b.c[1] && p.cy < b.c[1] + 12.01, `part height ${p.cy}`);
  }
});

test("hangar parts match the server's hangar solids on every map (maps.json hangarBoxes)", () => {
  for (const m of maps) {
    m.map.bases.forEach((b, side) => {
      const want = m.hangarBoxes[side];
      const got = hangarParts(b);
      assert.equal(got.length, want.length, `${m.kind}/${b.side}: box count`);
      got.forEach((p, i) => {
        const box = [p.cx - p.sx / 2, p.cy - p.sy / 2, p.cz - p.sz / 2, p.cx + p.sx / 2, p.cy + p.sy / 2, p.cz + p.sz / 2];
        for (let k = 0; k < 6; k++) {
          // Base elevations are rounded to 0.1 m on the wire.
          assert.ok(Math.abs(box[k] - want[i][k]) < 0.06, `${m.kind}/${b.side} box ${i}[${k}]: ${box[k]} vs ${want[i][k]}`);
        }
      });
    });
  }
});

test("runway lights sit on the runway edges, dashes on the centerline", () => {
  for (const b of bases) {
    const lights = runwayLights(b);
    assert.equal(lights.length, 2 * 31);
    for (const l of lights) assert.equal(surfaceAt([b], l.x, l.z), 1);
    for (const d of centerDashes(b)) assert.equal(surfaceAt([b], d.cx, d.cz), 1);
  }
});

test("8 threshold bars at each runway end, clear of the centerline", () => {
  for (const b of bases) {
    const bars = thresholdBars(b);
    assert.equal(bars.length, 2 * 8);
    for (const p of bars) {
      for (const [dx, dz] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) {
        assert.equal(surfaceAt([b], p.cx + (dx * p.sx) / 2, p.cz + (dz * p.sz) / 2), 1, "bar corner on the runway");
      }
      const across = Math.abs((p.cx - b.c[0]) * b.inner[0] + (p.cz - b.c[2]) * b.inner[1]);
      assert.ok(across > 2, `bar ${across} m off the centerline`);
    }
  }
});

test("buildBases makes one group with lights only at night", () => {
  const day = buildBases(bases, false);
  const night = buildBases(bases, true);
  assert.equal(day.name, "bases");
  assert.ok(night.getObjectByName("runway-lights"));
  assert.equal(day.getObjectByName("runway-lights"), undefined);
});
