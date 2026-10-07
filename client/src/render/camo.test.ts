import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { camoTexture, prepareCamo, roleColorOf, sharedMaterials } from "./camo.ts";
import { dressGlb } from "./glb.ts";
import { teamColors } from "./models/common.ts";
import { SCHEMES, SKIN_KINDS, type SkinId } from "./skins.ts";

const IDS = Object.keys(SKIN_KINDS) as SkinId[];

/** A loaded scene's stand-in: a body fuselage, a stripe fin, a canopy, a dark intake, a body aileron offset from the root. */
function scene(): THREE.Group {
  const root = new THREE.Group();
  const mat = (name: string, color: string) => Object.assign(new THREE.MeshStandardMaterial({ color }), { name });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 10), mat("body", "#ffffff"));
  body.name = "airframe";
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2, 2), mat("stripe", "#ffffff"));
  fin.name = "fin";
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat("canopy", "#332211"));
  glass.name = "canopy";
  const dark = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat("dark", "#2d3034"));
  dark.name = "intake";
  const ail = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 0.5), body.material);
  ail.name = "aileron_r";
  ail.position.set(3, 0, 2);
  root.add(body, fin, glass, dark, ail);
  return root;
}

const colorOf = (d: ReturnType<typeof dressGlb>, name: string) =>
  `#${((d.body.getObjectByName(name) as THREE.Mesh).material as THREE.MeshLambertMaterial).color.getHexString()}`;

test("material mapping: every skin on every side keeps the team colour on the stripe", () => {
  for (const team of ["nato", "soviet", "none"] as const) {
    for (const id of IDS) {
      const d = dressGlb(scene(), team, false, id);
      assert.equal(colorOf(d, "fin"), teamColors(team, false).stripe, `${id} ${team}`);
      assert.equal(colorOf(d, "intake"), "#2d3034", "dark parts keep the model's colour");
      const want = SCHEMES[id].body ?? teamColors(team, false).body;
      assert.equal(colorOf(d, "airframe"), want, `${id} body`);
      assert.equal(colorOf(d, "canopy"), SCHEMES[id].canopy ?? "#332211", `${id} canopy`);
      d.release();
    }
  }
  assert.equal(roleColorOf("metal", "nato", false, "night"), null);
});

test("planes of one look share their materials; the last release frees them", () => {
  const src = scene();
  const before = sharedMaterials();
  const a = dressGlb(src, "nato", false, "desert");
  const b = dressGlb(src, "nato", false, "desert");
  const c = dressGlb(src, "soviet", false, "desert");
  assert.equal((a.body.getObjectByName("airframe") as THREE.Mesh).material, (b.body.getObjectByName("airframe") as THREE.Mesh).material);
  assert.notEqual((a.body.getObjectByName("fin") as THREE.Mesh).material, (c.body.getObjectByName("fin") as THREE.Mesh).material, "another team: its own stripe");
  assert.equal((a.body.getObjectByName("aileron_r") as THREE.Mesh).material, (a.body.getObjectByName("airframe") as THREE.Mesh).material);
  const mats = sharedMaterials() - before;
  assert.equal(mats, 8, "4 roles for NATO, 4 for Soviet");
  let disposed = 0;
  for (const m of a.materials) m.addEventListener("dispose", () => disposed++);
  a.release();
  a.release(); // twice is harmless
  assert.equal(disposed, 0, "b still draws with them");
  b.release();
  assert.equal(disposed, 4);
  c.release();
  assert.equal(sharedMaterials(), before);
});

test("pattern textures: one per scheme, nearest filtered and tiled; plain schemes have none", () => {
  for (const id of IDS) {
    const t = camoTexture(id);
    assert.equal(t === null, !SCHEMES[id].pattern, id);
    if (!t) continue;
    assert.equal(camoTexture(id), t, `${id}: made once`);
    assert.equal(t.magFilter, THREE.NearestFilter);
    assert.equal(t.wrapS, THREE.RepeatWrapping);
  }
  const d = dressGlb(scene(), "nato", false, "splinter");
  const body = (d.body.getObjectByName("airframe") as THREE.Mesh).material as THREE.Material;
  assert.equal(body.customProgramCacheKey(), "camo");
  const fin = (d.body.getObjectByName("fin") as THREE.Mesh).material as THREE.Material;
  assert.notEqual(fin.customProgramCacheKey(), "camo", "only the body wears the camo");
  d.release();
});

test("camoPos: body meshes get their rest position in metres behind the nose, once", () => {
  const src = scene();
  prepareCamo(src);
  const air = src.getObjectByName("airframe") as THREE.Mesh;
  const ail = src.getObjectByName("aileron_r") as THREE.Mesh;
  const fin = src.getObjectByName("fin") as THREE.Mesh;
  const pa = air.geometry.getAttribute("camoPos");
  const minZ = Math.min(...Array.from({ length: pa.count }, (_, i) => pa.getZ(i)));
  assert.equal(minZ, 0, "the nose (z = -5) is at 0");
  const pl = ail.geometry.getAttribute("camoPos");
  const xs = Array.from({ length: pl.count }, (_, i) => pl.getX(i));
  assert.ok(Math.min(...xs) >= 2.49 && Math.max(...xs) <= 3.51, "the aileron's own offset is in its pattern position");
  assert.equal(fin.geometry.getAttribute("camoPos"), undefined, "the stripe wears no camo");
  const geo = air.geometry;
  prepareCamo(src);
  assert.equal(air.geometry, geo);
});
