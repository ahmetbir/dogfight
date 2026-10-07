import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { GlbLibrary } from "./models.ts";

test("the manifest is fetched once, each listed scene loaded once and shared, unlisted kinds never fetched", async () => {
  let manifests = 0;
  const scenes: string[] = [];
  const lib = new GlbLibrary({
    manifest: async () => { manifests++; return ["f16", "f22", 7]; },
    scene: async (url) => { scenes.push(url); return new THREE.Group(); },
  });
  const [a, b, c, d] = await Promise.all([lib.load("f16"), lib.load("f22"), lib.load("f16"), lib.load("zeppelin")]);
  assert.equal(manifests, 1);
  assert.deepEqual(scenes, ["/models/f16.glb", "/models/f22.glb"]);
  assert.ok(a && b && a === c, "one scene per kind, shared");
  assert.equal(d, null);
});

test("a failed manifest means no models, and a failed scene falls back once", async () => {
  const none = new GlbLibrary({ manifest: async () => { throw new Error("offline"); }, scene: async () => new THREE.Group() });
  assert.equal(await none.load("f16"), null);
  let tries = 0;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const bad = new GlbLibrary({ manifest: async () => ["f16"], scene: async () => { tries++; throw new Error("corrupt"); } });
    assert.equal(await bad.load("f16"), null);
    assert.equal(await bad.load("f16"), null);
    assert.equal(tries, 1);
  } finally {
    console.warn = warn;
  }
});
