// Touch overlay (spec §12.3): a floating stick on the left half, a throttle
// slider on the left edge and the action buttons on the right. Every finger
// (pointerId) is bound to one role while it is down, so the stick and the
// fire button work together. It only writes the shared TouchState; input/touch flies it.
import { lattr, lt, t } from "../i18n/index.ts";
import type { TouchControl } from "../input/bindings.ts";
import { stickVector, type Tap, type TouchState } from "../input/touch.ts";
import { h, text } from "./dom.ts";

export type Role = "stick" | "throttle" | "fire" | "brake" | "look" | "missile" | "flare" | "bomb" | "ab" | "gear" | "chat";

const STICK_R = 60; // px: full deflection
const TAPS: readonly Role[] = ["missile", "flare", "bomb", "ab", "gear"] satisfies Tap[];

/** Which role each finger holds. */
export class Pointers {
  private readonly by = new Map<number, Role>();

  down(id: number, role: Role): void {
    this.by.set(id, role);
  }

  /** Releases finger id; the role it held, if any. */
  up(id: number): Role | undefined {
    const r = this.by.get(id);
    this.by.delete(id);
    return r;
  }

  held(role: Role): boolean {
    for (const r of this.by.values()) if (r === role) return true;
    return false;
  }

  clear(): void {
    this.by.clear();
  }
}

/** The replay button (R on a keyboard): "replay" while down with a replay ready, "skip" while one plays, else hidden. */
export function replayButton(canReplay: boolean, replaying: boolean): "replay" | "skip" | null {
  if (replaying) return "skip";
  return canReplay ? "replay" : null;
}

const label = (c: TouchControl) => lt(`touch.${c}`);

export type TouchPadOpts = {
  bomb: boolean;     // base attack: show the bomb button
  onChat(): void;    // chat: toggle the six-preset menu
  onMenu(): void;    // menu: settings (Esc)
  onPick(): void;    // plane: aircraft pick (P)
  onBoard(show: boolean): void; // score held: scoreboard (Tab)
  onReplay(): void;  // replay / skip: start or skip the replay (R)
};

export class TouchPad {
  readonly el: HTMLElement;
  private readonly state: TouchState;
  private readonly pointers = new Pointers();
  private readonly base = h("div", { class: "tp-base", hidden: true });
  private readonly knob = h("div", { class: "tp-knob" });
  private readonly thFill = h("div", { class: "tp-th-fill" });
  private readonly thTrack: HTMLElement;
  private readonly replay = h("button", { type: "button", class: "tp-small tp-replay", hidden: true });
  private origin = { x: 0, y: 0 };

  constructor(state: TouchState, opts: TouchPadOpts) {
    this.state = state;
    this.base.append(this.knob);
    const zone = h("div", { class: "tp-zone" }, this.base);
    this.bind(zone, "stick", (e) => {
      this.origin = { x: e.clientX, y: e.clientY };
      const r = zone.getBoundingClientRect();
      this.base.style.left = `${e.clientX - r.left}px`;
      this.base.style.top = `${e.clientY - r.top}px`;
      this.knob.style.transform = "";
      this.base.hidden = false;
      state.stick = { x: 0, y: 0 };
    }, (e) => {
      const dx = e.clientX - this.origin.x, dy = e.clientY - this.origin.y;
      state.stick = stickVector(dx, dy, STICK_R);
      const l = Math.hypot(dx, dy), k = l > STICK_R ? STICK_R / l : 1;
      this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    });
    this.thTrack = h("div", { class: "tp-th-track" }, this.thFill);
    const th = lattr(h("div", { class: "tp-throttle" }, this.thTrack, h("span", { class: "tp-th-label" }, label("throttle"))), "aria-label", "touch.throttleAria");
    const slide = (e: PointerEvent) => {
      const r = this.thTrack.getBoundingClientRect();
      state.throttle = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / Math.max(1, r.height)));
      this.sync();
    };
    this.bind(th, "throttle", slide, slide);
    const btn = (role: Role & TouchControl, cls = "") => {
      const b = h("button", { type: "button", class: `tp-btn tp-${role}${cls}` }, label(role));
      this.bind(b, role, () => { if (role === "chat") opts.onChat(); });
      return b;
    };
    const small = (c: TouchControl, f: () => void) => {
      const b = h("button", { type: "button", class: "tp-small" }, label(c));
      b.addEventListener("click", f);
      return b;
    };
    const board = h("button", { type: "button", class: "tp-small" }, label("board"));
    board.addEventListener("pointerdown", () => opts.onBoard(true));
    for (const t of ["pointerup", "pointercancel", "pointerleave"]) board.addEventListener(t, () => opts.onBoard(false));
    this.replay.addEventListener("click", () => opts.onReplay());
    this.el = h("div", { class: "touchpad" }, zone, th,
      h("div", { class: "tp-top" }, small("menu", () => opts.onMenu()), small("pick", () => opts.onPick()), board, this.replay),
      h("div", { class: "tp-buttons" },
        btn("chat"), btn("look"), btn("ab"), btn("gear"), btn("brake"),
        btn("flare"), btn("missile"), opts.bomb ? btn("bomb") : null, btn("fire", " big")));
    this.el.addEventListener("contextmenu", (e) => e.preventDefault()); // long press
    this.sync();
  }

  /** Shows replay / skip per replayButton (every frame; touches the DOM only on change). */
  replayState(canReplay: boolean, replaying: boolean): void {
    const c = replayButton(canReplay, replaying);
    this.replay.hidden = c === null;
    if (c) text(this.replay, t(`touch.${c}`));
  }

  /** Redraws the slider from the state (the scheme sets it to idle on a runway respawn). */
  sync(): void {
    this.thFill.style.height = `${Math.round(this.state.throttle * 100)}%`;
  }

  dispose(): void {
    this.pointers.clear();
    this.held();
    this.state.stick = null;
    this.state.taps.clear();
    this.el.remove();
  }

  /** Binds role to el: each finger that lands on it holds the role until it lifts. */
  private bind(el: HTMLElement, role: Role, onDown?: (e: PointerEvent) => void, onMove?: (e: PointerEvent) => void): void {
    let mine: number | null = null; // the finger driving a stick/slider
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if ((role === "stick" || role === "throttle") && mine !== null) return; // one finger per stick
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // synthetic or already-released pointer
      }
      this.pointers.down(e.pointerId, role);
      if (role === "stick" || role === "throttle") mine = e.pointerId;
      if ((TAPS as Role[]).includes(role)) this.state.taps.add(role as Tap);
      el.classList.add("on");
      onDown?.(e);
      this.held();
    });
    el.addEventListener("pointermove", (e) => { if (e.pointerId === mine) onMove?.(e); });
    const up = (e: PointerEvent) => {
      if (this.pointers.up(e.pointerId) === undefined) return;
      if (e.pointerId === mine) mine = null;
      if (!this.pointers.held(role)) el.classList.remove("on");
      if (role === "stick" && mine === null) {
        this.state.stick = null;
        this.base.hidden = true;
      }
      this.held();
    };
    for (const t of ["pointerup", "pointercancel", "lostpointercapture"] as const) el.addEventListener(t, up);
  }

  private held(): void {
    this.state.fire = this.pointers.held("fire");
    this.state.brake = this.pointers.held("brake");
    this.state.look = this.pointers.held("look");
  }
}
