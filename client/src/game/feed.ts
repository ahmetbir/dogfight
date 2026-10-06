// Fan-out of applied server messages (state already updated) to listeners.
import type { ServerMsg } from "../net/protocol.ts";
import type { ServerEvent } from "./state.ts";

export type Listener = (m: ServerMsg, evs: ServerEvent[]) => void;

export class Feed {
  private readonly ls = new Set<Listener>();

  /** Subscribes f; returns the unsubscribe function. */
  on(f: Listener): () => void {
    this.ls.add(f);
    return () => this.ls.delete(f);
  }

  emit(m: ServerMsg, evs: ServerEvent[]): void {
    for (const f of this.ls) f(m, evs);
  }
}
