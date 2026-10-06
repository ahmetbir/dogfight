// Team choice (pick screen) and team switch (menu) for team and base modes.
// The server decides (game.ChooseTeam); these mirror its rules so the UI can
// say why a choice is closed before asking.
import { lattr, lt, t, type Key } from "../i18n/index.ts";
import { noticeText } from "../i18n/messages.ts";
import type { EventJSON, MissileJSON, NoticeMsg, PlaneJSON, PlayerJSON, RoundMsg, ServerMsg, Team, TeamChoice } from "../net/protocol.ts";
import { RULES } from "../book/rules.ts";
import { h, text } from "./dom.ts";

export type Side = "nato" | "soviet";
export type Counts = Record<Side, number>;

// The server's switch rules (game.SwitchCooldownTicks, SwitchCloseTicks,
// HurtTicks), from the Go-checked RULES table.
/** Least time between two switches, s. */
export const SWITCH_COOLDOWN_S = RULES.switchCooldownS;
/** No switch in the round's last SWITCH_CLOSE_S (every team mode); in ticks for round.left. */
export const SWITCH_CLOSE_S = RULES.switchCloseS;
export const SWITCH_CLOSE_TICKS = SWITCH_CLOSE_S * 60;
/** No switch this soon after taking damage, s. */
export const HURT_S = RULES.hurtS;
/** Debounce of selector clicks: team messages share the server's pick bucket (a burst over it kicks). */
export const CHOOSE_GAP_MS = 400;

/** "NATO" / "SOVYET" ("SOVIET"). */
export const teamName = (s: Side) => t(`team.${s}`);
/** Why a team is closed by the balance rule. */
export const uneven = () => t("notice.team_uneven");

/** A server notice (a refused team choice) in the current language, with this client's cooldown numbers. */
export function noticeOf(m: NoticeMsg): string {
  const n = m.code === "team_hurt" ? HURT_S : m.code === "team_late" ? SWITCH_CLOSE_S : SWITCH_COOLDOWN_S;
  return noticeText(m.code, m.msg, { n });
}

export function hasTeams(mode: string): boolean {
  return mode === "team" || mode === "base";
}

export function otherSide(t: Team): Side {
  return t === "nato" ? "soviet" : "nato";
}

/** Humans per team, leaving out player `except` (me). */
export function humanCounts(players: Iterable<PlayerJSON>, except: number): Counts {
  const c: Counts = { nato: 0, soviet: 0 };
  for (const p of players) if (!p.bot && p.id !== except && (p.team === "nato" || p.team === "soviet")) c[p.team]++;
  return c;
}

/**
 * Whether I may move from my team to `to`, given the other humans: the
 * human counts may differ by at most 1 afterwards, or the move narrows the gap.
 */
export function balanced(others: Counts, mine: Team, to: Side): boolean {
  if (mine === to) return true;
  const gap = (c: Counts) => Math.abs(c.nato - c.soviet);
  const now = { ...others };
  if (mine === "nato" || mine === "soviet") now[mine]++;
  const after = { ...others, [to]: others[to] + 1 };
  return gap(after) <= 1 || gap(after) < gap(now);
}

export type SwitchView = {
  mode: string; mine: Team; others: Counts;
  sinceSwitchS: number; // seconds since my last switch (Infinity: never)
  round: Pick<RoundMsg, "phase" | "left"> | null;
  alive: boolean;   // my plane is up (the fire gates apply only then)
  threat: boolean;  // a lock or a missile in flight on me
  hurtAgoS: number; // seconds since I last took damage (Infinity: never)
};

/** Why the menu's switch is closed now, or null when it is open. */
export function switchBlock(v: SwitchView): string | null {
  if (!hasTeams(v.mode) || (v.mine !== "nato" && v.mine !== "soviet")) return t("notice.team_none");
  if (v.round?.phase === "playing" && v.round.left < SWITCH_CLOSE_TICKS) return t("notice.team_late", { n: SWITCH_CLOSE_S });
  if (v.sinceSwitchS < SWITCH_COOLDOWN_S) return t("notice.team_cooldown", { n: Math.ceil(SWITCH_COOLDOWN_S - v.sinceSwitchS) });
  if (v.alive && v.threat) return t("notice.team_locked");
  if (v.alive && v.hurtAgoS < HURT_S) return t("notice.team_hurt", { n: HURT_S });
  if (!balanced(v.others, v.mine, otherSide(v.mine))) return uneven();
  return null;
}

/** The menu's "switch team" row: a button to the other team, or why it is closed. */
export function switchRow(v: SwitchView, onSwitch: (to: Side) => void): HTMLElement | null {
  if (!hasTeams(v.mode) || (v.mine !== "nato" && v.mine !== "soviet")) return null;
  const to = otherSide(v.mine);
  const why = switchBlock(v);
  const b = h("button", { type: "button", class: `btn team-switch ${to}`, disabled: why !== null }, t("team.switch", { team: teamName(to) }));
  b.addEventListener("click", () => onSwitch(to));
  return h("div", { class: "team-row" }, b, why ? h("span", { class: "form-error" }, why) : null);
}

export type TeamPickView = {
  choice: TeamChoice;
  allowed: Record<Side, boolean>;
  note: string; // a server refusal, shown for a few seconds
};

/** The pick screen's team selector state from the roster. */
export function teamPickView(players: Iterable<PlayerJSON>, you: number, mine: Team, choice: TeamChoice, note: string): TeamPickView {
  const others = humanCounts(players, you);
  return { choice, allowed: { nato: balanced(others, mine, "nato"), soviet: balanced(others, mine, "soviet") }, note };
}

const CHOICES: [TeamChoice, Key][] = [["auto", "team.auto"], ["nato", "team.nato"], ["soviet", "team.sovietName"]];

