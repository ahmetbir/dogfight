// Settings menu (Esc): scheme, sensitivity, invert Y, G effects, missile cam,
// performance mode, tilt aim (touch only), volume, key list, leave.
import { keyRows } from "../input/bindings.ts";
import { saveSettings, type Settings } from "../input/schemes.ts";
import { requestTilt } from "../input/tilt.ts";
import { fill, h } from "./dom.ts";
import { roomLink } from "./link.ts";

/** Key list per scheme, rendered from the bindings the schemes read (input/bindings.ts). */
export const KEYS: Record<Settings["scheme"], [string, string][]> = {
  mouse: keyRows("mouse"), keyboard: keyRows("keyboard"), touch: keyRows("touch"),
};

const SCHEME_NAMES: [Settings["scheme"], string][] = [["mouse", "Fare ile nişan"], ["keyboard", "Klavye"], ["touch", "Dokunmatik"]];

export type SettingsHooks = {
  changed(s: Settings): void; // after every change (already saved)
  resume(): void;
  leave(): void;
  book(): void; // open the pilot's manual
};

export class SettingsMenu {
  readonly el = h("div", { class: "overlay settings", hidden: true });
  private readonly s: Settings;
  private readonly hooks: SettingsHooks;
  private code = "";
  private bookBtn: HTMLElement | null = null;
  private team: HTMLElement | null = null;

  /** s is edited in place, so the game sees changes at once. */
  constructor(s: Settings, hooks: SettingsHooks) {
    this.s = s;
    this.hooks = hooks;
    this.el.addEventListener("click", (e) => { if (e.target === this.el) hooks.resume(); });
  }

  isOpen(): boolean {
    return !this.el.hidden;
  }

  /** team: the switch-team row (team modes), kept across re-renders. */
  open(code: string, team: HTMLElement | null = null): void {
    this.code = code;
    this.team = team;
    this.render();
    this.el.hidden = false;
  }

  close(): void {
    this.el.hidden = true;
  }

  /** Focuses the Kitap button (the manual closed back into the menu). */
  focusBook(): void {
    this.bookBtn?.focus();
  }

  private change(): void {
    saveSettings(this.s);
    this.hooks.changed(this.s);
  }

  /** "Eğimle nişan" asks for the motion sensors while turning on (iOS: inside this tap); a refusal unticks it. */
  private tiltCheck(): HTMLElement {
    const c = h("input", { type: "checkbox", class: "check", checked: this.s.tilt });
    const note = h("span", { class: "form-error" });
    c.addEventListener("change", () => {
      note.textContent = "";
      if (!c.checked) {
        this.s.tilt = false;
        this.change();
        return;
      }
      void requestTilt().then((ok) => {
        c.checked = ok;
        this.s.tilt = ok;
        if (!ok) note.textContent = "Eğim izni verilmedi";
        this.change();
      });
    });
    return h("div", {}, h("label", { class: "field inline" }, c, h("span", {}, "Eğimle nişan")), note);
  }

  private render(): void {
    const s = this.s;
    const scheme = h("div", { class: "seg", role: "group", "aria-label": "Kontrol şeması" },
      ...SCHEME_NAMES.map(([v, label]) => {
        const b = h("button", { type: "button", class: "seg-btn", "aria-pressed": String(s.scheme === v) }, label);
        b.addEventListener("click", () => {
          s.scheme = v;
          this.change();
          this.render();
        });
        return b;
      }));
    const sens = slider(0.2, 3, 0.1, s.sensitivity, (v) => v.toFixed(1) + "×", (v) => { s.sensitivity = v; this.change(); });
    const vol = slider(0, 1, 0.05, s.volume, (v) => `${Math.round(v * 100)}%`, (v) => { s.volume = v; this.change(); });
    const check = (label: string, get: () => boolean, set: (on: boolean) => void) => {
      const c = h("input", { type: "checkbox", class: "check", checked: get() });
      c.addEventListener("change", () => { set(c.checked); this.change(); });
      return h("label", { class: "field inline" }, c, h("span", {}, label));
    };
    const resume = h("button", { type: "button", class: "btn primary" }, "Devam");
    resume.addEventListener("click", () => this.hooks.resume());
    const leave = h("button", { type: "button", class: "btn danger" }, "Odadan çık");
    leave.addEventListener("click", () => this.hooks.leave());
    const book = h("button", { type: "button", class: "btn" }, "Kitap");
    book.addEventListener("click", () => this.hooks.book());
    this.bookBtn = book;
    fill(this.el, h("div", { class: "panel settings-panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Ayarlar"), this.code ? roomLink(this.code) : null),
      h("div", { class: "settings-grid" },
        h("div", { class: "settings-form" },
          h("div", { class: "field" }, h("span", {}, "Kontrol şeması"), scheme),
          s.scheme === "mouse" ? h("div", { class: "field" }, h("span", {}, "Fare hassasiyeti"), sens) : null,
          check("Y eksenini ters çevir", () => s.invertY, (on) => { s.invertY = on; }),
          check("G efektleri", () => s.gfx, (on) => { s.gfx = on; }),
          check("Füze kamerası", () => s.missileCam, (on) => { s.missileCam = on; }),
          check("Performans modu", () => s.perf, (on) => { s.perf = on; }),
          s.scheme === "touch" ? this.tiltCheck() : null,
          h("div", { class: "field" }, h("span", {}, "Ses seviyesi"), vol),
          this.team ? h("div", { class: "field" }, h("span", {}, "Takım"), this.team) : null),
        h("div", { class: "keys" }, h("h3", {}, "Tuşlar"),
          h("table", { class: "keytable" }, h("tbody", {},
            ...KEYS[s.scheme].map(([k, what]) => h("tr", {}, h("td", {}, h("kbd", {}, k)), h("td", {}, what))))))),
      h("div", { class: "panel-foot" }, leave, h("div", { class: "foot-right" }, book, resume))));
  }
}

function slider(min: number, max: number, step: number, value: number, fmt: (v: number) => string, set: (v: number) => void): HTMLElement {
  const input = h("input", { type: "range", class: "range", min, max, step, value });
  const out = h("span", { class: "value" }, fmt(value));
  input.addEventListener("input", () => {
    const v = Number(input.value);
    out.textContent = fmt(v);
    set(v);
  });
  return h("div", { class: "range-row" }, input, out);
}
