// The centered error card shown when a session cannot start.
import { errorCard as core } from "roomkit/ui/errorcard";
import { t } from "../i18n/index.ts";
import { h } from "./dom.ts";

/** A centered error card (before the game started) with the way home. */
export function errorCard(ui: HTMLElement, title: string, msg: string, ...actions: HTMLElement[]): void {
  core(ui, "DOGFIGHT", t("common.home"), title, msg, ...actions);
}

/** The first connection never got a welcome: "try again" runs retry. */
export function unreachableCard(ui: HTMLElement, retry: () => void): void {
  const again = h("button", { type: "button", class: "btn primary" }, t("card.retry"));
  again.addEventListener("click", retry);
  errorCard(ui, t("card.unreachTitle"), t("card.unreachBody"), again);
  again.focus();
}
