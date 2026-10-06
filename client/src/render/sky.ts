import * as THREE from "three";
import { LOOKS, type Look } from "./looks.ts";

export const SKY_RADIUS = 15000; // inside the camera far plane (20 km)

const skyVertex = /* glsl */ `
varying float vY;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vY = normalize(world.xyz - cameraPosition).y;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const skyFragment = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform float flash;
varying float vY;
void main() {
  vec3 c = mix(horizon, zenith, 1.0 - exp(-4.0 * max(vY, 0.0)));
  gl_FragColor = vec4(mix(c, vec3(0.86, 0.9, 1.0), flash), 1.0);
  #include <colorspace_fragment>
}`;

/** The sky: update keeps the dome on the camera; flash(k) brightens sky and ambient light (k 0..1, lightning). */
export type Sky = { update(camPos: THREE.Vector3): void; flash(k: number): void };

const HEMI = 0.9, SUN = 1.6; // clear-day intensities, scaled by look.light
const NIGHT_SKY = "#7f93c8", NIGHT_GROUND = "#202838", NIGHT_HEMI = 0.75;

/**
 * Adds the gradient sky dome, fog and sun/hemisphere lights for look to
 * scene. At night the sun is left out (WeatherFx adds the moon).
 */
export function buildSky(scene: THREE.Scene, look: Look = LOOKS.acik): Sky {
  scene.fog = new THREE.Fog(look.horizon, look.fog[0], look.fog[1]);
  // At night a moonlit blue ambient keeps terrain shapes and planes readable.
  const hemi = look.night
    ? new THREE.HemisphereLight(NIGHT_SKY, NIGHT_GROUND, NIGHT_HEMI)
    : new THREE.HemisphereLight(look.horizon, 0x5d8a3a, HEMI * look.light);
  const hemiBase = hemi.intensity;
  scene.add(hemi);
  if (!look.night) {
    const sun = new THREE.DirectionalLight(0xffffff, SUN * look.light);
    sun.position.set(-0.5, 0.8, -0.3);
    scene.add(sun); // target stays at the origin: light direction = -position
  }

  const flash = { value: 0 };
  const mat = new THREE.ShaderMaterial({
    uniforms: { zenith: { value: new THREE.Color(look.zenith) }, horizon: { value: new THREE.Color(look.horizon) }, flash },
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false, // exact sky colors; the horizon must equal the fog color
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 16), mat);
  dome.name = "sky";
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  scene.add(dome);
  return {
    update: (camPos) => dome.position.copy(camPos),
    flash: (k) => {
      flash.value = 0.7 * k;
      hemi.intensity = hemiBase * (1 + 2 * k);
    },
  };
}

/** FNV-1a 32-bit hash of a string (the decimal terrain seed). */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** mulberry32 PRNG: uniform floats in [0, 1). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PUFFS_MAX = 7;

/**
 * look.clouds.count clouds of 4–7 flat-shaded icosahedron puffs each between
 * look.clouds.min and max, all in one InstancedMesh. Deterministic per
 * terrain seed (welcome.terrain.seed).
 */
export function buildClouds(seed: string, look: Look = LOOKS.acik): THREE.InstancedMesh {
  const rnd = prng(fnv1a(seed));
  const range = (a: number, b: number) => a + (b - a) * rnd();
  const { count, min, max } = look.clouds;
  // Self-light keeps clear-day clouds bright; it fades with the weather's light.
  const grey = Math.min(0.85, 1.4 * (1 - look.light));
  const emissive = new THREE.Color(0x8a9aa8).lerp(new THREE.Color(look.horizon), grey).multiplyScalar(look.light);
  // Under a dark sky the clouds turn toward the horizon grey.
  const color = new THREE.Color(0xffffff).lerp(new THREE.Color(look.horizon), grey).multiplyScalar(1 - 0.3 * grey);
  const mat = new THREE.MeshLambertMaterial({ color, flatShading: true, emissive });
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat, Math.max(1, count * PUFFS_MAX));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  let n = 0;
  for (let c = 0; c < count; c++) {
    const ang = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * 7000;
    const cx = Math.cos(ang) * r;
    const cz = Math.sin(ang) * r;
    const cy = range(min, max);
    const size = range(90, 200);
    const heading = rnd() * Math.PI;
    const puffs = 4 + Math.floor(rnd() * 4);
    for (let i = 0; i < puffs; i++) {
      const along = (i / (puffs - 1) - 0.5) * size * 2.4;
      p.set(cx + Math.cos(heading) * along + range(-0.3, 0.3) * size, cy + range(-0.15, 0.3) * size,
        cz + Math.sin(heading) * along + range(-0.3, 0.3) * size);
      const k = size * range(0.6, 1.1) * (1 - Math.abs(i / (puffs - 1) - 0.5));
      s.set(k * range(1.1, 1.5), k * range(0.55, 0.8), k * range(1.0, 1.4));
      q.setFromEuler(e.set(0, rnd() * Math.PI * 2, 0));
      mesh.setMatrixAt(n++, m.compose(p, q, s));
    }
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = "clouds";
  return mesh;
}
