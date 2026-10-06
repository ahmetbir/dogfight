// Touch overlay (spec §12.3): a floating stick on the left half, a throttle
// slider on the left edge and the action buttons on the right. Every finger
// (pointerId) is bound to one role while it is down, so the stick and ATEŞ
// work together. It only writes the shared TouchState; input/touch flies it.
import { TOUCH_LABEL as L } from "../input/bindings.ts";
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

/** The replay button (R on a keyboard): TEKRAR while down with a replay ready, GEÇ while one plays, else hidden. */
export function replayButton(canReplay: boolean, replaying: boolean): typeof L.replay | typeof L.skip | null {
  if (replaying) return L.skip;
  return canReplay ? L.replay : null;
}

export type TouchPadOpts = {
  bomb: boolean;     // base attack: show BOMBA
  onChat(): void;    // SOHBET: toggle the six-preset menu
  onMenu(): void;    // MENÜ: settings (Esc)
  onPick(): void;    // UÇAK: aircraft pick (P)
  onBoard(show: boolean): void; // SKOR held: scoreboard (Tab)
  onReplay(): void;  // TEKRAR / GEÇ: start or skip the replay (R)
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
    const th = h("div", { class: "tp-throttle", "aria-label": "Gaz" }, this.thTrack, h("span", { class: "tp-th-label" }, L.throttle));
    const slide = (e: PointerEvent) => {
      const r = this.thTrack.getBoundingClientRect();
      state.throttle = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / Math.max(1, r.height)));
      this.sync();
    };
    this.bind(th, "throttle", slide, slide);
    const btn = (role: Role, label: string, cls = "") => {
      const b = h("button", { type: "button", class: `tp-btn tp-${role}${cls}` }, label);
      this.bind(b, role, () => { if (role === "chat") opts.onChat(); });
      return b;
    };
    const small = (label: string, f: () => void) => {
      const b = h("button", { type: "button", class: "tp-small" }, label);
      b.addEventListener("click", f);
      return b;
    };
    const board = h("button", { type: "button", class: "tp-small" }, L.board);
    board.addEventListener("pointerdown", () => opts.onBoard(true));
    for (const t of ["pointerup", "pointercancel", "pointerleave"]) board.addEventListener(t, () => opts.onBoard(false));
    this.replay.addEventListener("click", () => opts.onReplay());
    this.el = h("div", { class: "touchpad" }, zone, th,
      h("div", { class: "tp-top" }, small(L.menu, () => opts.onMenu()), small(L.pick, () => opts.onPick()), board, this.replay),
      h("div", { class: "tp-buttons" },
        btn("chat", L.chat), btn("look", L.look), btn("ab", L.ab), btn("gear", L.gear), btn("brake", L.brake),
        btn("flare", L.flare), btn("missile", L.missile), opts.bomb ? btn("bomb", L.bomb) : null, btn("fire", L.fire, " big")));
    this.el.addEventListener("contextmenu", (e) => e.preventDefault()); // long press
    this.sync();
  }

  /** Shows TEKRAR / GEÇ per replayButton (every frame; touches the DOM only on change). */
  replayState(canReplay: boolean, replaying: boolean): void {
    const label = replayButton(canReplay, replaying);
    this.replay.hidden = label === null;
    if (label) text(this.replay, label);
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
