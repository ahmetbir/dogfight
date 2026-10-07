// The hangar picker: a card grid of the side's jets (thumbnails of the real
// models in team colours, name, role tag, missiles) beside the selected jet
// as a live, turning 3D preview with its role line and stat bars. Arrow keys,
// Home/End, Enter; click or tap selects, a double click or the Fly button
// confirms. Self-contained: the pick screen (and later the lobby and the
// skins screen) give it a view and get the confirmed kind back.
import type { AircraftInfo, AircraftKind, Loadout, Team } from "../net/protocol.ts";
import { lt, t, type Key } from "../i18n/index.ts";
import { dist } from "../i18n/format.ts";
import { HangarModels, HangarStage } from "../render/hangar3d.ts";
import { h, text } from "./dom.ts";
import { loadoutCounts, missileText } from "./loadout.ts";

export type RoleGroup = "light" | "multi" | "stealth" | "interceptor" | "attack" | "cheap" | "heavy";

/** Each kind's role (the sim's roles, internal/sim aircraft.go). */
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

export type StatKey = "speed" | "agility" | "toughness" | "missiles" | "lock";
export type StatBar = { key: StatKey; label: Key; fill: number; value: string };

const STATS: { key: StatKey; label: Key; get(a: AircraftInfo): number; fmt(a: AircraftInfo): string }[] = [
  { key: "speed", label: "hangar.speed", get: (a) => a.maxSpeedAB, fmt: (a) => `${Math.round(a.maxSpeedAB * 3.6)} km/h` },
  // pitch and roll, each about 1 on an agile jet; the number shown is the pitch rate
  { key: "agility", label: "hangar.agility", get: (a) => a.pitchRate / 1.7 + a.rollRate / 4, fmt: (a) => `${Math.round((a.pitchRate * 180) / Math.PI)}°/s` },
  { key: "toughness", label: "hangar.toughness", get: (a) => a.maxHP, fmt: (a) => String(a.maxHP) },
  { key: "missiles", label: "hangar.missiles", get: (a) => a.missiles, fmt: (a) => String(a.missiles) },
  { key: "lock", label: "hangar.lock", get: (a) => a.lockRange, fmt: (a) => dist(a.lockRange) },
];

/**
 * The stat bars of a against every aircraft in the table: the weakest fills
 * a sixth, the best the whole bar, so close numbers still show a difference.
 */
export function hangarStats(a: AircraftInfo, all: readonly AircraftInfo[]): StatBar[] {
  return STATS.map((s) => {
    const vals = all.map(s.get);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const f = hi > lo ? (s.get(a) - lo) / (hi - lo) : 1;
    return { key: s.key, label: s.label, fill: 1 / 6 + (5 / 6) * Math.max(0, Math.min(1, f)), value: s.fmt(a) };
  });
}

/** The selection after a key in a grid of n cards, cols wide; null for other keys. */
export function step(i: number, key: string, cols: number, n: number): number | null {
  if (n <= 0) return null;
  const c = Math.max(1, cols);
  switch (key) {
    case "ArrowRight": return Math.min(n - 1, i + 1);
    case "ArrowLeft": return Math.max(0, i - 1);
    case "ArrowDown": return i + c < n ? i + c : i;
    case "ArrowUp": return i - c >= 0 ? i - c : i;
    case "Home": return 0;
    case "End": return n - 1;
    default: return null;
  }
}

/** The card selected when the grid opens: my last pick, else what I fly, else the first. */
export function firstSelection(kinds: readonly AircraftKind[], chosen: AircraftKind | null, current: AircraftKind | null): AircraftKind | null {
  for (const k of [chosen, current]) if (k && kinds.includes(k)) return k;
  return kinds[0] ?? null;
}

export type HangarView = {
  team: Team;                       // the side's colours (FFA: "none")
  kinds: AircraftInfo[];            // the cards, in order
  all: AircraftInfo[];              // the whole table: the stat bars' scale
  current: AircraftKind | null;     // what I fly now
  chosen: AircraftKind | null;      // what I picked last
  waiting: boolean;                 // no plane yet
  loadout: Loadout;
};

