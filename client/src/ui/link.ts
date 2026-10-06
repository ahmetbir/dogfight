// Room code + "Linki kopyala" (clipboard, with a select-to-copy fallback).
import { h } from "./dom.ts";

export function roomLink(code: string): HTMLElement {
  const url = `${location.origin}/r/${code}`;
  const field = h("input", { type: "text", class: "input link", readonly: true, value: url, "aria-label": "Oda linki" });
  const btn = h("button", { type: "button", class: "btn small" }, "Linki kopyala");
  btn.addEventListener("click", () => {
    const done = () => { btn.textContent = "Kopyalandı ✓"; setTimeout(() => { btn.textContent = "Linki kopyala"; }, 1500); };
    const fallback = () => { field.select(); btn.textContent = "Ctrl+C ile kopyala"; };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, fallback);
    else fallback();
  });
  return h("div", { class: "room-link" }, h("span", { class: "muted" }, "Oda"), h("span", { class: "code-tag" }, code), field, btn);
}
