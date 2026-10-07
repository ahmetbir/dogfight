// Lasting hit damage (sim damage.go): the wire byte, and the spec my plane
// flies with it, so prediction slows down and turns softer with the server.
// The factors are RULES, checked against Go by internal/match/book_rules_test.go.
import { RULES } from "../book/rules.ts";
import type { Spec } from "../sim/flight.ts";

export type Damage = { engine: number; controls: number; avionics: number };
export type DamagePart = keyof Damage;

const ENGINE = [1, RULES.dmgEngine1, RULES.dmgEngine2];
const CONTROLS = [1, RULES.dmgControls1, RULES.dmgControls2];

/** The snapshot's dm byte: engine bits 0–1, controls 2–3, avionics 4–5 (sim.Damage.Pack); missing is intact. */
export function unpackDamage(dm: number | undefined): Damage {
  const n = dm ?? 0;
  return { engine: n & 3, controls: (n >> 2) & 3, avionics: (n >> 4) & 3 };
}

/** spec flown with damage d (mirrors sim.Damaged). */
export function damagedSpec<S extends Spec>(s: S, d: Damage): S {
  const e = ENGINE[d.engine] ?? 1, c = CONTROLS[d.controls] ?? 1;
  if (e === 1 && c === 1) return s;
  return {
    ...s, maxSpeed: s.maxSpeed * e, maxSpeedAB: s.maxSpeedAB * e, accel: s.accel * e,
    rollRate: s.rollRate * c, pitchRate: s.pitchRate * c, yawRate: s.yawRate * c,
  };
}
