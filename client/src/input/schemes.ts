// Control schemes: turn raw input into a stick command once per tick.
import type { StickInput } from "../sim/flight.ts";
import { steer } from "../sim/autopilot.ts";
import { add, dot, len, qForward, qRotate, scale, sub, type Q, type V3 } from "../sim/vec.ts";
import { KEYBOARD_KEYS as K, MOUSE_KEYS as M } from "./bindings.ts";
import { LEFT, type InputState } from "./input.ts";
import { TouchScheme, type TouchState } from "./touch.ts";

/**
 * gfx: G effects (blackout / red tint); missileCam: follow my missile;
 * perf: performance mode (lighter rendering); tilt: aim by tilting the device
 * (touch scheme only); lever: mouse aim as a lever (mouse scheme only): the
 * aim keeps its offset from the nose, so a held offset keeps the plane turning.
 * hud: the HUD style (classic, or the monochrome military one); hudColor and
 * speedUnit belong to the military style.
 */
export type Settings = {
  scheme: "mouse" | "keyboard" | "touch"; sensitivity: number; invertY: boolean; volume: number; gfx: boolean;
  missileCam: boolean; perf: boolean; tilt: boolean; lever: boolean;
  hud: "classic" | "military"; hudColor: "green" | "amber"; speedUnit: "kmh" | "kt";
};

/** Defaults for a fine (mouse) or coarse (touch) pointer. */
export function defaultSettings(coarse: boolean): Settings {
  return { scheme: coarse ? "touch" : "mouse", sensitivity: 1, invertY: false, volume: 0.8, gfx: true, missileCam: !coarse, perf: coarse, tilt: false, lever: false,
    hud: "classic", hudColor: "green", speedUnit: "kmh" };
}

export const DEFAULT_SETTINGS: Settings = defaultSettings(false);

const KEY = "dogfight.settings";
const SCHEMES: readonly string[] = ["mouse", "keyboard", "touch"] satisfies Settings["scheme"][];
const HUDS: readonly string[] = ["classic", "military"] satisfies Settings["hud"][];
const HUD_COLORS: readonly string[] = ["green", "amber"] satisfies Settings["hudColor"][];
const SPEED_UNITS: readonly string[] = ["kmh", "kt"] satisfies Settings["speedUnit"][];

