// The aircraft table the manual uses outside a game: built from rules.ts,
// whose aircraft entries internal/match/book_rules_test.go checks against
// internal/sim's spec table.
import type { AircraftInfo, AircraftKind } from "../net/protocol.ts";
import { AIRCRAFT, RULES } from "./rules.ts";

type Field = "MaxHP" | "MaxSpeed" | "MaxSpeedAB" | "Accel" | "RollRate" | "PitchRate" | "YawRate" | "CornerSpeed" | "Missiles" | "Flares" |
  "LockRange" | "RotateSpeed";

/** The four aircraft in table order. */
export function builtinAircraft(): AircraftInfo[] {
  return (Object.keys(AIRCRAFT) as AircraftKind[]).map((kind) => {
    const n = (f: Field) => RULES[`${kind}${f}`];
    const [name, team] = AIRCRAFT[kind];
    return {
      kind, name, team, maxHP: n("MaxHP"), maxSpeed: n("MaxSpeed"), maxSpeedAB: n("MaxSpeedAB"), accel: n("Accel"),
      rollRate: n("RollRate"), pitchRate: n("PitchRate"), yawRate: n("YawRate"), cornerSpeed: n("CornerSpeed"),
      lockRange: n("LockRange"), missiles: n("Missiles"), flares: n("Flares"), rotateSpeed: n("RotateSpeed"),
    };
  });
}
