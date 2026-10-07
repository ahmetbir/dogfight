// Aircraft models: procedural low-poly builders and optional .glb overrides.
import * as THREE from "three";
import { GLTFLoader, type GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";
import { airframe } from "../game/airframe.ts";
import { palette, type Model, type Palette, type Team } from "./models/common.ts";
import { buildF15 } from "./models/f15.ts";
import { buildGear } from "./models/gear.ts";
import { buildF16 } from "./models/f16.ts";
import { buildMig29 } from "./models/mig29.ts";
import { buildSu27 } from "./models/su27.ts";
import { measure } from "./shape.ts";

const rawLength = new Map<string, number>(); // builder key → unscaled nose + tail, measured once

const builders: Record<string, (p: Palette) => Model> = { f16: buildF16, f15: buildF15, mig29: buildMig29, su27: buildSu27 };

/**
 * Procedural model of kind (the F-16's shape for a kind without a builder),
 * nose toward -Z, scaled to the kind's true length
 * (the .glb's), so a model that fails to load does not change the jet's size.
 * Children named "ab" (afterburner flame) and "idle" (nozzle glow) sit at each
 * engine exit; "gear" is the landing gear (hidden; PlaneView shows it). own
 * colors the local player's plane in FFA (team "none").
 */
export function buildModel(kind: string, team: Team, own = false): THREE.Group {
  const key = kind in builders ? kind : "f16";
  const m = builders[key](palette(team, own));
  const g = new THREE.Group();
  g.add(m.body, ...m.engines);
  let raw = rawLength.get(key); // the builder's length depends on the kind alone, not the team
  if (raw === undefined) {
    const s = measure(g);
    raw = s.nose + s.tail;
    rawLength.set(key, raw);
  }
  const scale = raw > 0 ? airframe(kind).length / raw : 1; // a kind without a builder: the F-16 shape at its own length
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
 * GLTFLoader plugin: embedded textures through <img> (CSP img-src allows
 * blob:), not fetch (connect-src 'self'). It overwrites an internal field of
 * three's GLTFParser (checked against 0.186); models.test.ts guards it.
 */
export function imgTextures(parser: GLTFParser): { name: string } {
  parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
  return { name: "dogfight_img_textures" };
}

/** Fetches a URL's JSON or the parsed .glb scene; the browser's by default, fakes in tests. */
export type GlbIo = { manifest(): Promise<unknown>; scene(url: string): Promise<THREE.Group> };

const browserIo: GlbIo = {
  async manifest() {
    const res = await fetch("/models/manifest.json");
    return res.ok ? res.json() : null;
  },
  async scene(url) {
    const loader = new GLTFLoader();
    loader.register(imgTextures);
    return (await loader.loadAsync(url)).scene;
  },
};

/**
 * The .glb models of a page: /models/manifest.json is fetched once, each
 * listed kind's scene loaded once and shared (callers clone it: dressGlb).
 * A kind the manifest does not list is never fetched.
 */
export class GlbLibrary {
  private readonly io: GlbIo;
  private listed: Promise<readonly string[]> | null = null;
  private readonly scenes = new Map<string, Promise<THREE.Group | null>>();

  constructor(io: GlbIo = browserIo) {
    this.io = io;
  }

  /** The loaded scene of kind, or null when it is not listed or fails to load. */
  load(kind: string): Promise<THREE.Group | null> {
    let p = this.scenes.get(kind);
    if (!p) {
      p = this.fetch(kind);
      this.scenes.set(kind, p);
    }
    return p;
  }

  private async fetch(kind: string): Promise<THREE.Group | null> {
    this.listed ??= this.io.manifest().then((k) => (Array.isArray(k) ? k.filter((x): x is string => typeof x === "string") : []), () => []);
    if (!(await this.listed).includes(kind)) return null;
    try {
      return await this.io.scene(`/models/${kind}.glb`);
    } catch (e) {
      // A listed model that fails to load falls back to the built-in one, loudly.
      console.warn(`models/${kind}.glb could not be loaded; using the built-in model`, e);
      return null;
    }
  }
}

let pageGlbs: GlbLibrary | null = null;

/** The page's one GlbLibrary (the game's planes and the hangar share its scenes). */
export function glbLibrary(): GlbLibrary {
  pageGlbs ??= new GlbLibrary();
  return pageGlbs;
}

/** Loads /models/<kind>.glb through the page's library; null when not listed. */
export function tryLoadGlb(kind: string): Promise<THREE.Group | null> {
  return glbLibrary().load(kind);
}
