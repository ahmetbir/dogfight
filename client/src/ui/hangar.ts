// The hangar picker: a card grid of the side's jets (thumbnails of the real
// models in team colours, name, role tag, missiles) beside the selected jet
// as a live, turning 3D preview with its role line and stat bars. Arrow keys,
// Home/End, Enter; click or tap selects, a double click or the Fly button
// confirms. Under the preview, a row of paint chips picks the selected jet's
// skin (render/skins.ts): the preview and its card repaint at once. Self-
// contained: the pick screen (and later the lobby) give it a view and get
// the confirmed kind and the skin choices back.
import type { AircraftInfo, AircraftKind, Loadout, Team } from "../net/protocol.ts";
import { lang, lt, t, type Key } from "../i18n/index.ts";
import { dist } from "../i18n/format.ts";
import { HangarModels, HangarStage } from "../render/hangar3d.ts";
import { defaultSkin, skinsFor, STANDARD as STANDARD_SKIN, swatchPixels, SWATCH_PX, validSkin, type SkinId } from "../render/skins.ts";
import { PreviewLife } from "./preview.ts";
import { h, text } from "./dom.ts";
import { loadoutCounts, missileText } from "./loadout.ts";
import { roleLine, roleTag } from "./roles.ts";

export { ROLE, roleLine, roleTag, type RoleGroup } from "./roles.ts";

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

