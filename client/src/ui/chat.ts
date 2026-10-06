// Quick chat: six preset lines on keys 1–6 (the CHAT menu on touch), shown in
// the kill feed. Presets travel as ids; each viewer reads them in their own language.
import { lattr, lt, t } from "../i18n/index.ts";
import { h } from "./dom.ts";

/** Preset ids; internal/protocol ChatMax = 6. */
export const CHAT_IDS = [1, 2, 3, 4, 5, 6] as const;
export type ChatId = (typeof CHAT_IDS)[number];

export function isChatId(id: unknown): id is ChatId {
  return (CHAT_IDS as readonly unknown[]).includes(id);
}

/** A preset's text in the current language; undefined for an unknown id. */
export function chatText(id: number): string | undefined {
  return isChatId(id) ? t(`chat.${id}`) : undefined;
}

export const CHAT_LIFE_MS = 5000;
// roomkit room's default ChatCooldown is 120 ticks (2 s); +100 ms so a send at exactly
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
    return CHAT_IDS.map((id) => [id, t(`chat.${id}`)]);
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
    if (!this.open || !isChatId(id)) return false;
    this.set(false);
    this.send(id);
    return true;
  }

  /** The menu's element (built on first use). */
  view(): HTMLElement {
    if (!this.el) {
      this.el = lattr(h("div", { class: "chat-menu", role: "menu" },
        ...CHAT_IDS.map((id) => {
          const b = h("button", { type: "button", class: "chat-opt", role: "menuitem" }, lt(`chat.${id}`));
          b.addEventListener("click", () => this.choose(id));
          return b;
        })), "aria-label", "chat.aria");
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
