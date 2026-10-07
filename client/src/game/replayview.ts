// The replay in the game: records every snapshot into the ring buffer (and
// stops shortly after my death, so the replay ends there), plays it back and
// turns each played frame into render states for planes and missiles.
import type { MissileJSON, Vec3 } from "../net/protocol.ts";
import { ServerClock } from "../predict/interp.ts";
import type { PlaneRender } from "../render/planes.ts";
import { scale, sub, v3, type Q, type V3 } from "../sim/vec.ts";
import type { Heard } from "./events.ts";
import { REPLAY_MS, ReplayBuffer, ReplayPlayer, type RFrame } from "./replay.ts";
import { toFlight, type GameState } from "./state.ts";
import { ratesToControls } from "./view.ts";

const POST_DEATH_MS = 1500;  // recorded after my death (the explosion)
const VEL_MS = 50;           // velocity estimate window (Doppler, camera FOV)
const TRAIL_ID = 1 << 24;    // replayed missiles get their own smoke trails
const HEARD_TH = 0.8;        // throttle the replayed engines are heard at

/** One played frame, ready to draw; me: my recorded plane (camera target). */
export type ReplayScene = {
  planes: Map<number, PlaneRender>; missiles: MissileJSON[]; heard: Heard[];
  me: { pos: V3; rot: Q; vel: V3; kind: string } | null;
};

export class ReplayView {
  private readonly s: GameState;
  private readonly buffer = new ReplayBuffer(REPLAY_MS + POST_DEATH_MS);
  private deathT = Infinity; // server ms of my last death
  private player: ReplayPlayer | null = null;
  private from = 0;          // local ms the playback started

  constructor(s: GameState) {
    this.s = s;
  }

  /** After each snapshot: record it, unless I have been down for a while. */
  record(): void {
    const s = this.s;
    const t = ServerClock.serverMs(s.tick);
    if (t > this.deathT + POST_DEATH_MS) return;
    const planes = [...s.planes.values()].map((p) => ({
      id: p.id, k: p.k, tm: p.tm, a: p.a, gr: !!p.gr, ab: !!p.ab,
      pos: v3(p.p[0], p.p[1], p.p[2]), rot: { w: p.q[0], x: p.q[1], y: p.q[2], z: p.q[3] },
      msl: p.ms + (p.rm ?? 0), ctl: ratesToControls(toFlight(p).w, s.aircraft.get(p.k)),
    }));
    const missiles = s.missiles.map((m) => ({ id: m.id, pos: v3(m.p[0], m.p[1], m.p[2]), vel: v3(m.v[0], m.v[1], m.v[2]) }));
    this.buffer.push({ t, planes, missiles });
  }

  /** I was downed at server tick `tick`. */
  died(tick: number): void {
    this.deathT = ServerClock.serverMs(tick);
  }

  /** I respawned: record afresh; an air start ends the playback, a parked runway start may watch on. */
  respawned(): void {
    this.deathT = Infinity;
    this.buffer.clear();
    if (this.s.start !== "pist") this.player = null;
  }

  /** Reconnected: nothing of the old life. */
  reset(): void {
    this.deathT = Infinity;
    this.buffer.clear();
    this.player = null;
  }

  playing(): boolean {
    return this.player !== null;
  }

  /** Down, not playing, and something recorded. */
  ready(): boolean {
    const me = this.s.planes.get(this.s.you);
    return !!me && !me.a && !this.player && this.deathT !== Infinity;
  }

  /** Starts the playback when ready(); true if it did. */
  start(nowMs: number): boolean {
    if (!this.ready()) return false;
    const frames = this.buffer.frames();
    if (frames.length < 2) return false;
    this.player = new ReplayPlayer(frames);
    this.from = nowMs;
    return true;
  }

  /** Ends the playback; true if one was running. */
  skip(): boolean {
    const was = this.player !== null;
    this.player = null;
    return was;
  }

  /** The frame to draw now; null when not playing (a finished playback ends here). */
  scene(nowMs: number): ReplayScene | null {
    const p = this.player;
    if (!p) return null;
    const e = nowMs - this.from;
    const f = p.done(e) ? null : p.sample(e);
    if (!f) {
      this.player = null;
      return null;
    }
    const before = p.sample(e - VEL_MS) ?? f;
    const vel = (id: number, pos: V3): V3 => {
      const b = before.planes.find((x) => x.id === id);
      return b && f.t > before.t ? scale(sub(pos, b.pos), 1000 / (f.t - before.t)) : v3(0, 0, 0);
    };
    return this.build(f, vel);
  }

  private build(f: RFrame, vel: (id: number, pos: V3) => V3): ReplayScene {
    const s = this.s;
    const planes = new Map<number, PlaneRender>();
    const heard: Heard[] = [];
    let me: ReplayScene["me"] = null;
    for (const p of f.planes) {
      const isMe = p.id === s.you;
      planes.set(p.id, {
        id: p.id, kind: p.k, team: p.tm, pos: p.pos, rot: p.rot, alive: p.a, hp: 1, maxHP: 1,
        ab: !!p.ab, gForce: 1, name: s.players.get(p.id)?.name ?? "", isMe, gear: !!p.gr,
        msl: p.msl, ctl: p.ctl,
      });
      const v = vel(p.id, p.pos);
      if (isMe) me = { pos: p.pos, rot: p.rot, vel: v, kind: p.k };
      if (p.a) heard.push({ id: p.id, pos: p.pos, vel: v, th: HEARD_TH, ab: !!p.ab });
    }
    const wire = (a: V3): Vec3 => [a.x, a.y, a.z];
    const missiles = f.missiles.map((m) => ({ id: m.id + TRAIL_ID, tg: 0, p: wire(m.pos), v: wire(m.vel ?? v3(0, 0, 0)) }));
    return { planes, missiles, heard, me };
  }
}
