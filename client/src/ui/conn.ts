// Connection indicator: signal bars in the HUD corner (the RTT on hover or
// tap) and the "connection unstable" banner under the score line.
import { t } from "../i18n/index.ts";
import type { LinkView, Quality } from "../net/link.ts";
import { h, text } from "./dom.ts";

const LIT: Record<Quality, number> = { good: 4, fair: 3, poor: 2, lost: 1 };

/** The indicator's texts for v: the RTT line and the hover title. */
export function connText(v: LinkView): { rtt: string; title: string } {
  const rtt = v.rttMs === null ? t("conn.rttNone") : t("conn.rtt", { ms: v.rttMs });
  const parts = [t(`conn.${v.quality}`), rtt];
  if (v.lossPct > 0) parts.push(t("conn.loss", { n: v.lossPct }));
  return { rtt, title: parts.join(" · ") };
}

export class ConnHud {
  readonly el: HTMLElement;
  readonly banner = h("div", { class: "hud-conn-warn", role: "status", hidden: true }, t("conn.unstable"));
  private readonly bars: HTMLElement[] = [1, 2, 3, 4].map((n) => h("span", { class: `conn-bar b${n}` }));
  private readonly ms = h("span", { class: "conn-ms" });
  private quality: Quality | null = null;

  constructor() {
    this.el = h("div", { class: "hud-conn", hidden: true }, h("span", { class: "conn-bars" }, ...this.bars), this.ms);
    this.el.addEventListener("pointerdown", (e) => {
      e.stopPropagation(); // a tap on the bars is not a click on the game
      this.el.classList.toggle("open");
    });
  }

  /** v: the link while connected; null while reconnecting (the top banner says so). */
  update(v: LinkView | null): void {
    this.el.hidden = v === null;
    this.banner.hidden = !v?.unstable;
    if (!v) return;
    if (v.quality !== this.quality) {
      if (this.quality) this.el.classList.remove(this.quality);
      this.el.classList.add(v.quality);
      this.quality = v.quality;
      this.bars.forEach((b, i) => b.classList.toggle("on", i < LIT[v.quality]));
    }
    const s = connText(v);
    text(this.ms, s.rtt);
    this.el.title = s.title;
    this.el.setAttribute("aria-label", s.title);
    text(this.banner, t("conn.unstable")); // the language may have switched
  }
}
