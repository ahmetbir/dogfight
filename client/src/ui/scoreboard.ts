// Scoreboard (held Tab) and the round-end screen; both list every roster
// player, with zero rows for players that have no board line yet (C19).
import { lang, t } from "../i18n/index.ts";
import type { LineJSON, PlayerJSON, Team } from "../net/protocol.ts";
import { clock, fill, h } from "./dom.ts";

export type Row = { id: number; name: string; team: Team; bot: boolean; k: number; d: number; s: number; me: boolean };

/** Roster joined with the board, best first (score, kills, fewer deaths, id). */
export function boardRows(players: Iterable<PlayerJSON>, board: LineJSON[], you: number): Row[] {
  const lines = new Map(board.map((l) => [l.id, l]));
  const rows: Row[] = [];
  for (const p of players) {
    const l = lines.get(p.id);
    rows.push({ id: p.id, name: p.name, team: p.team, bot: p.bot, k: l?.k ?? 0, d: l?.d ?? 0, s: l?.s ?? 0, me: p.id === you });
  }
  return rows.sort((a, b) => b.s - a.s || b.k - a.k || a.d - b.d || a.id - b.id);
}

export type BoardView = { mode: string; rows: Row[]; nato: number; soviet: number };

/** Team and base attack rooms score by side; FFA by pilot. */
export function teamMode(mode: string): boolean {
  return mode === "team" || mode === "base";
}

function table(rows: Row[], title?: HTMLElement): HTMLElement {
  return h("div", { class: "board-col" }, title ?? null,
    h("table", { class: "board" },
      h("thead", {}, h("tr", {}, h("th", { class: "name" }, t("board.name")), h("th", {}, t("board.k")), h("th", {}, t("board.d")),
        h("th", {}, t("board.score")))),
      h("tbody", {}, ...rows.map((r) => h("tr", { class: r.me ? "me" : "" },
        h("td", { class: "name" }, h("div", { class: "name-cell" }, h("span", { class: "pname" }, r.name), r.bot ? h("span", { class: "bot-tag" }, t("board.bot")) : null)),
        h("td", {}, r.k), h("td", {}, r.d), h("td", { class: "score" }, r.s))))));
}

function columns(v: BoardView): HTMLElement {
  if (!teamMode(v.mode)) return h("div", { class: "board-cols" }, table(v.rows));
  const side = (t: Team, label: string, score: number) =>
    table(v.rows.filter((r) => r.team === t), h("div", { class: `board-title ${t}` }, h("span", {}, label), h("span", { class: "big" }, score)));
  return h("div", { class: "board-cols two" }, side("nato", t("team.nato"), v.nato), side("soviet", t("team.soviet"), v.soviet));
}

export class Scoreboard {
  readonly el = h("div", { class: "overlay passive scoreboard", hidden: true });

  isOpen(): boolean {
    return !this.el.hidden;
  }

  show(v: BoardView): void {
    fill(this.el, h("div", { class: "panel wide" }, h("h2", {}, t("board.title")), columns(v)));
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }
}

export class RoundEnd {
  readonly el = h("div", { class: "overlay passive round-end", hidden: true });
  private readonly count = h("div", { class: "countdown" });
  private key = "";

  /** Shows the end screen; the table is rebuilt only when it (or the language) changed. */
  show(winner: string, v: BoardView, leftS: number, wt?: Team): void {
    const key = JSON.stringify([winner, wt, v, lang()]);
    if (key !== this.key) {
      this.key = key;
      fill(this.el, h("div", { class: "panel wide" },
        h("div", { class: "winner" }, h("span", { class: "muted" }, t("end.over")), h("h1", {}, winnerTitle(winner, v.mode, wt))),
        columns(v), this.count));
    }
    this.count.textContent = t("end.next", { n: Math.max(0, Math.ceil(leftS)) });
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
    this.key = "";
  }
}

/** The server's winner name of a drawn round (internal/mode Draw); a wire value, never shown as is. */
export const DRAW = "Berabere";

/**
 * The round-end title: a draw, the winning team (wt; older servers only send
 * the name) or the FFA winner's name (a player name, never translated).
 */
export function winnerTitle(winner: string, mode: string, wt?: Team): string {
  if (winner === DRAW) return t("end.draw");
  if (!teamMode(mode)) return t("end.won", { name: winner });
  const team = wt === "nato" || wt === "soviet" ? t(`team.${wt}`) : winner.toUpperCase();
  return t("end.teamWon", { team });
}

/** Top-center score line: "NATO 12 – 9 SOVYET  6:42" or "1. Viper 8  •  Sen 5  6:42". */
export function scoreLine(v: BoardView, leftS: number): string {
  const c = clock(leftS);
  if (teamMode(v.mode)) return `${t("common.teams", { a: v.nato, b: v.soviet })}  ${c}`;
  const top = v.rows[0];
  const me = v.rows.find((r) => r.me);
  if (!top) return c;
  const you = t("common.you");
  const first = `1. ${top.me ? you : top.name} ${top.s}`;
  return top.me || !me ? `${first}  ${c}` : `${first}  •  ${you} ${me.s}  ${c}`;
}
