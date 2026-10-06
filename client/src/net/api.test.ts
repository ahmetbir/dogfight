import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchLeaderboard, fetchMe, getJSON, STATS_OFF, parseLeaderboard, parseMe, parseRooms } from "./api.ts";

test("parseRooms keeps only well-formed rows", () => {
  const ok = { code: "K7QX", mode: "team", map: "ada", wx: "acik", humans: 1, seats: 4, phase: "playing", left: 300 };
  const rows = parseRooms({ rooms: [ok, { ...ok, code: "<b>" }, { ...ok, map: "mars" }, { ...ok, humans: "2" }, null, ...Array(60).fill(ok)] });
  assert.equal(rows.length, 50);
  assert.deepEqual(rows[0], ok);
  assert.deepEqual(parseRooms("nope"), []);
});

test("getJSON returns null on HTTP errors, bad JSON and timeouts", async () => {
  const res = (status: number, body: string) => async () => new Response(body, { status });
  assert.deepEqual(await getJSON("/x", {}, 1000, res(200, '{"a":1}') as typeof fetch), { a: 1 });
  assert.equal(await getJSON("/x", {}, 1000, res(503, "{}") as typeof fetch), null);
  assert.equal(await getJSON("/x", {}, 1000, res(200, "{oops") as typeof fetch), null);
  const hang = ((_u: string, init?: RequestInit) => new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("abort"))))) as typeof fetch;
  assert.equal(await getJSON("/x", {}, 20, hang), null);
});

test("leaderboard and me parsing", () => {
  const lb = parseLeaderboard({ period: "week", week: "2026-W41", top: [{ name: "A", kills: 3, deaths: 1, wins: 1, matches: 2 }, { name: 5 }] });
  assert.deepEqual(lb, { week: "2026-W41", top: [{ name: "A", kills: 3, deaths: 1, wins: 1, matches: 2 }] });
  assert.equal(parseMe({ name: "A" }), null);
  const me = parseMe({ name: "A", kills: 1, deaths: 0, crashes: 0, wins: 0, matches: 1, fired: 2, hits: 1, flight: 3600, favorite: "su27", weekKills: 1, week: "2026-W41" });
  assert.equal(me?.favorite, "su27");
  assert.equal(me?.botKills, 0); // older servers omit it
  assert.equal(parseMe({ ...me, botKills: 4 })?.botKills, 4);
  assert.equal(parseLeaderboard({ top: "x" }), null);
});

test("fetchMe sends the token only in the X-Pilot-Token header", async () => {
  const seen: { url: string; headers: unknown }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    seen.push({ url, headers: init?.headers });
    return new Response('{"pilot":null}', { status: 200 });
  }) as typeof fetch;
  assert.equal(await fetchMe("AAAAAAAAAAAAAAAAAAAAAA", f), null, "no stats yet");
  assert.deepEqual(seen, [{ url: "/api/me", headers: { "X-Pilot-Token": "AAAAAAAAAAAAAAAAAAAAAA" } }]);
});

test("stats endpoints tell 'stats off' from other failures", async () => {
  const res = (status: number, body: string) => (async () => new Response(body, { status })) as typeof fetch;
  assert.equal(await fetchLeaderboard("week", res(503, '{"error":"istatistik kapalı"}')), STATS_OFF);
  assert.equal(await fetchMe("AAAAAAAAAAAAAAAAAAAAAA", res(503, '{"error":"istatistik kapalı"}')), STATS_OFF);
  assert.equal(await fetchLeaderboard("week", res(503, "<html>bad gateway</html>")), null, "a proxy 503 is a plain failure");
  assert.equal(await fetchLeaderboard("week", res(500, '{"error":"istatistik kapalı"}')), null);
  assert.deepEqual(await fetchLeaderboard("all", res(200, '{"week":"","top":[]}')), { week: "", top: [] });
});

test("fetchMe reads the card from {pilot}", async () => {
  const card = { name: "A", kills: 1, deaths: 0, crashes: 0, wins: 0, matches: 1, fired: 2, hits: 1, flight: 3600, favorite: "su27", weekKills: 1 };
  const res = (body: string) => (async () => new Response(body, { status: 200 })) as typeof fetch;
  assert.equal((await fetchMe("AAAAAAAAAAAAAAAAAAAAAA", res(JSON.stringify({ pilot: card }))) as { name: string } | null)?.name, "A");
  assert.equal(await fetchMe("AAAAAAAAAAAAAAAAAAAAAA", res(JSON.stringify(card))), null, "a bare card is not the wire shape");
});