/** Auto / NATO / Soviet; built once, updated in place (clicks survive the 10 Hz refresh). */
export class TeamSelector {
  readonly el: HTMLElement;
  private readonly btns = new Map<TeamChoice, HTMLButtonElement>();
  private readonly note = h("span", { class: "form-error team-note" });

  constructor(onChoose: (c: TeamChoice) => void) {
    const seg = lattr(h("div", { class: "seg team-seg", role: "group" },
      ...CHOICES.map(([c, label]) => {
        const b = h("button", { type: "button", class: `seg-btn ${c}`, "aria-pressed": "false" }, lt(label));
        b.addEventListener("click", () => onChoose(c));
        this.btns.set(c, b);
        return b;
      })), "aria-label", "team.title");
    this.el = h("div", { class: "team-pick" }, h("span", { class: "muted" }, lt("team.title")), seg, this.note);
  }

  update(v: TeamPickView): void {
    const st = selectorState(v);
    for (const [c, b] of this.btns) {
      const on = String(c === st.pressed);
      if (b.getAttribute("aria-pressed") !== on) b.setAttribute("aria-pressed", on);
      const closed = st.closed.includes(c);
      if (b.disabled !== closed) b.disabled = closed;
      if (closed) b.title = uneven();
      else b.removeAttribute("title");
    }
    text(this.note, st.note);
  }
}

/** The selector's look: the pressed choice, the closed teams, and the note under it. */
export function selectorState(v: TeamPickView): { pressed: TeamChoice; closed: TeamChoice[]; note: string } {
  const closed = (["nato", "soviet"] as const).filter((c) => c !== v.choice && !v.allowed[c]);
  const note = v.note || (closed.length ? `${teamName(closed[0])}: ${uneven()}` : "");
  return { pressed: v.choice, closed, note };
}

const NOTE_MS = 4000;

/** What the team flow reads of the game state (GameState fits). */
export type TeamState = {
  mode: string; you: number; round: RoundMsg | null;
  players: Map<number, PlayerJSON>; planes: Map<number, PlaneJSON>; missiles: MissileJSON[];
};

/** A lock or a missile in flight on plane `me` (game.switchGate mirrors). */
export function underFire(me: number, planes: Iterable<PlaneJSON>, missiles: MissileJSON[]): boolean {
  if (missiles.some((m) => m.tg === me)) return true;
  for (const p of planes) if (p.id !== me && p.a && p.lk === me && p.ld) return true;
  return false;
}

/**
 * One session's team state: the pick screen's choice, the time of my last
 * switch and damage, and whether I have flown yet (before that a choice is free).
 */
export class TeamFlow {
  private readonly send: (c: TeamChoice) => boolean;
  private readonly s: TeamState;
  private choice: TeamChoice = "auto";
  private confirmed: TeamChoice = "auto"; // the last choice the roster showed
  private note = "";
  private noteUntil = 0;
  private switchedAt = -Infinity;
  private hurtAt = -Infinity;
  private sentAt = -Infinity;
  private fresh = true;
  private team: Team | null = null;

  constructor(send: (c: TeamChoice) => boolean, s: TeamState) {
    this.send = send;
    this.s = s;
  }

  private mine(): Team {
    return this.s.players.get(this.s.you)?.team ?? "none";
  }

  /**
   * Follows an applied server message (evs: its events). True when the roster
   * shows my team changed by a switch: open the pick screen for the new team.
   */
  apply(m: ServerMsg, evs: EventJSON[], now: number): boolean {
    switch (m.t) {
      case "welcome": // a new seat: auto-balanced, not flown yet
        this.choice = this.confirmed = "auto";
        this.fresh = true;
        this.team = null;
        this.note = "";
        this.hurtAt = this.switchedAt = -Infinity;
        return false;
      case "notice": // a server refusal: shown on the pick screen; the choice falls back
        this.note = noticeOf(m);
        this.noteUntil = now + NOTE_MS;
        this.choice = this.confirmed;
        return false;
      case "snap":
        if (this.s.planes.has(this.s.you)) this.fresh = false; // flown: from now on a change is a switch
        if (evs.some((e) => e.k === "hit" && e.a === this.s.you)) this.hurtAt = now;
        return false;
      case "players":
        return this.roster(this.mine(), now);
    }
    return false;
  }

  /** A click on the selector or the menu's switch; repeats and bursts are not sent. */
  choose(c: TeamChoice, now: number): void {
    if ((this.fresh && c === this.choice) || now - this.sentAt < CHOOSE_GAP_MS) return;
    if (this.send(c)) {
      this.choice = c;
      this.sentAt = now;
    }
  }

  private roster(mine: Team, now: number): boolean {
    if (this.s.players.get(this.s.you) === undefined) return false;
    const changed = this.team !== null && mine !== this.team;
    this.team = mine;
    if (this.choice === "auto" || this.choice === mine) this.confirmed = this.choice;
    if (!changed || this.fresh) return false;
    this.switchedAt = now;
    return true;
  }

  pickView(now: number): TeamPickView | null {
    if (!this.fresh || !hasTeams(this.s.mode)) return null;
    return teamPickView(this.s.players.values(), this.s.you, this.mine(), this.choice, now < this.noteUntil ? this.note : "");
  }

  switchView(now: number): SwitchView {
    const s = this.s;
    return {
      mode: s.mode, mine: this.mine(), others: humanCounts(s.players.values(), s.you),
      sinceSwitchS: (now - this.switchedAt) / 1000, round: s.round,
      alive: !!s.planes.get(s.you)?.a, threat: underFire(s.you, s.planes.values(), s.missiles), hurtAgoS: (now - this.hurtAt) / 1000,
    };
  }
}
