import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeHeights, heightAt } from "./heightmap.ts";

const data: { size: number; res: number; heights: string; points: [number, number, number][] } = JSON.parse(
  readFileSync(new URL("../../../testdata/vectors/terrain.json", import.meta.url), "utf8"),
);

test("decodeHeights reads little-endian uint16", () => {
  // bytes 01 02 ff 00 → 0x0201, 0x00ff
  assert.deepEqual([...decodeHeights("AQL/AA==")], [0x0201, 0x00ff]);
  assert.equal(decodeHeights(data.heights).length, data.res * data.res);
});

test("heightAt matches Go terrain vectors", () => {
  const h = decodeHeights(data.heights);
  assert.equal(data.points.length, 20);
  for (const [x, z, want] of data.points) {
    const got = heightAt(h, data.size, data.res, x, z);
    assert.ok(Math.abs(got - want) <= 1e-9, `heightAt(${x}, ${z}) = ${got}, want ${want}`);
  }
});
