import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stepFlight, type FlightState, type Spec, type StickInput } from "./flight.ts";
import { windAt } from "./wind.ts";
import type { Q, V3 } from "./vec.ts";

type Vector = {
  name: string; turbo: boolean; spec: Spec; ticks: number;
  wind?: number[]; ground?: { h: number; surf: number };
  start: { pos: number[]; rot: number[]; vel: number[]; th: number; gear?: boolean; ground?: boolean; abh?: number; abl?: boolean };
  inputs: (StickInput & { from: number })[];
  checkpoints: { tick: number; pos: number[]; rot: number[]; vel: number[]; gear?: boolean; ground?: boolean; w: number[]; abh: number; abl?: boolean }[];
};

const data: { scenarios: Vector[]; wind: { base: number[]; gust: number; tick: number; w: number[] }[] } = JSON.parse(
  readFileSync(new URL("../../../testdata/vectors/flight.json", import.meta.url), "utf8"),
);

const arr3 = (a: number[]): V3 => ({ x: a[0], y: a[1], z: a[2] });
const arr4 = (a: number[]): Q => ({ w: a[0], x: a[1], y: a[2], z: a[3] }); // [w,x,y,z]

// Step i (0-based) uses the last input with from <= i.
function activeInput(inputs: Vector["inputs"], i: number): StickInput {
  let cur = inputs[0];
  for (const inp of inputs) if (inp.from <= i) cur = inp;
  return cur;
}

function assertNear(got: Record<string, number>, want: Record<string, number>, tol: number, msg: string) {
  for (const k of Object.keys(want)) {
    assert.ok(Math.abs(got[k] - want[k]) <= tol, `${msg}.${k}: got ${got[k]} want ${want[k]}`);
  }
}

assert.ok(data.scenarios.length > 0);
for (const sc of data.scenarios) {
  test(`flight vector ${sc.name}`, () => {
    // The ground step needs the lift-off speed; a missing one must fail here, not roll forever.
    assert.ok(typeof sc.spec.rotateSpeed === "number" && sc.spec.rotateSpeed > 0, `${sc.name}: spec.rotateSpeed`);
    let fs: FlightState = { pos: arr3(sc.start.pos), rot: arr4(sc.start.rot), vel: arr3(sc.start.vel), th: sc.start.th,
      gear: !!sc.start.gear, ground: !!sc.start.ground, abh: sc.start.abh ?? 0, abl: !!sc.start.abl };
    const mods = { turbo: sc.turbo, wind: sc.wind ? arr3(sc.wind) : undefined, ground: sc.ground };
    const cps = new Map(sc.checkpoints.map((c) => [c.tick, c]));
    // Checkpoint tick = state after `tick` steps.
    for (let tick = 1; tick <= sc.ticks; tick++) {
      fs = stepFlight(fs, activeInput(sc.inputs, tick - 1), sc.spec, mods);
      const cp = cps.get(tick);
      if (cp) {
        assertNear(fs.pos, arr3(cp.pos), 1e-3, `${sc.name} pos @${tick}`);
        assertNear(fs.rot, arr4(cp.rot), 1e-3, `${sc.name} rot @${tick}`);
        assertNear(fs.vel, arr3(cp.vel), 1e-3, `${sc.name} vel @${tick}`);
        assertNear(fs.w ?? arr3([0, 0, 0]), arr3(cp.w), 1e-3, `${sc.name} w @${tick}`);
        assert.ok(Math.abs((fs.abh ?? 0) - cp.abh) <= 1e-3, `${sc.name} abh @${tick}: ${fs.abh} want ${cp.abh}`);
        assert.equal(!!fs.abl, !!cp.abl, `${sc.name} abl @${tick}`);
        assert.equal(!!fs.gear, !!cp.gear, `${sc.name} gear @${tick}`);
        assert.equal(!!fs.ground, !!cp.ground, `${sc.name} ground @${tick}`);
        cps.delete(tick);
      }
    }
    assert.equal(cps.size, 0, "every checkpoint reached");
  });
}

test("wind samples", () => {
  assert.ok(data.wind.length > 0);
  for (const s of data.wind) {
    const w = windAt(arr3(s.base), s.gust, s.tick);
    assertNear(w, arr3(s.w), 1e-9, `wind ${JSON.stringify(s)}`);
  }
});
