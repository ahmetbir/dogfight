// My paint on the server, sent once it settles. Browsing the paint row
// repaints the preview at once but sends nothing; the pick that carries
// the paint goes out SKIN_SETTLE_MS after the last change, or at once when
// the pick screen closes, and never when a pick that carries it anyway
// (Fly, a loadout click) has gone out meanwhile. It also mends a seat that
// came up in another paint than mine (reconnect, pick-timeout spawn, team
// switch): once per (kind, paint), settled the same way.

export const SKIN_SETTLE_MS = 1000;

export type Timers = { set(f: () => void, ms: number): unknown; clear(h: unknown): void };

const browserTimers: Timers = {
  set: (f, ms) => setTimeout(f, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class SkinSync {
  private readonly send: (kind: string) => void;
  private readonly timers: Timers;
  private readonly ms: number;
  private timer: unknown = null;
  private kind: string | null = null;
  private asked = "";

  /** send(kind) puts out one pick of kind carrying its paint (the caller's loadout and paint). */
  constructor(send: (kind: string) => void, timers: Timers = browserTimers, ms = SKIN_SETTLE_MS) {
    this.send = send;
    this.timers = timers;
    this.ms = ms;
  }

  /** kind's paint changed: send it once the changes settle (each change restarts the wait). */
  later(kind: string): void {
    this.kind = kind;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = this.timers.set(() => this.flush(), this.ms);
  }

  /** Sends a waiting paint now (the pick screen closed). */
  flush(): void {
    const k = this.kind;
    this.cancel();
    if (k !== null) this.send(k);
  }

  /** A pick carrying the paint went out: nothing waits any more. */
  cancel(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    this.kind = null;
  }

  get waiting(): boolean {
    return this.kind !== null;
  }

  /**
   * The roster shows my jet of kind in paint have, my choice is want: ask
   * for want once (not again for the same kind and paint until they match);
   * when they match, a send still waiting for kind is dropped.
   */
  mend(kind: string, have: string, want: string): void {
    if (have === want) {
      this.asked = "";
      if (this.kind === kind) this.cancel(); // already worn (or browsed back to it): nothing to send
      return;
    }
    const key = `${kind}|${want}`;
    if (key === this.asked || this.waiting) return;
    this.asked = key;
    this.later(kind);
  }
}

/**
 * After a reconnect (a new seat: the default loadout, standard paint):
 * whether my pick must go out again to restore the jet, loadout or paint.
 */
export function repickNeeded(seat: { kind: string; skin?: string }, chosen: string, loadout: string, paint: string): boolean {
  return seat.kind !== chosen || loadout !== "ir" || (seat.skin ?? "standard") !== paint;
}
