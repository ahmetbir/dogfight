// The local plane: input sequencing, prediction and own muzzle tracers.
import { damagedSpec, unpackDamage } from "./damage.ts";
import type { AircraftInfo, ClientMsg, PlaneJSON } from "../net/protocol.ts";
import { Predictor, type FlightEnv } from "../predict/predictor.ts";
import { DT, type FlightState, type StickInput } from "../sim/flight.ts";
import { add, dot, len, qConj, qForward, qIdentity, qMul, qNorm, qRotate, scale, sub, v3, type Q, type V3 } from "../sim/vec.ts";
import { toFlight } from "./state.ts";

const GUN_TICKS = 4;      // sim.GunInterval
const MUZZLE = 8;         // m ahead of the plane
const BULLET_SPEED = 900; // m/s on top of the plane's velocity
const G = 9.81;
const G_SMOOTH = 0.2;     // per tick low-pass of the g meter

export type Sender = { send(m: ClientMsg): boolean };
export type Controls = { stick: StickInput; fire: boolean; missile: boolean; flare: boolean; bomb: boolean; sel?: number };
export type Shot = { pos: V3; vel: V3 };

export class OwnPlane {
  private pred: Predictor | null = null;
  private seq = 0;
  private alive = false;
  private kind = "";
  private turbo = false;
  private overheated = false;
  private ticks = 0;
  private lastShot = -GUN_TICKS;
  private th = 1;
  private gear = false; // gear down wanted in the last sent input
  private prevVel: V3 | null = null;
  private g = 1;
  private gz = 1; // signed load factor along my up axis
  private lastSpin: Q = qIdentity(); // world-frame rotation of the last predicted tick

  private readonly envOf: (turbo: boolean) => FlightEnv;

  /** envOf gives the flight environment (ground, wind) for prediction. */
  constructor(envOf: (turbo: boolean) => FlightEnv) {
    this.envOf = envOf;
  }

  /** New connection (welcome): the server starts counting seq from 1 again. */
  reset(): void {
    this.pred = null;
    this.seq = 0;
    this.alive = false;
    this.prevVel = null;
    this.lastSpin = qIdentity();
    this.gear = false;
  }

  isAlive(): boolean {
    return this.alive;
  }

  /**
   * Applies my plane from a snapshot. Returns true when prediction restarted
   * from the server state (spawn, respawn, aircraft change). tick is the
   * snapshot's world tick (wt), the clock of the wind.
   */
  snap(p: PlaneJSON | undefined, ack: number, spawned: boolean, aircraft: Map<string, AircraftInfo>, tick: number): boolean {
    if (!p || !p.a) {
      this.alive = false;
      return false;
    }
    this.turbo = !!p.tb;
    this.overheated = p.oh;
    const fs = toFlight(p);
    const info = aircraft.get(p.k);
    if (!info) return false;
    const spec = damagedSpec(info, unpackDamage(p.dm)); // the server flies a hit engine or controls with this
    if (!this.pred || !this.alive || spawned || p.k !== this.kind) {
      if (this.pred) this.pred.setSpec(spec);
      else this.pred = new Predictor(spec);
      this.pred.reset(fs, tick, ack);
      this.kind = p.k;
      this.alive = true;
      this.th = p.th;
      this.prevVel = null;
      this.gz = 1;
      this.lastSpin = qIdentity();
      return true;
    }
    this.pred.setSpec(spec);
    this.pred.reconcile(fs, ack, tick, this.envOf(this.turbo));
    return false;
  }

  /** Physics state for the control scheme (null while dead). */
  state(): FlightState | null {
    return this.alive && this.pred ? this.pred.state() : null;
  }

  /**
   * Sends one tick of input; when it was written and I am alive, predicts
   * it. Returns my own muzzle shot when the gun fired this tick.
   */
  tick(c: Controls, out: Sender): Shot | null {
    const seq = this.seq + 1;
    const s = c.stick;
    const sent = out.send({ t: "in", seq, p: s.p, r: s.r, y: s.y, th: s.th, ab: s.ab, f: c.fire, m: c.missile, fl: c.flare,
      g: !!s.g, br: !!s.br, bo: c.bomb, ...(c.sel ? { sel: c.sel } : {}) });
    if (!sent) return null;
    this.seq = seq;
    this.th = s.th;
    this.gear = !!s.g;
    this.ticks++;
    if (!this.alive || !this.pred) return null;
    const rot0 = this.pred.state().rot;
    // Counted by seq, not by pending inputs, which stop growing at the cap while acks stall.
    this.pred.push(seq, s, this.pred.tickFor(seq), this.envOf(this.turbo));
    const fs = this.pred.state();
    this.lastSpin = qNorm(qMul(fs.rot, qConj(rot0)));
    if (this.prevVel) {
      const a = scale(sub(fs.vel, this.prevVel), 1 / DT);
      const raw = len(add(a, v3(0, G, 0))) / G; // |Δv/dt − g| / 9.81, g = (0, −9.81, 0)
      this.g += (raw - this.g) * G_SMOOTH;
      const load = dot(add(a, v3(0, G, 0)), qRotate(fs.rot, v3(0, 1, 0))) / G;
      this.gz += (load - this.gz) * G_SMOOTH;
    }
    this.prevVel = fs.vel;
    if (!c.fire || this.overheated || this.ticks - this.lastShot < GUN_TICKS) return null;
    this.lastShot = this.ticks;
    const fwd = qForward(fs.rot);
    return { pos: add(fs.pos, scale(fwd, MUZZLE)), vel: add(fs.vel, scale(fwd, BULLET_SPEED)) };
  }

  /**
   * One neutral input (tab hidden): no stick, brakes or weapons; current
   * throttle and wanted gear (a hidden tab on final must not raise it).
   */
  neutral(out: Sender): void {
    const seq = this.seq + 1;
    const m = { t: "in", seq, p: 0, r: 0, y: 0, th: this.th, ab: false, f: false, m: false, fl: false, g: this.gear, br: false, bo: false } as const;
    if (out.send(m)) this.seq = seq;
  }

  /** Drawn state (prediction + decaying correction); null while dead. */
  render(dtS: number): FlightState | null {
    return this.alive && this.pred ? this.pred.render(dtS) : null;
  }

  /**
   * The last tick's rotation step (world frame): the loop applies a fraction
   * of it for the time since that tick, so attitude moves every frame like
   * position does, even when a frame runs 0 or 2 ticks.
   */
  spin(): Q {
    return this.alive ? this.lastSpin : qIdentity();
  }

  /** World ticks my drawn state runs ahead of the latest snapshot (0 while dead). */
  ahead(): number {
    return this.alive && this.pred ? this.pred.ahead() : 0;
  }

  /** Signed load factor along my up axis (+1 level, negative pushing). */
  gLoad(): number {
    return this.alive ? this.gz : 1;
  }

  gForce(): number {
    return this.g;
  }
}
