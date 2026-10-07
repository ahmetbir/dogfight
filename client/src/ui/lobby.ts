// Pre-match lobby of a created room: the humans per side (FFA: one list)
// with their aircraft, empty seats shown as bots, the host badge, side
// buttons, the room link, the aircraft button (opens the pick screen) and
// the host's Start. The server decides (game.SetSide, game.Start); the model
// mirrors its rules so a closed side says why before asking.
import type { AircraftInfo, LobbyMsg, Team } from "../net/protocol.ts";
import { lang, lt, t } from "../i18n/index.ts";
import { fill, h, text } from "./dom.ts";
import { roomLink } from "./link.ts";
import { hasTeams, teamName, uneven, type Side } from "./team.ts";

export type LobbyRow =
  | { bot: false; id: number; name: string; plane: string; host: boolean; me: boolean }
  | { bot: true };

export type LobbyColumn = {
  side: Side | "none";
  rows: LobbyRow[];
  humans: number; seats: number;
  /** Side columns: null when I may move there (or am there), else why not. */
  closed: string | null;
  mine: boolean;
};

export type LobbyView = {
  code: string;
  columns: LobbyColumn[]; // NATO and Soviet, or one FFA list
  host: boolean;          // I am the host: Start is mine
  hostName: string;       // who starts ("" before anyone is seated)
  plane: string;          // my aircraft's name
  note: string;           // a server refusal, shown for a few seconds
};

export type LobbyInput = {
  msg: LobbyMsg; you: number; mode: string; code: string;
  aircraft: Map<string, AircraftInfo>; note: string;
};

const planeName = (kind: string, aircraft: Map<string, AircraftInfo>) => aircraft.get(kind)?.name ?? kind.toUpperCase();

/**
 * Whether I may move from side `mine` to `to` (game.sideBalanced): with
 * humans on both sides afterwards a side may not get two humans ahead,
 * unless the move narrows the gap; everyone on one side (friends against
 * bots) is fine.
 */
export function sideOpen(others: Record<Side, number>, mine: Team, to: Side): boolean {
  if (mine === to) return true;
  const after = { ...others, [to]: others[to] + 1 };
  if (after.nato === 0 || after.soviet === 0) return true;
  const now = { ...others };
  if (mine === "nato" || mine === "soviet") now[mine]++;
  const gap = (c: Record<Side, number>) => Math.abs(c.nato - c.soviet);
  return gap(after) <= 1 || gap(after) < gap(now);
}

/** The lobby screen's content from the server's lobby message. */
export function lobbyView(v: LobbyInput): LobbyView {
  const { msg, you, aircraft } = v;
  const row = (p: LobbyMsg["list"][number]): LobbyRow =>
    ({ bot: false, id: p.id, name: p.name, plane: planeName(p.kind, aircraft), host: p.id === msg.host, me: p.id === you });
  const me = msg.list.find((p) => p.id === you);
  const hostName = msg.list.find((p) => p.id === msg.host)?.name ?? "";
  const base = { code: v.code, host: msg.host !== 0 && msg.host === you, hostName, plane: me ? planeName(me.kind, aircraft) : "", note: v.note };
  const fillBots = (rows: LobbyRow[], seats: number) => [...rows, ...Array.from({ length: Math.max(0, seats - rows.length) }, (): LobbyRow => ({ bot: true }))];
  if (!hasTeams(v.mode)) {
    const rows = msg.list.map(row);
    return { ...base, columns: [{ side: "none", rows: fillBots(rows, msg.seats), humans: rows.length, seats: msg.seats, closed: null, mine: true }] };
  }
  const others: Record<Side, number> = { nato: 0, soviet: 0 };
  for (const p of msg.list) if (p.id !== you && (p.team === "nato" || p.team === "soviet")) others[p.team]++;
  const mine: Team = me?.team ?? "none";
  const columns = (["nato", "soviet"] as const).map((side): LobbyColumn => {
    const rows = msg.list.filter((p) => p.team === side).map(row);
    let closed: string | null = null;
    if (side !== mine) {
      if (others[side] >= msg.seats) closed = t("notice.side_full");
      else if (!sideOpen(others, mine, side)) closed = uneven();
    }
    return { side, rows: fillBots(rows, msg.seats), humans: rows.length, seats: msg.seats, closed, mine: side === mine };
  });
  return { ...base, columns };
}

export type LobbyActions = {
  side(s: Side): void;
  plane(): void;
  start(): void;
  settings(): void; // the menu: controls, language, the manual
  leave(): void;    // back to the home page
};

