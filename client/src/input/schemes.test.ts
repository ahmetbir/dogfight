import { test } from "node:test";
import assert from "node:assert/strict";
import { AIM_RAD_PER_PX, DEFAULT_SETTINGS, LEVER_DEAD, loadSettings, makeScheme, planeView, saveSettings, type Controls } from "./schemes.ts";
import { qAxisAngle, qIdentity, v3 } from "../sim/vec.ts";

function controls(keys: string[] = [], buttons = 0) {
  let dx = 0, dy = 0;
  const presses = new Set<string>();
  const c: Controls & { move(x: number, y: number): void; press(code: string): void } = {
    keys: new Set(keys), buttons,
    consumeMouse: () => { const m = { dx, dy }; dx = dy = 0; return m; },
    takePress: (code) => presses.delete(code),
    move: (x, y) => { dx += x; dy += y; },
    press: (code) => { presses.add(code); },
  };
  return c;
}
const plane = { rot: qIdentity(), th: 0.5 };
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

test("mouse aim starts on the nose and turns with the mouse", () => {
  const s = makeScheme(DEFAULT_SETTINGS);
  const c = controls();
  let f = s.frame(c, plane, 1 / 60);
  assert.ok(near(f.aimDir!.x, 0) && near(f.aimDir!.z, -1));
  c.move(100, 0); // right
  f = s.frame(c, plane, 1 / 60);
  const a = 100 * AIM_RAD_PER_PX;
  assert.ok(near(f.aimDir!.x, Math.sin(a)) && near(f.aimDir!.z, -Math.cos(a)));
  assert.ok(f.stick.r > 0, "rolls right toward the aim");
  c.move(0, -100); // up
  f = s.frame(c, plane, 1 / 60);
  assert.ok(f.aimDir!.y > 0.2);
});

/** Heading of a direction (rad, + left of -Z), as the scheme measures it. */
const headingOf = (d: { x: number; z: number }) => Math.atan2(-d.x, -d.z);
/** Whether two headings agree, wrap-around included. */
const sameHeading = (a: number, b: number) => near(Math.atan2(Math.sin(a - b), Math.cos(a - b)), 0);

test("mouse lever: the aim keeps its offset from the nose, so the turn goes on", () => {
  const s = makeScheme({ ...DEFAULT_SETTINGS, lever: true });
  const c = controls();
  s.frame(c, plane, 1 / 60);
  c.move(-100, 0); // left
  const off = 100 * AIM_RAD_PER_PX;
  let f = s.frame(c, plane, 1 / 60);
  assert.ok(near(headingOf(f.aimDir!), off), "aim off the nose by the mouse move");
  assert.ok(f.stick.r < 0, "rolls left toward the aim");
  for (const turned of [0.5, 1.5, 3]) { // the nose came round; the mouse did not move
    f = s.frame(c, { rot: qAxisAngle(v3(0, 1, 0), turned), th: 0.5 }, 1 / 60);
    assert.ok(sameHeading(headingOf(f.aimDir!), turned + off), `still ${off} rad ahead after turning ${turned}`);
  }
  c.move(100, 0); // back to centre: the nose is held
  f = s.frame(c, { rot: qAxisAngle(v3(0, 1, 0), 3), th: 0.5 }, 1 / 60);
  assert.ok(sameHeading(headingOf(f.aimDir!), 3));
  const aim = makeScheme(DEFAULT_SETTINGS); // aim mode: the aim stays put in the world
  aim.frame(c, plane, 1 / 60);
  c.move(-100, 0);
  aim.frame(c, plane, 1 / 60);
  assert.ok(near(headingOf(aim.frame(c, { rot: qAxisAngle(v3(0, 1, 0), off), th: 0.5 }, 1 / 60).aimDir!), off));
});

test("mouse lever: a tiny offset holds the nose, the offset tops out at 60°", () => {
  const s = makeScheme({ ...DEFAULT_SETTINGS, lever: true });
  const c = controls();
  s.frame(c, plane, 1 / 60);
  c.move(-(LEVER_DEAD / AIM_RAD_PER_PX) * 0.5, 0);
  assert.ok(near(headingOf(s.frame(c, plane, 1 / 60).aimDir!), 0), "inside the dead zone");
  c.move(-100000, 0);
  s.frame(c, plane, 1 / 60);
  c.move(10, 0); // pulling back answers at once: no wound-up offset to unwind
  assert.ok(headingOf(s.frame(c, plane, 1 / 60).aimDir!) < Math.PI / 3);
});

