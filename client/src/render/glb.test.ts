import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import * as THREE from "three";
import { deflection, dressGlb, NEUTRAL, Rig, roleColor } from "./glb.ts";
import { ratesToControls } from "../game/view.ts";

test("roll right raises the right trailing edges and lowers the left", () => {
  const c = { p: 0, r: 1, y: 0 };
  assert.ok(deflection("aileron", "r", c, 0) < 0);
  assert.ok(deflection("aileron", "l", c, 0) > 0);
  assert.ok(deflection("stab", "r", c, 0) < 0);
  assert.ok(deflection("stab", "l", c, 0) > 0);
});

test("pull raises both stabilators, yaw right swings the rudder right, gear lowers the flaps", () => {
  const pull = { p: 1, r: 0, y: 0 };
  assert.ok(deflection("stab", "l", pull, 0) < 0 && deflection("stab", "r", pull, 0) < 0);
  assert.ok(deflection("elevator", "l", pull, 0) < 0);
  assert.ok(deflection("rudder", "", { p: 0, r: 0, y: 1 }, 0) > 0);
  assert.ok(deflection("flap", "l", NEUTRAL, 1) > 0 && deflection("flap", "r", NEUTRAL, 1) > 0);
  assert.equal(deflection("flap", "r", NEUTRAL, 0), 0);
  assert.equal(deflection("canopy", "", pull, 1), 0);
});

test("team roles take the palette, the others keep the model's colour", () => {
  assert.equal(roleColor("body", "nato", false), "#9aa3ad");
  assert.equal(roleColor("stripe", "soviet", false), "#d83b3b");
  assert.notEqual(roleColor("secondary", "nato", false), null);
  assert.equal(roleColor("canopy", "nato", false), null);
  assert.equal(roleColor("dark", "soviet", false), null);
});

test("snapshot rates become stick deflections", () => {
  const spec = { pitchRate: 1.6, rollRate: 4.2, yawRate: 0.5 };
  const c = ratesToControls({ x: 0.8, y: -0.5, z: -8.4 }, spec)!;
  assert.equal(c.p, 0.5);
  assert.equal(c.r, 1);   // clamped
  assert.equal(c.y, 1);   // -w.y: yaw right
  assert.equal(ratesToControls(undefined, spec), undefined);
  assert.equal(ratesToControls({ x: 1, y: 0, z: 0 }, undefined), undefined);
});

/** A hand-built stand-in for a loaded .glb scene. */
function fakeScene(): THREE.Group {
  const root = new THREE.Group();
  const mat = (name: string, color: string) => Object.assign(new THREE.MeshStandardMaterial({ color }), { name });
  const air = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat("body", "#ffffff"));
  air.name = "airframe";
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat("canopy", "#332211"));
  glass.name = "canopy";
  const ail = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 0.3), mat("body", "#ffffff"));
  ail.name = "aileron_r";
  ail.userData = { role: "aileron", axis: [1, 0, 0] };
  const gear = new THREE.Group();
  gear.name = "gear";
  const leg = new THREE.Group();
  leg.name = "gear_nose";
  leg.userData = { retract: [1, 0, 0, -Math.PI / 2] };
  gear.add(leg);
  const ab = new THREE.Object3D();
  ab.name = "ab_0";
  ab.position.set(0, 0, 7);
  ab.userData = { radius: 0.5 };
  root.add(air, glass, ail, gear, ab);
  return root;
}

test("dressGlb recolours by role, puts flames on the markers and rigs the moving parts", () => {
  const src = fakeScene();
  const d = dressGlb(src, "soviet", false);
  const body = d.body.getObjectByName("airframe") as THREE.Mesh;
  assert.equal((body.material as THREE.MeshLambertMaterial).color.getHexString(), "a8b8c0");
  const glass = d.body.getObjectByName("canopy") as THREE.Mesh;
  assert.equal((glass.material as THREE.MeshLambertMaterial).color.getHexString(), "332211");
  assert.equal(d.ab.length, 1);
  assert.equal(d.idle.length, 1);
  const flame = new THREE.Vector3();
  d.body.updateMatrixWorld(true);
  d.ab[0].getWorldPosition(flame);
  assert.ok(Math.abs(flame.z - 7) < 1e-6, `flame at ${flame.z}`);
  // The source scene is untouched (it is shared by every plane of the kind).
  assert.ok((src.getObjectByName("airframe") as THREE.Mesh).material instanceof THREE.MeshStandardMaterial);

  d.rig.pose({ p: 0, r: 1, y: 0 }, 0);
  const ail = d.body.getObjectByName("aileron_r")!;
  const te = new THREE.Vector3(0, 0, 1).applyQuaternion(ail.quaternion);
  assert.ok(te.y > 0.1, "roll right lifts the right aileron's trailing edge");
  const gear = d.body.getObjectByName("gear")!;
  assert.equal(gear.visible, false, "retracted gear is hidden");
  const leg = d.body.getObjectByName("gear_nose")!;
  const down = new THREE.Vector3(0, -1, 0).applyQuaternion(leg.quaternion);
  assert.ok(down.z > 0.99, "nose leg folds aft");
  d.rig.pose(NEUTRAL, 1);
  assert.equal(gear.visible, true);
  assert.ok(new THREE.Vector3(0, -1, 0).applyQuaternion(leg.quaternion).y < -0.99, "gear down: rest pose");
});

test("a rig ignores malformed axes", () => {
  const o = new THREE.Group();
  const bad = new THREE.Group();
  bad.name = "rudder";
  bad.userData = { role: "rudder", axis: ["x", 0, 0] };
  o.add(bad);
  new Rig(o).pose({ p: 1, r: 1, y: 1 }, 1);
  assert.ok(bad.quaternion.equals(new THREE.Quaternion()));
});

// The committed model honours the node contract and the budgets (spec Phase 3).
const F16 = new URL("../../static/models/f16.glb", import.meta.url);

test("f16.glb: nodes, materials, budgets", { skip: !existsSync(F16) }, () => {
  const buf = readFileSync(F16);
  assert.ok(statSync(F16).size <= 150 * 1024, `size ${statSync(F16).size}`);
  assert.equal(buf.toString("ascii", 0, 4), "glTF");
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString("utf8", 20, 20 + len)) as {
    nodes: { name: string; extras?: Record<string, unknown> }[];
    materials: { name: string }[];
    meshes: { primitives: { indices: number }[] }[];
    accessors: { count: number }[];
    samplers?: { magFilter?: number }[];
  };
  const names = new Set(json.nodes.map((n) => n.name));
  for (const n of ["airframe", "canopy", "aileron_l", "aileron_r", "flap_l", "flap_r", "stab_l", "stab_r", "rudder",
    "gear", "gear_nose", "gear_main_l", "gear_main_r", "ab_0", "idle_0"]) {
    assert.ok(names.has(n), `node ${n}`);
  }
  for (const n of json.nodes) {
    if (/^(aileron|flap|stab|elevator|rudder)/.test(n.name)) assert.equal((n.extras?.axis as number[]).length, 3, n.name);
  }
  const roles = new Set(json.materials.map((m) => m.name));
  for (const r of roles) assert.ok(["body", "secondary", "stripe", "canopy", "dark", "metal"].includes(r), r);
  assert.ok(roles.has("body") && roles.has("stripe"));
  let tris = 0;
  for (const m of json.meshes) for (const p of m.primitives) tris += json.accessors[p.indices].count / 3;
  assert.ok(tris >= 1500 && tris <= 4000, `${tris} triangles`);
  assert.equal(json.samplers?.[0]?.magFilter, 9728, "nearest filter");
});
