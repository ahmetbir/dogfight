// Line-by-line port of internal/sim/ground.go (stepGround, settle, gearState).
import { add, qAxisAngle, qForward, qMul, qNorm, scale, v3, type Q } from "./vec.ts";
import { thrustOf } from "./thrust.ts";
import type { FlightMods, FlightState, Spec, StickInput } from "./flight.ts";

export type GroundSample = { h: number; surf: number };

export const GEAR_HEIGHT = 2.5, GEAR_DRAG = 0.8, GEAR_MAX_DEPLOY = 140, GEAR_MAX_SPEED = 160, GROUND_THRUST = 0.3;
export const ROLL_DECEL = 0.4, BRAKE_DECEL = 8, STEER_MAX = 0.7, STEER_RADIUS = 20, STEER_FADE = 80;
export const ROTATE_RATE = 0.25, MAX_GROUND_PITCH = 0.26, LIFTOFF_PITCH = 0.09;
export const TAXI_GOVERNOR = 28; // m/s: thrust (AB included) alone cannot push a plane past this off the runway
/** Rough (unpaved) ground: rolling resistance ×4, small bumps; > 35 m/s there is a crash (server). */
export const GRASS_ROLL = 4, GRASS_BUMP = 0.012, GRASS_MAX_SPEED = 35; // bump: rad of nose bob
const SURF_NONE = 0, SURF_RUNWAY = 1; // maps.SurfNone, maps.SurfRunway (surface.ts)

/** Port of grassBump in ground.go. */
function grassBump(x: number, z: number, speed: number): number {
  return GRASS_BUMP * Math.min(1, speed / GRASS_MAX_SPEED) * Math.sin(0.9 * x + 0.4 * z) * Math.cos(0.5 * x - 0.8 * z);
}
const DT = 1 / 60;

export function gearState(gear: boolean, ground: boolean, want: boolean, speed: number): boolean {
  if (ground) return true;
  if (gear && speed > GEAR_MAX_SPEED) return false;
  if (!want) return false;
  if (!gear && speed <= GEAR_MAX_DEPLOY) return true;
  return gear;
}

export function yawPitch(heading: number, pitch: number): Q {
  return qNorm(qMul(qAxisAngle(v3(0, 1, 0), heading), qAxisAngle(v3(1, 0, 0), pitch)));
}

function headingPitch(q: Q): [number, number] {
  const f = qForward(q);
  return [Math.atan2(-f.x, -f.z), Math.asin(Math.max(-1, Math.min(1, f.y)))];
}

export function stepGround(fs: FlightState, inp: StickInput, s: Spec, m: FlightMods, speed0: number): FlightState {
  let [heading, pitch] = headingPitch(fs.rot);
  const surf = m.ground?.surf ?? SURF_NONE;
  const rough = surf === SURF_NONE;
  if (rough) pitch -= grassBump(fs.pos.x, fs.pos.z, speed0); // take off last tick's bump
  const [k, engine] = thrustOf(s, fs.th, inp.ab, m.turbo);
  const thrust = engine * GROUND_THRUST;
  let decel = ROLL_DECEL;
  if (rough) decel *= GRASS_ROLL;
  if (inp.br) decel += BRAKE_DECEL;
  const coast = Math.max(0, speed0 + (-k * (1 + GEAR_DRAG) * speed0 * speed0 - decel) * DT);
  let speed = Math.max(0, speed0 + (thrust - k * (1 + GEAR_DRAG) * speed0 * speed0 - decel) * DT);
  // Taxi governor (taxi surfaces and rough ground): thrust is cut at TAXI_GOVERNOR; only momentum exceeds it.
  if (surf !== SURF_RUNWAY) speed = Math.max(coast, Math.min(speed, TAXI_GOVERNOR));
  const steer = Math.max(-1, Math.min(1, inp.y + inp.r));
  heading -= steer * Math.min(STEER_MAX, speed / STEER_RADIUS) * Math.max(0.15, 1 - speed / STEER_FADE) * DT;
  const rotate = s.rotateSpeed;
  if (speed >= rotate && inp.p > 0) pitch = Math.min(MAX_GROUND_PITCH, pitch + ROTATE_RATE * inp.p * DT);
  else pitch = Math.max(0, pitch - ROTATE_RATE * DT);
  const rot = yawPitch(heading, pitch);
  if (speed >= rotate && pitch >= LIFTOFF_PITCH) {
    const vel = scale(qForward(rot), speed);
    return { ...fs, rot, vel, pos: add(fs.pos, scale(vel, DT)), ground: false, w: v3(0, 0, 0) };
  }
  const vel = scale(v3(-Math.sin(heading), 0, -Math.cos(heading)), speed);
  const pos = add(fs.pos, scale(vel, DT));
  pos.y = (m.ground?.h ?? 0) + GEAR_HEIGHT;
  const drawn = rough ? yawPitch(heading, pitch + grassBump(pos.x, pos.z, speed)) : rot;
  return { ...fs, rot: drawn, vel, pos, ground: true, w: v3(0, 0, 0) };
}

export function settle(fs: FlightState, g: GroundSample): FlightState {
  const [heading, pitch] = headingPitch(fs.rot);
  const h = Math.sqrt(fs.vel.x * fs.vel.x + fs.vel.z * fs.vel.z);
  const rot = yawPitch(heading, Math.max(0, Math.min(LIFTOFF_PITCH / 2, pitch)));
  const vel = scale(v3(-Math.sin(heading), 0, -Math.cos(heading)), h);
  return { ...fs, rot, vel, pos: { x: fs.pos.x, y: g.h + GEAR_HEIGHT, z: fs.pos.z }, ground: true, w: v3(0, 0, 0) };
}
