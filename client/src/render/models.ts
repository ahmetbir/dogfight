// Aircraft models: procedural low-poly builders and optional .glb overrides.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { palette, type Model, type Palette, type Team } from "./models/common.ts";
import { buildF15 } from "./models/f15.ts";
import { buildGear } from "./models/gear.ts";
import { buildF16 } from "./models/f16.ts";
import { buildMig29 } from "./models/mig29.ts";
import { buildSu27 } from "./models/su27.ts";

const builders: Record<string, { build: (p: Palette) => Model; scale: number }> = {
  f16: { build: buildF16, scale: 1 },
  f15: { build: buildF15, scale: 1 },
  mig29: { build: buildMig29, scale: 1 },
  su27: { build: buildSu27, scale: 0.9 }, // longest of the four, kept near 17 m
};

/**
 * Procedural model of kind, nose toward -Z, ~15 m long. Children named "ab"
 * (afterburner flame) and "idle" (nozzle glow) sit at each engine exit; "gear"
 * is the landing gear (hidden; PlaneView shows it); the
 * group's userData.span is the half wingspan in meters. own colors the local
 * player's plane in FFA (team "none").
 */
export function buildModel(kind: string, team: Team, own = false): THREE.Group {
  const b = builders[kind] ?? builders.f16;
  const m = b.build(palette(team, own));
  const g = new THREE.Group();
  g.add(m.body, ...m.engines);
  g.scale.setScalar(b.scale);
  // Gear lives outside the airframe so a .glb body swap keeps it, and is
  // scaled back to true meters: the wheels must reach y = -2.5 on every kind.
  const gear = buildGear();
  gear.visible = false;
  gear.scale.setScalar(1 / b.scale);
  g.add(gear);
  g.userData.span = m.span * b.scale;
  g.name = kind;
  return g;
}

/**
 * Loads /models/<kind>.glb when the build listed it in
 * /models/manifest.json; null otherwise (never fetches a missing file).
 */
export async function tryLoadGlb(kind: string): Promise<THREE.Group | null> {
  let listed = false;
  try {
    const res = await fetch("/models/manifest.json");
    if (!res.ok) return null;
    const kinds: unknown = await res.json();
    if (!Array.isArray(kinds) || !kinds.includes(kind)) return null;
    listed = true;
    const gltf = await new GLTFLoader().loadAsync(`/models/${kind}.glb`);
    return gltf.scene;
  } catch (e) {
    // A listed model that fails to load falls back to the built-in one, loudly.
    if (listed) console.warn(`models/${kind}.glb could not be loaded; using the built-in model`, e);
    return null;
  }
}