type Card = { el: HTMLButtonElement; ms: HTMLElement; flag: HTMLElement; info: AircraftInfo };

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export class Hangar {
  readonly el = h("div", { class: "hangar" });
  private readonly onConfirm: (k: AircraftKind) => void;
  private readonly models = new HangarModels(); // loaded jets and thumbnails outlive the renderer
  private readonly stageCanvas = h("canvas", { class: "hangar-stage", "aria-hidden": "true" }) as HTMLCanvasElement;
  private readonly name = h("span", { class: "plane-name" });
  private readonly tag = h("span", { class: "role-tag" });
  private readonly flag = h("span", { class: "plane-flag", hidden: true }, lt("pick.flying"));
  private readonly line = h("p", { class: "hangar-role" });
  private readonly stats = h("div", { class: "hangar-stats" });
  private readonly fly = h("button", { type: "button", class: "btn primary hangar-fly" }, lt("hangar.fly")) as HTMLButtonElement;
  private readonly grid = h("div", { class: "hangar-grid", role: "listbox", "aria-label": t("pick.title") });
  private stage: HangarStage | null = null;
  private cards = new Map<AircraftKind, Card>();
  private order: AircraftKind[] = [];
  private key = "";
  private sel: AircraftKind | null = null;
  private v: HangarView | null = null;

  constructor(onConfirm: (k: AircraftKind) => void) {
    this.onConfirm = onConfirm;
    this.fly.addEventListener("click", () => { if (this.sel) this.onConfirm(this.sel); });
    this.el.append(
      h("div", { class: "hangar-show" }, this.stageCanvas,
        h("div", { class: "hangar-info" },
          h("div", { class: "plane-head" }, this.name, this.tag, this.flag), this.line, this.stats, this.fly)),
      this.grid);
  }

  /** Builds the cards when the side or its kinds change, else updates them in place. */
  update(v: HangarView): void {
    this.v = v;
    const key = JSON.stringify([v.team, v.kinds.map((a) => a.kind)]);
    if (key !== this.key) {
      this.key = key;
      this.build(v);
      this.sel = firstSelection(this.order, v.chosen, v.current);
    } else if (!this.sel || !this.cards.has(this.sel)) {
      this.sel = firstSelection(this.order, v.chosen, v.current);
    }
    for (const c of this.cards.values()) {
      text(c.ms, missileText(...loadoutCounts(c.info.missiles, v.loadout), v.loadout));
      c.flag.hidden = v.waiting || c.info.kind !== v.current;
    }
    this.select(this.sel, false);
  }

  /** Starts the preview renderer (the screen became visible). */
  open(): void {
    if (this.stage || !this.v) return;
    try {
      this.stage = new HangarStage(this.stageCanvas, this.models, reducedMotion());
    } catch {
      this.stage = null; // no WebGL: cards and stats still work
      return;
    }
    const team = this.v.team;
    this.stage.thumbnails(this.order, team, (kind) => this.cards.get(kind as AircraftKind)?.el.classList.add("drawn"));
    if (this.sel) this.stage.show(this.sel, team);
  }

  /** Frees the renderer (the screen closed); thumbnails and loaded models stay. */
  close(): void {
    this.stage?.dispose();
    this.stage = null;
  }

  /** Moves the keyboard focus to the selected card. */
  focus(): void {
    if (this.sel) this.cards.get(this.sel)?.el.focus({ preventScroll: false });
  }

  private build(v: HangarView): void {
    this.cards = new Map();
    this.order = v.kinds.map((a) => a.kind);
    const els = v.kinds.map((a) => {
      const thumb = this.models.thumb(a.kind, v.team);
      const ms = h("span", { class: "card-ms" });
      const flag = h("span", { class: "plane-flag", hidden: true }, lt("pick.flying"));
      const el = h("button", { type: "button", class: `hangar-card${thumb.drawn ? " drawn" : ""}`, role: "option", "aria-selected": "false", tabindex: "-1" },
        h("div", { class: "card-pic" }, thumb.canvas),
        h("div", { class: "card-head" }, h("span", { class: "card-name" }, a.name), flag),
        h("div", { class: "card-meta" }, h("span", { class: "role-tag" }, roleTag(a.kind)), h("span", { class: "card-ms-wrap" }, lt("hangar.missiles"), " ", ms))) as HTMLButtonElement;
      el.addEventListener("click", () => this.select(a.kind, true));
      el.addEventListener("dblclick", () => this.onConfirm(a.kind));
      this.cards.set(a.kind, { el, ms, flag, info: a });
      return el;
    });
    this.grid.replaceChildren(...els);
    if (this.stage) this.stage.thumbnails(this.order, v.team, (kind) => this.cards.get(kind as AircraftKind)?.el.classList.add("drawn"));
  }

  private select(kind: AircraftKind | null, focus: boolean): void {
    this.sel = kind;
    for (const [k, c] of this.cards) {
      const on = k === kind;
      if (c.el.getAttribute("aria-selected") !== String(on)) c.el.setAttribute("aria-selected", String(on));
      c.el.tabIndex = on ? 0 : -1;
    }
    const card = kind ? this.cards.get(kind) : undefined;
    if (!card || !this.v) return;
    const a = card.info;
    text(this.name, a.name);
    text(this.tag, roleTag(a.kind));
    text(this.line, roleLine(a.kind));
    this.flag.hidden = this.v.waiting || a.kind !== this.v.current;
    const bars = hangarStats(a, this.v.all);
    const key = JSON.stringify([a.kind, bars.map((b) => b.value)]);
    if (this.stats.dataset.key !== key) {
      this.stats.dataset.key = key;
      this.stats.replaceChildren(...bars.map((b) => {
        const fill = h("div", { class: "bar-fill" });
        fill.style.width = `${Math.round(b.fill * 100)}%`;
        return h("div", { class: "stat" }, h("span", { class: "stat-label" }, lt(b.label)), h("div", { class: "bar" }, fill),
          h("span", { class: "stat-value" }, b.value));
      }));
    }
    this.stage?.show(a.kind, this.v.team);
    if (focus) card.el.focus({ preventScroll: false });
  }

  /**
   * Arrow keys, Home and End move the selection, Enter flies it. The owner
   * forwards its keydowns here; keys typed into a text field are left alone.
   */
  handleKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (!this.sel || e.defaultPrevented || tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "Enter") {
      if (tag === "BUTTON" && !this.grid.contains(e.target as Node)) return; // Enter on another button presses it
      e.preventDefault();
      this.onConfirm(this.sel);
      return;
    }
    const cols = getComputedStyle(this.grid).gridTemplateColumns.split(" ").filter(Boolean).length;
    const i = step(this.order.indexOf(this.sel), e.key, cols, this.order.length);
    if (i === null) return;
    e.preventDefault();
    this.select(this.order[i] ?? this.sel, true);
  }
}
