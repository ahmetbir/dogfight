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
/** A catch-up larger than this is a real jump (respawn, reset): shown at once. */
export const TELEPORT_M = 60;
const G = 9.81;
const G_WINDOW_MS = 50;

export type RemotePose = { fs: FlightState; g: number };

type Entry = { t: number; fs: FlightState };

type Track = {
  buf: InterpBuffer;
  basis: Entry | null; // the newest snapshot the last frame was carried from (null: inside the buffer)
  off: { pos: V3; rot: Q } | null; // catch-up still being blended in
  offAt: number;
};

const IDENTITY: Q = { w: 1, x: 0, y: 0, z: 0 };

/**
 * The raw drawn state at rt: the buffer's interpolation, past its end the
 * newest state carried on (at most 500 ms), except a plane with its gear down
 * or on its wheels, which holds (a landing plane would sink through the
 * runway). Never below the ground plus gear height.
 */
export function rawPose(buf: InterpBuffer, rt: number, ground: (x: number, z: number) => number): FlightState | null {
  const last = buf.newest();
  if (!last) return null;
  const fs = rt > last.t && (last.fs.gear || last.fs.ground) ? last.fs : extrapolate(buf, rt);
  if (!fs) return null;
  const floor = ground(fs.pos.x, fs.pos.z) + GEAR_HEIGHT;
  return fs.pos.y >= floor ? fs : { ...fs, pos: v3(fs.pos.x, floor, fs.pos.z) };
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
 * over BLEND_MS from where the plane was being drawn, unless it is more than
 * TELEPORT_M away.
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
        const was = rawPose(single(tr.basis), rt, this.ground) ?? raw;
        const d = sub(was.pos, raw.pos);
        tr.off = len(d) > TELEPORT_M ? null : { pos: d, rot: qNorm(qMul(was.rot, qConj(raw.rot))) };
        tr.offAt = nowMs;
      }
      tr.basis = newest && rt > newest.t ? newest : null;
      let fs = raw;
      const k = tr.off ? 1 - (nowMs - tr.offAt) / BLEND_MS : 0;
      if (tr.off && k > 0) {
        fs = { ...raw, pos: add(raw.pos, scale(tr.off.pos, k)), rot: qMul(qSlerp(IDENTITY, tr.off.rot, k), raw.rot) };
      } else {
        tr.off = null;
      }
      out.set(id, { fs, g: remoteG(buf, rt, raw, this.ground) });
    }
    return out;
  }
}

/** A buffer holding only e: e carried on, as it was being drawn. */
function single(e: Entry): InterpBuffer {
  const b = new InterpBuffer();
  b.push(e.t, e.fs);
  return b;
}
