// Where other planes are drawn this frame: interpolated 100 ms behind, and
// past a late snapshot carried on along their last motion instead of
// standing still. One pose per plane per frame, shared by the mesh, the
// follow camera, engine sound, the HUD and the G estimate.
import { extrapolate, InterpBuffer } from "../predict/interp.ts";
import type { FlightState } from "../sim/flight.ts";
import { GEAR_HEIGHT } from "../sim/ground.ts";
import { add, len, qConj, qMul, qNorm, qSlerp, scale, sub, v3, type Q, type V3 } from "../sim/vec.ts";

/** How long a catch-up after a late snapshot is blended in. */
export const BLEND_MS = 100;
/**
 * A catch-up larger than this is a real jump (respawn, reset): shown at
 * once. At least TELEPORT_M, more for a fast plane: what it covers in
 * TELEPORT_S, so a fast plane's ordinary catch-up is never popped and a
 * slow plane's real jump is never slid.
 */
export const TELEPORT_M = 60, TELEPORT_S = 0.6;
/** Height over the ground under which the server crashes a plane (internal/sim/hazards.go crashClearance). */
export const CRASH_CLEARANCE = 2.0;
const G = 9.81;
const G_WINDOW_MS = 50;

export type RemotePose = { fs: FlightState; g: number };

type Entry = { t: number; fs: FlightState };

type Offset = { pos: V3; rot: Q };

type Track = {
  buf: InterpBuffer;
  basis: Entry | null; // the newest snapshot the last frame was carried from (null: inside the buffer)
  off: Offset | null; // catch-up still being blended in
  offAt: number;
};

const IDENTITY: Q = { w: 1, x: 0, y: 0, z: 0 };

/**
 * The raw drawn state at rt: the buffer's interpolation, past its end the
 * newest state carried on (at most 500 ms), except a plane on its wheels,
 * which holds. Never below the ground plus the gear height (gear down or on
 * the wheels) or the server's crash clearance (gear up).
 */
export function rawPose(buf: InterpBuffer, rt: number, ground: (x: number, z: number) => number): FlightState | null {
  const last = buf.newest();
  if (!last) return null;
  const fs = rt > last.t && last.fs.ground ? last.fs : extrapolate(buf, rt);
  if (!fs) return null;
  const floor = ground(fs.pos.x, fs.pos.z) + (last.fs.gear || last.fs.ground ? GEAR_HEIGHT : CRASH_CLEARANCE);
  return fs.pos.y >= floor ? fs : { ...fs, pos: v3(fs.pos.x, floor, fs.pos.z) };
}

/** Where another plane is drawn this frame (lock box, radar, enemies list): its shared pose. */
export function drawnAt(others: ReadonlyMap<number, RemotePose>, id: number): { pos: V3; vel: V3 } | null {
  const fs = others.get(id)?.fs;
  return fs ? { pos: fs.pos, vel: fs.vel } : null;
}

/** |Δv/dt − g| / 9.81 over the last 50 ms of the drawn track (1 without a buffer). */
export function remoteG(buf: InterpBuffer, rt: number, now: FlightState, ground: (x: number, z: number) => number): number {
  const before = rawPose(buf, rt - G_WINDOW_MS, ground);
  if (!before) return 1;
  const a = scale(sub(now.vel, before.vel), 1000 / G_WINDOW_MS);
  return len(add(a, v3(0, G, 0))) / G;
}

/**
 * Per-plane drawn poses. frame() once per rendered frame; a new snapshot
 * that lands while a plane is carried past the old newest one is blended in
 * over BLEND_MS from where the plane is being drawn (a blend in progress
 * included), unless it is a real jump (TELEPORT_M, TELEPORT_S).
 */
export class RemotePoses {
  private readonly tracks = new Map<number, Track>();
  private readonly ground: (x: number, z: number) => number;

  constructor(ground: (x: number, z: number) => number) {
    this.ground = ground;
  }

  frame(bufs: ReadonlyMap<number, InterpBuffer>, alive: (id: number) => boolean, rt: number, nowMs: number): Map<number, RemotePose> {
    const out = new Map<number, RemotePose>();
    for (const id of this.tracks.keys()) if (!bufs.has(id) || !alive(id)) this.tracks.delete(id);
    for (const [id, buf] of bufs) {
      if (!alive(id)) continue;
      let tr = this.tracks.get(id);
      if (!tr || tr.buf !== buf) { // new plane or a new life: no blend from the old one
        tr = { buf, basis: null, off: null, offAt: 0 };
        this.tracks.set(id, tr);
      }
      const raw = rawPose(buf, rt, this.ground);
      if (!raw) continue;
      const newest = buf.newest() ?? null;
      if (tr.basis && newest !== tr.basis) { // a snapshot landed while this plane was carried on
        // from where it is drawn now: the old carry plus what is left of a blend in progress
        const old = rawPose(single(tr.basis), rt, this.ground) ?? raw;
        const was = applied(old, tr.off, weight(tr, nowMs));
        const d = sub(was.pos, raw.pos);
        tr.off = len(d) > Math.max(TELEPORT_M, len(raw.vel) * TELEPORT_S) ? null : { pos: d, rot: qNorm(qMul(was.rot, qConj(raw.rot))) };
        tr.offAt = nowMs;
      }
      tr.basis = newest && rt > newest.t ? newest : null;
      const k = weight(tr, nowMs);
      if (k === 0) tr.off = null;
      const fs = applied(raw, tr.off, k);
      out.set(id, { fs, g: remoteG(buf, rt, raw, this.ground) });
    }
    return out;
  }
}

/** How much of the track's catch-up is still shown at nowMs (1 → 0 over BLEND_MS). */
function weight(tr: Track, nowMs: number): number {
  return tr.off ? Math.max(0, 1 - (nowMs - tr.offAt) / BLEND_MS) : 0;
}

/** fs shifted by k of the offset (position and attitude). */
function applied(fs: FlightState, off: Offset | null, k: number): FlightState {
  if (!off || k <= 0) return fs;
  return { ...fs, pos: add(fs.pos, scale(off.pos, k)), rot: qMul(qSlerp(IDENTITY, off.rot, k), fs.rot) };
}

/** A buffer holding only e: e carried on, as it was being drawn. */
function single(e: Entry): InterpBuffer {
  const b = new InterpBuffer();
  b.push(e.t, e.fs);
  return b;
}
