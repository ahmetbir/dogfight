import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { BaseInfo } from "../net/protocol.ts";
import { decodeHeights } from "../render/heightmap.ts";
import { groundSample, surfaceAt } from "./surface.ts";

type MapVec = {
  kind: string; size: number; res: number; heights: string; map: { bases: BaseInfo[] }; points: number[][];
  hangarBoxes: number[][][];
};
const data: { maps: MapVec[] } = JSON.parse(readFileSync(new URL("../../../testdata/vectors/maps.json", import.meta.url), "utf8"));

assert.equal(data.maps.length, 4);
for (const m of data.maps) {
  test(`surface and ground vectors: ${m.kind}`, () => {
    const h = decodeHeights(m.heights);
    assert.equal(m.points.length, 40);
    for (const [x, z, surf, ground] of m.points) {
      assert.equal(surfaceAt(m.map.bases, x, z), surf, `${m.kind} surf at ${x},${z}`);
      const g = groundSample(h, m.size, m.res, m.map.bases, x, z);
      assert.ok(Math.abs(g.h - ground) <= 1e-9, `${m.kind} ground at ${x},${z}: ${g.h} vs ${ground}`);
    }
    // Every surface kind is exercised, and each side carries 6 hangars × 4 boxes for the hangar meshes.
    assert.deepEqual(new Set(m.points.map((p) => p[2])), new Set([0, 1, 2]));
    assert.deepEqual(m.hangarBoxes.map((b) => b.length), [24, 24]);
  });
}
