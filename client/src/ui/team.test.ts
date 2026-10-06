import { test } from "node:test";
import assert from "node:assert/strict";
import type { EventJSON, PlaneJSON, PlayerJSON, Snap, TeamChoice, Welcome } from "../net/protocol.ts";
import { parseRooms } from "../net/api.ts";
import { pickKey, type PickView } from "./pick.ts";
import { roomLabel, teamsText } from "./rooms.ts";
import {
  balanced, humanCounts, selectorState, SWITCH_CLOSE_TICKS, switchBlock, TeamFlow, teamPickView, underFire, uneven,
  type SwitchView, type TeamState,
} from "./team.ts";

const pl = (id: number, team: PlayerJSON["team"], bot = false): PlayerJSON => ({ id, name: `p${id}`, team, kind: "f16", bot });

test("human counts leave out bots and me", () => {
  const ps = [pl(1, "nato"), pl(2, "soviet"), pl(3, "nato", true), pl(4, "nato")];
  assert.deepEqual(humanCounts(ps, 1), { nato: 1, soviet: 1 });
});

test("balance rule: at most 1 apart afterwards, or the gap narrows", () => {
  assert.ok(balanced({ nato: 0, soviet: 0 }, "nato", "soviet"));              // 1-0 → 0-1
  assert.ok(!balanced({ nato: 1, soviet: 0 }, "soviet", "nato"));             // 1-1 → 2-0
  assert.ok(balanced({ nato: 1, soviet: 1 }, "nato", "soviet"));              // 2-1 → 1-2
  assert.ok(!balanced({ nato: 2, soviet: 0 }, "soviet", "nato"));             // 2-1 → 3-0
  assert.ok(balanced({ nato: 3, soviet: 0 }, "nato", "soviet"));              // 4-0 → 3-1 narrows
  assert.ok(balanced({ nato: 5, soviet: 0 }, "nato", "nato"));                // staying is always fine
});

test("pick screen selector: auto pressed, uneven team closed with the reason", () => {
  // Me (1) on Soviet; another human on NATO: NATO would make 2-0.
  const v = teamPickView([pl(1, "soviet"), pl(2, "nato")], 1, "soviet", "auto", "");
  assert.deepEqual(v.allowed, { nato: false, soviet: true });
  assert.deepEqual(selectorState(v), { pressed: "auto", closed: ["nato"], note: `NATO: ${uneven()}` });
  // Alone: both open, nothing to say.
  const alone = teamPickView([pl(1, "nato")], 1, "nato", "soviet", "");
  assert.deepEqual(selectorState(alone), { pressed: "soviet", closed: [], note: "" });
  // A server refusal wins over the computed note.
  assert.equal(selectorState({ ...v, note: "Takım dolu" }).note, "Takım dolu");
});

test("pick screen rebuilds when the team selector comes or goes", () => {
  const base: PickView = { code: "K7QX", team: "nato", aircraft: [], current: null, chosen: null, protectedNow: false, waiting: true, waitLeft: 15 };
  const withTeams = { ...base, teamPick: teamPickView([], 1, "nato", "auto", "") };
  assert.notEqual(pickKey(base), pickKey(withTeams));
  assert.notEqual(pickKey(withTeams), pickKey({ ...withTeams, team: "soviet" }), "a switch rebuilds the cards for the new team");
});

test("menu switch: last minute in every team mode, cooldown, fire gates, balance, FFA", () => {
  const v: SwitchView = {
    mode: "team", mine: "nato", others: { nato: 0, soviet: 0 }, sinceSwitchS: Infinity, round: { phase: "playing", left: 9999 },
    alive: true, threat: false, hurtAgoS: Infinity,
  };
  assert.equal(switchBlock(v), null);
  assert.equal(switchBlock({ ...v, sinceSwitchS: 12.2 }), "Takım değiştirmek için 18 sn bekle");
  for (const mode of ["team", "base"]) {
    assert.equal(switchBlock({ ...v, mode, round: { phase: "playing", left: SWITCH_CLOSE_TICKS - 1 } }), "Raundun son 60 saniyesinde takım değiştirilemez");
  }
  assert.equal(switchBlock({ ...v, round: { phase: "playing", left: SWITCH_CLOSE_TICKS } }), null);
  assert.equal(switchBlock({ ...v, round: { phase: "ended", left: 100 } }), null, "the scoreboard break is not the last minute");
  assert.equal(switchBlock({ ...v, threat: true }), "Kilitliyken takım değiştiremezsin");
  assert.equal(switchBlock({ ...v, hurtAgoS: 9.9 }), "Hasar aldıktan sonra 10 sn bekle");
  assert.equal(switchBlock({ ...v, hurtAgoS: 10 }), null);
  assert.equal(switchBlock({ ...v, alive: false, threat: true, hurtAgoS: 1 }), null, "dead: nothing to escape from");
  assert.equal(switchBlock({ ...v, mine: "soviet", others: { nato: 1, soviet: 0 } }), uneven());
  assert.equal(switchBlock({ ...v, mode: "ffa", mine: "none" }), "Bu modda takım yok");
});