/** Whether the primary pointer is coarse (a touch screen); false where matchMedia is missing (tests). */
function coarsePointer(): boolean {
  try {
    return typeof globalThis.matchMedia === "function" && globalThis.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/** Settings from localStorage, defaults (by pointer type) for anything missing or invalid. */
export function loadSettings(store: Pick<Storage, "getItem"> | null = globalThis.localStorage ?? null, coarse = coarsePointer()): Settings {
  let raw: Record<string, unknown> = {};
  try {
    const v: unknown = JSON.parse(store?.getItem(KEY) ?? "{}");
    if (v && typeof v === "object") raw = v as Record<string, unknown>;
  } catch {
    // unreadable storage or JSON: defaults
  }
  const d = defaultSettings(coarse);
  const num = (x: unknown, lo: number, hi: number, def: number) =>
    typeof x === "number" && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : def;
  const bool = (x: unknown, def: boolean) => (typeof x === "boolean" ? x : def);
  const one = <T extends string>(x: unknown, of: readonly string[], def: T) => (typeof x === "string" && of.includes(x) ? (x as T) : def);
  return {
    scheme: typeof raw.scheme === "string" && SCHEMES.includes(raw.scheme) ? (raw.scheme as Settings["scheme"]) : d.scheme,
    sensitivity: num(raw.sensitivity, 0.1, 5, d.sensitivity),
    invertY: bool(raw.invertY, d.invertY),
    volume: num(raw.volume, 0, 1, d.volume),
    gfx: bool(raw.gfx, d.gfx),
    missileCam: bool(raw.missileCam, d.missileCam),
    perf: bool(raw.perf, d.perf),
    tilt: bool(raw.tilt, d.tilt),
    lever: bool(raw.lever, d.lever),
    hud: one(raw.hud, HUDS, d.hud),
    hudColor: one(raw.hudColor, HUD_COLORS, d.hudColor),
    speedUnit: one(raw.speedUnit, SPEED_UNITS, d.speedUnit),
  };
}

export function saveSettings(s: Settings, store: Pick<Storage, "setItem"> | null = globalThis.localStorage ?? null): void {
  try {
    store?.setItem(KEY, JSON.stringify(s));
  } catch {
    // private mode / quota: settings stay for this session only
  }
}

/** The part of InputState a scheme reads (tests pass a plain object). */
export type Controls = Pick<InputState, "keys" | "buttons" | "consumeMouse" | "takePress"> & { touch?: TouchState };

/** stick.g = gear down wanted, stick.br = wheel brakes held; bomb is one-shot. */
export type Frame = {
  stick: StickInput; fire: boolean; missile: boolean; flare: boolean; bomb: boolean; aimDir: V3 | null; lookBack: boolean;
  pick?: boolean; // the pick key went down: toggle IR / radar (mouse, keyboard)
};

/**
 * The plane a scheme steers: attitude, throttle and (when known) whether its
 * gear is down and it is on its wheels.
 */
export type PlaneView = { rot: Q; th: number; gear?: boolean; ground?: boolean; w?: V3 };

/** The scheme's view of the predicted plane (w feeds the autopilot's roll damping); level, full throttle while dead. */
export function planeView(fs: PlaneView | null): PlaneView {
  return fs ? { rot: fs.rot, th: fs.th, gear: fs.gear, ground: fs.ground, w: fs.w } : { rot: { w: 1, x: 0, y: 0, z: 0 }, th: 1 };
}

/** Throttle a fresh scheme starts from: idle on the ground (parked spawn), else the plane's. */
const seedThrottle = (plane: PlaneView) => (plane.ground ? 0 : plane.th);

export interface Scheme {
  readonly kind: Settings["scheme"];
  frame(st: Controls, plane: PlaneView, dtS: number): Frame;
  /** Forget aim and throttle; the next frame starts from the plane (spawn; idle on the ground). */
  reset(): void;
}

export function makeScheme(s: Settings): Scheme {
  if (s.scheme === "touch") return new TouchScheme(s);
  return s.scheme === "keyboard" ? new KeyboardScheme(s) : new MouseScheme(s);
}

const THROTTLE_RATE = 0.5; // per second
export const AIM_RAD_PER_PX = 0.0025;
const MAX_AIM_PITCH = (85 * Math.PI) / 180;
export const MAX_AIM_OFF = Math.PI / 3; // aim stays within 60° of the nose, so the plane stays on screen
export const LEVER_DEAD = (1.5 * Math.PI) / 180; // lever offsets inside this hold the nose (no drift off a near-centred mouse)

type Codes = readonly string[];
/** Any of codes held down. */
const down = (st: Controls, codes: Codes) => codes.some((c) => st.keys.has(c));
const axis = (st: Controls, neg: Codes, pos: Codes) => (down(st, pos) ? 1 : 0) - (down(st, neg) ? 1 : 0);
/** Held now, or tapped since the last tick (the latch is always consumed). */
const held = (tapped: boolean, down: boolean) => tapped || down;
/** Consumes every listed press (none left over for the next frame); true if any was pressed. */
const takeAny = (st: Controls, codes: Codes) => codes.map((c) => st.takePress(c)).some(Boolean);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Gear wanted: seeded from the plane after reset, toggled by L (TEKER on touch). When the
 * gear goes up although the last sent input wanted it down, the sim forced it
 * (overspeed): wanted is dropped too, so the gear does not redeploy by itself
 * when the plane slows below the deploy speed mid-fight.
 */
export class GearWant {
  private want: boolean | null = null;
  private seen: boolean | undefined; // plane gear at the previous frame

  reset(): void {
    this.want = null;
    this.seen = undefined;
  }

  frame(toggle: boolean, gear: boolean | undefined): boolean {
    if (this.want === null) this.want = gear ?? false;
    else if (this.want && this.seen === true && gear === false) this.want = false;
    this.seen = gear;
    if (toggle) this.want = !this.want;
    return this.want;
  }
}

/** d rotated toward the plane's nose until it is at most max rad off; d itself when inside. */
export function coneClamp(d: V3, rot: Q, max: number): V3 {
  const f = qForward(rot);
  const cos = dot(d, f);
  if (cos >= Math.cos(max)) return d;
  let perp = sub(d, scale(f, cos));
  if (len(perp) < 1e-9) perp = qRotate(rot, { x: 0, y: 1, z: 0 }); // straight behind: swing over the top
  perp = scale(perp, 1 / len(perp));
  return add(scale(f, Math.cos(max)), scale(perp, Math.sin(max)));
}

/**
 * Mouse aim: the mouse moves a world-space aim direction (yaw about world Y,
 * pitch about the horizontal camera-right axis, ±85°, within 60° of the
 * nose); the autopilot steers
 * the nose toward it. Keys: MOUSE_KEYS (input/bindings.ts); a ctrl-click or
 * two-finger click arrives as a Mouse2 press.
 */
class MouseScheme implements Scheme {
  readonly kind = "mouse";
  private yaw = NaN; // NaN until the first frame seeds it from the plane
  private pitch = 0;
  private offYaw = 0;   // lever: aim offset from the nose's heading (rad, + left)
  private offPitch = 0; // lever: aim offset from the nose's pitch (rad, + up)
  private heading = 0;  // lever: last nose heading, kept while the nose points nearly straight up or down
  private th = 0;
  private readonly gear = new GearWant();
  private readonly s: Settings;

  constructor(s: Settings) {
    this.s = s;
  }

  reset(): void {
    this.yaw = NaN;
    this.offYaw = this.offPitch = 0;
    this.gear.reset();
  }

  frame(st: Controls, plane: PlaneView, dtS: number): Frame {
    const g = this.gear.frame(takeAny(st, M.gear), plane.gear);
    const nose = qForward(plane.rot);
    if (Number.isNaN(this.yaw)) {
      this.yaw = this.heading = Math.atan2(-nose.x, -nose.z);
      this.pitch = Math.max(-MAX_AIM_PITCH, Math.min(MAX_AIM_PITCH, Math.asin(Math.max(-1, Math.min(1, nose.y)))));
      this.th = seedThrottle(plane);
      st.consumeMouse();
    }
    const m = st.consumeMouse();
    const k = this.s.sensitivity * AIM_RAD_PER_PX;
    const dYaw = -m.dx * k; // mouse right → turn right
    const dPitch = -m.dy * k * (this.s.invertY ? -1 : 1); // mouse up → nose up
    if (this.s.lever) {
      // The aim rides on the nose (heading and pitch, horizon-level): a held offset never gets reached.
      if (Math.abs(nose.y) < 0.98) this.heading = Math.atan2(-nose.x, -nose.z);
      this.offYaw += dYaw;
      this.offPitch += dPitch;
      const r = Math.hypot(this.offYaw, this.offPitch);
      if (r > MAX_AIM_OFF) {
        this.offYaw *= MAX_AIM_OFF / r;
        this.offPitch *= MAX_AIM_OFF / r;
      }
      const live = r > LEVER_DEAD;
      this.yaw = this.heading + (live ? this.offYaw : 0);
      this.pitch = Math.asin(Math.max(-1, Math.min(1, nose.y))) + (live ? this.offPitch : 0);
    } else {
      this.yaw += dYaw;
      this.pitch += dPitch;
      this.offYaw = this.offPitch = 0;
    }
    this.pitch = Math.max(-MAX_AIM_PITCH, Math.min(MAX_AIM_PITCH, this.pitch));
    const c = Math.cos(this.pitch);
    let aimDir: V3 = { x: -Math.sin(this.yaw) * c, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * c };
    const capped = coneClamp(aimDir, plane.rot, MAX_AIM_OFF);
    if (capped !== aimDir) { // write back so the aim does not wind up past the cone
      aimDir = capped;
      this.yaw = Math.atan2(-aimDir.x, -aimDir.z);
      this.pitch = Math.max(-MAX_AIM_PITCH, Math.min(MAX_AIM_PITCH, Math.asin(Math.max(-1, Math.min(1, aimDir.y)))));
    }
    this.th = clamp01(this.th + axis(st, M.throttleDown, M.throttleUp) * THROTTLE_RATE * dtS);
    const ap = steer(plane.rot, plane.w, aimDir);
    const roll = axis(st, M.rollLeft, M.rollRight);
    return {
      stick: { p: ap.p, r: roll !== 0 ? roll : ap.r, y: ap.y, th: this.th, ab: down(st, M.ab), g, br: down(st, M.brake) },
      fire: held(takeAny(st, M.fire), (st.buttons & LEFT) !== 0), // M.fire is the left button
      missile: takeAny(st, M.missile),
      pick: takeAny(st, M.pick),
      flare: held(takeAny(st, M.flare), down(st, M.flare)),
      bomb: takeAny(st, M.bomb),
      aimDir,
      lookBack: down(st, M.lookBack),
    };
  }
}

/**
 * Keyboard: pitch, roll, yaw, throttle and weapons on KEYBOARD_KEYS
 * (input/bindings.ts); pitch down is W by default (flight-sim convention;
 * invertY swaps).
 */
class KeyboardScheme implements Scheme {
  readonly kind = "keyboard";
  private th = NaN;
  private readonly gear = new GearWant();
  private readonly s: Settings;

  constructor(s: Settings) {
    this.s = s;
  }

  reset(): void {
    this.th = NaN;
    this.gear.reset();
  }

  frame(st: Controls, plane: PlaneView, dtS: number): Frame {
    const g = this.gear.frame(takeAny(st, K.gear), plane.gear);
    if (Number.isNaN(this.th)) this.th = seedThrottle(plane);
    st.consumeMouse();
    this.th = clamp01(this.th + axis(st, K.throttleDown, K.throttleUp) * THROTTLE_RATE * dtS);
    const p = axis(st, K.pitchDown, K.pitchUp) * (this.s.invertY ? -1 : 1);
    return {
      stick: {
        p, r: axis(st, K.rollLeft, K.rollRight), y: axis(st, K.yawLeft, K.yawRight), th: this.th, ab: down(st, K.ab), g, br: down(st, K.brake),
      },
      fire: held(takeAny(st, K.fire), down(st, K.fire)),
      missile: takeAny(st, K.missile),
      pick: takeAny(st, K.pick),
      flare: held(takeAny(st, K.flare), down(st, K.flare)),
      bomb: takeAny(st, K.bomb),
      aimDir: null,
      lookBack: down(st, K.lookBack),
    };
  }
}
