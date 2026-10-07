import { test } from "node:test";
import assert from "node:assert/strict";
import { LobbyFlow, lobbyEscape, START_GAP_MS } from "./lobbyflow.ts";

test("the lobby opens on joining a waiting room and again after each round; Start closes it", () => {
  const f = new LobbyFlow();
  assert.equal(f.sync(true), "opened");   // joined a waiting room: release the pointer
  assert.equal(f.sync(true), null);       // the 10 Hz refresh changes nothing
  assert.equal(f.sync(false), "closed");  // the host started: fly
  assert.equal(f.sync(false), null);
  assert.equal(f.sync(true), "opened");   // round over: back in the lobby, mouse released again
});

test("a quick-play room never opens the lobby", () => {
  const f = new LobbyFlow();
  assert.equal(f.sync(false), null);
});

test("Start goes out at most once per gap, only in the lobby, and is free again in the next lobby", () => {
  const f = new LobbyFlow();
  assert.equal(f.start(0), false); // not in a lobby
  f.sync(true);
  assert.equal(f.start(1000), true);
  assert.equal(f.start(1000 + START_GAP_MS - 1), false); // a double click, a laggy re-click
  assert.equal(f.start(1000 + START_GAP_MS), true);
  f.sync(false);
  f.sync(true);
  assert.equal(f.start(1000 + START_GAP_MS + 1), true);
});

test("Esc with only the lobby on screen opens the menu; over a picker or the menu it closes that", () => {
  const none = { lobby: false, pick: false, menu: false, book: false };
  assert.equal(lobbyEscape({ ...none, lobby: true }), "menu");
  assert.equal(lobbyEscape({ ...none, lobby: true, pick: true }), "game");
  assert.equal(lobbyEscape({ ...none, lobby: true, menu: true }), "game");
  assert.equal(lobbyEscape({ ...none, lobby: true, book: true }), "game");
  assert.equal(lobbyEscape(none), "game");
});
