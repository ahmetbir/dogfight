import { test } from "node:test";
import assert from "node:assert/strict";
import { setLang } from "../i18n/index.ts";
import { keyRows } from "../input/bindings.ts";
import { chatText } from "./chat.ts";
import { mapName, modeName } from "./create.ts";
import { formatFlight } from "./leaderboard.ts";
import { warnText } from "./loadout.ts";
import { formatDist } from "./reticle.ts";
import { roomLabel } from "./rooms.ts";
import { boardRows, scoreLine, winnerTitle } from "./scoreboard.ts";
import { switchBlock, type SwitchView } from "./team.ts";

const TURKISH = /[çğıİöşüÇĞÖŞÜ]/;

/** Runs f in English, back to Turkish after. */
function inEnglish(f: () => void): void {
  setLang("en", null);
  try {
    f();
  } finally {
    setLang("tr", null);
  }
}

test("switching the language changes the screens' texts; player names stay as typed", () => {
  const rows = boardRows([{ id: 1, name: "Şahin", team: "none", kind: "f16", bot: false }, { id: 2, name: "Viper", team: "none", kind: "f16", bot: false }],
    [{ id: 2, k: 3, d: 0, s: 3 }, { id: 1, k: 1, d: 0, s: 1 }], 1);
  const ffa = { mode: "ffa", rows, nato: 0, soviet: 0 };
  assert.equal(scoreLine(ffa, 65), "1. Viper 3  •  Sen 1  1:05");
  assert.equal(winnerTitle("Berabere", "team"), "Berabere");
  assert.equal(winnerTitle("Sovyet", "team", "soviet"), "SOVYET KAZANDI");
  inEnglish(() => {
    assert.equal(scoreLine(ffa, 65), "1. Viper 3  •  You 1  1:05");
    assert.equal(scoreLine({ ...ffa, mode: "team", nato: 4, soviet: 2 }, 65), "NATO 4 – 2 SOVIET  1:05");
    assert.equal(winnerTitle("Berabere", "team"), "Draw");
    assert.equal(winnerTitle("Sovyet", "team", "soviet"), "SOVIET WINS");
    assert.equal(winnerTitle("Şahin", "ffa"), "Şahin wins", "a player's name is never translated");
    assert.equal(chatText(1), "Right behind you!");
    assert.equal(roomLabel({ code: "K7QX", mode: "base", map: "col", wx: "firtina", humans: 2, seats: 6, phase: "playing", left: 312 }),
      "2/6 · Base Attack · Desert · Storm");
    assert.equal(`${modeName("ffa")} / ${mapName("sehir")}`, "Free-for-all / City");
    assert.equal(formatFlight(60 * 60 * 75), "1 h 15 min");
    assert.equal(formatDist(1260), "1.3 km");
    assert.equal(warnText({ kind: "radar", dist: 1260 }, formatDist), "MISSILE WARNING · RADAR · 1.3 km");
    const v: SwitchView = { mode: "team", mine: "nato", others: { nato: 0, soviet: 0 }, sinceSwitchS: 12.2, round: null, alive: true, threat: false, hurtAgoS: Infinity };
    assert.equal(switchBlock(v), "Wait 18 s to switch teams");
    for (const s of ["mouse", "keyboard", "touch"] as const) {
      for (const [k, what] of keyRows(s)) assert.ok(!TURKISH.test(k + what), `${s}: ${k} ${what}`);
    }
  });
  assert.equal(chatText(1), "Arkandayım!");
});
