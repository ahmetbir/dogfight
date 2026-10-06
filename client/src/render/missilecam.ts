// Missile camera: a picture-in-picture view that chases my missile from
// behind, drawn into a bottom-center inset of the same scene.
import * as THREE from "three";
import type { MissileJSON } from "../net/protocol.ts";
import { add, len, scale, type V3 } from "../sim/vec.ts";
import type { Renderer } from "./renderer.ts";

export const CAM_MAX_MS = 6000; // the inset closes this long after launch at the latest
const LINGER_MS = 500;          // shown on after the missile is gone (impact)
const BACK = 20;                // m behind the missile
const ABOVE = 4;                // m above it
const LOOK = 100;               // m ahead along its velocity
// The inset sits farther back and higher than the plain chase pose, so it
// looks over the missile's own smoke trail instead of down it.
const PIP_BACK = 30;
const PIP_ABOVE = 8;
const WIDTH = 0.25;             // inset width / canvas width
const MARGIN = 16;              // px from the bottom edge

/** The inset in CSS px with a bottom-left origin (WebGL viewport): 25% wide, 16:9, bottom center. */
export function insetRect(w: number, h: number): { x: number; y: number; w: number; h: number } {
  const iw = Math.round(w * WIDTH);
  const ih = Math.min(Math.round((iw * 9) / 16), Math.max(0, h - 2 * MARGIN));
  return { x: Math.round((w - iw) / 2), y: MARGIN, w: iw, h: ih };
}

/** Camera eye `back` m behind (along the velocity) and `above` m above pos, looking ahead of it. */
export function chasePose(pos: V3, vel: V3, back = BACK, above = ABOVE): { eye: V3; look: V3 } {
  const s = len(vel);
  const d = s > 1e-6 ? scale(vel, 1 / s) : { x: 0, y: 0, z: -1 };
  return {
    eye: { x: pos.x - d.x * back, y: pos.y - d.y * back + above, z: pos.z - d.z * back },
    look: add(pos, scale(d, LOOK)),
  };
}

export class MissileCam {
  private readonly cam = new THREE.PerspectiveCamera(60, 16 / 9, 1, 20000);
  private id: number | null = null;
  private since = 0;
  private stopAt = Infinity;
  private posed = false; // the followed missile was seen at least once

  /** Starts following missile id (replaces any other). */
  follow(id: number, nowMs: number): void {
    this.id = id;
    this.since = nowMs;
    this.stopAt = Infinity;
    this.posed = false;
  }

  /** The followed missile is gone: the inset lingers LINGER_MS more. */
  stop(nowMs: number): void {
    if (this.id !== null && this.stopAt === Infinity) this.stopAt = nowMs;
  }

  /** The followed missile's id; null when none. */
  following(): number | null {
    return this.id;
  }

  active(nowMs: number): boolean {
    if (this.id === null) return false;
    if (nowMs - this.since < CAM_MAX_MS && nowMs - this.stopAt < LINGER_MS) return true;
    this.id = null;
    return false;
  }

  /** Poses the camera on the followed missile at pos + vel·sinceSnapS; keeps the last pose when it is missing. */
  update(missiles: MissileJSON[], sinceSnapS: number): void {
    const m = this.id === null ? undefined : missiles.find((x) => x.id === this.id);
    if (!m) return;
    const vel = { x: m.v[0], y: m.v[1], z: m.v[2] };
    const pos = { x: m.p[0] + vel.x * sinceSnapS, y: m.p[1] + vel.y * sinceSnapS, z: m.p[2] + vel.z * sinceSnapS };
    const p = chasePose(pos, vel, PIP_BACK, PIP_ABOVE);
    this.cam.position.set(p.eye.x, p.eye.y, p.eye.z);
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(p.look.x, p.look.y, p.look.z);
    this.posed = true;
  }

  /** Draws the inset over the frame already rendered. */
  render(r: Renderer): void {
    if (!this.posed) return;
    const { w, h } = r.size();
    r.renderInset(this.cam, insetRect(w, h));
  }
}
