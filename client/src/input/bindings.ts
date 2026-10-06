// Key bindings: the one table the schemes (input/schemes.ts, input/touch.ts),
// the in-game key router (ui/keys.ts) and the touch overlay read, and the key
// lists (settings menu, pilot's manual) render. Change a key here and every
// list follows.
import { REPLAY_MS } from "../game/replay.ts";
import { keyName as coreKeyName, keys as coreKeys, type Codes, type KeyRow } from "../core/ui/keys.ts";
import { t } from "../i18n/index.ts";

export type { KeyRow };

const GEAR: Codes = ["KeyL"];
const BRAKE: Codes = ["KeyB"];
const LOOK: Codes = ["KeyC"];

/** Gear key in every scheme (the touch scheme takes it too, next to its gear button). */
export const GEAR_KEYS = GEAR;

/** Mouse aim: the mouse aims, these keys do the rest. Mouse0 also counts while the left button is held. */
export const MOUSE_KEYS = {
  throttleUp: ["KeyW"], throttleDown: ["KeyS"], ab: ["ShiftLeft", "ShiftRight"], rollLeft: ["KeyA"], rollRight: ["KeyD"],
  fire: ["Mouse0"], missile: ["Mouse2", "KeyE"], flare: ["Space"], gear: GEAR, brake: BRAKE, bomb: ["KeyH", "Mouse1"],
  lookBack: LOOK,
} as const satisfies Record<string, Codes>;

/** Keyboard: pitchDown is W by default (flight-sim convention; "Y ters" swaps pitch). */
export const KEYBOARD_KEYS = {
  pitchDown: ["KeyW"], pitchUp: ["KeyS"], rollLeft: ["KeyA"], rollRight: ["KeyD"], yawLeft: ["KeyQ"], yawRight: ["KeyE"],
  throttleUp: ["KeyR"], throttleDown: ["KeyF"], ab: ["KeyX"], fire: ["Space"], missile: ["KeyV"], flare: ["KeyG"],
  gear: GEAR, brake: BRAKE, bomb: ["KeyH"], lookBack: LOOK,
} as const satisfies Record<string, Codes>;

/** Keys outside the flight schemes (ui/keys.ts). Chat is Digit1–6 / Numpad1–6 (ui/chat.ts chatId). */
export const GAME_KEYS = {
  board: "Tab", menu: "Escape", pick: "KeyP", replay: "KeyR", spectatePrev: "ArrowLeft", spectateNext: "ArrowRight",
} as const;

/** Touch overlay controls (ui/touchpad.ts); their labels are touchLabel(). */
export type TouchControl = "stick" | "throttle" | "fire" | "missile" | "flare" | "bomb" | "ab" | "gear" | "brake" | "chat" | "look"
  | "menu" | "pick" | "board" | "replay" | "skip";

/** A touch control's label in the current language: "TEKER" / "GEAR". */
export const touchLabel = (c: TouchControl) => t(`touch.${c}`);

/** Every touch label at once (the key lists, the manual). */
export function touchLabels(): Record<TouchControl, string> {
  const all: TouchControl[] = ["stick", "throttle", "fire", "missile", "flare", "bomb", "ab", "gear", "brake", "chat", "look", "menu",
    "pick", "board", "replay", "skip"];
  return Object.fromEntries(all.map((c) => [c, touchLabel(c)])) as Record<TouchControl, string>;
}

const mouse = (c: "Mouse0" | "Mouse1" | "Mouse2") => t(`key.${c}`);

/** "KeyW" → "W", "Mouse2" → "Sağ tık" / "Right click", "Escape" → "Esc". */
export const keyName = (code: string): string => coreKeyName(code, mouse);

/** The keys of several bindings, as a list label: "W / S", "Sağ tık / E" (duplicates once). */
export const keys = (...codes: Codes[]): string => coreKeys(mouse, ...codes);

export type Scheme = "mouse" | "keyboard" | "touch";

const REPLAY_S = Math.round(REPLAY_MS / 1000);
/*
 * One missile key for every loadout (no kind toggle): it fires what the lock
 * is for. Mixed locks radar beyond the IR range, IR inside it (radar too
 * when the IR missiles are gone): sim lockKind.
 */
const flat = (m: Record<string, Codes>) => Object.values(m).flat();

/** Rows every keyboard scheme shares (chat, board, pick, menu, replay, spectate); R notes a throttle clash. */
function commonRows(scheme: Record<string, Codes>): KeyRow[] {
  const g = GAME_KEYS;
  const clash = flat(scheme).includes(g.replay);
  return [
    ["1–6", t("row.chat")], [keys(scheme.lookBack ?? LOOK), t("row.look")], [keys([g.board]), t("row.board")],
    [keys([g.pick]), t("row.pick")], [keys([g.menu]), t("row.menu")],
    [keys([g.replay]), t(clash ? "row.replayClash" : "row.replay", { n: REPLAY_S })],
    [keys([g.spectatePrev, g.spectateNext]), t("row.spectate")],
  ];
}

/** The key list of a scheme in the current language (settings menu and the pilot's manual). */
export function keyRows(scheme: Scheme): KeyRow[] {
  if (scheme === "touch") {
    const l = touchLabels();
    return [
      [l.stick, t("row.stick")], [t("row.leftEdge", { k: l.throttle }), t("row.throttle")], [l.fire, t("row.gunHeld")],
      [`${l.missile} / ${l.flare} / ${l.bomb}`, t("row.tap")], [l.ab, t("row.abToggle")], [`${l.gear} / ${l.brake}`, t("row.gearBrake")],
      [l.chat, t("row.chatTouch")], [l.look, t("row.lookHeld")], [`${l.menu} / ${l.pick} / ${l.board}`, t("row.menuTouch")],
      [t("row.tiltKey"), t("row.tilt")], [`${l.replay} / ${l.skip}`, t("row.replayTouch", { n: REPLAY_S })],
      [t("row.tapScreen"), t("row.spectate")],
    ];
  }
  if (scheme === "keyboard") {
    const k = KEYBOARD_KEYS;
    return [
      [keys(k.pitchDown, k.pitchUp), t("row.pitch")], [keys(k.rollLeft, k.rollRight), t("row.roll")],
      [keys(k.yawLeft, k.yawRight), t("row.yaw")], [keys(k.throttleUp, k.throttleDown), t("row.throttleKeys")], [keys(k.ab), t("row.ab")],
      [keys(k.fire), t("row.gun")], [keys(k.missile), t("row.missile")], [keys(k.flare), t("row.flare")], [keys(k.gear), t("row.gear")],
      [keys(k.brake), t("row.brake")], [keys(k.bomb), t("row.bomb")], ...commonRows(k),
    ];
  }
  const m = MOUSE_KEYS;
  return [
    [t("row.mouse"), t("row.aim")], [keys(m.throttleUp, m.throttleDown), t("row.throttleKeys")], [keys(m.ab), t("row.ab")],
    [keys(m.rollLeft, m.rollRight), t("row.rollExtra")], [keys(m.fire), t("row.gun")],
    [keys(m.missile), t("row.missileMouse", { missile: t("row.missile") })], [keys(m.flare), t("row.flare")],
    [keys(m.gear), t("row.gear")], [keys(m.brake), t("row.brake")], [keys(m.bomb), t("row.bomb")], ...commonRows(m),
  ];
}
