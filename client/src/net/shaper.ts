// Dogfight's outbound shaping: inputs merge their one-shot presses, picks keep a gap.
import type { ShaperPolicy } from "../core/net/shaper.ts";
import type { ClientMsg } from "./protocol.ts";

export { MAX_BUFFERED, STALL_MS } from "../core/net/shaper.ts";
/** Least time between two picks; a pick inside it waits and the newest one is sent. */
export const PICK_GAP_MS = 500;

export const POLICY: ShaperPolicy<ClientMsg> = {
  isInput: (m) => m.t === "in",
  latch: (held, m) =>
    m.t === "in" && held.t === "in" ? { ...m, m: m.m || held.m, fl: m.fl || held.fl, bo: !!(m.bo || held.bo) } : m,
  gapped: (m) => m.t === "pick",
  gapMs: PICK_GAP_MS,
};
