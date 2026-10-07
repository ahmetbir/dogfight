import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { GLB_RETRY_MS, GlbLibrary } from "./models.ts";

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

test("a failed manifest or model is tried again after the backoff, not remembered", async () => {
  let t = 0;
  let manifestOk = false, sceneOk = false, manifests = 0, scenes = 0;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const lib = new GlbLibrary({
      manifest: async () => { manifests++; if (!manifestOk) throw new Error("offline"); return ["f16"]; },
      scene: async () => { scenes++; if (!sceneOk) throw new Error("corrupt"); return new THREE.Group(); },
    }, () => t);
    assert.equal(await lib.load("f16"), null);           // manifest down
    assert.equal(await lib.load("f16"), null);           // inside the backoff: no request
    assert.equal(manifests, 1);
    manifestOk = true;
    t += GLB_RETRY_MS;
    assert.equal(await lib.load("f16"), null);           // manifest fine now, the model fails
    assert.equal(manifests, 2);
    assert.equal(scenes, 1);
    assert.equal(await lib.load("f16"), null);           // backoff again
    assert.equal(scenes, 1);
    sceneOk = true;
    t += GLB_RETRY_MS;
    const g = await lib.load("f16");
    assert.ok(g, "loaded once the server answers");
    assert.equal(await lib.load("f16"), g, "then kept and shared");
    assert.equal(manifests, 2, "a good manifest is kept");
    assert.equal(scenes, 2);
    assert.equal(await lib.load("zeppelin"), null, "not listed: an answer, no fetch");
    assert.equal(scenes, 2);
  } finally {
    console.warn = warn;
  }
});