/**
 * The lobby overlay. The panel (head with the room link, columns, buttons)
 * is rebuilt only when the view changes, so a click and the copy-link
 * feedback survive the 10 Hz refresh.
 */
export class LobbyScreen {
  readonly el = h("div", { class: "overlay lobby", hidden: true });
  private readonly act: LobbyActions;
  private link: HTMLElement | null = null;
  private linkCode = "";
  private body = h("div", { class: "lobby-body" });
  private readonly note = h("span", { class: "form-error lobby-note" });
  private key = "";

  constructor(act: LobbyActions) {
    this.act = act;
  }

  isOpen(): boolean {
    return !this.el.hidden;
  }

  close(): void {
    this.el.hidden = true;
  }

  show(v: LobbyView): void {
    if (v.code !== this.linkCode || !this.link) {
      this.linkCode = v.code;
      this.link = roomLink(v.code);
      this.key = "";
    }
    const key = JSON.stringify([lang(), { ...v, note: "" }]);
    if (key !== this.key) {
      this.key = key;
      this.build(v);
    }
    text(this.note, v.note);
    this.el.hidden = false;
  }

  private build(v: LobbyView): void {
    const cols = v.columns.map((c) => this.column(c, v.columns.length > 1));
    const plane = h("button", { type: "button", class: "btn lobby-plane" }, lt("lobby.plane"));
    plane.addEventListener("click", () => this.act.plane());
    let go: HTMLElement;
    if (v.host) {
      go = h("button", { type: "button", class: "btn primary lobby-start" }, lt("lobby.start"));
      go.addEventListener("click", () => this.act.start());
    } else {
      go = h("span", { class: "muted lobby-wait" }, h("span", { class: "spinner" }), t("lobby.wait", { name: v.hostName }));
    }
    const settings = h("button", { type: "button", class: "btn small" }, lt("settings.title"));
    settings.addEventListener("click", () => this.act.settings());
    const leave = h("button", { type: "button", class: "btn small" }, lt("settings.leave"));
    leave.addEventListener("click", () => this.act.leave());
    this.body = h("div", { class: "lobby-body" },
      h("p", { class: "muted lobby-hint" }, lt(v.host ? "lobby.hintHost" : "lobby.hint")),
      h("div", { class: `lobby-cols${v.columns.length > 1 ? " two" : ""}` }, ...cols),
      h("div", { class: "lobby-me" }, h("span", { class: "muted" }, lt("lobby.mine")), h("b", { class: "lobby-myplane" }, v.plane), plane,
        h("span", { class: "lobby-tools" }, settings, leave)),
      this.note,
      h("div", { class: "panel-foot" }, h("span", { class: "muted" }, lt("lobby.late")), go));
    fill(this.el, h("div", { class: "panel wide lobby-panel" },
      h("div", { class: "panel-head" }, h("h2", {}, lt("lobby.title")), this.link),
      this.body));
  }

  private column(c: LobbyColumn, sides: boolean): HTMLElement {
    const title = c.side === "none" ? t("lobby.pilots") : teamName(c.side);
    const rows = c.rows.map((r) => r.bot
      ? h("li", { class: "lobby-row bot" }, h("span", { class: "lobby-name muted" }, t("lobby.bot")))
      : h("li", { class: `lobby-row${r.me ? " me" : ""}` },
        h("span", { class: "lobby-name" }, r.name),
        r.host ? h("span", { class: "lobby-badge host" }, t("lobby.host")) : null,
        r.me ? h("span", { class: "lobby-badge me" }, t("lobby.you")) : null,
        h("span", { class: "lobby-kind muted" }, r.plane)));
    let action: HTMLElement | null = null;
    if (sides && c.side !== "none") {
      const side = c.side;
      if (c.mine) action = h("span", { class: "lobby-here muted" }, t("lobby.here"));
      else {
        const b = h("button", { type: "button", class: `btn small team-switch ${side}`, disabled: c.closed !== null }, t("lobby.join", { team: teamName(side) }));
        b.addEventListener("click", () => this.act.side(side));
        action = h("div", { class: "lobby-action" }, b, c.closed ? h("span", { class: "form-error" }, c.closed) : null);
      }
    }
    return h("section", { class: `lobby-col ${c.side}${c.mine && sides ? " mine" : ""}` },
      h("div", { class: "lobby-col-head" }, h("h3", { class: `team-tag ${c.side}` }, title), h("span", { class: "muted" }, `${c.humans}/${c.seats}`)),
      h("ol", { class: "lobby-rows" }, ...rows),
      action);
  }
}
