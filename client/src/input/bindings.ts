// Key bindings: the one table the schemes (input/schemes.ts, input/touch.ts),
// the in-game key router (ui/keys.ts) and the touch overlay read, and the key
// lists (settings menu, pilot's manual) render. Change a key here and every
// list follows.
import { REPLAY_MS } from "../game/replay.ts";

/** KeyboardEvent.code values; mouse buttons are "Mouse0" (left), "Mouse1" (middle), "Mouse2" (right). */
type Codes = readonly string[];

const GEAR: Codes = ["KeyL"];
const BRAKE: Codes = ["KeyB"];
const LOOK: Codes = ["KeyC"];

/** Gear key in every scheme (the touch scheme takes it too, next to TEKER). */
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

/** Touch overlay labels (ui/touchpad.ts). */
export const TOUCH_LABEL = {
  stick: "Sol çubuk", throttle: "GAZ", fire: "ATEŞ", missile: "FÜZE", flare: "FLARE", bomb: "BOMBA", ab: "AB", gear: "TEKER",
  brake: "FREN", chat: "SOHBET", look: "GERİ", menu: "MENÜ", pick: "UÇAK", board: "SKOR", replay: "TEKRAR", skip: "GEÇ",
} as const;

const NAMES: Record<string, string> = {
  Mouse0: "Sol tık", Mouse1: "orta tık", Mouse2: "Sağ tık", ShiftLeft: "Shift", ShiftRight: "Shift", Escape: "Esc",
  ArrowLeft: "←", ArrowRight: "→",
};

/** "KeyW" → "W", "Mouse2" → "Sağ tık", "Escape" → "Esc". */
export function keyName(code: string): string {
  return NAMES[code] ?? code.replace(/^(Key|Digit)/, "");
}

/** The keys of several bindings, as a list label: "W / S", "Sağ tık / E" (duplicates once). */
export function keys(...codes: Codes[]): string {
  return [...new Set(codes.flat().map(keyName))].join(" / ");
}

export type Scheme = "mouse" | "keyboard" | "touch";
export type KeyRow = [string, string];

const REPLAY_S = Math.round(REPLAY_MS / 1000);
/**
 * One missile key for every loadout (no kind toggle): it fires what the lock
 * is for. Karışık locks radar beyond the IR range, IR inside it (radar too
 * when the IR missiles are gone): sim lockKind.
 */
const MISSILE = "Füze (kilit gerekir; Karışık: uzakta radar, yakında IR)";
const flat = (m: Record<string, Codes>) => Object.values(m).flat();

/** Rows every keyboard scheme shares (chat, board, pick, menu, replay, spectate); R notes a throttle clash. */
function commonRows(scheme: Record<string, Codes>): KeyRow[] {
  const g = GAME_KEYS;
  const clash = flat(scheme).includes(g.replay);
  return [
    ["1–6", "Hızlı sohbet"], [keys(scheme.lookBack ?? LOOK), "Geri bak"], [keys([g.board]), "Skor tablosu (basılı)"],
    [keys([g.pick]), "Uçak seçimi"], [keys([g.menu]), "Menü"],
    [keys([g.replay]), `Ölünce: son ${REPLAY_S} sn tekrar${clash ? " (uçarken: gaz artır)" : ""}`],
    [keys([g.spectatePrev, g.spectateNext]), "Beklerken: izlenen uçağı değiştir"],
  ];
}

/** The key list of a scheme (settings menu and the pilot's manual). */
export function keyRows(scheme: Scheme): KeyRow[] {
  if (scheme === "touch") {
    const t = TOUCH_LABEL;
    return [
      [t.stick, "Burun/yatış (bırakınca düzler)"], [`Sol kenar (${t.throttle})`, "Gaz"], [t.fire, "Top (basılı)"],
      [`${t.missile} / ${t.flare} / ${t.bomb}`, "Tek basış"], [t.ab, "Afterburner aç/kapa"], [`${t.gear} / ${t.brake}`, "İniş takımı / fren"],
      [t.chat, "Hızlı mesaj"], [t.look, "Geri bak (basılı)"], [`${t.menu} / ${t.pick} / ${t.board}`, "Menü / uçak seçimi / skor (basılı)"],
      ["Eğim", "Eğimle nişan açıksa çubuk boştayken"], [`${t.replay} / ${t.skip}`, `Ölünce: son ${REPLAY_S} sn tekrar / atla`],
      ["Ekrana dokun", "Beklerken: izlenen uçağı değiştir"],
    ];
  }
  if (scheme === "keyboard") {
    const k = KEYBOARD_KEYS;
    return [
      [keys(k.pitchDown, k.pitchUp), "Burun aşağı / yukarı (Y ters çevirince tersi)"], [keys(k.rollLeft, k.rollRight), "Yatış (roll)"],
      [keys(k.yawLeft, k.yawRight), "Sapma (yaw)"], [keys(k.throttleUp, k.throttleDown), "Gaz artır / azalt"], [keys(k.ab), "Afterburner"],
      [keys(k.fire), "Top"], [keys(k.missile), MISSILE], [keys(k.flare), "Flare"], [keys(k.gear), "İniş takımı aç/kapa"],
      [keys(k.brake), "Fren (basılı)"], [keys(k.bomb), "Bomba (Üs Saldırısı)"], ...commonRows(k),
    ];
  }
  const m = MOUSE_KEYS;
  return [
    ["Fare", "Nişan (uçak burnunu imlece çevirir)"], [keys(m.throttleUp, m.throttleDown), "Gaz artır / azalt"], [keys(m.ab), "Afterburner"],
    [keys(m.rollLeft, m.rollRight), "Ek yatış (roll)"], [keys(m.fire), "Top"],
    [keys(m.missile), `${MISSILE}; trackpad: iki parmak ya da ctrl+tık`], [keys(m.flare), "Flare"],
    [keys(m.gear), "İniş takımı aç/kapa"], [keys(m.brake), "Fren (basılı)"], [keys(m.bomb), "Bomba (Üs Saldırısı)"], ...commonRows(m),
  ];
}
