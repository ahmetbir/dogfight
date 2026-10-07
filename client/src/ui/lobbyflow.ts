// The lobby's session wiring as plain state (app.ts runs the DOM side):
// when the lobby screen opens or closes, how often Start may go out, and
// what Esc does while the lobby is on screen.

/** Least time between two Start clicks sent (the server answers repeats with not_lobby). */
export const START_GAP_MS = 1000;

/** The screens over the game that Esc can close. */
export type Overlays = { lobby: boolean; pick: boolean; menu: boolean; book: boolean };

/**
 * Esc in the lobby: with only the lobby on screen it opens the menu (Leave,
 * settings, language); with the pick, menu or manual over it, "game" lets
 * the usual Esc close that one. Outside the lobby always "game".
 */
export function lobbyEscape(o: Overlays): "menu" | "game" {
  return o.lobby && !o.pick && !o.menu && !o.book ? "menu" : "game";
}

export class LobbyFlow {
  private open = false;
  private startAt = -Infinity;

  /**
   * Follows the room: "opened" when the lobby screen appears (the round
   * ended, or I joined a waiting room: release the pointer lock), "closed"
   * when it goes because the round started (close the menus and fly), else
   * null.
   */
  sync(inLobby: boolean): "opened" | "closed" | null {
    if (inLobby === this.open) return null;
    this.open = inLobby;
    if (inLobby) this.startAt = -Infinity; // a new lobby: Start is free again
    return inLobby ? "opened" : "closed";
  }

  /** A Start click at now: true when it may be sent (one per START_GAP_MS). */
  start(now: number): boolean {
    if (!this.open || now - this.startAt < START_GAP_MS) return false;
    this.startAt = now;
    return true;
  }
}
