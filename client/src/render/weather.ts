// Weather effects (spec §12.1): rain streaks around the camera, lightning
// flashes, and the night sky (stars, moon, moonlight). The per-kind table is
// in looks.ts.
import * as THREE from "three";
import type { Look } from "./looks.ts";
import { prng, SKY_RADIUS } from "./sky.ts";

export { LOOKS, lookFor, type Look } from "./looks.ts";

const RAIN_BOX = 120;     // m: rain cube edge, centered on the camera
const RAIN_SPEED = 40;    // m/s
const RAIN_LEN = 3;       // m per streak
const FLASH_S = 0.12;
const FLASH_GAP: [number, number] = [6, 14]; // s between lightning strikes
const STARS = 800;
const MOON_DIR = new THREE.Vector3(0.45, 0.55, -0.7).normalize();

/** v wrapped into [lo, lo + RAIN_BOX). */
const wrap = (v: number, lo: number) => lo + ((((v - lo) % RAIN_BOX) + RAIN_BOX) % RAIN_BOX);

/** Box = [minX, minY, minZ, maxX, maxY, maxZ]. */
type Box = number[];

/** Whether a streak bottom at (x, y, z) is under one of the covers (no rain under a roof). */
export function covered(near: readonly Box[], x: number, y: number, z: number): boolean {
  for (const b of near) if (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5] && y < b[4]) return true;
  return false;
}

/** The covers whose footprint overlaps the rain cube around cam. */
export function coversNear(covers: readonly Box[], cx: number, cz: number): Box[] {
  const r = RAIN_BOX / 2;
  return covers.filter((b) => b[3] >= cx - r && b[0] <= cx + r && b[5] >= cz - r && b[2] <= cz + r);
}

/** Rain: n vertical streaks falling through a cube that follows the camera. */
class Rain {
  readonly lines: THREE.LineSegments;
  private readonly drops: Float32Array; // x, y, z of each streak's bottom, world space
  private readonly pos: Float32Array;
  private readonly covers: readonly Box[];

  constructor(n: number, rnd: () => number, covers: readonly Box[]) {
    this.covers = covers;
    this.drops = new Float32Array(3 * n).map(() => (rnd() - 0.5) * RAIN_BOX);
    this.pos = new Float32Array(6 * n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: "#b4c3d2", transparent: true, opacity: 0.38, depthWrite: false, fog: false,
    }));
    this.lines.frustumCulled = false;
    this.lines.name = "rain";
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }

  update(dt: number, cam: THREE.Vector3): void {
    const d = this.drops, p = this.pos;
    const x0 = cam.x - RAIN_BOX / 2, y0 = cam.y - RAIN_BOX / 2, z0 = cam.z - RAIN_BOX / 2;
    const near = coversNear(this.covers, cam.x, cam.z);
    for (let i = 0, j = 0; i < d.length; i += 3, j += 6) {
      const x = (d[i] = wrap(d[i], x0));
      const y = (d[i + 1] = wrap(d[i + 1] - RAIN_SPEED * dt, y0));
      const z = (d[i + 2] = wrap(d[i + 2], z0));
      p[j] = p[j + 3] = x;
      p[j + 1] = y;
      p[j + 4] = near.length > 0 && covered(near, x, y, z) ? y : y + RAIN_LEN; // zero length: not drawn
      p[j + 2] = p[j + 5] = z;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}

/** Stars on the upper sky dome plus a moon disk; both follow the camera. */
function nightSky(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  g.name = "night-sky";
  const r = SKY_RADIUS * 0.9;
  const pos = new Float32Array(3 * STARS);
  for (let i = 0; i < STARS; i++) {
    const a = rnd() * Math.PI * 2;
    const y = 0.05 + 0.95 * Math.sqrt(rnd()); // denser overhead than at the horizon haze
    const h = Math.sqrt(1 - y * y);
    pos.set([Math.cos(a) * h * r, y * r, Math.sin(a) * h * r], 3 * i);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({
    color: "#dfe8ff", size: 2, sizeAttenuation: false, fog: false, toneMapped: false, depthWrite: false,
  }));
  stars.frustumCulled = false;
  stars.renderOrder = -1;
  const moon = new THREE.Mesh(new THREE.CircleGeometry(r * 0.03, 24), new THREE.MeshBasicMaterial({
    color: "#e9efff", fog: false, toneMapped: false, depthWrite: false,
  }));
  moon.position.copy(MOON_DIR).multiplyScalar(r);
  moon.lookAt(0, 0, 0);
  moon.renderOrder = -1;
  g.add(stars, moon);
  return g;
}

/**
 * The moving parts of a weather look. flash receives the lightning
 * brightness 0..1 (Sky.flash); strikes are local, not synced between players.
 */
export class WeatherFx {
  private readonly scene: THREE.Scene;
  private readonly covers: readonly Box[];
  private rain: Rain | null = null;
  private readonly night: THREE.Group | null;
  private readonly rnd: () => number;
  private readonly flash: (k: number) => void;
  private readonly lightning: boolean;
  private untilStrike: number;
  private flashLeft = 0;

  /** covers: roof boxes (hangars, buildings) no rain falls under. */
  constructor(scene: THREE.Scene, look: Look, seed: number, flash: (k: number) => void = () => {}, covers: readonly Box[] = []) {
    this.scene = scene;
    this.covers = covers;
    this.rnd = prng(seed);
    this.flash = flash;
    this.lightning = look.lightning;
    this.untilStrike = this.gap();
    this.setRain(look.rain);
    this.night = look.night ? nightSky(this.rnd) : null;
    if (this.night) {
      scene.add(this.night);
      const moon = new THREE.DirectionalLight("#9fb4ff", 0.35);
      moon.position.copy(MOON_DIR);
      moon.name = "moon";
      scene.add(moon);
    }
  }

  /** Replaces the rain with n streaks (0: none); performance mode can change it mid-game. */
  setRain(n: number): void {
    if (this.rain) {
      this.scene.remove(this.rain.lines);
      this.rain.dispose();
      this.rain = null;
    }
    if (n <= 0) return;
    this.rain = new Rain(n, this.rnd, this.covers);
    this.scene.add(this.rain.lines);
  }

  private gap(): number {
    return FLASH_GAP[0] + (FLASH_GAP[1] - FLASH_GAP[0]) * this.rnd();
  }

  update(dtS: number, cam: THREE.Vector3): void {
    this.rain?.update(dtS, cam);
    this.night?.position.copy(cam);
    if (!this.lightning) return;
    if (this.flashLeft > 0) {
      this.flashLeft -= dtS;
      // A strike flickers: bright, a dip, bright again.
      const t = 1 - this.flashLeft / FLASH_S;
      this.flash(this.flashLeft > 0 ? (t > 0.35 && t < 0.55 ? 0.35 : 1) : 0);
      return;
    }
    this.untilStrike -= dtS;
    if (this.untilStrike <= 0) {
      this.untilStrike = this.gap();
      this.flashLeft = FLASH_S;
      this.flash(1);
    }
  }
}
