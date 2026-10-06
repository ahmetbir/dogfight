// Ground help (feedback #1 items 11 and 16): a key hint panel while on the
// wheels (dismissible, remembered) and, after a runway start, a one-line
// takeoff coach until the first successful takeoff (remembered).
import { lattr, t } from "../i18n/index.ts";
import { kmh } from "../i18n/format.ts";
import { KEYBOARD_KEYS as K, keys, MOUSE_KEYS as M, touchLabel } from "../input/bindings.ts";
import type { Settings } from "../input/schemes.ts";
import { h, text } from "./dom.ts";

export type Scheme = Settings["scheme"];
export type Store = Pick<Storage, "getItem" | "setItem">;

const HINT_KEY = "dogfight.hint.ground";
const COACH_KEY = "dogfight.coach.takeoff";
const ROTATE_MARGIN = 3; // m/s: "nose up" shows this much before rotate speed

/** Throttle, nose-up, gear and brake controls of a scheme, from input/bindings.ts (keys, or touch buttons). */
function keysOf(scheme: Scheme, invertY: boolean): { gas: string; up: string; gear: string; brake: string } {
  if (scheme === "touch") {
    return { gas: touchLabel("throttle"), up: t(invertY ? "coach.stickDown" : "coach.stickUp"), gear: touchLabel("gear"), brake: touchLabel("brake") };
  }
  if (scheme === "keyboard") {
    return { gas: `${keys(K.throttleUp)}/${keys(K.ab)}`, up: keys(invertY ? K.pitchDown : K.pitchUp), gear: keys(K.gear), brake: keys(K.brake) };
  }
  return { gas: `${keys(M.throttleUp)}/${keys(M.ab)}`, up: t(invertY ? "coach.mouseDown" : "coach.mouseUp"), gear: keys(M.gear), brake: keys(M.brake) };
}

/** The ground key line; rotateSpeed in m/s. */
export function groundHint(scheme: Scheme, invertY: boolean, rotateSpeed: number): string {
  const k = keysOf(scheme, invertY);
  const rotate = t("coach.rotate", { speed: kmh(rotateSpeed), up: k.up });
  return t(scheme === "touch" ? "coach.touchHint" : "coach.hint", { ...k, rotate });
}

export type CoachView = { alive: boolean; onGround: boolean; speed: number; gear: boolean };

/** The coach line for this moment of a takeoff ("" once airborne with the gear up). */
export function coachLine(v: CoachView, rotateSpeed: number, scheme: Scheme, invertY: boolean): string {
  if (!v.alive) return "";
  const k = keysOf(scheme, invertY);
  if (v.onGround) return v.speed < rotateSpeed - ROTATE_MARGIN ? t("coach.gas", { k: k.gas }) : t("coach.nose", { k: k.up });
  return v.gear ? t("coach.gearUp", { k: k.gear }) : "";
}

/** A successful takeoff: flying, gear up. */
export const tookOff = (v: CoachView) => v.alive && !v.onGround && !v.gear;

function read(store: Store | null, key: string): boolean {
  try {
    return store?.getItem(key) === "1";
  } catch {
    return false;
  }
}

function write(store: Store | null, key: string): void {
  try {
    store?.setItem(key, "1");
  } catch {
    // storage blocked: remembered for this page only
  }
}

export type GroundView = CoachView & { scheme: Scheme; invertY: boolean; rotateSpeed: number };

export class GroundHelp {
  readonly el: HTMLElement;
  private readonly hintText = h("span", {});
  private readonly hint: HTMLElement;
  private readonly coach = h("div", { class: "hud-coach", hidden: true });
  private readonly store: Store | null;
  private hintOff: boolean;
  private coachDone: boolean;
  private wasAlive = false;
  private runway = false; // this life started on the wheels

  constructor(store: Store | null = globalThis.localStorage ?? null) {
    this.store = store;
    this.hintOff = read(store, HINT_KEY);
    this.coachDone = read(store, COACH_KEY);
    const close = lattr(h("button", { type: "button", class: "hint-close" }, "×"), "aria-label", "coach.close");
    close.addEventListener("click", () => {
      this.hintOff = true;
      write(this.store, HINT_KEY);
      this.hint.hidden = true;
    });
    this.hint = h("div", { class: "ground-hint", hidden: true }, this.hintText, close);
    this.el = h("div", { class: "ground-help" }, this.coach, this.hint);
  }

  update(v: GroundView): void {
    if (v.alive && !this.wasAlive) this.runway = v.onGround; // spawned: parked or in the air
    this.wasAlive = v.alive;
    if (this.runway && !this.coachDone && tookOff(v)) {
      this.coachDone = true;
      write(this.store, COACH_KEY);
    }
    const line = this.runway && !this.coachDone ? coachLine(v, v.rotateSpeed, v.scheme, v.invertY) : "";
    text(this.coach, line);
    this.coach.hidden = line === "";
    const hint = !this.hintOff && v.alive && v.onGround;
    if (hint) text(this.hintText, groundHint(v.scheme, v.invertY, v.rotateSpeed));
    this.hint.hidden = !hint;
  }
}
