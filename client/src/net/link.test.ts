import { test } from "node:test";
import assert from "node:assert/strict";
import { LinkMonitor, PING_MS, PING_TIMEOUT_MS, UNSTABLE_MS } from "./link.ts";

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
  l.pong(100, 130);
  l.ping(100 + PING_MS, send); // a second after the ping, but not after its pong
  l.ping(130 + PING_MS, send);
  assert.deepEqual(sent, [100, 130 + PING_MS], "the next one a second after the pong");
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
  assert.equal(l.view(3100).rttMs, 40, "answered after 1.1 s with the downlink flowing: an uplink stall, not a sample");
});

test("one ping in flight at most: a 10 s stall sends one, a 30 s one two (the server kicks over 4 at once)", () => {
  for (const [stallMs, most] of [[10000, 1], [30000, 2]]) {
    const l = new LinkMonitor(0);
    let sent = 0;
    for (let t = 0; t <= stallMs; t += 100) l.ping(t, () => { sent++; return true; }); // no pong comes back
    assert.equal(sent, most, `${stallMs} ms stall`);
  }
  assert.ok(30000 / PING_TIMEOUT_MS < 2, "two link pings plus two keepalives stay within the burst of 4");
});

test("after a stall the RTT reads the link again within about a second", () => {
  const l = new LinkMonitor(0);
  let t = 0;
  const pending: number[] = [];
  const step = (dark: boolean) => {
    t += 50;
    if (!dark) {
      l.received(t);
      while (pending.length && pending[0] + 100 <= t) l.pong(pending.shift()!, t); // 100 ms round trip
    }
    l.ping(t, (ts) => { pending.push(ts); return true; });
  };
  for (let i = 0; i < 100; i++) step(false); // 5 s steady
  assert.equal(l.view(t).rttMs, 100);
  for (let i = 0; i < 60; i++) step(true); // 3 s dark: the ping in flight is answered late
  assert.equal(l.view(t).quality, "lost");
  const back = t;
  // The first pong after the stall carries 3 s of waiting: discarded.
  while (t < back + 1300) step(false);
  const v = l.view(t);
  assert.equal(v.rttMs, 100, JSON.stringify(v));
  assert.equal(v.quality, "good");
});

test("RTT falls faster than it rises", () => {
  const l = new LinkMonitor(0);
  l.pong(0, 100);
  l.pong(1000, 1600); // a slow sample (under a second: not a stall)
  assert.equal(l.view(1600).rttMs, Math.round(100 + 500 * 0.3));
  l.pong(2000, 2100);
  assert.equal(l.view(2100).rttMs, Math.round(250 + (100 - 250) * 0.6));
});

/**
 * The server's ping guard (roomkit server/guard.go: 2/s, burst 4, kick when
 * empty) against LinkMonitor on the 100 ms UI timer plus the socket's 15 s
 * keepalive, through an uplink-only blackhole of T ms (the downlink keeps
 * flowing). Returns whether the server would kick.
 */
function kicked(T: number, phase: number, rtt: number): boolean {
  const l = new LinkMonitor(0);
  const from = 60000, to = from + T, end = to + 10000;
  const up: { at: number; ts: number }[] = [];
  const down: { at: number; ts: number }[] = [];
  let tokens = 4, refilled = 0;
  const send = (now: number, ts: number) => {
    up.push({ at: (now >= from && now < to ? to : now) + rtt / 2, ts });
    return true;
  };
  for (let now = 0; now <= end; now += 5) {
    up.sort((a, b) => a.at - b.at);
    while (up.length && up[0].at <= now) {
      const m = up.shift()!;
      tokens = Math.min(4, tokens + ((now - refilled) / 1000) * 2);
      refilled = now;
      if (tokens < 1) return true;
      tokens--;
      down.push({ at: now + rtt / 2, ts: m.ts });
    }
    while (down.length && down[0].at <= now) {
      const m = down.shift()!;
      l.received(now);
      l.pong(m.ts, now);
    }
    if (now % 35 === 0) l.received(now); // snapshots keep coming
    if (now >= phase && (now - phase) % 15000 === 0) send(now, now); // keepalive
    if (now % 100 === 0) l.ping(now, (ts) => send(now, ts));
  }
  return false;
}

test("no uplink stall the server survives (under its 30 s idle close) ends in a ping kick", () => {
  for (const rtt of [40, 100, 200, 400, 600]) {
    const bad: string[] = [];
    for (let T = 1000; T < 30000; T += 500) for (let phase = 0; phase < 15000; phase += 1000) if (kicked(T, phase, rtt)) bad.push(`${T}/${phase}`);
    assert.deepEqual(bad, [], `rtt ${rtt} ms: stall/keepalive phase that kicked`);
  }
});

test("after an uplink-only stall the RTT reads the link again within about a second", () => {
  const l = new LinkMonitor(0);
  let t = 0;
  const up: number[] = [];
  const down: { at: number; ts: number }[] = [];
  const step = (dark: boolean) => {
    t += 50;
    l.received(t); // the downlink flows throughout
    if (!dark) for (const ts of up.splice(0)) down.push({ at: t + 50, ts });
    while (down.length && down[0].at <= t) l.pong(down.shift()!.ts, t);
    l.ping(t, (ts) => { up.push(ts); return true; });
  };
  for (let i = 0; i < 100; i++) step(false);
  assert.equal(l.view(t).rttMs, 100);
  for (let i = 0; i < 200; i++) step(true); // 10 s: the ping in flight waits
  assert.ok(l.view(t).rttMs! > 5000, "the ping out shows the stall while it lasts");
  const back = t;
  while (t < back + 1300) step(false);
  const v = l.view(t);
  assert.equal(v.rttMs, 100, JSON.stringify(v));
  assert.equal(v.quality, "good");
});

test("a link that really is slow is believed on the second slow ping", () => {
  const l = new LinkMonitor(0);
  const flow = (from: number, to: number) => { for (let t = from; t <= to; t += 50) l.received(t); }; // snapshots keep coming
  l.ping(0, () => true);
  flow(0, 100);
  l.pong(0, 100);
  l.ping(1100, () => true);
  flow(1100, 2600);
  l.pong(1100, 2600); // 1.5 s: doubted
  assert.equal(l.view(2600).rttMs, 100);
  l.ping(3600, () => true);
  flow(3600, 5100);
  l.pong(3600, 5100); // again: believed
  assert.equal(l.view(5100).rttMs, Math.round(100 + 1400 * 0.3));
});
