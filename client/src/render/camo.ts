// Skins on the GPU: the recoloured role materials of a .glb, shared by every
// plane wearing the same (material, team, skin), and the camouflage pattern
// multiplied over the body's atlas. The pattern is projected in the
// airframe's rest pose, metres behind the nose: faces looking up or down
// take it from above (x, z), faces looking sideways from the side (y, z),
// so it runs on across parts and moves with the control surfaces. Each
// face picks its projection from its own (flat) normal in the fragment
// shader. Textures are made once per scheme; nearest filtering keeps the
// PS1 look of the atlas.
import * as THREE from "three";
import type { Team } from "./models/common.ts";
import { PATTERN_PX, SCHEMES, patternPixels, skinColors, type SkinId } from "./skins.ts";

const ATTR = "camoPos";

/** Roles a scheme recolours; the rest keep the model's colour. */
const ROLES = new Set(["body", "secondary", "stripe", "canopy"]);

const textures = new Map<SkinId, THREE.DataTexture | null>();

/** The scheme's pattern tile (null: plain), made on first use and kept. */
export function camoTexture(id: SkinId): THREE.DataTexture | null {
  if (textures.has(id)) return textures.get(id) ?? null;
  const s = SCHEMES[id];
  let tex: THREE.DataTexture | null = null;
  if (s?.pattern && s.body) {
    tex = new THREE.DataTexture(patternPixels(s.pattern, s.body), PATTERN_PX, PATTERN_PX, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace; // sRGB ratios: body × texel lands on the camo colour
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
  }
  textures.set(id, tex);
  return tex;
}

/**
 * Gives every body mesh of a loaded scene its rest-pose position in the
 * airframe's frame, nose at z = 0, as the camoPos attribute. Runs once per
 * scene (the geometry is shared by every clone); later calls are free.
 */
export function prepareCamo(src: THREE.Object3D): void {
  if (src.userData.camoReady) return;
  src.updateMatrixWorld(true);
  const toRoot = src.matrixWorld.clone().invert();
  const meshes: THREE.Mesh[] = [];
  src.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
  let nose = Infinity;
  const v = new THREE.Vector3();
  const local = new THREE.Matrix4();
  for (const m of meshes) {
    const pos = m.geometry.getAttribute("position");
    if (!pos) continue;
    local.multiplyMatrices(toRoot, m.matrixWorld);
    for (let i = 0; i < pos.count; i++) nose = Math.min(nose, v.fromBufferAttribute(pos, i).applyMatrix4(local).z);
  }
  if (!Number.isFinite(nose)) nose = 0;
  const done = new Set<THREE.BufferGeometry>();
  for (const m of meshes) {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (!mats.some((x) => x.name === "body")) continue;
    if (done.has(m.geometry)) m.geometry = m.geometry.clone(); // a geometry shared by two nodes needs two rest poses
    done.add(m.geometry);
    const pos = m.geometry.getAttribute("position");
    if (!pos) continue;
    local.multiplyMatrices(toRoot, m.matrixWorld);
    const out = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(local);
      out.set([v.x, v.y, v.z - nose], i * 3);
    }
    m.geometry.setAttribute(ATTR, new THREE.BufferAttribute(out, 3));
  }
  src.userData.camoReady = true;
}

/** Hooks the pattern into a Lambert material: body colour × atlas × camo, lit and self-lit alike. */
function addCamo(mat: THREE.MeshLambertMaterial, tex: THREE.Texture, tile: number): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.camoMap = { value: tex };
    sh.uniforms.camoTile = { value: tile };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\nattribute vec3 ${ATTR};\nvarying vec3 vCamoPos;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvCamoPos = ${ATTR};`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D camoMap;\nuniform float camoTile;\nvarying vec3 vCamoPos;")
      .replace("#include <map_fragment>", `#include <map_fragment>
vec3 camoN = abs(cross(dFdx(vCamoPos), dFdy(vCamoPos)));
vec2 camoUv = (camoN.x > camoN.y && camoN.x > camoN.z ? vCamoPos.yz : vCamoPos.xz) / camoTile;
vec3 camo = texture2D(camoMap, camoUv).rgb;
diffuseColor.rgb *= camo;`)
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= camo;");
  };
  mat.customProgramCacheKey = () => "camo";
}

type Shared = { mat: THREE.Material; refs: number };
const shared = new Map<string, Shared>();

/**
 * The material a plane draws src (a loaded role material) with, for team
 * and skin: shared by every plane with the same key, freed when the last
 * one releases it.
 */
export function skinMaterial(src: THREE.MeshStandardMaterial, team: Team, own: boolean, skin: SkinId): { mat: THREE.Material; release: () => void } {
  const role = src.name;
  const key = `${src.uuid}|${team}|${own}|${ROLES.has(role) ? skin : ""}`;
  let s = shared.get(key);
  if (!s) {
    s = { mat: makeMaterial(src, team, own, skin), refs: 0 };
    shared.set(key, s);
  }
  s.refs++;
  const entry = s;
  let released = false;
  return {
    mat: entry.mat,
    release: () => {
      if (released) return;
      released = true;
      if (--entry.refs > 0) return;
      entry.mat.dispose();
      if (shared.get(key) === entry) shared.delete(key);
    },
  };
}

/** How many shared skin materials are alive (tests). */
export function sharedMaterials(): number {
  return shared.size;
}

/** The colour role takes under a skin; null: the model's own. */
export function roleColorOf(role: string, team: Team, own: boolean, skin: SkinId): string | null {
  const c = skinColors(skin, team, own);
  switch (role) {
    case "body": return c.body;
    case "secondary": return c.secondary;
    case "stripe": return c.stripe;
    case "canopy": return c.canopy;
    default: return null;
  }
}

function makeMaterial(m: THREE.MeshStandardMaterial, team: Team, own: boolean, skin: SkinId): THREE.Material {
  const color = roleColorOf(m.name, team, own, skin) ?? `#${m.color.getHexString()}`;
  const map = m.map ?? null;
  if (map) {
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.NearestMipmapLinearFilter;
  }
  // Like the procedural palette: flat facets, a little self-light on the shaded side.
  const mat = new THREE.MeshLambertMaterial({
    name: m.name, color, map, flatShading: true,
    emissive: color, emissiveMap: map, emissiveIntensity: m.name === "canopy" ? 0.35 : 0.18,
  });
  const pattern = SCHEMES[skin]?.pattern;
  const tex = m.name === "body" ? camoTexture(skin) : null;
  if (tex && pattern) addCamo(mat, tex, pattern.tile);
  return mat;
}
