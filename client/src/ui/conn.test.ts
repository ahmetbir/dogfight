import { test } from "node:test";
import assert from "node:assert/strict";
import { setLang } from "../i18n/index.ts";
import { connText } from "./conn.ts";

test("connection texts in both languages: quality, RTT, loss only when there is some", () => {
  try {
    setLang("en", null);
    assert.deepEqual(connText({ quality: "good", rttMs: 42, lossPct: 0, unstable: false }), { rtt: "42 ms", title: "Connection good · 42 ms" });
    assert.deepEqual(connText({ quality: "poor", rttMs: null, lossPct: 7, unstable: false }), { rtt: "— ms", title: "Connection poor · — ms · 7% loss" });
    setLang("tr", null);
    assert.deepEqual(connText({ quality: "lost", rttMs: 310, lossPct: 3, unstable: true }), { rtt: "310 ms", title: "Sunucu sessiz · 310 ms · %3 kayıp" });
  } finally {
    setLang("tr", null);
  }
});
