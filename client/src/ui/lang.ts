// The TR / EN switch (home page header, settings menu).
import { lang, LANGS, setLang, t, tIn, type Lang } from "../i18n/index.ts";
import { h } from "./dom.ts";

/** Two toggle buttons; a click switches the language, then `switched` re-renders what is not live. */
export function langToggle(switched: (l: Lang) => void = () => {}): HTMLElement {
  const box = h("div", { class: "seg lang-toggle", role: "group", "aria-label": t("lang.label") });
  const buttons = LANGS.map((l) => {
    const b = h("button", { type: "button", class: "seg-btn", lang: l, title: tIn(l, `lang.${l}`), "aria-pressed": String(l === lang()) },
      l.toUpperCase());
    b.addEventListener("click", () => {
      if (l === lang()) return;
      for (const o of buttons) o.setAttribute("aria-pressed", String(o === b));
      setLang(l);
      box.setAttribute("aria-label", t("lang.label"));
      switched(l);
    });
    return b;
  });
  box.append(...buttons);
  return box;
}
