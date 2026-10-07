import { test } from "node:test";
import assert from "node:assert/strict";
import { drawNextThumb, HangarModels } from "./hangar3d.ts";
import { ThumbQueue } from "./thumbqueue.ts";

type Jet = { kind: string; team: string; freed: boolean };
const fakeCanvas = () => ({ width: 0, height: 0, className: "", dataset: {} as Record<string, string> }) as unknown as HTMLCanvasElement;
const tick = () => new Promise<void>((r) => setImmediate(r));

/** Loads that finish when the test says so, in any order. */
function loads() {
  const waiting = new Map<string, (j: Jet) => void>();
  const made: Jet[] = [];
  const load = (team: string) => (kind: string) => new Promise<Jet>((r) => waiting.set(`${kind}|${team}`, r));
  const finish = (kind: string, team: string) => {
    const j = { kind, team, freed: false };
    made.push(j);
    waiting.get(`${kind}|${team}`)!(j);
  };
  return { load, finish, made };
}

// The reviewer's repro (N1): first open with the NATO jets still loading, a
// switch to the Soviet side, then the stale NATO loads finish.
test("a side switch with thumbnail jobs pending never blanks the new side's cards", async () => {
  const models = new HangarModels(fakeCanvas);
  const free = (j: Jet) => { j.freed = true; };
  const q = new ThumbQueue<Jet>(free);
  const L = loads();
  const drawn: string[] = [];
  const draw = (j: Jet, out: HTMLCanvasElement) => { out.dataset.drawn = "1"; drawn.push(`${j.kind}|${j.team}`); };
  const frames = (n: number) => { for (let i = 0; i < n; i++) drawNextThumb(q, models, draw, free); };

  const nato = ["f16", "f15", "f22"];
  for (const k of nato) models.thumb(k, "nato");              // the NATO cards hold their canvases
  q.request(nato, "nato", L.load("nato"), () => {});
  L.finish("f16", "nato");
  await tick();
  frames(1);                                                  // one NATO thumbnail drawn, two still loading
  assert.deepEqual(drawn, ["f16|nato"]);

  const soviet = ["mig29", "su27"];
  const cards = soviet.map((k) => models.thumb(k, "soviet").canvas); // the switch: new cards, NATO freed
  q.request(soviet, "soviet", L.load("soviet"), () => {});
  L.finish("f15", "nato");                                    // stale loads arrive after the switch
  L.finish("f22", "nato");
  L.finish("mig29", "soviet");
  L.finish("su27", "soviet");
  await tick();
  frames(5);

  assert.deepEqual(drawn, ["f16|nato", "mig29|soviet", "su27|soviet"]);
  for (const c of cards) assert.ok(c.width > 0 && c.dataset.drawn === "1", "the Soviet cards keep live, drawn canvases");
  assert.equal(models.held("mig29", "soviet"), cards[0]);
  assert.equal(models.held("f15", "nato"), null, "a stale side never re-takes the thumbnails");
  assert.ok(L.made.every((j) => j.freed), "every loaded jet is freed, stale or drawn");
  assert.equal(q.pending, 0);
});

test("the queue keeps request order, skips kinds already queued, and frees on cancel", async () => {
  const freed: string[] = [];
  const q = new ThumbQueue<Jet>((j) => freed.push(j.kind));
  const L = loads();
  q.request(["a", "b"], "nato", L.load("nato"), () => {});
  q.request(["b", "c"], "nato", L.load("nato"), () => {}); // b is already queued
  assert.equal(q.pending, 3);
  L.finish("b", "nato");
  await tick();
  assert.equal(q.next(), null, "a is first and still loading");
  L.finish("a", "nato");
  await tick();
  assert.equal(q.next()?.kind, "a");
  assert.equal(q.next()?.kind, "b");
  q.cancel();                                                 // c still loading
  L.finish("c", "nato");
  await tick();
  assert.deepEqual(freed, ["c"]);
  assert.equal(q.next(), null);
});

test("held thumbnails: a stale side's ask neither evicts nor answers", () => {
  const m = new HangarModels(fakeCanvas);
  const c = m.thumb("f16", "nato").canvas;
  assert.equal(m.held("f16", "soviet"), null);
  assert.ok(c.width > 0, "not zeroed by a stale ask");
  m.thumb("mig29", "soviet");                                 // the cards switch: NATO freed
  assert.equal(c.width, 0);
  assert.equal(m.held("f16", "nato"), null);
});

test("a new skin redraws only that card, and a pending job in the old skin never lands", async () => {
  const models = new HangarModels(fakeCanvas);
  const freed: string[] = [];
  const q = new ThumbQueue<Jet & { look: string }>((j) => { freed.push(`${j.kind}:${j.look}`); });
  const waiting = new Map<string, (j: Jet & { look: string }) => void>();
  const load = (kind: string, look: string) => new Promise<Jet & { look: string }>((r) => waiting.set(`${kind}:${look}`, r));
  const finish = (kind: string, look: string) => waiting.get(`${kind}:${look}`)!({ kind, team: "nato", freed: false, look });
  const drawn: string[] = [];
  const draw = (j: Jet & { look: string }, out: HTMLCanvasElement) => { out.dataset.drawn = "1"; drawn.push(`${j.kind}:${j.look}`); };
  const looks: Record<string, string> = { f16: "standard", f14: "naval" };
  for (const k of ["f16", "f14"]) models.thumb(k, "nato", looks[k]);
  q.request(["f16", "f14"], "nato", load, () => {}, (k) => looks[k]!);
  finish("f16", "standard");
  finish("f14", "naval");
  await tick();
  drawNextThumb(q, models, draw, () => {});
  drawNextThumb(q, models, draw, () => {});
  assert.deepEqual(drawn, ["f16:standard", "f14:naval"]);

  looks.f14 = "night";                                         // first paint change: still loading when the second comes
  assert.equal(models.thumb("f14", "nato", "night").drawn, false, "the card shows it needs a new picture");
  assert.equal(models.thumb("f16", "nato", "standard").drawn, true, "the other card keeps its picture");
  q.request(["f14"], "nato", load, () => {}, (k) => looks[k]!);
  looks.f14 = "blackband";
  models.thumb("f14", "nato", "blackband");
  q.request(["f14"], "nato", load, () => {}, (k) => looks[k]!);
  assert.equal(q.pending, 1, "the night job was replaced");
  finish("f14", "night");                                      // the stale load arrives: freed, never drawn
  finish("f14", "blackband");
  await tick();
  drawNextThumb(q, models, draw, () => {});
  assert.deepEqual(drawn, ["f16:standard", "f14:naval", "f14:blackband"]);
  assert.deepEqual(freed, ["f14:night"]);
});