test("under fire: a hard lock or a missile in flight on me", () => {
  const plane = (id: number, extra: Partial<PlaneJSON>): PlaneJSON =>
    ({ id, k: "f16", tm: "nato", p: [0, 0, 0], q: [1, 0, 0, 0], v: [0, 0, 0], th: 0, hp: 1, a: true, ht: 0, oh: false, ms: 0, fl: 0, ...extra });
  assert.equal(underFire(1, [plane(2, { lk: 1, ld: false })], []), false, "a lock in progress is not a lock");
  assert.equal(underFire(1, [plane(2, { lk: 1, ld: true })], []), true);
  assert.equal(underFire(1, [plane(2, { lk: 1, ld: true, a: false })], []), false);
  assert.equal(underFire(1, [], [{ id: 9, tg: 1, p: [0, 0, 0], v: [0, 0, 0] }]), true);
});

function session() {
  const s: TeamState = { mode: "team", you: 1, round: null, players: new Map(), planes: new Map(), missiles: [] };
  const sent: TeamChoice[] = [];
  const f = new TeamFlow((c) => (sent.push(c), true), s);
  const roster = (team: PlayerJSON["team"], now: number) => {
    s.players = new Map([[1, pl(1, team)]]);
    return f.apply({ t: "players", list: [...s.players.values()] }, [], now);
  };
  const snap = (alive: boolean, evs: EventJSON[], now: number) => {
    s.planes = alive ? new Map([[1, { id: 1, a: true } as PlaneJSON]]) : new Map();
    f.apply({ t: "snap" } as Snap, evs, now);
  };
  f.apply({ t: "welcome" } as Welcome, [], 0);
  return { s, f, sent, roster, snap };
}

test("team flow: free choice before flying, switch opens the pick and starts the cooldown", () => {
  const { s, f, sent, roster, snap } = session();
  assert.equal(roster("nato", 0), false);
  assert.ok(f.pickView(0), "selector while not flown yet");
  s.mode = "ffa";
  assert.equal(f.pickView(0), null, "no selector in FFA");
  s.mode = "team";
  f.choose("soviet", 0);
  assert.equal(roster("soviet", 10), false, "a pick-screen choice is not a switch");
  snap(true, [], 20);
  assert.equal(f.pickView(20), null, "no selector once flown");
  f.choose("nato", 1000);
  assert.equal(roster("nato", 1000), true, "switched: open the pick screen");
  assert.equal(switchBlock(f.switchView(11000)), "Takım değiştirmek için 20 sn bekle");
  assert.equal(switchBlock(f.switchView(31000)), null);
  assert.deepEqual(sent, ["soviet", "nato"]);
});

test("team flow: repeats and bursts are not sent (the pick bucket kicks)", () => {
  const { f, sent, roster } = session();
  roster("nato", 0);
  f.choose("auto", 0);    // already the choice
  f.choose("soviet", 0);
  f.choose("nato", 100);  // inside the gap
  f.choose("soviet", 600); // same as the pending choice
  f.choose("auto", 700);
  assert.deepEqual(sent, ["soviet", "auto"]);
});

test("team flow: a hit on me closes the switch for 10 s", () => {
  const { f, roster, snap } = session();
  roster("nato", 0);
  snap(true, [{ k: "hit", tick: 1, a: 1, b: 2 }], 5000);
  assert.equal(switchBlock(f.switchView(14000)), "Hasar aldıktan sonra 10 sn bekle");
  assert.equal(switchBlock(f.switchView(15000)), null);
  snap(true, [{ k: "hit", tick: 2, a: 3, b: 1 }], 20000); // my hit on someone else
  assert.equal(switchBlock(f.switchView(20500)), null);
});

test("team flow: a refusal shows its note and keeps the confirmed choice", () => {
  const { f, roster } = session();
  roster("nato", 0);
  f.choose("soviet", 0);
  f.apply({ t: "notice", msg: "Takımlar dengesiz olur" }, [], 100);
  const v = f.pickView(200);
  assert.equal(v?.choice, "auto");
  assert.equal(v?.note, "Takımlar dengesiz olur");
  assert.equal(f.pickView(5000)?.note, "", "the note fades");
});

test("room list: per-team humans for team modes", () => {
  const ok = { code: "K7QX", mode: "team", map: "ada", wx: "acik", humans: 3, seats: 4, phase: "playing", left: 300 };
  const [a, b, c] = parseRooms({ rooms: [{ ...ok, teams: [1, 2] }, { ...ok, teams: [1, "x"] }, { ...ok, mode: "ffa" }] });
  assert.deepEqual(a.teams, [1, 2]);
  assert.equal(b.teams, undefined);
  assert.equal(teamsText(c), "");
  assert.equal(roomLabel(a), "3/4 · Takımlı · NATO 1 – 2 SOVYET · Ada · Açık");
});
