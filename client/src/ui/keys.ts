// In-game key routing (window keydown/keyup): Tab scoreboard, Esc menu,
// P aircraft pick, 1–6 quick chat, ← → spectated plane, R replay (while
// down; the keyboard scheme's throttle-up R does nothing then). Flight keys belong to the schemes.
import { GAME_KEYS as G } from "../input/bindings.ts";
import { chatId } from "./chat.ts";

const ESC_AFTER_LOCK_MS = 300; // an Esc that released the pointer lock already opened the menu

/**
 * What Esc does. A replay is skipped first; it never opens the menu, and
 * since the game ignores lock loss while a replay plays (input not playing),
 * an Esc that also released the pointer lock still lands here as "skip": the
 * caller then asks for the lock again (best effort; the HUD asks for a click
 * when the browser refuses without a gesture).
 */
export function escapeAction(s: { sinceLockMenuMs: number; blocked: boolean; replaying: boolean }): "none" | "close" | "skip" | "menu" {
  if (s.sinceLockMenuMs < ESC_AFTER_LOCK_MS) return "none";
  if (s.blocked) return "close";
  return s.replaying ? "skip" : "menu";
}

export type KeyRoutes = {
  active(): boolean;   // the game has started
  blocked(): boolean;  // a menu covers the game
  menuOpen(): boolean; // the settings menu is open
  board(show: boolean): void;
  escape(): void;
  pick(): void;
  chat(id: number): void;
  spectate(step: 1 | -1): void; // ← →: the plane watched while I have none
  replay(): void;               // R: start/skip the replay (the game ignores it while I fly)
};

/** The keydown/keyup listener for r. */
export function keyRouter(r: KeyRoutes): (e: KeyboardEvent) => void {
  return (e) => {
    if (!r.active() || (e.target instanceof HTMLInputElement && e.target.type === "text")) return;
    if (e.code === G.board) {
      if (r.blocked()) { // Tab moves focus through the pick/settings overlays
        r.board(false);
        return;
      }
      e.preventDefault();
      r.board(e.type === "keydown");
      return;
    }
    if (e.type !== "keydown" || e.repeat) return;
    if (e.code === G.menu) {
      r.escape();
    } else if (e.code === G.pick && !r.menuOpen()) {
      r.pick();
    } else if (e.code === G.replay && !r.blocked()) {
      r.replay();
    } else if ((e.code === G.spectateNext || e.code === G.spectatePrev) && !r.blocked()) {
      r.spectate(e.code === G.spectateNext ? 1 : -1);
    } else if (!r.blocked() && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const id = chatId(e.code);
      if (id) r.chat(id);
    }
  };
}
