import { newTouchState, type TouchState } from "./touch.ts";

// Raw keyboard/mouse/touch state. Keys are KeyboardEvent.code values ("KeyW",
// "ShiftLeft", "Space"); mouse buttons are the MouseEvent.buttons bitmask.

/** Keys whose browser default (focus change, page scroll) is blocked while playing. */
const BLOCKED = new Set(["Tab", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

export const LEFT = 1;
export const RIGHT = 2;
const SECONDARY_DEDUP_MS = 250;

export type InputOptions = {
  /** Pointer lock was lost while playing (Esc under pointer lock, C42). */
  onLockLost?: () => void;
  /** Whether a click on the canvas takes the pointer lock (not for the touch scheme). */
  wantsLock?: () => boolean;
  /** The touch overlay's state, shared with ui/touchpad and input/tilt. */
  touch?: TouchState;
};

export class InputState {
  keys = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  buttons = 0;
  readonly touch: TouchState;
  /** While false, keys keep their browser defaults and lock loss is not reported. */
  playing = false;
  private readonly presses = new Set<string>();
  private lastSecondary = -Infinity;
  private readonly canvas: HTMLElement;
  private readonly opts: InputOptions;
  private readonly off: (() => void)[] = [];

  constructor(canvas: HTMLElement, opts: InputOptions = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.touch = opts.touch ?? newTouchState();
    const on = <K extends keyof (WindowEventMap & DocumentEventMap)>(
      t: EventTarget, type: K, f: (e: (WindowEventMap & DocumentEventMap)[K]) => void,
    ) => {
      t.addEventListener(type, f as EventListener);
      this.off.push(() => t.removeEventListener(type, f as EventListener));
    };
    on(window, "keydown", (e) => {
      if (this.playing && BLOCKED.has(e.code)) e.preventDefault();
      if (!e.repeat) this.presses.add(e.code);
      this.keys.add(e.code);
    });
    on(window, "keyup", (e) => {
      if (this.playing && BLOCKED.has(e.code)) e.preventDefault();
      this.keys.delete(e.code);
    });
    on(window, "blur", () => this.clear());
    on(canvas, "mousedown", (e) => {
      if (e.button === 1) e.preventDefault(); // middle click (bomb): no autoscroll
      if (!this.locked()) { // the click that takes the lock does not fire
        if (this.playing && (opts.wantsLock?.() ?? true)) void Promise.resolve(canvas.requestPointerLock?.()).catch(() => {});
        return;
      }
      if (e.button === 2 || (e.button === 0 && e.ctrlKey)) { // ctrl-click = macOS secondary click
        this.buttons = e.buttons & ~LEFT;
        this.secondary(e.timeStamp);
        return;
      }
      this.buttons = e.buttons;
      this.presses.add(`Mouse${e.button}`);
    });
    on(window, "mouseup", (e) => { this.buttons = e.ctrlKey ? e.buttons & ~LEFT : e.buttons; });
    // Mac trackpad two-finger clicks may arrive only as contextmenu, without a
    // button-2 mousedown; count it too (deduped with the mousedown).
    on(canvas, "contextmenu", (e) => {
      e.preventDefault();
      if (this.locked()) this.secondary(e.timeStamp);
    });
    on(window, "mousemove", (e) => {
      if (!this.locked()) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    on(document, "pointerlockchange", () => {
      if (this.locked()) return;
      this.buttons = 0;
      if (this.playing) this.opts.onLockLost?.();
    });
  }

  /** True while the canvas holds the pointer lock. */
  locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** Mouse movement since the last call. */
  consumeMouse(): { dx: number; dy: number } {
    const m = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return m;
  }

  /**
   * Records one secondary click as a "Mouse2" press. A single physical click
   * can fire both mousedown(button 2) and contextmenu; events closer than
   * SECONDARY_DEDUP_MS count once.
   */
  secondary(t: number): void {
    if (t - this.lastSecondary < SECONDARY_DEDUP_MS) return;
    this.lastSecondary = t;
    this.presses.add("Mouse2");
  }

  /** True once per press of code ("KeyF", "Mouse2") since the last call. */
  takePress(code: string): boolean {
    return this.presses.delete(code);
  }

  /** Releases everything (focus lost). */
  clear(): void {
    this.keys.clear();
    this.presses.clear();
    this.buttons = 0;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.touch.stick = null;
    this.touch.fire = false;
    this.touch.brake = false;
    this.touch.look = false;
    this.touch.taps.clear();
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off.length = 0;
    if (this.locked()) document.exitPointerLock();
  }
}
