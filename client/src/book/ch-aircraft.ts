// The aircraft chapter's tables: every jet of a side with its role and the
// numbers that tell them apart (the prose: i18n/book/*/basics.ts).
import { t } from "../i18n/index.ts";
import type { AircraftInfo, Team } from "../net/protocol.ts";
import { ROLE, roleLine, roleTag, type RoleGroup } from "../ui/roles.ts";
import { b, dist, kmh, table } from "./kit.ts";

/** A side's aircraft (FFA flies all): name, role, HP, top speed, missiles, lock range. */
export function rosterTable(list: AircraftInfo[], team: Team): HTMLElement {
  return table([t("bt.aircraft"), t("bt.role"), t("bt.hp"), t("bt.topSpeed"), t("bt.load"), t("bt.lock")],
    list.filter((a) => a.team === team).map((a) => [
      b(a.name), `${roleTag(a.kind)}: ${roleLine(a.kind).replace(/^[^:]*:\s*/, "")}`, String(a.maxHP), kmh(a.maxSpeedAB), String(a.missiles),
      dist(a.lockRange),
    ]));
}

/** The role groups in the order the chapter explains them. */
export const ROLE_ORDER: readonly RoleGroup[] = ["light", "multi", "stealth", "interceptor", "attack", "cheap", "heavy"];

/** "F-16, MiG-29, Rafale, Typhoon": the aircraft of a role, in table order. */
export function roleNames(list: AircraftInfo[], g: RoleGroup): string {
  return list.filter((a) => (ROLE as Record<string, RoleGroup | undefined>)[a.kind] === g).map((a) => a.name).join(", ");
}
