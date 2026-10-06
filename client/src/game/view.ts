// Render states for every plane: mine from prediction, others interpolated.
import type { PlaneRender } from "../render/planes.ts";
import type { FlightState } from "../sim/flight.ts";
import { add, len, scale, sub, v3 } from "../sim/vec.ts";
import { toFlight, type GameState } from "./state.ts";

const G = 9.81;
const G_WINDOW_MS = 50;

/** |Δv/dt − g| / 9.81 from the interpolated velocity of a remote plane. */
function remoteG(s: GameState, id: number, rt: number, now: FlightState): number {
  const before = s.interp.get(id)?.sample(rt - G_WINDOW_MS);
  if (!before) return 1;
  const a = scale(sub(now.vel, before.vel), 1000 / G_WINDOW_MS);
  return len(add(a, v3(0, G, 0))) / G;
}

/**
 * mine is my drawn state (null while dead or unknown); ab is my current AB
 * input so the flame reacts without waiting for the server.
 */
export function planeRenders(
  s: GameState, rt: number, mine: { fs: FlightState | null; gForce: number; ab: boolean },
): Map<number, PlaneRender> {
  const out = new Map<number, PlaneRender>();
  for (const p of s.planes.values()) {
    const isMe = p.id === s.you;
    let fs: FlightState | null;
    let g = 1;
    if (isMe) {
      fs = mine.fs ?? toFlight(p);
      g = mine.gForce;
    } else {
      fs = (p.a ? s.interp.get(p.id)?.sample(rt) : null) ?? toFlight(p);
      if (p.a) g = remoteG(s, p.id, rt, fs);
    }
    out.set(p.id, {
      id: p.id, kind: p.k, team: p.tm, pos: fs.pos, rot: fs.rot,
      alive: p.a && (!isMe || mine.fs !== null),
      hp: p.hp, maxHP: s.aircraft.get(p.k)?.maxHP ?? 100,
      ab: isMe ? p.a && mine.ab : !!p.ab, gForce: g,
      name: s.players.get(p.id)?.name ?? "", isMe,
      gear: isMe ? !!fs.gear : !!p.gr, // mine from prediction, others from the wire
    });
  }
  return out;
}
