// Quick chat: six preset lines on keys 1–6 (SOHBET menu on touch), shown in
// the kill feed.
import { h } from "./dom.ts";

/** Preset texts by id 1..6 (index 0 unused); internal/protocol ChatMax = 6. */
export const CHAT_TEXT: readonly string[] = [
  "", "Arkandayım!", "Yardım lazım!", "Hedefe saldırıyorum", "Üsse dönüyorum", "Tamam", "Teşekkürler",
];

export const CHAT_LIFE_MS = 5000;
// internal/room ChatCooldown is 120 ticks (2 s); +100 ms so a send at exactly
// +2 s cannot land inside it after network jitter and be dropped silently
const COOLDOWN_MS = 2100;

/** Digit1..6 / Numpad1..6 → 1..6, anything else 0. */
export function chatId(code: string): number {
  const m = /^(?:Digit|Numpad)([1-6])$/.exec(code);
  return m ? Number(m[1]) : 0;
}

/** Client-side mirror of the server's chat cooldown. */
export class ChatThrottle {
  private last = -Infinity;

  /** True (and the send counted) when nowMs is at least COOLDOWN_MS after the last send. */
  ok(nowMs: number): boolean {
    if (nowMs - this.last < COOLDOWN_MS) return false;
    this.last = nowMs;
    return true;
  }
}

/** The touch SOHBET menu: six preset buttons; a choice sends once and closes it. */
export class ChatMenu {
  private readonly send: (id: number) => void;
  private open = false;
  private el: HTMLElement | null = null;

  constructor(send: (id: number) => void) {
    this.send = send;
  }

  /** [id, text] of every preset. */
  options(): [number, string][] {
    return CHAT_TEXT.slice(1).map((t, i) => [i + 1, t]);
  }

  isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    this.set(!this.open);
  }

  close(): void {
    this.set(false);
  }

  /** Sends preset id when the menu is open and id is known; true when sent. */
  choose(id: number): boolean {
    if (!this.open || !Number.isInteger(id) || id < 1 || id >= CHAT_TEXT.length) return false;
    this.set(false);
    this.send(id);
    return true;
  }

  /** The menu's element (built on first use). */
  view(): HTMLElement {
    if (!this.el) {
      this.el = h("div", { class: "chat-menu", role: "menu", "aria-label": "Hızlı sohbet" },
        ...this.options().map(([id, t]) => {
          const b = h("button", { type: "button", class: "chat-opt", role: "menuitem" }, t);
          b.addEventListener("click", () => this.choose(id));
          return b;
        }));
      this.el.hidden = !this.open;
    }
    return this.el;
  }

  private set(on: boolean): void {
    this.open = on;
    if (this.el) {
      this.el.hidden = !on;
      this.el.ownerDocument.body.classList.toggle("chat-open", on); // touch: the menu takes the right panel's place
    }
  }
}
