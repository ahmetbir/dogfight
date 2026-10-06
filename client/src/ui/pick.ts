// Aircraft pick screen: cards for the kinds my team may fly, with stat bars,
// the missile loadout and (team modes) the team.
import type { AircraftInfo, AircraftKind, Loadout, Team, TeamChoice } from "../net/protocol.ts";
import { RULES } from "../book/rules.ts";
import { lt, t, type Key } from "../i18n/index.ts";
import { fill, h, text } from "./dom.ts";
import { roomLink } from "./link.ts";
import { loadoutCounts, LoadoutSelector, missileText } from "./loadout.ts";
import { TeamSelector, type TeamPickView } from "./team.ts";

export type PickView = {
  code: string; team: Team; aircraft: AircraftInfo[];
  current: AircraftKind | null; // what I fly now (roster)
  chosen: AircraftKind | null;  // what I picked last
  protectedNow: boolean;        // alive in spawn protection: a pick applies at once
  waiting: boolean;             // no plane yet: the first pick spawns me
  waitLeft: number;             // while waiting: whole seconds until the default spawn
  teamPick?: TeamPickView | null; // team modes, before the first plane: auto / NATO / Soviet
  loadout?: Loadout;            // the missile loadout my next pick carries (default IR)
};

/** Server-side pick timeout (game.PickTimeoutTicks / 60). */
export const PICK_TIMEOUT_S = RULES.pickTimeoutS; // internal/game PickTimeoutTicks (Go-checked)

/** Whole seconds left of the pick timeout, counted from the welcome. */
export function waitLeft(welcomeAt: number, now: number): number {
  return Math.max(0, Math.ceil(PICK_TIMEOUT_S - (now - welcomeAt) / 1000));
}

/** "N sn içinde" / "in N s" while time is left, "birazdan" / "shortly" once it ran out. */
export function waitWhen(left: number): string {
  return left > 0 ? t("pick.in", { n: left }) : t("pick.soon");
}

type Stat = { label: Key; get(a: AircraftInfo): number; fmt(a: AircraftInfo): string };

const MISSILE_STAT: Key = "pick.missiles";
const STATS: Stat[] = [
  { label: "pick.hp", get: (a) => a.maxHP, fmt: (a) => String(a.maxHP) },
  { label: "pick.speed", get: (a) => a.maxSpeedAB, fmt: (a) => `${Math.round(a.maxSpeedAB * 3.6)} km/h` },
  { label: "pick.turn", get: (a) => a.pitchRate, fmt: (a) => `${Math.round((a.pitchRate * 180) / Math.PI)}°/s` },
  { label: MISSILE_STAT, get: (a) => a.missiles, fmt: (a) => String(a.missiles) },
];

/** Kinds a team may fly (FFA flies all), in the welcome's order. */
export function kindsFor(team: Team, aircraft: AircraftInfo[]): AircraftInfo[] {
  return aircraft.filter((a) => team === "none" || a.team === team);
}

/** Bar fill 0..1 of each stat against the best aircraft in the table. */
export function statFill(a: AircraftInfo, all: AircraftInfo[], get: (a: AircraftInfo) => number): number {
  const best = Math.max(...all.map(get));
  return best > 0 ? Math.max(0, Math.min(1, get(a) / best)) : 0;
}

/** What the cards are built from; anything else is updated in place. */
export function pickKey(v: PickView): string {
  return JSON.stringify([v.code, v.team, v.aircraft.map((a) => a.kind), !!v.teamPick]);
}

export function pickNote(v: PickView): string {
  if (v.waiting) return t("pick.noteWait", { when: waitWhen(v.waitLeft) });
  return t(v.protectedNow ? "pick.noteProt" : "pick.noteNext");
}

type Card = { card: HTMLElement; flag: HTMLElement; ms: HTMLElement | null; missiles: number };

/**
 * The cards are built once per (room, team, aircraft table) and then only
 * updated in place, so a click (mousedown + mouseup on the same element),
 * hover, focus and the copy-link feedback survive the 10 Hz refresh.
 */
