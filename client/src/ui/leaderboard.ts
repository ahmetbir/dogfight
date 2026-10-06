// Home page: weekly / all-time leaderboard and my pilot card. Names are
// user input: they only ever reach the DOM as text nodes (h/text).
import { t } from "../i18n/index.ts";
import { fixed, pct } from "../i18n/format.ts";
import { fetchLeaderboard, fetchMe, STATS_OFF, type Board, type Me, type Off } from "../net/api.ts";
import { segmented } from "./create.ts";
import { fill, h } from "./dom.ts";

const FAVORITE: Record<string, string> = { f16: "F-16", f15: "F-15", mig29: "MiG-29", su27: "Su-27" };
const TICKS_PER_MIN = 60 * 60;

/** Airborne ticks as "12 dk" or "3 sa 12 dk" ("12 min", "3 h 12 min"). */
export function formatFlight(ticks: number): string {
  const min = Math.floor(Math.max(0, ticks) / TICKS_PER_MIN);
  return min < 60 ? t("unit.min", { n: min }) : t("unit.hmin", { h: Math.floor(min / 60), m: min % 60 });
}

/** Aircraft kind → display name; "—" when unknown or none. */
export function favoriteName(kind: string): string {
  return FAVORITE[kind] ?? "—";
}

/** "2026-W41" → "41. hafta" / "Week 41"; "" when not that shape. */
export function weekLabel(week: string): string {
  const m = /^\d{4}-W(\d{2})$/.exec(week);
  return m ? t("lb.weekNo", { n: Number(m[1]) }) : "";
}

type Period = "week" | "all";

export class Leaderboard {
  readonly el: HTMLElement;
  private readonly body = h("div", { class: "lb-body" });
  private readonly sub = h("span", { class: "muted lb-week" });
  private period: Period = "week";
  private readonly fetchBoard: (p: Period) => Promise<Board | Off | null>;
  private gen = 0;

  constructor(fetchBoard: (p: Period) => Promise<Board | Off | null> = (p) => fetchLeaderboard(p)) {
    this.fetchBoard = fetchBoard;
    const tabs = segmented<Period>(t("lb.period"), [["week", t("lb.week")], ["all", t("lb.all")]], this.period, (p) => {
      this.period = p;
      this.load();
    }, "tabs");
    this.el = h("section", { class: "panel card lb-card" },
      h("div", { class: "card-head" }, h("h2", {}, t("lb.title")), this.sub), tabs, this.body);
  }

  load(): void {
    const gen = ++this.gen;
    const period = this.period;
    void this.fetchBoard(period).then((b) => {
      if (gen === this.gen) this.show(period, b);
    });
  }

  private show(period: Period, b: Board | Off | null): void {
    this.sub.textContent = period === "week" && b && b !== STATS_OFF ? weekLabel(b.week) : "";
    if (b === STATS_OFF) return fill(this.body, h("p", { class: "muted empty" }, t("lb.off")));
    if (!b) return fill(this.body, h("p", { class: "muted empty" }, t("lb.failed")));
    if (!b.top.length) return fill(this.body, h("p", { class: "muted empty" }, t("lb.empty")));
    // Narrow screens show the short headers (style.css), so no column is cut.
    const col = (long: string, short: string) => h("th", { title: long }, h("span", { class: "th-long" }, long), h("span", { class: "th-short" }, short));
    const head = h("tr", {}, h("th", {}, "#"), h("th", { class: "name" }, t("lb.pilot")),
      col(t("lb.kills"), t("lb.killsShort")), col(t("lb.deaths"), t("lb.deathsShort")), col(t("lb.wins"), t("lb.winsShort")));
    const rows = b.top.map((e, i) => h("tr", {},
      h("td", { class: "rank" }, i + 1), h("td", { class: "name" }, h("span", { class: "pname" }, e.name)),
      h("td", { class: "score" }, e.kills), h("td", {}, e.deaths), h("td", {}, e.wins)));
    fill(this.body, h("table", { class: "board lb" }, h("thead", {}, head), h("tbody", {}, ...rows)));
  }
}

export class PilotCard {
  readonly el: HTMLElement;
  private readonly body = h("div", { class: "pc-body" });
  private readonly fetchCard: (tok: string) => Promise<Me | Off | null>;
  private gen = 0;

  constructor(fetchCard: (tok: string) => Promise<Me | Off | null> = (t) => fetchMe(t)) {
    this.fetchCard = fetchCard;
    this.el = h("section", { class: "panel card pilot-card" }, h("h2", {}, t("pc.title")), this.body);
  }

  load(tok: string): void {
    const gen = ++this.gen;
    if (!tok) return this.empty();
    void this.fetchCard(tok).then((me) => {
      if (gen !== this.gen) return;
      if (me === STATS_OFF) fill(this.body, h("p", { class: "muted empty" }, t("lb.off")));
      else if (me) this.show(me);
      else this.empty();
    });
  }

  private empty(): void {
    fill(this.body, h("p", { class: "muted empty" }, t("pc.empty")));
  }

  private show(me: Me): void {
    const tile = (label: string, value: string | number, note = "") =>
      h("div", { class: "pc-tile" }, h("span", { class: "pc-value" }, value), h("span", { class: "pc-label" }, label),
        note ? h("span", { class: "pc-note" }, note) : null);
    const kd = (me.kills + me.botKills) / Math.max(1, me.deaths);
    const acc = me.fired > 0 ? pct(me.hits / me.fired) : "—";
    fill(this.body,
      h("div", { class: "pc-head" }, h("span", { class: "pc-name" }, me.name),
        h("span", { class: "pc-fav" }, t("pc.fav"), h("b", {}, favoriteName(me.favorite)))),
      h("div", { class: "pc-grid" },
        tile(t("pc.kills"), me.kills, t("pc.killsNote")), tile(t("pc.bots"), me.botKills, t("pc.botsNote")),
        tile(t("pc.deaths"), me.deaths, me.crashes ? t("pc.crashes", { n: me.crashes }) : ""),
        tile(t("pc.kd"), fixed(kd, 2)), tile(t("pc.matches"), me.matches), tile(t("pc.wins"), me.wins),
        tile(t("pc.acc"), acc, t("pc.accNote")), tile(t("pc.flight"), formatFlight(me.flight)), tile(t("pc.week"), me.weekKills, t("pc.weekNote"))));
  }
}
