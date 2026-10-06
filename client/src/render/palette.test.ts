import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { baseColor, PALETTES, paletteFor } from "./palette.ts";

test("one palette per map kind; unknown falls back to the island", () => {
  assert.deepEqual(Object.keys(PALETTES).sort(), ["ada", "col", "dag", "sehir"]);
  assert.equal(paletteFor("mars"), PALETTES.ada);
  assert.equal(paletteFor("col").seaOpacity, 1, "the desert has no sea: an opaque sand plane");
  for (const p of Object.values(PALETTES)) {
    for (const c of [p.sand, p.grassLow, p.grassHigh, p.rock, p.snow, p.seabed, p.sea]) assert.match(c, /^#[0-9a-f]{6}$/);
  }
});

test("snow only above the palette's snow line", () => {
  const c = new THREE.Color();
  const dag = PALETTES.dag;
  assert.equal(baseColor(dag.snowLine + 50, 0.1, dag, c).getHexString(), new THREE.Color(dag.snow).getHexString());
  assert.notEqual(baseColor(dag.snowLine + 50, 0.1, PALETTES.col, c).getHexString(), new THREE.Color(PALETTES.col.snow).getHexString());
});
