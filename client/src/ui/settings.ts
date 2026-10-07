// Settings menu (Esc): language, scheme, sensitivity, mouse lever, invert Y, G effects, missile cam,
// performance mode, tilt aim (touch only), HUD style (with the military style's colour and speed unit),
// volume, key list, leave.
import { t, type Key } from "../i18n/index.ts";
import { fixed, pct } from "../i18n/format.ts";
import { keyRows } from "../input/bindings.ts";
import { saveSettings, type Settings } from "../input/schemes.ts";
import { requestTilt } from "../input/tilt.ts";
import { fill, h } from "./dom.ts";
import { langToggle } from "./lang.ts";
import { roomLink } from "./link.ts";

const SCHEME_NAMES: [Settings["scheme"], Key][] = [["mouse", "scheme.mouse"], ["keyboard", "scheme.keyboard"], ["touch", "scheme.touch"]];
const HUD_NAMES: [Settings["hud"], Key][] = [["classic", "settings.hudClassic"], ["military", "settings.hudMilitary"]];
const HUD_COLORS: [Settings["hudColor"], Key][] = [["green", "settings.hudGreen"], ["amber", "settings.hudAmber"]];

export type SettingsHooks = {
  changed(s: Settings): void; // after every change (already saved)
  resume(): void;
  leave(): void;
  book(): void; // open the pilot's manual
  lang?(): void; // after a language switch (screens that are not live re-render)
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

  /** Focuses the manual's button (the manual closed back into the menu). */
  focusBook(): void {
    this.bookBtn?.focus();
  }

  private change(): void {
    saveSettings(this.s);
    this.hooks.changed(this.s);
  }

  /** Tilt aim asks for the motion sensors while turning on (iOS: inside this tap); a refusal unticks it. */
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
        if (!ok) note.textContent = t("settings.tiltDenied");
        this.change();
      });
    });
    return h("div", {}, h("label", { class: "field inline" }, c, h("span", {}, t("settings.tilt"))), note);
  }

  private render(): void {
    const s = this.s;
    /** A segmented choice; a pick saves and re-renders (rows depend on it). */
    const seg = <T extends string>(label: Key, opts: [T, string][], get: () => T, set: (v: T) => void) =>
      h("div", { class: "field" }, h("span", {}, t(label)), h("div", { class: "seg", role: "group", "aria-label": t(label) },
        ...opts.map(([v, name]) => {
          const b = h("button", { type: "button", class: "seg-btn", "aria-pressed": String(get() === v) }, name);
          b.addEventListener("click", () => {
            set(v);
            this.change();
            this.render();
          });
          return b;
        })));
    const named = <T extends string>(list: [T, Key][]): [T, string][] => list.map(([v, k]) => [v, t(k)]);
    const scheme = seg("settings.scheme", named(SCHEME_NAMES), () => s.scheme, (v) => { s.scheme = v; });
    const hud = seg("settings.hud", named(HUD_NAMES), () => s.hud, (v) => { s.hud = v; });
    const military = s.hud === "military";
    const hudColor = military ? seg("settings.hudColor", named(HUD_COLORS), () => s.hudColor, (v) => { s.hudColor = v; }) : null;
    const unit = military ? seg("settings.speedUnit", [["kmh", "km/h"], ["kt", "kt"]], () => s.speedUnit, (v) => { s.speedUnit = v; }) : null;
    const sens = slider(0.2, 3, 0.1, s.sensitivity, (v) => fixed(v, 1) + "×", (v) => { s.sensitivity = v; this.change(); });
    const vol = slider(0, 1, 0.05, s.volume, (v) => pct(v), (v) => { s.volume = v; this.change(); });
    const check = (label: Key, get: () => boolean, set: (on: boolean) => void) => {
      const c = h("input", { type: "checkbox", class: "check", checked: get() });
      c.addEventListener("change", () => { set(c.checked); this.change(); });
      return h("label", { class: "field inline" }, c, h("span", {}, t(label)));
    };
    const resume = h("button", { type: "button", class: "btn primary" }, t("settings.resume"));
    resume.addEventListener("click", () => this.hooks.resume());
    const leave = h("button", { type: "button", class: "btn danger" }, t("settings.leave"));
    leave.addEventListener("click", () => this.hooks.leave());
    const book = h("button", { type: "button", class: "btn" }, t("settings.book"));
    book.addEventListener("click", () => this.hooks.book());
    this.bookBtn = book;
    // A switch re-renders the menu (and whatever the game re-renders), focus back on the toggle.
    const lang = langToggle(() => {
      this.render();
      this.hooks.lang?.();
      this.el.querySelector<HTMLElement>(".lang-toggle [aria-pressed=true]")?.focus();
    });
    fill(this.el, h("div", { class: "panel settings-panel" },
      h("div", { class: "panel-head" }, h("h2", {}, t("settings.title")), this.code ? roomLink(this.code) : null),
      h("div", { class: "settings-grid" },
        h("div", { class: "settings-form" },
          h("div", { class: "field" }, h("span", {}, t("lang.label")), lang),
          scheme,
          s.scheme === "mouse" ? h("div", { class: "field" }, h("span", {}, t("settings.sens")), sens) : null,
          s.scheme === "mouse" ? check("settings.lever", () => s.lever, (on) => { s.lever = on; }) : null,
          check("settings.invertY", () => s.invertY, (on) => { s.invertY = on; }),
          check("settings.gfx", () => s.gfx, (on) => { s.gfx = on; }),
          check("settings.missileCam", () => s.missileCam, (on) => { s.missileCam = on; }),
          check("settings.perf", () => s.perf, (on) => { s.perf = on; }),
          s.scheme === "touch" ? this.tiltCheck() : null,
          hud, hudColor, unit,
          h("div", { class: "field" }, h("span", {}, t("settings.volume")), vol),
          this.team ? h("div", { class: "field" }, h("span", {}, t("team.title")), this.team) : null),
        h("div", { class: "keys" }, h("h3", {}, t("settings.keys")),
          h("table", { class: "keytable" }, h("tbody", {},
            ...keyRows(s.scheme).map(([k, what]) => h("tr", {}, h("td", {}, h("kbd", {}, k)), h("td", {}, what))))))),
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