test("aim pitch clamps at 85° and invertY flips it", () => {
  const s = makeScheme(DEFAULT_SETTINGS);
  const c = controls();
  const climbing = { rot: qAxisAngle(v3(1, 0, 0), Math.PI / 3), th: 0.5 }; // nose 60° up
  s.frame(c, climbing, 1 / 60);
  c.move(0, -100000);
  const f = s.frame(c, climbing, 1 / 60);
  assert.ok(near(Math.asin(f.aimDir!.y), (85 * Math.PI) / 180));
  const inv = makeScheme({ ...DEFAULT_SETTINGS, invertY: true });
  inv.frame(c, plane, 1 / 60);
  c.move(0, -100);
  assert.ok(inv.frame(c, plane, 1 / 60).aimDir!.y < 0);
});

test("mouse scheme: W/S ramp throttle at 0.5/s, A/D override roll, buttons", () => {
  const s = makeScheme(DEFAULT_SETTINGS);
  const c = controls(["KeyW", "KeyA", "ShiftLeft", "KeyC"], 1);
  let f = s.frame(c, plane, 1 / 60);
  for (let i = 0; i < 59; i++) f = s.frame(c, plane, 1 / 60);
  assert.ok(near(f.stick.th, 1, 1e-9), `${f.stick.th}`);
  assert.equal(f.stick.r, -1);
  assert.equal(f.stick.ab, true);
  assert.equal(f.fire, true);
  assert.equal(f.lookBack, true);
  assert.equal(f.missile, false);
  c.press("Mouse2");
  assert.equal(s.frame(c, plane, 1 / 60).missile, true, "press edge");
  assert.equal(s.frame(c, plane, 1 / 60).missile, false, "one missile per click");
  c.press("KeyE");
  assert.equal(s.frame(c, plane, 1 / 60).missile, true, "E fires a missile too");
  c.press("Mouse2"); c.press("KeyE");
  assert.equal(s.frame(c, plane, 1 / 60).missile, true, "both in one frame");
  assert.equal(s.frame(c, plane, 1 / 60).missile, false, "both consumed, nothing left over");
});

test("mouse aim stays within 60° of the nose without winding up", () => {
  const s = makeScheme(DEFAULT_SETTINGS);
  const c = controls();
  s.frame(c, plane, 1 / 60);
  c.move(800, 0); // 2 rad to the right
  let f = s.frame(c, plane, 1 / 60);
  const off = (d: { z: number }) => Math.acos(-d.z); // angle from the nose (0,0,-1)
  assert.ok(near(off(f.aimDir!), Math.PI / 3, 1e-9), `${off(f.aimDir!)}`);
  assert.ok(f.aimDir!.x > 0, "still to the right");
  c.move(-100, 0); // back toward the nose: moves at once, no wind-up
  f = s.frame(c, plane, 1 / 60);
  assert.ok(near(off(f.aimDir!), Math.PI / 3 - 100 * AIM_RAD_PER_PX, 1e-9), `${off(f.aimDir!)}`);
});

test("a tap between ticks still fires once", () => {
  const s = makeScheme(DEFAULT_SETTINGS);
  const c = controls();
  c.press("Mouse0");
  assert.equal(s.frame(c, plane, 1 / 60).fire, true);
  assert.equal(s.frame(c, plane, 1 / 60).fire, false);
});

test("reset re-seeds the aim from the plane", () => {
  const s = makeScheme(DEFAULT_SETTINGS);
  const c = controls();
  s.frame(c, plane, 1 / 60);
  c.move(500, 0);
  s.frame(c, plane, 1 / 60);
  s.reset();
  const east = { rot: qAxisAngle(v3(0, 1, 0), -Math.PI / 2), th: 1 }; // nose toward +X
  const f = s.frame(c, east, 1 / 60);
  assert.ok(near(f.aimDir!.x, 1, 1e-9), `${JSON.stringify(f.aimDir)}`);
});

