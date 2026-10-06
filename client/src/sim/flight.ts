// Line-by-line port of internal/sim/flight.go. Keep the operation order
// identical; testdata/vectors/flight.json pins it.
import { add, len, lerp, norm, qAxisAngle, qForward, qMul, qNorm, scale, cross, v3, type Q, type V3 } from "./vec.ts";
import { thrustOf } from "./thrust.ts";
import { GEAR_DRAG, GEAR_HEIGHT, gearState, settle, stepGround, type GroundSample } from "./ground.ts";

/** Flight-relevant aircraft numbers; AircraftInfo from the welcome satisfies it. */
export type Spec = {
  maxSpeed: number; maxSpeedAB: number; accel: number;
  rollRate: number; pitchRate: number; yawRate: number; cornerSpeed: number;
  rotateSpeed: number; // m/s: lift-off speed with the nose up (welcome aircraft[].rotateSpeed)
};
/**
 * vel is air-relative; gear = landing gear down, ground = rolling on the wheels;
 * w = body angular rate (x pitch, y yaw, z roll), rad/s, absent = 0;
 * abh = afterburner heat 0..1, abl = afterburner locked out.
 */
export type FlightState = {
  pos: V3; rot: Q; vel: V3; th: number; gear?: boolean; ground?: boolean; w?: V3; abh?: number; abl?: boolean;
};
/** g = desired gear-down state, br = wheel brakes (held). */
export type StickInput = { p: number; r: number; y: number; th: number; ab: boolean; g?: boolean; br?: boolean };
/** wind moves an airborne plane only; ground is the terrain under it at the start of the tick. */
export type FlightMods = { turbo: boolean; wind?: V3; ground?: GroundSample };

export const DT = 1 / 60, STALL = 90, GRAVITY = 14, CEILING = 3000, SLIP = 3;
/** Control inertia: rate change per s = ACCEL × max rate; push reaches PUSH_RATIO of the pull rate. */
export const PUSH_RATIO = 0.55, PITCH_ACCEL = 2.5, YAW_ACCEL = 2.5, ROLL_ACCEL = 3.0;
/** Afterburner budget: heat +1/15 per s burning, −1/25 per s off; locked at 1 until ≤ 0.3. */
export const AB_HEAT_RISE = 1 / 15, AB_HEAT_COOL = 1 / 25, AB_UNLOCK = 0.3;
/** Induced drag: extra deceleration INDUCED_DRAG·(n−1)², n − 1 = speed·|w pitch, yaw|/GRAVITY. */
export const INDUCED_DRAG = 0.2;

function approach(cur: number, target: number, step: number): number {
  return cur + Math.max(-step, Math.min(step, target - cur));
}

/** Control-rate scale: 0.3 below stall, 1 at corner speed, 0.6 at AB top speed. */
export function authority(speed: number, s: Spec): number {
  if (speed < STALL) return 0.3;
  if (speed < s.cornerSpeed) return 0.3 + 0.7 * (speed - STALL) / (s.cornerSpeed - STALL);
  return 1 - 0.4 * Math.min(1, (speed - s.cornerSpeed) / (s.maxSpeedAB - s.cornerSpeed));
}

function clampFinite(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0;
}

export function stepFlight(fs: FlightState, inp: StickInput, s: Spec, m: FlightMods): FlightState {
  const pitch = clampFinite(inp.p, -1, 1);
  const roll = clampFinite(inp.r, -1, 1);
  const yaw = clampFinite(inp.y, -1, 1);
  const th = clampFinite(inp.th, 0, 1);
  const abl0 = !!fs.abl;
  const ab = inp.ab && !abl0;
  let abh = fs.abh ?? 0;
  abh = ab ? Math.min(1, abh + AB_HEAT_RISE * DT) : Math.max(0, abh - AB_HEAT_COOL * DT);
  let abl = abl0;
  if (abh >= 1) abl = true;
  else if (abl && abh <= AB_UNLOCK) abl = false;
  fs = { ...fs, abh, abl };
  let speed = len(fs.vel);
  const gear = gearState(!!fs.gear, !!fs.ground, !!inp.g, speed);
  if (fs.ground) return stepGround({ ...fs, th, gear }, { ...inp, p: pitch, r: roll, y: yaw, th, ab }, s, m, speed);
  let fwd = qForward(fs.rot);

  const [k, thrust] = thrustOf(s, th, ab, m.turbo);
  const w0 = fs.w ?? v3(0, 0, 0);
  const lf = speed * Math.sqrt(w0.x * w0.x + w0.y * w0.y) / GRAVITY; // load factor n − 1
  const induced = INDUCED_DRAG * lf * lf;
  if (gear) speed += (thrust - k * (1 + GEAR_DRAG) * speed * speed - GRAVITY * fwd.y - induced) * DT;
  else speed += (thrust - k * speed * speed - GRAVITY * fwd.y - induced) * DT;
  speed = Math.max(speed, 20);

  const auth = authority(speed, s);
  let pitchT = pitch * s.pitchRate * auth;
  if (pitch < 0) pitchT *= PUSH_RATIO;
  const w = v3(
    approach(w0.x, pitchT, PITCH_ACCEL * s.pitchRate * DT),
    approach(w0.y, -yaw * s.yawRate * auth, YAW_ACCEL * s.yawRate * DT),
    approach(w0.z, -roll * s.rollRate * Math.max(auth, 0.5), ROLL_ACCEL * s.rollRate * DT));
  let rot = fs.rot;
  const a = len(w) * DT;
  if (a > 0) rot = qMul(rot, qAxisAngle(w, a));
  if (speed < STALL) { // nose falls toward the ground
    fwd = qForward(rot);
    const axis = cross(fwd, v3(0, -1, 0));
    if (len(axis) > 1e-6) {
      const drop = (STALL - speed) / STALL * 1.2 * DT;
      rot = qMul(qAxisAngle(axis, drop), rot);
    }
  }
  rot = qNorm(rot);

  let dir = norm(fs.vel);
  if (dir.x === 0 && dir.y === 0 && dir.z === 0) dir = qForward(rot);
  dir = norm(lerp(dir, qForward(rot), Math.min(1, SLIP * DT)));
  const vel = scale(dir, speed);
  const wind = m.wind; // without wind keep the v1 expression bit-for-bit
  const pos = wind && (wind.x !== 0 || wind.y !== 0 || wind.z !== 0)
    ? add(fs.pos, scale(add(vel, wind), DT))
    : add(fs.pos, scale(vel, DT));
  if (pos.y > CEILING) {
    pos.y = CEILING;
    vel.y = Math.min(vel.y, 0);
  }
  const out: FlightState = { pos, rot, vel, th, gear, ground: false, w, abh, abl };
  const g = m.ground ?? { h: 0, surf: 0 }; // Go's zero GroundSample
  return gear && pos.y <= g.h + GEAR_HEIGHT ? settle(out, g) : out; // touchdown, paved or not
}
