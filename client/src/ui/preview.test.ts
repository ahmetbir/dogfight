import { test } from "node:test";
import assert from "node:assert/strict";
import { PreviewLife, type PreviewStage } from "./preview.ts";

/** A fake canvas whose context dies with the stage on it, as three's forceContextLoss does. */
type Canvas = { id: number; lost: boolean };

function rig(failOn = new Set<number>()) {
  let n = 0;
  const log: string[] = [];
  const stages: { canvas: Canvas; disposed: boolean }[] = [];
  let mounted: Canvas | null = null;
  const drawn: string[] = [];
  const life = new PreviewLife<Canvas>({
    canvas: () => ({ id: ++n, lost: false }),
    mount: (c) => { mounted = c; },
    stage: (c): PreviewStage => {
      if (c.lost) throw new TypeError("lost context"); // what three throws on a reused canvas
      if (failOn.has(c.id)) throw new Error("no WebGL");
      const s = { canvas: c, disposed: false };
      stages.push(s);
      return {
        show: (kind, team) => log.push(`show ${kind} ${team} on ${c.id}`),
        thumbnails: (kinds, team, done) => { log.push(`thumbs ${team} ${kinds.join(",")} on ${c.id}`); for (const k of kinds) done(k); },
        dispose: () => { s.disposed = true; c.lost = true; },
      };
    },
    drawn: (k) => drawn.push(k),
  });
  return { life, log, stages, drawn, mounted: () => mounted };
}

test("open, close and reopen: each open draws on a fresh canvas, each close frees its stage", () => {
  const r = rig();
  r.life.start("nato", ["f16", "f15"], "f16");
  assert.ok(r.life.open);
  assert.equal(r.mounted()?.id, 1);
  r.life.stop();
  assert.equal(r.mounted(), null);
  assert.ok(r.stages[0]!.disposed && r.stages[0]!.canvas.lost);
  r.life.start("nato", ["f16", "f15"], "f22");
  assert.ok(r.life.open, "the second open works: a new canvas, not the lost one");
  assert.equal(r.mounted()?.id, 2);
  r.life.stop();
  r.life.start("nato", ["f16", "f15"], "f16");
  assert.equal(r.stages.length, 3);
  assert.deepEqual(r.stages.map((s) => s.disposed), [true, true, false]);
  // every open asks for its side's thumbnails and its selection again
  assert.deepEqual(r.log.filter((l) => l.startsWith("thumbs")), ["thumbs nato f16,f15 on 1", "thumbs nato f16,f15 on 2", "thumbs nato f16,f15 on 3"]);
  assert.deepEqual(r.log.filter((l) => l.startsWith("show")), ["show f16 nato on 1", "show f22 nato on 2", "show f16 nato on 3"]);
});

test("switching sides while open asks for the new side's thumbnails; closed, the next open does", () => {
  const r = rig();
  r.life.start("nato", ["f16", "f15"], "f16");
  r.life.cards("nato", ["f16", "f15"]);           // same side: nothing new
  r.life.cards("soviet", ["mig29", "su27"]);      // team switch while open
  r.life.select("mig29", "soviet");
  r.life.select("mig29", "soviet");               // no repeat
  r.life.stop();
  r.life.cards("nato", ["f16", "f15"]);           // switched back while closed: nothing to draw on
  r.life.select("f15", "nato");
  r.life.start("nato", ["f16", "f15"], "f15");
  assert.deepEqual(r.log, [
    "thumbs nato f16,f15 on 1", "show f16 nato on 1",
    "thumbs soviet mig29,su27 on 1", "show mig29 soviet on 1",
    "thumbs nato f16,f15 on 2", "show f15 nato on 2",
  ]);
  assert.deepEqual(r.drawn, ["f16", "f15", "mig29", "su27", "f16", "f15"]);
});

test("a stage that cannot start leaves the cards working and the next open tries again", () => {
  const r = rig(new Set([1]));
  r.life.start("nato", ["f16"], "f16");
  assert.ok(!r.life.open);
  assert.equal(r.mounted(), null, "no dead canvas left in the page");
  r.life.select("f16", "nato");                   // harmless while closed
  r.life.stop();                                  // harmless too
  r.life.start("nato", ["f16"], "f16");
  assert.ok(r.life.open);
  assert.equal(r.mounted()?.id, 2);
});