test("keyboard scheme: W nose down, invertY, R/F throttle, X AB, Space/V/G", () => {
  const s = makeScheme({ ...DEFAULT_SETTINGS, scheme: "keyboard" });
  const c = controls(["KeyW", "KeyD", "KeyE", "KeyR", "KeyX", "Space", "KeyG"]);
  const f = s.frame(c, plane, 0.5);
  assert.deepEqual(f.stick, { p: -1, r: 1, y: 1, th: 0.75, ab: true, g: false, br: false });
  assert.equal(f.fire, true);
  assert.equal(f.flare, true);
  assert.equal(f.aimDir, null);
  c.press("KeyV");
  assert.equal(s.frame(c, plane, 0).missile, true);
  const inv = makeScheme({ ...DEFAULT_SETTINGS, scheme: "keyboard", invertY: true });
  assert.equal(inv.frame(controls(["KeyW"]), plane, 0).stick.p, 1);
  assert.equal(s.frame(controls(["KeyF"]), plane, 1).stick.th, 0.25);
});

test("settings round-trip through storage and survive garbage", () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  assert.deepEqual(loadSettings(store), DEFAULT_SETTINGS);
  const custom = { scheme: "keyboard", sensitivity: 2, invertY: true, volume: 0.3, gfx: false, missileCam: false, perf: true, tilt: true, lever: true } as const;
  saveSettings(custom, store);
  assert.deepEqual(loadSettings(store), custom);
  mem.set("dogfight.settings", JSON.stringify({ scheme: "mouse" })); // saved before G effects existed
  assert.equal(loadSettings(store).gfx, true, "G effects default on");
  mem.set("dogfight.settings", "{nope");
  assert.deepEqual(loadSettings(store), DEFAULT_SETTINGS);
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  assert.deepEqual(loadSettings(broken), DEFAULT_SETTINGS);
  saveSettings(DEFAULT_SETTINGS, broken);
});

test("defaults follow the pointer type", () => {
  const empty = { getItem: () => null };
  assert.deepEqual(
    [loadSettings(empty, true).scheme, loadSettings(empty, true).missileCam, loadSettings(empty, true).perf],
    ["touch", false, true]);
  assert.deepEqual(
    [loadSettings(empty, false).scheme, loadSettings(empty, false).missileCam, loadSettings(empty, false).perf],
    ["mouse", true, false]);
  const saved = { getItem: () => JSON.stringify({ scheme: "touch", missileCam: "yes", tilt: true }) };
  const s = loadSettings(saved, false);
  assert.equal(s.scheme, "touch");
  assert.equal(s.missileCam, true, "invalid value falls back to the default");
  assert.equal(s.tilt, true);
});

test("the touch scheme without a touch state holds the plane's throttle and fires nothing", () => {
  const s = makeScheme({ ...DEFAULT_SETTINGS, scheme: "touch" });
  assert.equal(s.kind, "touch", "kind matches the setting, so the loop does not rebuild it every tick");
  const f = s.frame(controls(), { rot: qIdentity(), th: 0.5 }, 1 / 60);
  assert.deepEqual([f.aimDir, f.stick.th, f.fire, f.missile], [null, 0.5, false, false]);
});

test("gear toggles with L from the plane's state, brake holds with B, H drops a bomb", () => {
  for (const kind of ["mouse", "keyboard"] as const) {
    const sc = makeScheme({ ...DEFAULT_SETTINGS, scheme: kind });
    const st = controls();
    const plane = { rot: qIdentity(), th: 0, gear: true };
    assert.equal(sc.frame(st, plane, 1 / 60).stick.g, true, `${kind}: seeded from the plane`);
    st.press("KeyL");
    assert.equal(sc.frame(st, plane, 1 / 60).stick.g, false, `${kind}: L raises`);
    st.keys.add("KeyB");
    st.press("KeyH");
    const f = sc.frame(st, plane, 1 / 60);
    assert.equal(f.stick.br, true);
    assert.equal(f.bomb, true);
    assert.equal(sc.frame(st, plane, 1 / 60).bomb, false, "bomb is one-shot");
    st.keys.delete("KeyB");
    assert.equal(sc.frame(st, plane, 1 / 60).stick.br, false, `${kind}: brake released`);
    sc.reset();
    assert.equal(sc.frame(st, { ...plane, gear: false }, 1 / 60).stick.g, false, "reset re-seeds");
  }
});

