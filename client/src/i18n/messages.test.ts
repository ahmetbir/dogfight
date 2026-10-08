import { test } from "node:test";
import assert from "node:assert/strict";
import { ERROR_CODES, NAME_BLOCKED, NOTICE_CODES, RECOVERABLE, ROOM_GONE, type ErrorCode } from "../net/codes.ts";
import { setLang, tIn } from "./index.ts";
import { ERROR_KEY, errorText, NOTICE_KEY, noticeText } from "./messages.ts";

test("every server error and notice code has its own text in both languages", () => {
  const errors: (ErrorCode | typeof ROOM_GONE)[] = [...ERROR_CODES, ROOM_GONE];
  const keys = errors.map((c) => ERROR_KEY[c]).concat(NOTICE_CODES.map((c) => NOTICE_KEY[c]));
  assert.equal(new Set(keys).size, keys.length, "one key per code");
  for (const k of keys) {
    assert.ok(tIn("tr", k) && tIn("en", k), k);
    assert.notEqual(tIn("tr", k), tIn("en", k), `${k} is translated`);
  }
  for (const c of RECOVERABLE) assert.ok((ERROR_CODES as readonly string[]).includes(c), c);
});

test("errors render by code in the viewer's language; unknown codes fall back to the server's text", () => {
  assert.equal(errorText("full", "oda dolu"), "Oda dolu");
  assert.equal(errorText(ROOM_GONE, ""), "Sunucu güncellendi, odan kapandı. Ana sayfadan yeni bir oyuna katıl.");
  assert.equal(errorText("brand_new", "yeni bir hata"), "yeni bir hata");
  assert.equal(errorText(undefined, ""), "Bağlantı hatası");
  setLang("en", null);
  try {
    assert.equal(errorText("full", "oda dolu"), "The room is full");
    assert.equal(errorText("no_room", "oda bulunamadı"), "Room not found");
    assert.equal(errorText(undefined, ""), "Connection error");
    assert.equal(noticeText("team_cooldown", "Takım değiştirmek için 30 sn bekle", { n: 30 }), "Wait 30 s to switch teams");
    assert.equal(noticeText("team_full", "Takım dolu"), "That team is full");
    assert.equal(noticeText(undefined, "eski sunucu"), "eski sunucu");
  } finally {
    setLang("tr", null);
  }
  assert.equal(noticeText("team_hurt", "x", { n: 10 }), "Hasar aldıktan sonra 10 sn bekle");
});

test("a blocked name reads as a request for another name, in both languages", () => {
  assert.equal(errorText(NAME_BLOCKED, NAME_BLOCKED), "Bu isim kullanılamaz — başka bir isim seç");
  setLang("en", null);
  try {
    assert.equal(errorText(NAME_BLOCKED, NAME_BLOCKED), "This name can't be used — pick another");
  } finally {
    setLang("tr", null);
  }
});
