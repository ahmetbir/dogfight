// Open-room list on the home page: refreshed every 5 s, one "Katıl" per room.
import { fetchRooms, type RoomRow } from "../net/api.ts";
import { MAP_NAMES, MODE_NAMES, WEATHER_NAMES } from "./create.ts";
import { clock, fill, h, text } from "./dom.ts";

const REFRESH_MS = 5000;

/** "2/4" pilots in the room / seats. */
export function seatsText(r: RoomRow): string {
  return `${r.humans}/${r.seats}`;
}

/** "NATO 1 – 2 SOVYET": humans per team (team modes), "" otherwise. */
export function teamsText(r: RoomRow): string {
  return r.teams ? `NATO ${r.teams[0]} – ${r.teams[1]} SOVYET` : "";
}

/** "2/4 · Takımlı · NATO 1 – 1 SOVYET · Ada · Açık": occupancy first, so a narrow row never cuts it. */
export function roomLabel(r: RoomRow): string {
  return [seatsText(r), MODE_NAMES[r.mode], teamsText(r), MAP_NAMES[r.map], WEATHER_NAMES[r.wx]].filter(Boolean).join(" · ");
}

/**
 * One fetch at a time: a refresh while one is running is skipped, a
 * rejected fetch counts as a failed one (null), and answers that arrive
 * after stop() are dropped.
 */
export class Refresher<T> {
  private readonly fetch: () => Promise<T | null>;
  private readonly apply: (v: T | null) => void;
  private gen = 0;
  private busy = false;

  constructor(fetch: () => Promise<T | null>, apply: (v: T | null) => void) {
    this.fetch = fetch;
    this.apply = apply;
  }

  async run(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const gen = this.gen;
    let v: T | null = null;
    try {
      v = await this.fetch();
    } catch {
      v = null;
    } finally {
      this.busy = false;
    }
    if (gen === this.gen) this.apply(v);
  }

  stop(): void {
    this.gen++;
  }
}

export class RoomList {
  readonly el: HTMLElement;
  private readonly list = h("div", { class: "room-rows" });
  private readonly status = h("div", { class: "room-status muted", role: "status" });
  private readonly onJoin: (code: string) => void;
  private readonly refresher: Refresher<RoomRow[]>;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(onJoin: (code: string) => void, fetchRows: () => Promise<RoomRow[] | null> = () => fetchRooms()) {
    this.onJoin = onJoin;
    this.refresher = new Refresher(fetchRows, (rows) => this.show(rows));
    this.el = h("section", { class: "panel card rooms-card" },
      h("div", { class: "card-head" }, h("h2", {}, "Açık Odalar"), h("span", { class: "live-dot", title: "5 sn'de bir yenilenir" })),
      this.list, this.status);
    text(this.status, "Yükleniyor…");
  }

  start(): void {
    if (this.timer !== null) return;
    void this.refresher.run();
    this.timer = setInterval(() => void this.refresher.run(), REFRESH_MS);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.refresher.stop();
  }

  private show(rows: RoomRow[] | null): void {
    if (rows === null) { // keep the last list
      text(this.status, "Liste alınamadı");
      return;
    }
    text(this.status, rows.length ? "" : "Açık oda yok — Hızlı Oyna yeni oda kurar.");
    fill(this.list, ...rows.map((r) => this.row(r)));
  }

  private row(r: RoomRow): HTMLElement {
    const full = r.humans >= r.seats;
    const join = h("button", { type: "button", class: "btn small", disabled: full }, full ? "Dolu" : "Katıl");
    join.addEventListener("click", () => this.onJoin(r.code));
    return h("div", { class: "room-row" },
      h("span", { class: "code-tag" }, r.code),
      h("span", { class: "room-seats" }, seatsText(r)),
      h("span", { class: "room-label", title: roomLabel(r) }, [MODE_NAMES[r.mode], teamsText(r), MAP_NAMES[r.map], WEATHER_NAMES[r.wx]].filter(Boolean).join(" · ")),
      h("span", { class: "room-left muted" }, r.phase === "ended" ? "ara" : clock(r.left)),
      join);
  }
}
