import { test } from "node:test";
import { matchFixture } from "./golden.ts";
import { Socket, type Conn, type Env } from "../net/socket.ts";

class RawConn implements Conn {
  readyState = 0;
  bufferedAmount = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  private readonly log: string[];
  private readonly n: number;
  constructor(log: string[], n: number) { this.log = log; this.n = n; }
  send(data: string) { this.log.push(`c${this.n} ${data}`); }
  close() { this.readyState = 3; this.log.push(`c${this.n} close`); }
}

test("socket wire transcript", () => {
  let t = 0;
  const log: string[] = [];
  const conns: RawConn[] = [];
  type T = { at: number; f: () => void; every: number; live: boolean };
  const timers: T[] = [];
  const env: Env = {
    dial: () => { const c = new RawConn(log, conns.length); conns.push(c); return c; },
    now: () => t,
    setTimeout: (f, ms) => { const h = { at: t + ms, f, every: 0, live: true }; timers.push(h); return h; },
    clearTimeout: (h) => { (h as T).live = false; },
    setInterval: (f, ms) => { const h = { at: t + ms, f, every: ms, live: true }; timers.push(h); return h; },
    clearInterval: (h) => { (h as T).live = false; },
  };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const due = timers.filter((x) => x.live && x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      t = due.at;
      if (due.every > 0) due.at += due.every; else due.live = false;
      due.f();
    }
    t = end;
  };
  const open = (c: RawConn) => { c.readyState = 1; c.onopen?.({} as Event); };
  const recv = (c: RawConn, m: object) => c.onmessage?.({ data: JSON.stringify(m) } as MessageEvent);
  // The only line later tasks may adapt (the Socket constructor moves into core).
  const s = new Socket("ws://x/ws", "Ace", { t: "create", mode: "team", size: 4, diff: "normal", seed: 9 }, {
    onMsg: (m) => log.push(`msg ${m.t}`), onStatus: (st) => log.push(`status ${st}`), onFatal: (c, m) => log.push(`fatal ${c} ${m}`),
  }, env);
  s.setToken("AAAAAAAAAAAAAAAAAAAAA1");
  open(conns[0]);
  recv(conns[0], { t: "welcome", you: 3, code: "ABCD" });
  for (let seq = 1; seq <= 6; seq++) {
    s.send({ t: "in", seq, p: 0.1 * seq, r: -0.2, y: 0, th: 1, ab: seq === 2, f: seq % 2 === 0, m: seq === 3, fl: seq === 4, g: false, br: false, bo: seq === 5 });
    advance(16);
  }
  conns[0].bufferedAmount = 64 * 1024; // backed up: inputs are held, one-shots merged
  s.send({ t: "in", seq: 7, p: 0, r: 0, y: 0, th: 1, ab: false, f: false, m: true, fl: false, g: false, br: false });
  s.send({ t: "in", seq: 8, p: 0, r: 0, y: 0, th: 1, ab: false, f: false, m: false, fl: true, g: false, br: false });
  conns[0].bufferedAmount = 0;
  recv(conns[0], { t: "pong", ts: 1 });
  s.send({ t: "pick", kind: "f16", lo: "radar" });
  s.send({ t: "pick", kind: "f15" }); // inside the gap: held, newest wins
  advance(600);
  s.send({ t: "chat", id: 2 });
  advance(15000); // a ping
  conns[0].readyState = 3;
  conns[0].onclose?.({ code: 1012 } as CloseEvent); // server update: reconnect at once, join by code
  advance(600);
  open(conns[1]);
  recv(conns[1], { t: "error", msg: "oda bulunamadı", code: "no_room" });
  matchFixture("wire", log);
});