test("middle click drops a bomb in the mouse scheme only", () => {
  const mouse = makeScheme(DEFAULT_SETTINGS);
  const keyboard = makeScheme({ ...DEFAULT_SETTINGS, scheme: "keyboard" });
  const plane = { rot: qIdentity(), th: 0, gear: false };
  const a = controls();
  a.press("Mouse1");
  assert.equal(mouse.frame(a, plane, 1 / 60).bomb, true);
  const b = controls();
  b.press("Mouse1");
  assert.equal(keyboard.frame(b, plane, 1 / 60).bomb, false);
});

test("a forced gear retract clears 'wanted', so the gear does not redeploy on its own", () => {
  for (const kind of ["mouse", "keyboard"] as const) {
    const sc = makeScheme({ ...DEFAULT_SETTINGS, scheme: kind });
    const st = controls();
    const down = { rot: qIdentity(), th: 1, gear: true };
    const up = { ...down, gear: false };
    assert.equal(sc.frame(st, down, 1 / 60).stick.g, true);
    assert.equal(sc.frame(st, up, 1 / 60).stick.g, false, `${kind}: server raised it while wanted down`);
    assert.equal(sc.frame(st, up, 1 / 60).stick.g, false, `${kind}: stays up when slow again`);
    st.press("KeyL");
    assert.equal(sc.frame(st, up, 1 / 60).stick.g, true, `${kind}: L asks for it again`);
    assert.equal(sc.frame(st, up, 1 / 60).stick.g, true, `${kind}: wanted down while too fast to deploy`);
  }
});

test("raising and re-lowering within a tick is not a forced retract", () => {
  const sc = makeScheme(DEFAULT_SETTINGS);
  const st = controls();
  const down = { rot: qIdentity(), th: 0, gear: true };
  sc.frame(st, down, 1 / 60);
  st.press("KeyL");
  assert.equal(sc.frame(st, down, 1 / 60).stick.g, false); // sent: up
  st.press("KeyL");
  assert.equal(sc.frame(st, { ...down, gear: false }, 1 / 60).stick.g, true, "the gear went up because I asked");
});

test("a new life on the ground starts at idle throttle in every scheme; air lives keep the plane's", () => {
  for (const scheme of ["mouse", "keyboard"] as const) {
    const s = makeScheme({ ...DEFAULT_SETTINGS, scheme });
    const c = controls();
    assert.equal(s.frame(c, { rot: qIdentity(), th: 1 }, 1 / 60).stick.th, 1, `${scheme}: seeded from the plane`);
    s.reset(); // spawned parked in a hangar; the plane still shows the last life's throttle
    assert.equal(s.frame(c, { rot: qIdentity(), th: 1, gear: true, ground: true }, 1 / 60).stick.th, 0, `${scheme}: idle on the ground`);
    s.reset(); // spawned in the air
    assert.equal(s.frame(c, { rot: qIdentity(), th: 0.8 }, 1 / 60).stick.th, 0.8, `${scheme}: air spawn keeps throttle`);
  }
});

test("mouse aim damps the plane's roll rate: the loop's plane view carries w", () => {
  const fs = { pos: v3(0, 1000, 0), rot: qIdentity(), vel: v3(0, 0, -200), th: 0.5, w: v3(0, 0, -2) }; // rolling right
  assert.deepEqual(planeView(fs).w, fs.w);
  const roll = (w?: { x: number; y: number; z: number }) => {
    const s = makeScheme(DEFAULT_SETTINGS);
    const c = controls();
    s.frame(c, planeView({ ...fs, w }), 1 / 60);
    c.move(40, -150); // aim up and a little right: a small bank, roll not saturated
    return s.frame(c, planeView({ ...fs, w }), 1 / 60).stick.r;
  };
  assert.ok(roll(fs.w) < roll(undefined) - 0.1, `damped ${roll(fs.w)} vs ${roll(undefined)}`);
});
