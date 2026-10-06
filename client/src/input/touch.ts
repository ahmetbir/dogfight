// Touch controls (spec §12.3): a virtual stick with autopilot assist on
// release, a throttle slider and on-screen buttons. The overlay (ui/touchpad)
// and tilt (input/tilt) write a TouchState; TouchScheme reads it each tick.
import { steer } from "../sim/autopilot.ts";
import { len, qForward, qRotate, v3, type Q, type V3 } from "../sim/vec.ts";
import { GEAR_KEYS } from "./bindings.ts";
import { GearWant, type Controls, type Frame, type PlaneView, type Scheme, type Settings } from "./schemes.ts";

export type Tap = "missile" | "flare" | "bomb" | "ab" | "gear";

/**
 * stick: virtual stick (unit disk, null while released); throttle 0..1 from
 * the slider; fire/brake/look held; taps: one-shot buttons since the last
 * tick; tilt: stick from the device tilt (null while off).
 */
export type TouchState = {
  stick: { x: number; y: number } | null; throttle: number; fire: boolean; brake: boolean; look: boolean;
  taps: Set<Tap>; tilt: { x: number; y: number } | null;
};

/**
 * Throttle starts full, as the mouse scheme's does without a plane: the inputs
 * sent before the first spawn are replayed into the predicted plane, and an
 * idle slider there would stall a fresh air spawn (a runway spawn idles anyway).
 */
export function newTouchState(): TouchState {
  return { stick: null, throttle: 1, fire: false, brake: false, look: false, taps: new Set(), tilt: null };
}

export const DEADZONE = 0.12;

/** A drag of (dx, dy) CSS px (screen y down) → unit-disk stick, up = +y; inside the deadzone → 0. */
export function stickVector(dx: number, dy: number, radius: number): { x: number; y: number } {
  let x = dx / radius, y = -dy / radius;
  const l = Math.hypot(x, y);
  if (l < DEADZONE) return { x: 0, y: 0 };
  if (l > 1) {
    x /= l;
    y /= l;
  }
  return { x, y };
}

/**
 * Stick commands: held → p = y (invertY flips), r = x; released (or
 * centered) → the autopilot levels the wings and brings the nose to the
 * horizon.
 */
export function touchStick(s: { x: number; y: number } | null, rot: Q, invertY: boolean, w?: V3): { p: number; r: number; y: number } {
  if (!s || (s.x === 0 && s.y === 0)) {
    const f = qForward(rot);
    const flat = v3(f.x, 0, f.z);
    if (len(flat) < 1e-6) return { p: 0, r: 0, y: 0 };
    const ap = steer(rot, w, flat);
    // Nose on the horizon: steer fine-tunes pitch/yaw only, so level the wings here.
    return ap.r === 0 ? { ...ap, r: levelRoll(rot, w) } : ap;
  }
  return { p: invertY ? -s.y : s.y, r: s.x, y: 0 };
}

const ROLL_GAIN = 2, ROLL_DAMP = 0.1; // as sim/autopilot steer

/** Roll command that brings the wings level (bank > 0 = right wing down). */
function levelRoll(rot: Q, w: V3 | undefined): number {
  const right = qRotate(rot, v3(1, 0, 0));
  const up = qRotate(rot, v3(0, 1, 0));
  const bank = Math.atan2(-right.y, up.y);
  return Math.max(-1, Math.min(1, -bank * ROLL_GAIN + (w?.z ?? 0) * ROLL_DAMP));
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** AB and gear toggle per tap; missile, flare and bomb fire once per tap; fire and brake are held. */
export class TouchScheme implements Scheme {
  readonly kind = "touch";
  private ab = false;
  private seed = false; // after reset: the next frame sets the slider from the plane
  private readonly gear = new GearWant();
  private readonly s: Settings;

  constructor(s: Settings) {
    this.s = s;
  }

  reset(): void {
    this.ab = false;
    this.seed = true;
    this.gear.reset();
  }

  frame(st: Controls, plane: PlaneView, _dtS: number): Frame {
    const t = st.touch;
    if (!t) {
      return {
        stick: { p: 0, r: 0, y: 0, th: plane.th, ab: false }, fire: false, missile: false, flare: false, bomb: false, aimDir: null, lookBack: false,
      };
    }
    if (this.seed) {
      this.seed = false;
      t.throttle = plane.ground ? 0 : clamp01(plane.th); // runway start: idle, parking brake holds
    }
    const tap = (k: Tap) => t.taps.delete(k);
    if (tap("ab")) this.ab = !this.ab;
    const gearTap = tap("gear"), gearKey = GEAR_KEYS.map((c) => st.takePress(c)).some(Boolean); // consume both: no carried press
    const g = this.gear.frame(gearTap || gearKey, plane.gear);
    const ap = touchStick(t.stick ?? t.tilt, plane.rot, this.s.invertY, plane.w);
    const out: Frame = {
      stick: { ...ap, th: clamp01(t.throttle), ab: this.ab, g, br: t.brake },
      fire: t.fire,
      missile: tap("missile"),
      flare: tap("flare"),
      bomb: tap("bomb"),
      aimDir: null,
      lookBack: t.look,
    };
    t.taps.clear();
    return out;
  }
}
