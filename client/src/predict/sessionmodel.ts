// Test model of internal/room/session.go (used by the predictor tests only):
// inputs with seq <= the last accepted one are dropped, a full queue (8)
// loses its oldest entry, a backlog above 4 is dropped at tick time, and a
// starved queue repeats the last input (ack does not move).
import type { StickInput } from "../sim/flight.ts";

const QUEUE_CAP = 8;
const QUEUE_KEEP = 4;

export class SessionModel {
  private q: { seq: number; inp: StickInput }[] = [];
  private last: StickInput | null = null;
  private lastSeq = 0;
  ack = 0;

  push(seq: number, inp: StickInput): void {
    if (seq <= this.lastSeq) return;
    this.lastSeq = seq;
    if (this.q.length === QUEUE_CAP) this.q.shift();
    this.q.push({ seq, inp });
  }

  /** The input for this tick and whether it is a fresh one (false: repeat or none yet). */
  next(): { inp: StickInput | null; fresh: boolean } {
    if (this.q.length === 0) return { inp: this.last, fresh: false };
    if (this.q.length > QUEUE_KEEP) this.q.splice(0, this.q.length - QUEUE_KEEP);
    const e = this.q.shift()!;
    this.ack = e.seq;
    this.last = e.inp;
    return { inp: e.inp, fresh: true };
  }
}