/** The skin after a key in the paint row of n chips; null for other keys. */
export function stepSkin(i: number, key: string, n: number): number | null {
  if (n <= 0) return null;
  switch (key) {
    case "ArrowRight": case "ArrowDown": return (i + 1) % n;
    case "ArrowLeft": case "ArrowUp": return (i - 1 + n) % n;
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
  skins?: Readonly<Record<string, string>>; // each jet's chosen skin (missing: its default)
};

type Card = { el: HTMLButtonElement; ms: HTMLElement; flag: HTMLElement; info: AircraftInfo };

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export class Hangar {
  readonly el = h("div", { class: "hangar" });
  private readonly onConfirm: (k: AircraftKind) => void;
  private readonly models = new HangarModels(); // thumbnails outlive the renderer (one side's, freed by dispose)
  private readonly stageBox = h("div", { class: "hangar-stage", "aria-hidden": "true" }); // a fresh canvas per open goes in here
  private readonly preview: PreviewLife<HTMLCanvasElement>;
  private readonly name = h("span", { class: "plane-name" });
  private readonly tag = h("span", { class: "role-tag" });
  private readonly flag = h("span", { class: "plane-flag", hidden: true }, lt("pick.flying"));
  private readonly line = h("p", { class: "hangar-role" });
  private readonly stats = h("div", { class: "hangar-stats" });
  private readonly fly = h("button", { type: "button", class: "btn primary hangar-fly" }, lt("hangar.fly")) as HTMLButtonElement;
  /** The same action for a footer that stays on screen (the phone layout shows it there). */
  readonly footFly = h("button", { type: "button", class: "btn primary hangar-foot-fly" }, lt("hangar.fly")) as HTMLButtonElement;
  private readonly grid = h("div", { class: "hangar-grid", role: "listbox", "aria-label": t("pick.title") });
  private readonly onSkin: (kind: AircraftKind, skin: SkinId) => void;
  private readonly paintName = h("span", { class: "paint-name" });
  private readonly chips = h("div", { class: "paint-chips", role: "radiogroup", "aria-label": t("hangar.paint") });
  private chipKey = "";
  private local: Record<string, string> = {}; // chosen here, ahead of the next view
  private cards = new Map<AircraftKind, Card>();
  private order: AircraftKind[] = [];
  private key = "";
  private sel: AircraftKind | null = null;
  private v: HangarView | null = null;

  constructor(onConfirm: (k: AircraftKind) => void, onSkin: (kind: AircraftKind, skin: SkinId) => void = () => {}) {
    this.onConfirm = onConfirm;
    this.onSkin = onSkin;
    for (const b of [this.fly, this.footFly]) b.addEventListener("click", () => { if (this.sel) this.onConfirm(this.sel); });
    this.preview = new PreviewLife<HTMLCanvasElement>({
      canvas: () => h("canvas", {}) as HTMLCanvasElement,
      mount: (c) => this.stageBox.replaceChildren(...(c ? [c] : [])),
      stage: (c) => new HangarStage(c, this.models, reducedMotion()),
      drawn: (kind) => this.cards.get(kind as AircraftKind)?.el.classList.add("drawn"),
    });
    this.el.append(
      h("div", { class: "hangar-show" }, this.stageBox,
        h("div", { class: "hangar-paint" }, h("div", { class: "paint-head" }, h("span", { class: "paint-label" }, lt("hangar.paint")), this.paintName), this.chips),
        h("div", { class: "hangar-info" },
          h("div", { class: "plane-head" }, this.name, this.tag, this.flag), this.line, this.stats, this.fly)),
      this.grid);
  }

  /** Builds the cards when the side or its kinds change, else updates them in place. */
  update(v: HangarView): void {
    this.v = v;
    if (v.skins) this.local = {}; // the owner's choices are current again
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
    this.repaint();
    this.select(this.sel, false);
  }

  /** The skin kind wears here: chosen in this view, else the owner's, else its default. */
  look(kind: string): SkinId {
    const id = this.local[kind] ?? this.v?.skins?.[kind];
    return id === undefined ? defaultSkin(kind) : validSkin(kind, id);
  }

  private looks(): Record<string, string> {
    return Object.fromEntries(this.order.map((k) => [k, this.look(k)]));
  }

  /** Cards whose skin changed lose their thumbnail until the stage draws it again. */
  private repaint(): void {
    if (!this.v) return;
    for (const [k, c] of this.cards) if (!this.models.thumb(k, this.v.team, this.look(k)).drawn) c.el.classList.remove("drawn");
    this.preview.cards(this.v.team, this.order, this.looks());
  }

  /** A chip chosen: the focus stays on the checked chip (the row is updated in place, never rebuilt by a choice). */
  private chooseSkin(kind: AircraftKind, skin: SkinId): void {
    if (this.look(kind) !== skin) {
      this.local[kind] = skin;
      this.onSkin(kind, skin);
      this.repaint();
      this.select(this.sel, false);
    }
    (this.chips.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  /**
   * The paint row of kind: one chip per skin it may wear, the worn one
   * checked. Built again only for another jet, side or language; a new
   * look only moves the check.
   */
  private paintRow(kind: AircraftKind, team: Team): void {
    const look = this.look(kind);
    text(this.paintName, t(`skin.${look}` as Key));
    const key = `${kind}|${team}|${lang()}`;
    if (key !== this.chipKey) {
      this.chipKey = key;
      this.chips.replaceChildren(...skinsFor(kind).map((id) => {
        const name = t(`skin.${id}` as Key);
        const sw = h("canvas", { class: "paint-swatch", width: String(SWATCH_PX), height: String(SWATCH_PX) }) as HTMLCanvasElement;
        const g = sw.getContext("2d");
        if (g) g.putImageData(new ImageData(swatchPixels(id, team, false), SWATCH_PX, SWATCH_PX), 0, 0);
        const b = h("button", { type: "button", class: "paint-chip", role: "radio", "aria-checked": "false", "aria-label": name, title: name, tabindex: "-1" }, sw);
        b.dataset.skin = id;
        b.addEventListener("click", () => this.chooseSkin(kind, id));
        return b;
      }));
    }
    for (const b of Array.from(this.chips.children) as HTMLElement[]) {
      const on = b.dataset.skin === look;
      if (b.getAttribute("aria-checked") !== String(on)) b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }

  /** Starts the preview on a new canvas (the screen became visible). */
  open(): void {
    if (this.v) this.preview.start(this.v.team, this.order, this.sel, this.looks());
  }

  /** Frees the renderer and its canvas (the screen closed); thumbnails stay. */
  close(): void {
    this.preview.stop();
  }

  /** Frees everything, thumbnails too (leaving the match). */
  dispose(): void {
    this.preview.stop();
    this.models.dispose();
    this.grid.replaceChildren();
    this.cards = new Map();
    this.key = "";
  }

  /** The kind the cards have selected (null before the table arrives). */
  selected(): AircraftKind | null {
    return this.sel;
  }

  /** Moves the keyboard focus to the selected card. */
  focus(): void {
    if (this.sel) this.cards.get(this.sel)?.el.focus({ preventScroll: false });
  }

  private build(v: HangarView): void {
    this.cards = new Map();
    this.order = v.kinds.map((a) => a.kind);
    const els = v.kinds.map((a) => {
      const thumb = this.models.thumb(a.kind, v.team, this.look(a.kind));
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
    this.preview.cards(v.team, this.order, this.looks());
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
    this.paintRow(a.kind, this.v.team);
    this.preview.select(a.kind, this.v.team, this.look(a.kind));
    if (focus) card.el.focus({ preventScroll: false });
  }

  /**
   * Arrow keys, Home and End move the selection, Enter flies it. The owner
   * forwards its keydowns here; keys typed into a text field are left alone.
   */
  handleKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (!this.sel || e.defaultPrevented || tag === "INPUT" || tag === "TEXTAREA") return;
    if (this.chips.contains(e.target as Node)) { // the paint row: arrows, Home and End choose the skin
      const ids = skinsFor(this.sel);
      const i = stepSkin(ids.indexOf(this.look(this.sel)), e.key, ids.length);
      if (i === null) return;
      e.preventDefault();
      this.chooseSkin(this.sel, ids[i] ?? STANDARD_SKIN);
      return;
    }
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
