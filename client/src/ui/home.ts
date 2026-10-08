// Home page: name + quick play, pilot card, join, open rooms, leaderboard,
// create-room form (create.ts); and the name prompt for /r/CODE.
import { Book } from "../book/book.ts";
import { t } from "../i18n/index.ts";
import { normalizeCode } from "../net/code.ts";
import { loadToken } from "../net/pilot.ts";
import type { Create, Join, Quick } from "../net/protocol.ts";
import { createForm } from "./create.ts";
import { fill, h, storedName, storeName, takeNameRefused } from "./dom.ts";
import { Leaderboard, PilotCard } from "./leaderboard.ts";
import { langToggle } from "./lang.ts";
import { RoomList } from "./rooms.ts";

export type Start = (name: string, entry: Create | Join | Quick) => void;

const NAME_MAX = 16;

function nameField(value = storedName()): HTMLInputElement {
  return h("input", {
    type: "text", class: "input", maxlength: NAME_MAX, placeholder: t("home.namePh"), value,
    autocomplete: "nickname", spellcheck: false,
  });
}

/** The reason under the name field after the server refused the last name; empty otherwise. */
function nameNote(refused: boolean): HTMLElement {
  return h("div", { class: "form-error", role: "alert" }, refused ? t("err.name_blocked") : "");
}

function takeName(input: HTMLInputElement): string {
  const n = input.value.trim().slice(0, NAME_MAX) || `Pilot${Math.floor(100 + Math.random() * 900)}`;
  storeName(n);
  return n;
}

/** draft: the name field's text, kept across a language switch (which re-renders the page). */
export function showHome(root: HTMLElement, start: Start, draft?: string): void {
  const refused = takeNameRefused();
  const name = nameField(draft);
  let list: RoomList | null = null;
  const go = (entry: Create | Join | Quick) => {
    list?.stop();
    start(takeName(name), entry);
  };
  const joinRoom = (c: string) => {
    history.pushState(null, "", `/r/${c}`);
    go({ t: "join", code: c });
  };
  list = new RoomList(joinRoom);
  const board = new Leaderboard();
  const card = new PilotCard();

  const quick = h("button", { type: "button", class: "btn primary quick" }, t("home.quick"));
  quick.addEventListener("click", () => go({ t: "quick" }));
  const pilot = h("div", { class: "panel card name-card" },
    h("label", { class: "field" }, h("span", {}, t("home.name")), name), nameNote(refused), quick,
    h("p", { class: "muted hint" }, t("home.quickHint")));

  const code = h("input", { type: "text", class: "input code", maxlength: 4, placeholder: t("home.codePh"), autocomplete: "off", spellcheck: false, "aria-label": t("home.codeAria") });
  code.addEventListener("input", () => { code.value = code.value.toUpperCase(); });
  const joinErr = h("div", { class: "form-error", role: "alert" });
  const joinForm = h("form", { class: "panel card join-card" },
    h("h2", {}, t("home.joinTitle")),
    h("div", { class: "join-row" }, code, h("button", { type: "submit", class: "btn" }, t("common.join"))),
    joinErr);
  joinForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const c = normalizeCode(code.value);
    if (!c) {
      joinErr.textContent = t("home.codeErr");
      return;
    }
    joinRoom(c);
  });

  const book = new Book({});
  const open = h("button", { type: "button", class: "btn small book-open" }, t("home.book"));
  open.addEventListener("click", () => book.open(open));
  // A switch re-renders the page (lists, cards, form), keeping the typed name.
  const lang = langToggle(() => {
    list?.stop();
    showHome(root, start, name.value);
    root.querySelector<HTMLElement>(".lang-toggle [aria-pressed=true]")?.focus();
  });
  fill(root, h("div", { class: "screen home" },
    h("header", { class: "brand" }, h("h1", {}, "DOGFIGHT"), h("p", { class: "muted" }, t("home.tagline")), h("div", { class: "brand-tools" }, open, lang)),
    h("div", { class: "home-grid" },
      h("div", { class: "home-col" }, pilot, joinForm, card.el),
      h("div", { class: "home-col" }, list.el, board.el),
      h("div", { class: "home-col" }, createForm((entry) => go(entry))))), book.el);
  list.start();
  board.load();
  card.load(loadToken());
  if (draft === undefined) name.focus();
}

/** /r/CODE: joins at once with a stored name, otherwise asks for one. */
export function showJoin(root: HTMLElement, code: string, start: Start, draft?: string): void {
  const refused = takeNameRefused();
  if (draft === undefined && storedName()) {
    start(storedName(), { t: "join", code });
    return;
  }
  const name = nameField(draft);
  const form = h("form", { class: "panel card narrow" },
    h("h2", {}, t("home.joinPrompt")),
    h("p", { class: "muted" }, t("common.room"), " ", h("span", { class: "code-tag" }, code)),
    h("label", { class: "field" }, h("span", {}, t("home.name")), name), nameNote(refused),
    h("button", { type: "submit", class: "btn primary" }, t("common.join")));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    start(takeName(name), { t: "join", code });
  });
  const lang = langToggle(() => showJoin(root, code, start, name.value));
  fill(root, h("div", { class: "screen home" }, h("header", { class: "brand" }, h("h1", {}, "DOGFIGHT"), lang), form));
  name.focus();
}
