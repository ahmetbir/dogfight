import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Particles } from "./particles.ts";

const LOOK = { color: new THREE.Color(1, 1, 1), size: [1, 2] as [number, number], alpha: 1, life: 10, drag: 0, lift: 0 };

test("a lowered limit caps live particles; raising it restores the pool", () => {
  const p = new Particles(8, false);
  p.setLimit(4);
  for (let i = 0; i < 10; i++) p.emit(0, 0, 0, 0, 0, 0, LOOK);
  assert.equal(p.count, 4);
  p.setLimit(100); // clamped to the allocated 8
  for (let i = 0; i < 10; i++) p.emit(0, 0, 0, 0, 0, 0, LOOK);
  assert.equal(p.count, 8);
});
