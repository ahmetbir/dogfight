// Tests only: a committed .glb read into a THREE scene without a browser
// (GLTFLoader needs image decoding). Node hierarchy, names, transforms and
// vertex positions only; enough to measure a model.
import { readFileSync } from "node:fs";
import * as THREE from "three";

type Node = { name?: string; children?: number[]; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] };
type Gltf = {
  scene?: number; scenes: { nodes: number[] }[]; nodes: Node[];
  meshes: { primitives: { attributes: { POSITION: number } }[] }[];
  accessors: { bufferView: number; byteOffset?: number; count: number; componentType: number; type: string }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
};

export function readGlb(file: URL | string): THREE.Group {
  const buf = readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen)) as Gltf;
  const binAt = 20 + jsonLen + 8; // BIN chunk header: length, type
  const positions = (a: number): Float32Array => {
    const acc = json.accessors[a];
    const view = json.bufferViews[acc.bufferView];
    if (acc.componentType !== 5126 || acc.type !== "VEC3") throw new Error("POSITION is not float VEC3");
    const stride = view.byteStride ?? 12;
    const at = binAt + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const out = new Float32Array(acc.count * 3);
    for (let i = 0; i < acc.count; i++) for (let k = 0; k < 3; k++) out[i * 3 + k] = buf.readFloatLE(at + i * stride + k * 4);
    return out;
  };
  const build = (i: number): THREE.Object3D => {
    const n = json.nodes[i];
    const o = new THREE.Group();
    o.name = n.name ?? "";
    if (n.matrix) new THREE.Matrix4().fromArray(n.matrix).decompose(o.position, o.quaternion, o.scale);
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    if (n.mesh !== undefined) {
      for (const p of json.meshes[n.mesh].primitives) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(positions(p.attributes.POSITION), 3));
        o.add(new THREE.Mesh(g));
      }
    }
    for (const c of n.children ?? []) o.add(build(c));
    return o;
  };
  const root = new THREE.Group();
  for (const i of json.scenes[json.scene ?? 0].nodes) root.add(build(i));
  return root;
}

/** tools/blender/contract.json: the node names and missile counts build.py enforces. */
export type Contract = {
  nodes: string[]; single: string[]; twin: string[];
  kinds: Record<string, { missiles: number; twin: boolean }>;
};
export const contract: Contract = JSON.parse(readFileSync(new URL("../../../tools/blender/contract.json", import.meta.url), "utf8"));
