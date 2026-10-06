// Missile loadouts: the pick screen's selector and the pure helpers the HUD
// uses (counts, ranges, the kind of a lock or an incoming missile).
import { RULES } from "../book/rules.ts";
import { LOADOUTS, type Loadout, type MissileJSON } from "../net/protocol.ts";
import { dist, v3, type V3 } from "../sim/vec.ts";
import { h, text } from "./dom.ts";

export type MissileKind = "ir" | "radar";

export const LOADOUT_LABEL: Record<Loadout, string> = { ir: "IR (kısa menzil)", radar: "Radar (orta menzil)", mixed: "Karışık" };

const R = RULES;
export const LOADOUT_HINT: Record<Loadout, string> = {
  ir: "Isı güdümlü, ateşle-unut. Flare'e kanabilir.",
  radar: `Kilit menzili ×${R.radarRangeMul}, kilit ${R.radarLockS} sn; sayı yarıya iner. Füze vurana dek hedefi burnunun ${R.radarLeashDeg}° içinde tut. Flare işlemez; hedef füzeye dik uçarsa (${R.radarBeamS} sn) iz kopar.`,
  mixed: "Yarısı IR + 1 radar. Füze tuşu: kilitli hedef IR menzilinin dışındaysa radar, içindeyse IR atar.",
};

/** Why the missile key did nothing without a lock: how long to hold the target per loadout. */
export function noLockNotice(lo: Loadout): string {
  if (lo === "radar") return `KİLİT YOK — hedefi nişangâhta ${R.radarLockS} sn tut`;
  if (lo === "mixed") return `KİLİT YOK — hedefi nişangâhta ${R.lockS} sn tut (uzakta radar: ${R.radarLockS} sn)`;
  return `KİLİT YOK — hedefi nişangâhta ${R.lockS} sn tut`;
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

/** A radar missile tracks me: the "DİK UÇ!" (beam) cue. */
export function beamCue(alive: boolean, missiles: MissileJSON[], you: number): boolean {
  return alive && missiles.some((m) => m.tg === you && kindOf(m.mk) === "radar");
}

/** "FÜZE UYARISI · RADAR · 1.2 km". */
export function warnText(inc: { kind: MissileKind; dist: number } | null, fmt: (m: number) => string): string {
  return inc ? `FÜZE UYARISI · ${inc.kind === "radar" ? "RADAR" : "IR"} · ${fmt(inc.dist)}` : "FÜZE UYARISI";
}

/** Pick screen row: three buttons, the chosen one pressed, and its hint under them. */
export class LoadoutSelector {
  readonly el: HTMLElement;
  private readonly buttons = new Map<Loadout, HTMLElement>();
  private readonly hint = h("div", { class: "muted loadout-hint" });

  constructor(onPick: (lo: Loadout) => void) {
    const row = LOADOUTS.map((lo) => {
      const b = h("button", { type: "button", class: `seg-btn lo-${lo}`, "aria-pressed": "false" }, LOADOUT_LABEL[lo]);
      b.addEventListener("click", () => onPick(lo));
      this.buttons.set(lo, b);
      return b;
    });
    this.el = h("div", { class: "team-pick loadout-pick" }, h("span", { class: "muted" }, "Füze yükü"),
      h("div", { class: "seg grid3 loadout-seg", role: "group", "aria-label": "Füze yükü" }, ...row), this.hint);
  }

  update(lo: Loadout): void {
    for (const [k, b] of this.buttons) {
      const on = String(k === lo);
      if (b.getAttribute("aria-pressed") !== on) b.setAttribute("aria-pressed", on);
    }
    text(this.hint, LOADOUT_HINT[lo]);
  }
}
