// Connection banner, fatal errors and the no-WebGL screen.
import type { Status } from "../net/socket.ts";
import { fill, h } from "./dom.ts";

export class Banner {
  private readonly el: HTMLElement;
  private everOpen = false;
  private fatalShown = false;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  /** Socket status: a reconnect notice once the game had been connected, or a server update. */
  status(s: Status): void {
    if (this.fatalShown) return;
    if (s === "open") this.everOpen = true;
    if (s === "updating") {
      this.show("info", h("span", { class: "spinner" }), "Sunucu güncelleniyor, yeniden bağlanılıyor…");
    } else if (s === "connecting" && this.everOpen) {
      this.show("info", h("span", { class: "spinner" }), "Bağlantı koptu, yeniden bağlanılıyor…");
    } else {
      this.hide();
    }
  }

  /** A server error: the connection is over; offer the way home. */
  fatal(msg: string): void {
    this.fatalShown = true;
    this.show("error", h("strong", {}, msg || "Bağlantı hatası"), h("a", { href: "/", class: "btn small" }, "Ana sayfa"));
  }

  hide(): void {
    this.el.hidden = true;
    this.el.className = "";
    fill(this.el);
  }

  private show(kind: "info" | "error", ...children: (Node | string)[]): void {
    this.el.className = kind;
    this.el.setAttribute("role", kind === "error" ? "alert" : "status");
    fill(this.el, ...children);
    this.el.hidden = false;
  }
}

/** Full-screen explanation when WebGL is unavailable. */
export function noWebGL(root: HTMLElement): void {
  fill(root, h("div", { class: "screen" },
    h("div", { class: "panel narrow" },
      h("h2", {}, "WebGL kullanılamıyor"),
      h("p", {}, "Bu oyun 3B çizim için WebGL'e ihtiyaç duyar; tarayıcın ya da ekran kartı sürücün onu sağlamıyor."),
      h("p", { class: "muted" }, "Güncel bir Chrome, Firefox, Edge veya Safari kullan ve donanım hızlandırmanın açık olduğundan emin ol."),
      h("a", { href: "/", class: "btn" }, "Ana sayfa"))));
}
