// Outbound rate shaping for one connection: a stalled network must not
// release seconds of queued inputs in one bunch, and picks keep a gap.
import type { ClientMsg, In, Pick } from "./protocol.ts";

/** Bytes queued in the browser above which the connection counts as backed up. */
export const MAX_BUFFERED = 8 * 1024;
/** Server silence (snaps come at 30 Hz) after which the network counts as stalled. */
export const STALL_MS = 1000;
/** Least time between two picks; a pick inside it waits and the newest one is sent. */
export const PICK_GAP_MS = 500;

export type ShaperEnv = {
  now: () => number;
  setTimeout: (f: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
  buffered: () => number;              // the socket's bufferedAmount
  write: (m: ClientMsg) => boolean;
};

/**
 * Shaper sits between the game and one open connection. While the connection
 * is backed up it holds only the newest input (one-shot presses of the ones
 * it replaces carry over) and sends it once traffic flows again; the server
 * keeps only the newest inputs anyway. Picks go out at most once per
 * PICK_GAP_MS. Every message it accepts reports true.
 */
export class Shaper {
  private readonly env: ShaperEnv;
  private lastRecv: number;
  private heldIn: In | null = null;
  private lastPick = -Infinity;
  private heldPick: Pick | null = null;
  private pickTimer: unknown = null;

  constructor(env: ShaperEnv) {
    this.env = env;
    this.lastRecv = env.now();
  }

  /** Any server message: the network is flowing; a held input goes out. */
  received(): void {
    this.lastRecv = this.env.now();
    if (this.heldIn && !this.backedUp()) {
      const m = this.heldIn;
      this.heldIn = null;
      this.env.write(m);
    }
  }

  send(m: ClientMsg): boolean {
    if (m.t === "in") return this.input(m);
    if (m.t === "pick") return this.pick(m);
    return this.env.write(m);
  }

  /** The connection is gone: nothing held is sent. */
  dispose(): void {
    if (this.pickTimer !== null) this.env.clearTimeout(this.pickTimer);
    this.pickTimer = null;
    this.heldIn = this.heldPick = null;
  }

  private backedUp(): boolean {
    return this.env.buffered() > MAX_BUFFERED || this.env.now() - this.lastRecv > STALL_MS;
  }

  private input(m: In): boolean {
    const held = this.heldIn;
    const out: In = held ? { ...m, m: m.m || held.m, fl: m.fl || held.fl, bo: !!(m.bo || held.bo) } : m;
    if (this.backedUp()) {
      this.heldIn = out;
      return true;
    }
    this.heldIn = null;
    return this.env.write(out);
  }

  private pick(m: Pick): boolean {
    const wait = this.lastPick + PICK_GAP_MS - this.env.now();
    if (wait <= 0 && this.pickTimer === null) {
      this.lastPick = this.env.now();
      return this.env.write(m);
    }
    this.heldPick = m;
    if (this.pickTimer === null) {
      this.pickTimer = this.env.setTimeout(() => {
        this.pickTimer = null;
        const p = this.heldPick;
        this.heldPick = null;
        if (p) {
          this.lastPick = this.env.now();
          this.env.write(p);
        }
      }, Math.max(wait, 0));
    }
    return true;
  }
}
