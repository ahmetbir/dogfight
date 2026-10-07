import { test } from "node:test";
import assert from "node:assert/strict";
import { LinkMonitor, PING_MS, UNSTABLE_MS } from "./link.ts";

/** A monitor fed 30 Hz snapshots from t=0 to `until` ms (game tick = 2 per snapshot). */
function flowing(until: number, rttMs?: number): LinkMonitor {
  const l = new LinkMonitor(0);
  for (let t = 0, tick = 0; t <= until; t += 1000 / 30, tick += 2) {
    l.received(t);
    l.snap(tick);
  }
  if (rttMs !== undefined) l.pong(until - rttMs, until);
  return l;
}

test("a clean link is good, RTT unknown until the first pong", () => {
  const l = flowing(2000);
  assert.deepEqual(l.view(2010), { quality: "good", rttMs: null, lossPct: 0, unstable: false });
  l.pong(1960, 2010);
  assert.equal(l.view(2010).rttMs, 50);
});

test("RTT grades the link: fair from 120 ms, poor from 250 ms", () => {
  assert.equal(flowing(2000, 119).view(2000).quality, "good");
  assert.equal(flowing(2000, 120).view(2000).quality, "fair");
  assert.equal(flowing(2000, 249).view(2000).quality, "fair");
  assert.equal(flowing(2000, 250).view(2000).quality, "poor");
});

test("RTT is smoothed: one slow pong does not flip a good link to poor", () => {
  const l = flowing(2000, 40);
  l.pong(2000 - 400, 2000);
  const v = l.view(2000);
  assert.equal(v.rttMs, Math.round(40 + (400 - 40) * 0.3));
  assert.equal(v.quality, "fair");
});

test("silence grades the link and shows the banner after 1 s", () => {
  const l = new LinkMonitor(0);
  const last = 1000;
  l.received(last);
  assert.equal(l.view(last + 199).quality, "good");
  assert.equal(l.view(last + 200).quality, "fair");
  assert.equal(l.view(last + 400).quality, "poor");
  assert.equal(l.view(last + UNSTABLE_MS - 1).unstable, false);
  const v = l.view(last + UNSTABLE_MS);
  assert.equal(v.quality, "lost");
  assert.equal(v.unstable, true);
  assert.equal(l.silentMs(last + 1234), 1234);
});

test("the banner clears 600 ms after traffic resumes, not at the first message", () => {
  const l = new LinkMonitor(0);
  l.received(0);
  l.received(1500); // after 1.5 s of silence
  assert.equal(l.view(1500).unstable, true);
  assert.equal(l.view(1500).quality, "good");
  l.received(1530);
  assert.equal(l.view(2099).unstable, true);
  assert.equal(l.view(2100).unstable, false);
});

test("a short gap (under 1 s) never shows the banner", () => {
  const l = new LinkMonitor(0);
  l.received(0);
  l.received(900);
  assert.equal(l.view(900).unstable, false);
});

test("snapshot gaps count as loss over the last ~2 s", () => {
  const l = new LinkMonitor(0);
  let tick = 0;
  for (let i = 0; i < 60; i++) l.snap((tick += 2));
  assert.equal(l.view(0).lossPct, 0);
  l.snap((tick += 4)); // one snapshot missing: 1 of 61
  assert.equal(l.view(0).lossPct, 2);
  assert.equal(l.view(0).quality, "good", "under 2 % is noise");
  l.snap((tick += 4)); // 2 of 62
  assert.equal(l.view(0).quality, "fair");
  for (let i = 0; i < 5; i++) l.snap((tick += 4));
  assert.equal(l.view(0).quality, "poor");
  for (let i = 0; i < 60; i++) l.snap((tick += 2));
  assert.equal(l.view(0).lossPct, 0, "old gaps leave the window");
});

test("a new connection restarts the snapshot ticks (no loss from the jump)", () => {
  const l = new LinkMonitor(0);
  l.snap(5000);
  l.reset(10);
  l.snap(2);
  l.snap(4);
  assert.equal(l.view(10).lossPct, 0);
});

test("pings go out at most once per second, and only when written", () => {
  const l = new LinkMonitor(0);
  const sent: number[] = [];
  let ok = false;
  const send = (ts: number) => { if (ok) sent.push(ts); return ok; };
  l.ping(0, send); // not written (reconnecting): try again next call
  ok = true;
  l.ping(100, send);
  l.ping(100 + PING_MS - 1, send);
  l.ping(100 + PING_MS, send);
  assert.deepEqual(sent, [100, 100 + PING_MS]);
});

test("a bogus pong (from the future, not finite) is ignored", () => {
  const l = new LinkMonitor(0);
  l.pong(500, 100);
  l.pong(Number.NaN, 100);
  assert.equal(l.view(100).rttMs, null);
});

test("an unanswered ping raises the shown RTT: a silent link does not keep showing its last good value", () => {
  const l = flowing(2000, 40);
  l.ping(2000, () => true);
  assert.equal(l.view(2030).rttMs, 40, "younger than the RTT: no news");
  assert.equal(l.view(2900).rttMs, 900);
  l.pong(2000, 3100);
  assert.equal(l.view(3100).rttMs, Math.round(40 + (1100 - 40) * 0.3), "answered: back to the smoothed samples");
});
