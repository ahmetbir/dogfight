// Aircraft pick screen: the hangar (ui/hangar.ts) with the kinds my team may
// fly, the missile loadout and (team modes) the team.
import type { AircraftInfo, AircraftKind, Loadout, Team, TeamChoice } from "../net/protocol.ts";
import { RULES } from "../book/rules.ts";
import { lt, t } from "../i18n/index.ts";
import { fill, h, text } from "./dom.ts";
import { roomLink } from "./link.ts";
import { Hangar } from "./hangar.ts";
import { LoadoutSelector } from "./loadout.ts";
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

/** Kinds a team may fly (FFA flies all), in the welcome's order. */
export function kindsFor(team: Team, aircraft: AircraftInfo[]): AircraftInfo[] {
  return aircraft.filter((a) => team === "none" || a.team === team);
}

/** What the cards are built from; anything else is updated in place. */
export function pickKey(v: PickView): string {
  return JSON.stringify([v.code, v.team, v.aircraft.map((a) => a.kind), !!v.teamPick]);
}

/**
 * What leaving the screen without the Fly button sends: before the first
 * plane, the selected card (else the default kind would spawn, silently);
 * flying, nothing (the selection is only a look until it is flown).
 */
export function pickOnLeave(v: Pick<PickView, "waiting">, selected: AircraftKind | null): AircraftKind | null {
  return v.waiting ? selected : null;
}

/** The name of a selected card that leaving would not fly (flying, another jet selected), else "". */
export function unpickedName(v: Pick<PickView, "waiting" | "chosen" | "current" | "aircraft">, selected: AircraftKind | null): string {
  if (v.waiting || !selected || selected === (v.chosen ?? v.current)) return "";
  return v.aircraft.find((a) => a.kind === selected)?.name ?? "";
}

export function pickNote(v: PickView): string {
  if (v.waiting) return t("pick.noteWait", { when: waitWhen(v.waitLeft) });
  return t(v.protectedNow ? "pick.noteProt" : "pick.noteNext");
}

/**
 * The frame (team and loadout selectors, room link, note) is built once per
 * (room, team, aircraft table) and then only updated in place, so a click,
 * hover, focus and the copy-link feedback survive the 10 Hz refresh; the
 * hangar inside keeps its own cards and selection the same way.
 */
export class PickScreen {
  readonly el = h("div", { class: "overlay pick", hidden: true });
  private readonly onClose: () => void;
  private readonly onPick: (k: AircraftKind) => void;
  private v: PickView | null = null;
  private readonly unpicked = h("span", { class: "pick-unpicked", hidden: true });
  private readonly onTeam: (c: TeamChoice) => void;
  private readonly onLoadout: (lo: Loadout) => void;
  private readonly hangar: Hangar;
  private teams: TeamSelector | null = null;
  private loadouts: LoadoutSelector | null = null;
  private readonly note = h("span", { class: "muted" });
  private key = "";

  constructor(onPick: (k: AircraftKind) => void, onClose: () => void, onTeam: (c: TeamChoice) => void = () => {},
    onLoadout: (lo: Loadout) => void = () => {}) {
    this.hangar = new Hangar(onPick);
    this.onPick = onPick;
    this.onClose = onClose;
    this.onTeam = onTeam;
    this.onLoadout = onLoadout;
    this.el.addEventListener("click", (e) => { if (e.target === this.el) this.leave(); });
    this.el.addEventListener("keydown", (e) => this.hangar.handleKey(e));
  }

  isOpen(): boolean {
    return !this.el.hidden;
  }

  close(): void {
    this.el.hidden = true;
    this.hangar.close(); // the preview's renderer goes with the screen
  }

  /** Frees the hangar's thumbnails too (leaving the match). */
  dispose(): void {
    this.close();
    this.hangar.dispose();
    this.key = "";
  }

  /** Back to flight, or a click beside the panel: flies the selection while waiting (pickOnLeave). */
  private leave(): void {
    const k = this.v ? pickOnLeave(this.v, this.hangar.selected()) : null;
    if (k) this.onPick(k);
    else this.onClose();
  }

  /** Opens (or refreshes, when open) the screen for v. */
  show(v: PickView): void {
    this.v = v;
    const key = pickKey(v);
    let refocus = false;
    if (key !== this.key) {
      this.key = key;
      refocus = !this.el.hidden && this.el.contains(document.activeElement); // re-parenting the hangar drops its focus
      this.build(v);
    }
    const lo = v.loadout ?? "ir";
    this.hangar.update({ team: v.team, kinds: kindsFor(v.team, v.aircraft), all: v.aircraft, current: v.current, chosen: v.chosen, waiting: v.waiting, loadout: lo });
    if (v.teamPick) this.teams?.update(v.teamPick);
    this.loadouts?.update(lo);
    text(this.note, pickNote(v));
    this.syncUnpicked();
    if (this.el.hidden) {
      this.el.hidden = false;
      this.hangar.open();
      this.hangar.focus();
    } else if (refocus) this.hangar.focus();
  }

  private build(v: PickView): void {
    this.teams = v.teamPick ? new TeamSelector(this.onTeam) : null;
    this.loadouts = new LoadoutSelector(this.onLoadout);
    const go = h("button", { type: "button", class: "btn" }, lt("pick.back"));
    go.addEventListener("click", () => this.leave());
    this.hangar.el.addEventListener("click", () => this.syncUnpicked());
    this.hangar.el.addEventListener("keyup", () => this.syncUnpicked());
    fill(this.el, h("div", { class: "panel wide pick-panel" },
      h("div", { class: "panel-head" }, h("h2", {}, lt("pick.title")), roomLink(v.code)),
      h("div", { class: "pick-opts" }, this.teams?.el, this.loadouts.el),
      this.hangar.el,
      h("div", { class: "panel-foot" }, h("span", { class: "muted" }, this.note, lt("pick.reopen"), this.unpicked),
        h("div", { class: "pick-foot-btns" }, go, this.hangar.footFly))));
  }

  /** "F-22 is selected, not flown: Fly this jet switches." while flying with another card selected. */
  private syncUnpicked(): void {
    const name = this.v ? unpickedName(this.v, this.hangar.selected()) : "";
    this.unpicked.hidden = !name;
    if (name) text(this.unpicked, t("pick.unpicked", { name }));
  }
}
