// Connection banner, fatal errors and the no-WebGL screen.
import { Banner as CoreBanner } from "roomkit/ui/banner";
import { t } from "../i18n/index.ts";
import { fill, h } from "./dom.ts";

export class Banner extends CoreBanner {
  constructor(el: HTMLElement) {
    super(el, { updating: () => t("banner.updating"), lost: () => t("banner.lost"), conn: () => t("err.conn"), home: () => t("common.home") });
  }
}

/** Full-screen explanation when WebGL is unavailable. */
export function noWebGL(root: HTMLElement): void {
  fill(root, h("div", { class: "screen" },
    h("div", { class: "panel narrow" },
      h("h2", {}, t("webgl.title")),
      h("p", {}, t("webgl.body")),
      h("p", { class: "muted" }, t("webgl.hint")),
      h("a", { href: "/", class: "btn" }, t("common.home")))));
}
