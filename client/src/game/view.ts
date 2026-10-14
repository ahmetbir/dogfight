// Render states for every plane: mine from prediction, others from this
// frame's remote poses (game/remote.ts).
import type { PlayerJSON } from "../net/protocol.ts";
import type { Controls } from "../render/glb.ts";
import type { PlaneRender } from "../render/planes.ts";
import type { FlightState, Spec } from "../sim/flight.ts";
import type { V3 } from "../sim/vec.ts";
import type { RemotePose } from "./remote.ts";
import { toFlight, type GameState } from "./state.ts";

/**
 * Stick deflections that would produce body rates w (x pitch, y yaw, z roll,
 * rad/s) on aircraft spec: how another plane's control surfaces move.
 */
export function ratesToControls(w: V3 | undefined, spec: Pick<Spec, "pitchRate" | "yawRate" | "rollRate"> | undefined): Controls | undefined {
  if (!w || !spec) return undefined;
  const k = (v: number, rate: number) => (rate > 0 && Number.isFinite(v) ? Math.max(-1, Math.min(1, v / rate)) : 0);
  return { p: k(w.x, spec.pitchRate), r: k(-w.z, spec.rollRate), y: k(-w.y, spec.yawRate) };
}

/**
 * The paint of a player's jet of kind (the kind the snapshot flies): the
 * roster's skin when that is the picked jet, else the flying jet's own
 * (fskin; a pick waiting for the next spawn leaves it alone).
 */
export function paintOf(pl: PlayerJSON | undefined, kind: string): string | undefined {
  if (!pl) return undefined;
  return pl.kind === kind ? pl.skin : pl.fskin ?? pl.skin;
}

/**
 * others is this frame's drawn pose of every other live plane; mine is my drawn state (null while dead or unknown); ab is my current AB
 * input so the flame reacts without waiting for the server; stick moves my
 * control surfaces.
 */
export function planeRenders(
  s: GameState, others: ReadonlyMap<number, RemotePose>, mine: { fs: FlightState | null; gForce: number; ab: boolean; stick?: Controls },
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
      const at = p.a ? others.get(p.id) : undefined;
      fs = at?.fs ?? toFlight(p);
      if (at) g = at.g;
    }
    out.set(p.id, {
      id: p.id, kind: p.k, team: p.tm, pos: fs.pos, rot: fs.rot,
      alive: p.a && (!isMe || mine.fs !== null),
      hp: p.hp, maxHP: s.aircraft.get(p.k)?.maxHP ?? 100,
      ab: isMe ? p.a && mine.ab : !!p.ab, gForce: g,
      name: s.players.get(p.id)?.name ?? "", isMe, skin: paintOf(s.players.get(p.id), p.k),
      gear: isMe ? !!fs.gear : !!p.gr, // mine from prediction, others from the wire
      ctl: isMe ? mine.stick : ratesToControls(toFlight(p).w, s.aircraft.get(p.k)),
      msl: p.ms + (p.rm ?? 0), // every plane's snapshot carries both kinds (rearm refills them)
    });
  }
  return out;
}
