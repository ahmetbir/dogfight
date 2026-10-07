import { test } from "node:test";
import assert from "node:assert/strict";
import type { AircraftInfo, LobbyEntry, LobbyMsg, RoundMsg } from "../net/protocol.ts";
import { GameState } from "../game/state.ts";
import { setLang, t } from "../i18n/index.ts";
import { lobbyView, sideOpen, type LobbyInput } from "./lobby.ts";

const NAMES = { f16: "F-16", f15: "F-15", mig29: "MiG-29", su27: "Su-27" } as const;
const aircraft = new Map<string, AircraftInfo>(Object.entries(NAMES).map(([k, name]) => [k, { kind: k, name } as AircraftInfo]));
const e = (id: number, team: LobbyEntry["team"], kind: LobbyEntry["kind"] = team === "soviet" ? "mig29" : "f16"): LobbyEntry => ({ id, name: `p${id}`, team, kind });
const msg = (list: LobbyEntry[], host = list[0]?.id ?? 0, seats = 2): LobbyMsg => ({ t: "lobby", phase: "lobby", host, seats, list });
const input = (m: LobbyMsg, you: number, mode = "team"): LobbyInput => ({ msg: m, you, mode, code: "K7QX", aircraft, note: "" });

test("side rule mirrors game.sideBalanced: friends together, else at most one apart or narrowing", () => {
  assert.ok(sideOpen({ nato: 1, soviet: 0 }, "soviet", "nato"));   // 1-1 → 2-0: together against bots
  assert.ok(sideOpen({ nato: 2, soviet: 0 }, "soviet", "nato"));   // 2-1 → 3-0
  assert.ok(!sideOpen({ nato: 2, soviet: 1 }, "soviet", "nato"));  // 2-2 → 3-1
  assert.ok(!sideOpen({ nato: 1, soviet: 2 }, "nato", "soviet"));  // 2-2 → 1-3
  assert.ok(sideOpen({ nato: 1, soviet: 1 }, "nato", "soviet"));   // 2-1 → 1-2
  assert.ok(sideOpen({ nato: 2, soviet: 1 }, "nato", "soviet"));   // 3-1 → 2-2 narrows
  assert.ok(sideOpen({ nato: 4, soviet: 1 }, "nato", "nato"));     // staying is always fine
});

test("two columns: humans in join order, empty seats as bots, host and me marked", () => {
  setLang("en");
  const v = lobbyView(input(msg([e(1, "nato"), e(2, "soviet"), e(4, "nato", "f15")]), 2));
  assert.equal(v.columns.length, 2);
  const [n, s] = v.columns;
  assert.equal(n.side, "nato");
  assert.deepEqual(n.rows.map((r) => (r.bot ? "bot" : `${r.name}:${r.plane}:${r.host ? "H" : ""}${r.me ? "M" : ""}`)), ["p1:F-16:H", "p4:F-15:"]);
  assert.deepEqual(s.rows.map((r) => (r.bot ? "bot" : `${r.name}:${r.me ? "M" : ""}`)), ["p2:M", "bot"]);
  assert.equal(n.humans, 2);
  assert.equal(n.seats, 2);
  assert.ok(s.mine && !n.mine);
  assert.equal(n.closed, t("notice.side_full")); // NATO's two seats hold humans
  assert.equal(v.plane, "MiG-29");
  assert.equal(v.hostName, "p1");
});

test("Start is the host's only; it moves with the host", () => {
  const m = msg([e(3, "nato"), e(5, "soviet")], 3);
  assert.ok(lobbyView(input(m, 3)).host);
  assert.ok(!lobbyView(input(m, 5)).host);
  assert.ok(lobbyView(input({ ...m, host: 5, list: [e(5, "soviet")] }, 5)).host); // the host left
  assert.ok(!lobbyView(input({ ...m, host: 0, list: [] }, 0)).host);
});

test("a side that would be two humans ahead is closed with the reason", () => {
  setLang("en");
  // NATO 2, Soviet 2, seats 3: me (Soviet) to NATO makes 3-1.
  const v = lobbyView(input(msg([e(1, "nato"), e(2, "soviet"), e(3, "nato"), e(4, "soviet")], 1, 3), 4));
  assert.equal(v.columns[0].closed, t("notice.team_uneven"));
  assert.equal(v.columns[1].closed, null); // my own side
  // Me alone on Soviet with one friend on NATO: joining them is open (2-0).
  const w = lobbyView(input(msg([e(1, "nato"), e(2, "soviet")]), 2));
  assert.equal(w.columns[0].closed, null);
});

test("FFA: one list, no sides, bots fill the room", () => {
  const v = lobbyView(input(msg([e(1, "none", "su27"), e(2, "none")], 1, 4), 2, "ffa"));
  assert.equal(v.columns.length, 1);
  assert.equal(v.columns[0].side, "none");
  assert.equal(v.columns[0].rows.filter((r) => r.bot).length, 2);
  assert.equal(v.columns[0].closed, null);
});

test("the room is in the lobby while the round phase says so", () => {
  const s = new GameState();
  const round = (phase: RoundMsg["phase"]): RoundMsg => ({ t: "round", phase, left: 0, nato: 0, soviet: 0, board: [] });
  assert.ok(!s.inLobby());
  s.apply(round("lobby"), 0);
  s.apply(msg([e(1, "nato")]), 0);
  assert.ok(s.inLobby());
  assert.equal(s.lobby?.list.length, 1);
  s.apply(round("playing"), 0);
  assert.ok(!s.inLobby());
  s.apply(round("ended"), 0);
  assert.ok(!s.inLobby());
});
