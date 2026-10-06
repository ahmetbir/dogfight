// Tilt aim (spec §12.3, optional): device orientation drives the touch
// stick while no finger holds it. In landscape, beta (front-back axis of the
// portrait device) banks and gamma pitches.
import { DEADZONE, type TouchState } from "./touch.ts";

const FULL_DEG = 25; // tilt from the reference for a full stick
const RAD = Math.PI / 180;

/**
 * Bank and pitch angles (degrees) from the device's up vector, which is
 * continuous where Euler beta/gamma are not: past vertical, gamma wraps from
 * −90 to +90 and beta jumps by 180 for the same physical pose. For
 * |beta| < 90 this returns exactly { bank: beta, pitch: gamma }.
 */
export function stableAngles(beta: number, gamma: number): { bank: number; pitch: number } {
  const cb = Math.cos(beta * RAD);
  const ux = -cb * Math.sin(gamma * RAD), uy = Math.sin(beta * RAD), uz = cb * Math.cos(gamma * RAD);
  return { bank: Math.asin(Math.max(-1, Math.min(1, uy))) / RAD, pitch: Math.atan2(-ux, uz) / RAD };
}

/** a − b wrapped into [−180, 180). */
function delta(a: number, b: number): number {
  return ((((a - b + 180) % 360) + 360) % 360) - 180;
}

/** Device angles (degrees) → unit-disk stick around ref; landscapeSign flips for the other landscape side. */
export function tiltToStick(beta: number, gamma: number, ref: { beta: number; gamma: number }, landscapeSign: 1 | -1): { x: number; y: number } {
  const a = stableAngles(beta, gamma), r = stableAngles(ref.beta, ref.gamma);
  let x = (landscapeSign * delta(a.bank, r.bank)) / FULL_DEG;
  let y = (landscapeSign * delta(a.pitch, r.pitch)) / FULL_DEG;
  const l = Math.hypot(x, y);
  if (l < DEADZONE) return { x: 0, y: 0 };
  if (l > 1) {
    x /= l;
    y /= l;
  }
  return { x, y };
}

type PermissionAPI = { requestPermission?: () => Promise<string> };

/**
 * Asks for motion sensors where the browser wants it (iOS 13+:
 * DeviceOrientationEvent.requestPermission, which must run inside a user
 * gesture); true elsewhere.
 */
export async function requestTilt(): Promise<boolean> {
  const api = (globalThis as { DeviceOrientationEvent?: PermissionAPI }).DeviceOrientationEvent;
  if (typeof api?.requestPermission !== "function") return true;
  try {
    return (await api.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/** 1 for landscape-primary (90°), −1 for the other side (270° / −90°). */
function landscapeSign(): 1 | -1 {
  const a = globalThis.screen?.orientation?.angle ?? (globalThis as { orientation?: number }).orientation ?? 90;
  return a === 270 || a === -90 ? -1 : 1;
}

/** Writes state.tilt from deviceorientation; the first reading after start/recenter is the neutral pose. */
export class Tilt {
  private readonly state: TouchState;
  private ref: { beta: number; gamma: number } | null = null;
  private on = false;
  private readonly onOrient = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return;
    if (!this.ref) this.ref = { beta: e.beta, gamma: e.gamma };
    this.state.tilt = tiltToStick(e.beta, e.gamma, this.ref, landscapeSign());
  };

  constructor(state: TouchState) {
    this.state = state;
  }

  start(): void {
    if (this.on) return;
    this.on = true;
    this.ref = null;
    window.addEventListener("deviceorientation", this.onOrient);
  }

  recenter(): void {
    this.ref = null;
  }

  stop(): void {
    if (!this.on) return;
    this.on = false;
    window.removeEventListener("deviceorientation", this.onOrient);
    this.state.tilt = null;
  }
}
