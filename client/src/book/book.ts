// The pilot's manual: a modal with a chapter list and a
// content pane. Opened from the home page and the in-game menu; while open in
// a game it counts as a menu (the plane gets no input), the server is not told.
import type { AircraftInfo } from "../net/protocol.ts";
import { lattr, lt } from "../i18n/index.ts";
import { tabMove, trapIndex } from "../core/ui/modal.ts";
import { track } from "../i18n/live.ts";
import { fill, h } from "../ui/dom.ts";
import { builtinAircraft } from "./aircraft.ts";
import { CHAPTERS } from "./chapters.ts";
import type { Chapter } from "./kit.ts";

const KEY = "dogfight.book.chapter";

/** The remembered chapter index (0 when unknown or storage is blocked). */
export function lastChapter(chapters: readonly Chapter[], store: Pick<Storage, "getItem"> | null = safeStore()): number {
  try {
    const i = chapters.findIndex((c) => c.id === store?.getItem(KEY));
    return Math.max(0, i);
  } catch {
    return 0;
  }
}

function remember(id: string, store: Pick<Storage, "setItem"> | null = safeStore()): void {
  try {
    store?.setItem(KEY, id);
  } catch {
    // storage blocked: the manual opens on the first chapter next time
  }
}

function safeStore(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export type BookOpts = {
  aircraft?(): AircraftInfo[] | null; // the live table in a game; the built-in table otherwise
  closed?(): void;                    // after closing (the game returns to its menu)
};

export class Book {
  readonly el = h("div", { class: "overlay book", hidden: true });
  private readonly opts: BookOpts;
  private readonly tabs: HTMLButtonElement[];
  private readonly panel: HTMLElement;
  private readonly page = h("article", { class: "book-page", role: "tabpanel", tabindex: 0, id: "book-page" });
  private readonly chapters = CHAPTERS;
  private current = 0;
  private back: HTMLElement | null = null; // focus to restore on close
  private readonly onKey = (e: KeyboardEvent) => this.key(e);
  private readonly onFocus = (e: FocusEvent) => {
    if (e.target instanceof Node && !this.panel.contains(e.target)) this.panel.focus();
  };

  constructor(opts: BookOpts) {
    this.opts = opts;
    this.tabs = this.chapters.map((c, i) => {
      const t = h("button", {
        type: "button", class: "book-tab", role: "tab", id: `book-tab-${c.id}`, "aria-controls": "book-page", "aria-selected": "false",
        tabindex: -1,
      }, h("span", { class: "book-num" }, String(i + 1)), track(document.createTextNode(c.title()), (n) => { n.data = c.title(); }));
      t.addEventListener("click", () => this.show(i, false));
      return t;
    });
    const toc = lattr(h("nav", { class: "book-toc", role: "tablist", "aria-orientation": "vertical" }, ...this.tabs), "aria-label", "book.toc");
    toc.addEventListener("keydown", (e) => {
      const to = tabMove(e.key, this.current, this.tabs.length);
      if (to === null) return;
      e.preventDefault();
      this.show(to, true);
    });
    const close = lattr(h("button", { type: "button", class: "btn small book-close" }, lt("book.close")), "aria-label", "book.closeAria");
    close.addEventListener("click", () => this.close());
    // tabindex -1: a click on plain text inside focuses the panel, so focus never drops to <body>.
    this.panel = h("div", { class: "panel book-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "book-title", tabindex: -1 },
      h("div", { class: "book-head" }, h("h2", { id: "book-title" }, lt("book.title")), close),
      h("div", { class: "book-body" }, toc, this.page));
    fill(this.el, this.panel);
    this.el.addEventListener("click", (e) => { if (e.target === this.el) this.close(); });
  }

  isOpen(): boolean {
    return !this.el.hidden;
  }

  /** opener gets the focus back on close (default: whatever had it). */
  open(opener?: HTMLElement): void {
    if (this.isOpen()) return;
    const active = document.activeElement;
    this.back = opener ?? (active instanceof HTMLElement ? active : null);
    this.el.hidden = false;
    // Capture on window: runs before the game's key router and flight input, which never see keys while the book is open.
    window.addEventListener("keydown", this.onKey, true);
    document.addEventListener("focusin", this.onFocus);
    this.show(lastChapter(this.chapters), true);
  }

  /** Closes and tells the opener (the game returns to its menu). */
  close(): void {
    if (!this.isOpen()) return;
    this.hide();
    this.opts.closed?.();
  }

  /** Closes without telling the opener (another screen takes over). */
  hide(): void {
    if (!this.isOpen()) return;
    this.el.hidden = true;
    window.removeEventListener("keydown", this.onKey, true);
    document.removeEventListener("focusin", this.onFocus);
    if (this.back?.isConnected) this.back.focus();
    this.back = null;
  }

  /** Esc closes the book (only the book); Tab and Shift+Tab cycle inside it. */
  private key(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    if (e.key !== "Tab") return;
    e.preventDefault();
    e.stopPropagation();
    const list = this.focusables();
    if (!list.length) return;
    const cur = list.indexOf(document.activeElement as HTMLElement);
    list[trapIndex(cur, list.length, e.shiftKey)]!.focus();
  }

  /** The Tab stops in order: close button, the selected chapter tab, the page. */
  private focusables(): HTMLElement[] {
    return Array.from(this.panel.querySelectorAll<HTMLElement>("button, [href], input, [tabindex]"))
      .filter((x) => x !== this.panel && x.tabIndex >= 0 && !(x as HTMLButtonElement).disabled);
  }

  /** Shows chapter i; focusTab moves the focus to its tab (keyboard and open). */
  private show(i: number, focusTab: boolean): void {
    this.current = i;
    const c = this.chapters[i]!;
    this.tabs.forEach((t, j) => {
      t.setAttribute("aria-selected", String(j === i));
      t.tabIndex = j === i ? 0 : -1;
    });
    this.page.setAttribute("aria-labelledby", `book-tab-${c.id}`);
    const live = this.opts.aircraft?.();
    fill(this.page, h("h2", { class: "book-title" }, c.title()), ...c.render({ aircraft: live?.length ? live : builtinAircraft() }));
    this.page.scrollTop = 0;
    remember(c.id);
    const tab = this.tabs[i]!;
    if (focusTab) tab.focus();
    tab.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }
}
