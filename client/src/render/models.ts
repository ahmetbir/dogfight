// Aircraft models: procedural low-poly builders and optional .glb overrides.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { airframe } from "../game/airframe.ts";
import { palette, type Model, type Palette, type Team } from "./models/common.ts";
import { buildF15 } from "./models/f15.ts";
import { buildGear } from "./models/gear.ts";
import { buildF16 } from "./models/f16.ts";
import { buildMig29 } from "./models/mig29.ts";
import { buildSu27 } from "./models/su27.ts";
import { measure } from "./shape.ts";

const builders: Record<string, (p: Palette) => Model> = { f16: buildF16, f15: buildF15, mig29: buildMig29, su27: buildSu27 };

/**
 * Procedural model of kind, nose toward -Z, scaled to the kind's true length
 * (the .glb's), so a model that fails to load does not change the jet's size.
 * Children named "ab" (afterburner flame) and "idle" (nozzle glow) sit at each
 * engine exit; "gear" is the landing gear (hidden; PlaneView shows it). own
 * colors the local player's plane in FFA (team "none").
 */
export function buildModel(kind: string, team: Team, own = false): THREE.Group {
  const known = kind in builders;
  const m = builders[known ? kind : "f16"](palette(team, own));
  const g = new THREE.Group();
  g.add(m.body, ...m.engines);
  const s = measure(g);
  const scale = s.nose + s.tail > 0 ? airframe(known ? kind : "f16").length / (s.nose + s.tail) : 1;
  g.scale.setScalar(scale);
  // Gear lives outside the airframe so a .glb body swap keeps it, and is
  // scaled back to true meters: the wheels must reach y = -2.5 on every kind.
  const gear = buildGear();
  gear.visible = false;
  gear.scale.setScalar(1 / scale);
  g.add(gear);
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
    const loader = new GLTFLoader();
    // Embedded textures through <img> (CSP img-src allows blob:), not fetch (connect-src 'self').
    loader.register((parser) => {
      parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
      return { name: "dogfight_img_textures" };
    });
    const gltf = await loader.loadAsync(`/models/${kind}.glb`);
    return gltf.scene;
  } catch (e) {
    // A listed model that fails to load falls back to the built-in one, loudly.
    if (listed) console.warn(`models/${kind}.glb could not be loaded; using the built-in model`, e);
    return null;
  }
}
