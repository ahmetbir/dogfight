// Each aircraft's role, as the pick screen (ui/hangar.ts) and the pilot's
// manual show it: a group tag and one line per kind (i18n role.*). The roles
// are the sim's Spec.Role (internal/sim aircraft.go); TestClientRolesMatchServer
// (internal/match/book_rules_test.go) pins this table to it.
import type { AircraftKind } from "../net/protocol.ts";
import { t, type Key } from "../i18n/index.ts";

export type RoleGroup = "light" | "multi" | "stealth" | "interceptor" | "attack" | "cheap" | "heavy";

/** Each kind's role: sim.Spec.Role, Go-checked. One `kind: "role"` pair per entry. */
export const ROLE: Readonly<Record<AircraftKind, RoleGroup>> = {
  f16: "light", mig29: "light", rafale: "light", typhoon: "light",
  f15: "multi", su27: "multi", su30: "multi", f18: "multi",
  f22: "stealth", su57: "stealth",
  f14: "interceptor", mig31: "interceptor",
  a10: "attack", su25: "attack",
  mig21: "cheap",
  f4: "heavy", mig23: "heavy",
};

/** Short role tag of a card ("Hafif, çevik" / "Light, agile"). */
export function roleTag(kind: string): string {
  const g = (ROLE as Record<string, RoleGroup | undefined>)[kind];
  return g ? t(`role.${g}` as Key) : "";
}

/** One line on what the jet is good at, "" for a kind this client does not know. */
export function roleLine(kind: string): string {
  return kind in ROLE ? t(`role.${kind}` as Key) : "";
}

