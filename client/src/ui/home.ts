// Home page: name + quick play, pilot card, join, open rooms, leaderboard,
// create-room form (create.ts); and the name prompt for /r/CODE.
import { Book } from "../book/book.ts";
import { normalizeCode } from "../net/code.ts";
import { loadToken } from "../net/pilot.ts";
import type { Create, Join, Quick } from "../net/protocol.ts";
import { createForm } from "./create.ts";
import { fill, h, storedName, storeName } from "./dom.ts";
import { Leaderboard, PilotCard } from "./leaderboard.ts";
import { RoomList } from "./rooms.ts";

export type Start = (name: string, entry: Create | Join | Quick) => void;

const NAME_MAX = 16;

function nameField(): HTMLInputElement {
  return h("input", {
    type: "text", class: "input", maxlength: NAME_MAX, placeholder: "Pilot adın", value: storedName(),
    autocomplete: "nickname", spellcheck: false,
  });
}

function takeName(input: HTMLInputElement): string {
  const n = input.value.trim().slice(0, NAME_MAX) || `Pilot${Math.floor(100 + Math.random() * 900)}`;
  storeName(n);
  return n;
}

export function showHome(root: HTMLElement, start: Start): void {
  const name = nameField();
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

  const quick = h("button", { type: "button", class: "btn primary quick" }, "Hızlı Oyna");
  quick.addEventListener("click", () => go({ t: "quick" }));
  const pilot = h("div", { class: "panel card name-card" },
    h("label", { class: "field" }, h("span", {}, "İsim"), name), quick,
    h("p", { class: "muted hint" }, "En kalabalık açık odaya katılır; yoksa yeni oda kurar."));

  const code = h("input", { type: "text", class: "input code", maxlength: 4, placeholder: "KOD", autocomplete: "off", spellcheck: false, "aria-label": "Oda kodu" });
  code.addEventListener("input", () => { code.value = code.value.toUpperCase(); });
  const joinErr = h("div", { class: "form-error", role: "alert" });
  const joinForm = h("form", { class: "panel card join-card" },
    h("h2", {}, "Odaya Katıl"),
    h("div", { class: "join-row" }, code, h("button", { type: "submit", class: "btn" }, "Katıl")),
    joinErr);
  joinForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const c = normalizeCode(code.value);
    if (!c) {
      joinErr.textContent = "Kod 4 karakter olmalı (ör. K7QX).";
      return;
    }
    joinRoom(c);
  });

  const book = new Book({});
  const open = h("button", { type: "button", class: "btn small book-open" }, "Pilot El Kitabı");
  open.addEventListener("click", () => book.open(open));
  fill(root, h("div", { class: "screen home" },
    h("header", { class: "brand" }, h("h1", {}, "DOGFIGHT"), h("p", { class: "muted" }, "Tarayıcıda çok oyunculu jet it dalaşı"), open),
    h("div", { class: "home-grid" },
      h("div", { class: "home-col" }, pilot, joinForm, card.el),
      h("div", { class: "home-col" }, list.el, board.el),
      h("div", { class: "home-col" }, createForm((entry) => go(entry))))), book.el);
  list.start();
  board.load();
  card.load(loadToken());
  name.focus();
}

/** /r/CODE: joins at once with a stored name, otherwise asks for one. */
export function showJoin(root: HTMLElement, code: string, start: Start): void {
  if (storedName()) {
    start(storedName(), { t: "join", code });
    return;
  }
  const name = nameField();
  const form = h("form", { class: "panel card narrow" },
    h("h2", {}, "Odaya katıl"),
    h("p", { class: "muted" }, "Oda ", h("span", { class: "code-tag" }, code)),
    h("label", { class: "field" }, h("span", {}, "İsim"), name),
    h("button", { type: "submit", class: "btn primary" }, "Katıl"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    start(takeName(name), { t: "join", code });
  });
  fill(root, h("div", { class: "screen home" }, h("header", { class: "brand" }, h("h1", {}, "DOGFIGHT")), form));
  name.focus();
}
