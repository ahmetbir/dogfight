// Missile loadouts: the pick screen's selector and the pure helpers the HUD
// uses (counts, ranges, the kind of a lock or an incoming missile).
import { RULES } from "../book/rules.ts";
import { lattr, lt, t } from "../i18n/index.ts";
import { num, sec } from "../i18n/format.ts";
import { KEYBOARD_KEYS, keys, MOUSE_KEYS } from "../input/bindings.ts";
import { LOADOUTS, type Loadout, type MissileJSON } from "../net/protocol.ts";
import { dist, v3, type V3 } from "../sim/vec.ts";
import { h, text } from "./dom.ts";

export type MissileKind = "ir" | "radar";

const R = RULES;
const LABEL_KEY = { ir: "lo.ir", radar: "lo.radar", mixed: "lo.mixed" } as const satisfies Record<Loadout, string>;

/** "IR (kısa menzil)" / "IR (short range)". */
export const loadoutLabel = (lo: Loadout) => t(LABEL_KEY[lo]);

/** The pick screen's hint under the loadout buttons. */
export function loadoutHint(lo: Loadout): string {
  if (lo === "radar") return t("lo.hintRadar", { mul: num(R.radarRangeMul), lock: sec(R.radarLockS), leash: R.radarLeashDeg, beam: sec(R.radarBeamS) });
  if (lo === "mixed") return t("lo.hintMixed", { mk: keys(MOUSE_KEYS.pick), kk: keys(KEYBOARD_KEYS.pick) });
  return t("lo.hintIr");
}

/** Why the missile key did nothing without a lock: how long to hold the target per loadout, or for the picked kind. */
export function noLockNotice(lo: Loadout, picked?: MissileKind): string {
  if (picked) return t("lo.noLock", { s: sec(picked === "radar" ? R.radarLockS : R.lockS) });
  if (lo === "radar") return t("lo.noLock", { s: sec(R.radarLockS) });
  if (lo === "mixed") return t("lo.noLockMixed", { s: sec(R.lockS), r: sec(R.radarLockS) });
  return t("lo.noLock", { s: sec(R.lockS) });
}

/** Wire number (snapshot lo) → loadout; unknown or missing is IR. */
export function loadoutOf(n: number | undefined): Loadout {
  return LOADOUTS[n ?? 0] ?? "ir";
}

/** Wire number (mk, lkk) → missile kind. */
export function kindOf(n: number | undefined): MissileKind {
  return n === 1 ? "radar" : "ir";
}

/** Full [IR, radar] load of an aircraft with `missiles` IR missiles (mirrors sim.LoadoutCounts, Go-tested with the same table). */
export function loadoutCounts(missiles: number, lo: Loadout): [number, number] {
  if (lo === "radar") return [0, Math.max(1, Math.floor(missiles / 2))];
  if (lo === "mixed") return [Math.floor(missiles / 2), 1];
  return [missiles, 0];
}

/** "5", "2 R", "2 IR + 1 R": a missile count in the loadout's kinds. */
export function missileText(ir: number, radar: number, lo: Loadout): string {
  if (lo === "ir") return String(ir);
  if (lo === "radar") return `${radar} R`;
  return `${ir} IR + ${radar} R`;
}

/** Wire number of a picked kind (In.sel; missing: auto, the Karışık rule). */
export const PICK_WIRE = { ir: 1, radar: 2 } as const satisfies Record<MissileKind, number>;

/** The other kind: the pick key's toggle. */
export const otherKind = (k: MissileKind): MissileKind => (k === "ir" ? "radar" : "ir");

/** The kind a pick fires with ir / radar missiles left: the picked kind while it lasts, the other after (mirrors sim.pickedKind). */
export function pickedKind(pick: MissileKind, ir: number, radar: number): MissileKind {
  if (pick === "ir") return ir > 0 || radar <= 0 ? "ir" : "radar";
  return radar > 0 || ir <= 0 ? "radar" : "ir";
}

/** The HUD's missile readout: one entry per kind aboard, the one the key fires marked on ("IR 2", "RADAR 1"). */
export function ammoParts(ir: number, radar: number, lo: Loadout, fires: MissileKind): { kind: MissileKind; text: string; on: boolean }[] {
  const kinds: MissileKind[] = lo === "ir" ? ["ir"] : lo === "radar" ? ["radar"] : ["ir", "radar"];
  return kinds.map((kind) => ({ kind, text: `${kind === "ir" ? "IR" : "RADAR"} ${kind === "ir" ? ir : radar}`, on: kind === fires }));
}

/** IR and radar lock ranges (m) for an effective (weather-scaled) lock range. */
export function ranges(lockRange: number): { ir: number; radar: number } {
  return { ir: lockRange, radar: lockRange * R.radarRangeMul };
}

/** The longest range I can lock at with the missiles left (0 when empty). */
export function reach(lockRange: number, ir: number, radar: number): number {
  if (radar > 0) return ranges(lockRange).radar;
  return ir > 0 ? lockRange : 0;
}

/** The nearest missile tracking plane `you`: its kind and distance; null when none. */
export function incoming(me: V3, missiles: MissileJSON[], you: number): { kind: MissileKind; dist: number } | null {
  let best: { kind: MissileKind; dist: number } | null = null;
  for (const m of missiles) {
    if (m.tg !== you) continue;
    const d = dist(me, v3(m.p[0], m.p[1], m.p[2]));
    if (!best || d < best.dist) best = { kind: kindOf(m.mk), dist: d };
  }
  return best;
}

/** The nearest IR missile tracking me (the flare cue's distance); null when none. */
export function incomingIR(me: V3, missiles: MissileJSON[], you: number): number | null {
  return incoming(me, missiles.filter((m) => kindOf(m.mk) === "ir"), you)?.dist ?? null;
}

/** A radar missile tracks me: the beam cue. */
export function beamCue(alive: boolean, missiles: MissileJSON[], you: number): boolean {
  return alive && missiles.some((m) => m.tg === you && kindOf(m.mk) === "radar");
}

/** "FÜZE UYARISI · RADAR · 1,2 km" / "MISSILE WARNING · RADAR · 1.2 km". */
export function warnText(inc: { kind: MissileKind; dist: number } | null, fmt: (m: number) => string): string {
  return inc ? t("hud.missileWarnAt", { kind: inc.kind === "radar" ? "RADAR" : "IR", dist: fmt(inc.dist) }) : t("hud.missileWarn");
}

/** Pick screen row: three buttons, the chosen one pressed, and its hint under them. */
export class LoadoutSelector {
  readonly el: HTMLElement;
  private readonly buttons = new Map<Loadout, HTMLElement>();
  private readonly hint = h("div", { class: "muted loadout-hint" });

  constructor(onPick: (lo: Loadout) => void) {
    const row = LOADOUTS.map((lo) => {
      const b = h("button", { type: "button", class: `seg-btn lo-${lo}`, "aria-pressed": "false" }, lt(LABEL_KEY[lo]));
      b.addEventListener("click", () => onPick(lo));
      this.buttons.set(lo, b);
      return b;
    });
    this.el = h("div", { class: "team-pick loadout-pick" }, h("span", { class: "muted" }, lt("lo.title")),
      lattr(h("div", { class: "seg grid3 loadout-seg", role: "group" }, ...row), "aria-label", "lo.title"), this.hint);
  }

  update(lo: Loadout): void {
    for (const [k, b] of this.buttons) {
      const on = String(k === lo);
      if (b.getAttribute("aria-pressed") !== on) b.setAttribute("aria-pressed", on);
    }
    text(this.hint, loadoutHint(lo));
  }
}