export class PickScreen {
  readonly el = h("div", { class: "overlay pick", hidden: true });
  private readonly onPick: (k: AircraftKind) => void;
  private readonly onClose: () => void;
  private readonly onTeam: (c: TeamChoice) => void;
  private readonly onLoadout: (lo: Loadout) => void;
  private teams: TeamSelector | null = null;
  private loadouts: LoadoutSelector | null = null;
  private readonly note = h("span", { class: "muted" });
  private cards = new Map<AircraftKind, Card>();
  private key = "";

  constructor(onPick: (k: AircraftKind) => void, onClose: () => void, onTeam: (c: TeamChoice) => void = () => {},
    onLoadout: (lo: Loadout) => void = () => {}) {
    this.onPick = onPick;
    this.onClose = onClose;
    this.onTeam = onTeam;
    this.onLoadout = onLoadout;
    this.el.addEventListener("click", (e) => { if (e.target === this.el) this.onClose(); });
  }

  isOpen(): boolean {
    return !this.el.hidden;
  }

  close(): void {
    this.el.hidden = true;
  }

  /** Opens (or refreshes, when open) the screen for v. */
  show(v: PickView): void {
    const key = pickKey(v);
    if (key !== this.key) {
      this.key = key;
      this.build(v);
    }
    const selected = v.chosen ?? v.current;
    const lo = v.loadout ?? "ir";
    for (const [kind, c] of this.cards) {
      const on = String(kind === selected);
      if (c.card.getAttribute("aria-pressed") !== on) c.card.setAttribute("aria-pressed", on);
      c.flag.hidden = v.waiting || kind !== v.current;
      if (c.ms) text(c.ms, missileText(...loadoutCounts(c.missiles, lo), lo));
    }
    if (v.teamPick) this.teams?.update(v.teamPick);
    this.loadouts?.update(lo);
    text(this.note, pickNote(v));
    this.el.hidden = false;
  }

  private build(v: PickView): void {
    const all = v.aircraft;
    this.cards = new Map();
    const cards = kindsFor(v.team, all).map((a) => {
      const flag = h("div", { class: "plane-flag", hidden: true }, lt("pick.flying"));
      let ms: HTMLElement | null = null;
      const card = h("button", { type: "button", class: "plane-card", "aria-pressed": "false" },
        h("div", { class: "plane-head" }, h("span", { class: "plane-name" }, a.name),
          h("span", { class: `team-tag ${a.team}` }, lt(a.team === "nato" ? "team.nato" : "team.soviet"))),
        ...STATS.map((s) => {
          const value = h("span", { class: "stat-value" }, s.fmt(a));
          if (s.label === MISSILE_STAT) ms = value; // follows the loadout (show)
          return h("div", { class: "stat" }, h("span", { class: "stat-label" }, lt(s.label)), bar(statFill(a, all, s.get)), value);
        }),
        flag);
      card.addEventListener("click", () => this.onPick(a.kind));
      this.cards.set(a.kind, { card, flag, ms, missiles: a.missiles });
      return card;
    });
    this.teams = v.teamPick ? new TeamSelector(this.onTeam) : null;
    this.loadouts = new LoadoutSelector(this.onLoadout);
    const go = h("button", { type: "button", class: "btn primary" }, lt("pick.back"));
    go.addEventListener("click", () => this.onClose());
    fill(this.el, h("div", { class: "panel wide" },
      h("div", { class: "panel-head" }, h("h2", {}, lt("pick.title")), roomLink(v.code)),
      this.teams?.el,
      this.loadouts.el,
      h("div", { class: "plane-grid" }, ...cards),
      h("div", { class: "panel-foot" }, h("span", { class: "muted" }, this.note, lt("pick.reopen")), go)));
  }
}

function bar(f: number): HTMLElement {
  const fillEl = h("div", { class: "bar-fill" });
  fillEl.style.width = `${Math.round(f * 100)}%`;
  return h("div", { class: "bar" }, fillEl);
}
