// The centered error card shown when a session cannot start.
import { fill, h } from "./dom.ts";

/** A centered error card (before the game started) with the way home. */
export function errorCard(ui: HTMLElement, title: string, msg: string, ...actions: HTMLElement[]): void {
  fill(ui, h("div", { class: "screen" }, h("header", { class: "brand" }, h("h1", {}, "DOGFIGHT")),
    h("div", { class: "panel narrow error-card", role: "alert" }, h("h2", {}, title), h("p", {}, msg),
      ...actions, h("a", { href: "/", class: actions.length ? "btn" : "btn primary" }, "Ana sayfa"))));
}

/** The first connection never got a welcome: "Tekrar dene" runs retry. */
export function unreachableCard(ui: HTMLElement, retry: () => void): void {
  const again = h("button", { type: "button", class: "btn primary" }, "Tekrar dene");
  again.addEventListener("click", retry);
  errorCard(ui, "Sunucuya bağlanılamadı", "Sunucu şu an yanıt vermiyor. Biraz sonra tekrar dene.", again);
  again.focus();
}
