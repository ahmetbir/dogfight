// Connection quality as the player feels it: round-trip time from ping/pong,
// how long the server has been silent, and snapshots lost on the way. Pure:
// every call takes the local time (ms) so tests drive it without a clock.

export type Quality = "good" | "fair" | "poor" | "lost";

/** What the HUD shows. rttMs is null until the first pong. */
export type LinkView = { quality: Quality; rttMs: number | null; lossPct: number; unstable: boolean };

/** Ping period while in a match (the server allows 2/s; the socket's keepalive adds one per 15 s). */
export const PING_MS = 1000;
/** Silence (snapshots come at 30 Hz) after which the "connection unstable" banner shows. */
export const UNSTABLE_MS = 1000;
/** The banner stays this long after traffic resumes, so a stuttering link does not blink it. */
const UNSTABLE_HOLD_MS = 600;
const SNAP_TICKS = 2;     // game ticks between snapshots (match.SnapEvery)
const LOSS_WINDOW = 60;   // expected snapshots (~2 s) the loss is counted over
const RTT_SMOOTH = 0.3;   // weight of a new RTT sample
// Thresholds: [fair from, poor from].
const RTT_MS = [120, 250];
const LOSS_PCT = [2, 10];
const SILENT_MS = [200, 400];

export class LinkMonitor {
  private lastRecv: number;
  private lastPing = -Infinity;
  private rtt: number | null = null;
  private lastTick: number | null = null;
  private window: number[] = []; // per expected snapshot: 1 lost, 0 arrived
  private unstableUntil = -Infinity;

  constructor(now: number) {
    this.lastRecv = now;
  }

  /** A new connection: nothing heard yet on it, snapshot ticks start over. */
  reset(now: number): void {
    this.lastRecv = now;
    this.lastTick = null;
    this.window = [];
    this.unstableUntil = -Infinity;
  }

  /** Any server message arrived. */
  received(now: number): void {
    if (now - this.lastRecv >= UNSTABLE_MS) this.unstableUntil = now + UNSTABLE_HOLD_MS;
    this.lastRecv = now;
  }

  /** A snapshot of game tick `tick`: the ticks skipped since the last one are lost snapshots. */
  snap(tick: number): void {
    const prev = this.lastTick;
    this.lastTick = tick;
    if (prev === null || tick <= prev) return;
    const lost = Math.min(Math.round((tick - prev) / SNAP_TICKS) - 1, LOSS_WINDOW);
    for (let i = 0; i < lost; i++) this.window.push(1);
    this.window.push(0);
    if (this.window.length > LOSS_WINDOW) this.window.splice(0, this.window.length - LOSS_WINDOW);
  }

  /** A pong echoing ts, the local time its ping was sent. */
  pong(ts: number, now: number): void {
    const sample = now - ts;
    if (!Number.isFinite(sample) || sample < 0) return;
    this.rtt = this.rtt === null ? sample : this.rtt + (sample - this.rtt) * RTT_SMOOTH;
  }

  /** Sends a ping through send when one is due (at most every PING_MS). */
  ping(now: number, send: (ts: number) => boolean): void {
    if (now - this.lastPing < PING_MS) return;
    if (send(now)) this.lastPing = now;
  }

  /** Milliseconds since the server was last heard. */
  silentMs(now: number): number {
    return Math.max(0, now - this.lastRecv);
  }

  view(now: number): LinkView {
    const silent = this.silentMs(now);
    const loss = this.window.length ? (100 * this.window.reduce((a, b) => a + b, 0)) / this.window.length : 0;
    const rtt = this.rtt === null ? null : Math.round(this.rtt);
    const level = Math.max(grade(silent, SILENT_MS), grade(loss, LOSS_PCT), rtt === null ? 0 : grade(rtt, RTT_MS));
    const quality: Quality = silent >= UNSTABLE_MS ? "lost" : (["good", "fair", "poor"] as const)[level];
    return { quality, rttMs: rtt, lossPct: Math.round(loss), unstable: silent >= UNSTABLE_MS || now < this.unstableUntil };
  }
}

/** 0 below the first threshold, 1 from it, 2 from the second. */
function grade(v: number, at: number[]): number {
  return v >= at[1] ? 2 : v >= at[0] ? 1 : 0;
}
