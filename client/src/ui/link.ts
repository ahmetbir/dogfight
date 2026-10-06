// Room code + a copy-link button (clipboard, with a select-to-copy fallback).
import { lattr, lt, t } from "../i18n/index.ts";
import { h } from "./dom.ts";

export function roomLink(code: string): HTMLElement {
  const url = `${location.origin}/r/${code}`;
  const field = lattr(h("input", { type: "text", class: "input link", readonly: true, value: url }), "aria-label", "link.aria");
  const btn = h("button", { type: "button", class: "btn small" }, lt("link.copy"));
  btn.addEventListener("click", () => {
    const done = () => { btn.textContent = t("link.copied"); setTimeout(() => { btn.replaceChildren(lt("link.copy")); }, 1500); };
    const fallback = () => { field.select(); btn.textContent = t("link.manual"); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, fallback);
    else fallback();
  });
  return h("div", { class: "room-link" }, h("span", { class: "muted" }, lt("common.room")), h("span", { class: "code-tag" }, code), field, btn);
}
