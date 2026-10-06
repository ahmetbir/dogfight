// Flare HUD: the blinking "FLARE!" cue while an IR missile tracking me is
// close and a flare is ready, "DİK UÇ!" while a radar missile tracks me
// (beam it: flares do nothing), and the short note when a flare decoys a missile.
import { RULES } from "../book/rules.ts";
import { KEYBOARD_KEYS, keys, MOUSE_KEYS } from "../input/bindings.ts";
import { DT } from "../sim/flight.ts";
import { h, text } from "./dom.ts";

// RULES is checked against Go by internal/room/book_rules_test.go.
export const FLARE_CUE_M = RULES.flareWarn;
export const FLARE_COOLDOWN_TICKS = Math.round(RULES.flareCooldownS / DT);
export const DECOY_NOTE_MS = 1500;

/** Flare key per scheme from the bindings table; touch lights its FLARE button instead. */
const FLARE_KEY: Record<string, string> = { mouse: keys(MOUSE_KEYS.flare).toUpperCase(), keyboard: keys(KEYBOARD_KEYS.flare).toUpperCase() };

/** The key cap the cue shows for scheme ("" for touch). */
export function flareKey(scheme: string): string {
  return FLARE_KEY[scheme] ?? "";
}

/** A missile tracking me is inside FLARE_CUE_M and a flare would leave now. */
export function flareCue(alive: boolean, incoming: number | null, flares: number, tick: number, myFlareTick: number): boolean {
  return alive && incoming !== null && incoming < FLARE_CUE_M && flares > 0 && tick - myFlareTick >= FLARE_COOLDOWN_TICKS;
}

/** The decoy note for me: the target hears it evaded, the shooter that the flare fooled its missile. */
export function decoyNote(atMe: boolean, mine: boolean): { msg: string; good: boolean } | null {
  if (atMe) return { msg: "FÜZE ATLATILDI!", good: true };
  if (mine) return { msg: "Füzen flare'e kandı", good: false };
  return null;
}

/** The beam cue against a radar missile: fly across its line of sight (flares do nothing). */
export const BEAM_CUE = "DİK UÇ!";

export class FlareHud {
  readonly cue: HTMLElement;
  readonly beam = h("div", { class: "hud-flarecue beam", hidden: true }, BEAM_CUE);
  readonly note = h("div", { class: "hud-decoy", hidden: true });
  private readonly key = h("span", { class: "hud-key" });
  private noteUntil = 0;

  constructor() {
    this.cue = h("div", { class: "hud-flarecue", hidden: true }, "FLARE!", this.key);
  }

  /** on: show the cue; scheme picks the key cap; the touch FLARE button lights through `host`'s class; beam: a radar missile tracks me. */
  update(on: boolean, scheme: string, host: HTMLElement | null, now: number, beam = false): void {
    this.cue.hidden = !on;
    this.beam.hidden = !beam;
    const k = flareKey(scheme);
    text(this.key, k);
    this.key.hidden = !k;
    host?.classList.toggle("flare-cue", on);
    if (!this.note.hidden && now > this.noteUntil) this.note.hidden = true;
  }

  decoy(atMe: boolean, mine: boolean, now: number): void {
    const n = decoyNote(atMe, mine);
    if (!n) return;
    text(this.note, n.msg);
    this.note.classList.toggle("good", n.good);
    this.note.classList.remove("on");
    void this.note.offsetWidth; // restart the pop animation
    this.note.classList.add("on");
    this.note.hidden = false;
    this.noteUntil = now + DECOY_NOTE_MS;
  }
}
