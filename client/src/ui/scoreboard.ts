// Scoreboard (held Tab) and the round-end screen; both list every roster
// player, with zero rows for players that have no board line yet (C19).
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
      h("thead", {}, h("tr", {}, h("th", { class: "name" }, "İsim"), h("th", {}, "K"), h("th", {}, "Ö"), h("th", {}, "Puan"))),
      h("tbody", {}, ...rows.map((r) => h("tr", { class: r.me ? "me" : "" },
        h("td", { class: "name" }, h("div", { class: "name-cell" }, h("span", { class: "pname" }, r.name), r.bot ? h("span", { class: "bot-tag" }, "BOT") : null)),
        h("td", {}, r.k), h("td", {}, r.d), h("td", { class: "score" }, r.s))))));
}

function columns(v: BoardView): HTMLElement {
  if (!teamMode(v.mode)) return h("div", { class: "board-cols" }, table(v.rows));
  const side = (t: Team, label: string, score: number) =>
    table(v.rows.filter((r) => r.team === t), h("div", { class: `board-title ${t}` }, h("span", {}, label), h("span", { class: "big" }, score)));
  return h("div", { class: "board-cols two" }, side("nato", "NATO", v.nato), side("soviet", "SOVYET", v.soviet));
}

export class Scoreboard {
  readonly el = h("div", { class: "overlay passive scoreboard", hidden: true });

  isOpen(): boolean {
    return !this.el.hidden;
  }

  show(v: BoardView): void {
    fill(this.el, h("div", { class: "panel wide" }, h("h2", {}, "Skor tablosu"), columns(v)));
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

  /** Shows the end screen; the table is rebuilt only when it changed. */
  show(winner: string, v: BoardView, leftS: number): void {
    const key = JSON.stringify([winner, v]);
    if (key !== this.key) {
      this.key = key;
      const title = winner === "Berabere" ? "Berabere" : teamMode(v.mode) ? `${winner.toUpperCase()} KAZANDI` : `${winner} kazandı`;
      fill(this.el, h("div", { class: "panel wide" },
        h("div", { class: "winner" }, h("span", { class: "muted" }, "Raund bitti"), h("h1", {}, title)),
        columns(v), this.count));
    }
    this.count.textContent = `Yeni raund ${Math.max(0, Math.ceil(leftS))} sn`;
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
    this.key = "";
  }
}

/** Top-center score line: "NATO 12 – 9 SOVYET  6:42" or "1. Viper 8  •  Sen 5  6:42". */
export function scoreLine(v: BoardView, leftS: number): string {
  const t = clock(leftS);
  if (teamMode(v.mode)) return `NATO ${v.nato} – ${v.soviet} SOVYET  ${t}`;
  const top = v.rows[0];
  const me = v.rows.find((r) => r.me);
  if (!top) return t;
  const first = `1. ${top.me ? "Sen" : top.name} ${top.s}`;
  return top.me || !me ? `${first}  ${t}` : `${first}  •  Sen ${me.s}  ${t}`;
}
