import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { airframe } from "../game/airframe.ts";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildModel, imgTextures } from "./models.ts";
import { measure } from "./shape.ts";

const KINDS = ["f16", "f15", "mig29", "su27"];

/** Triangles under g; the landing gear (hidden in flight) has its own budget. */
function triangles(g: THREE.Object3D, gear = false): number {
  let n = 0;
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    let inGear = false;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name === "gear") inGear = true;
    if (inGear !== gear) return;
    const geo = o.geometry as THREE.BufferGeometry;
    n += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
  });
  return n;
}

for (const kind of KINDS) {
  test(`${kind} model budget and orientation`, () => {
    for (const team of ["nato", "soviet", "none"] as const) {
      const g = buildModel(kind, team);
      g.updateMatrixWorld(true);
      assert.ok(triangles(g) <= 600, `${kind}: ${triangles(g)} triangles`);
      const bb = new THREE.Box3().setFromObject(g.children[0]); // airframe, without flames
      const len = bb.max.z - bb.min.z;
      // A failed .glb leaves the jet its true size.
      assert.ok(Math.abs(len - airframe(kind).length) < 1e-3, `${kind}: length ${len}, want ${airframe(kind).length}`);
      // Nose toward -Z: the nose reaches well ahead of the middle.
      assert.ok(bb.min.z < -0.4 * len, `${kind}: nose at ${bb.min.z}`);
      assert.ok(Math.abs(bb.max.x + bb.min.x) < 1e-6, `${kind}: not symmetric`);
      assert.ok(g.getObjectsByProperty("name", "ab").length >= 1);
      assert.ok(g.getObjectsByProperty("name", "idle").length >= 1);
      assert.ok(measure(g).tip.x > 4, `${kind}: wingtip`);
      const gear = g.getObjectByName("gear");
      assert.ok(gear, `${kind}: gear group`);
      const gb = new THREE.Box3().setFromObject(gear!);
      assert.ok(Math.abs(gb.min.y + 2.5) < 0.05, `${kind}: wheels must touch y=-2.5 (sim GearHeight), got ${gb.min.y}`);
      assert.equal(gear!.visible, false, "gear starts retracted");
      assert.ok(triangles(g, true) <= 200, `${kind}: gear ${triangles(g, true)} triangles`);
    }
  });
}

test("team colors differ", () => {
  const color = (team: "nato" | "soviet" | "none", own = false) => {
    const mesh = buildModel("f16", team, own).children[0].children[0] as THREE.Mesh;
    return (mesh.material as THREE.MeshLambertMaterial).color.getHexString();
  };
  assert.equal(color("nato"), "9aa3ad");
  assert.equal(color("soviet"), "a8b8c0");
  assert.equal(color("none", true), "e8b33a");
});

// CSP forbids fetching blob: textures, so imgTextures must replace the parser's
// image loader. It does so through an internal field of three's GLTFParser:
// this fails if a three upgrade renames or rebuilds it.
test("imgTextures swaps the parser's ImageBitmapLoader for a TextureLoader", async () => {
  const g = globalThis as { createImageBitmap?: unknown };
  const saved = g.createImageBitmap;
  g.createImageBitmap = () => undefined; // three picks ImageBitmapLoader when this exists
  try {
    const seen: string[] = [];
    const probe = (when: string) => (parser: { textureLoader?: unknown }) => {
      seen.push(`${when}:${parser.textureLoader?.constructor?.name}`);
      return { name: `probe_${when}` };
    };
    const loader = new GLTFLoader();
    loader.register(probe("before"));
    loader.register(imgTextures);
    loader.register(probe("after"));
    await new Promise((resolve, reject) => loader.parse(JSON.stringify({ asset: { version: "2.0" } }), "", resolve, reject));
    assert.deepEqual(seen, ["before:ImageBitmapLoader", "after:TextureLoader"]);
  } finally {
    g.createImageBitmap = saved;
  }
});
