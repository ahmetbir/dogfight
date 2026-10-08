// One game session: socket, state, game loop and the in-game screens
// (HUD, pick, scoreboard, round end, settings) with their keys.
import { Book } from "../book/book.ts";
import { Feed } from "../game/feed.ts";
import { mergeHooks, type GameHooks } from "../game/events.ts";
import { nextTarget, othersAlive } from "../game/spectate.ts";
import { startGame, type Game } from "../game/loop.ts";
import { GameState } from "../game/state.ts";
import { lt, t } from "../i18n/index.ts";
import { errorText } from "../i18n/messages.ts";
import { NAME_BLOCKED } from "../net/codes.ts";
import { loadSettings, type Settings } from "../input/schemes.ts";
import { requestTilt, Tilt } from "../input/tilt.ts";
import { newTouchState } from "../input/touch.ts";
import type { AircraftKind, Create, Join, Loadout, Quick, ServerMsg } from "../net/protocol.ts";
import { LinkMonitor } from "../net/link.ts";
import { loadToken, storeToken } from "../net/pilot.ts";
import { openSocket, socketURL, type Socket } from "../net/socket.ts";
import { Renderer } from "../render/renderer.ts";
import { STANDARD as STANDARD_SKIN, type SkinId } from "../render/skins.ts";
import { noWebGL, type Banner } from "./banner.ts";
import { errorCard, unreachableCard } from "./errorcard.ts";
import { fill, h, refuseName } from "./dom.ts";
import { ChatMenu, ChatThrottle } from "./chat.ts";
import { Hud } from "./hud.ts";
import { escapeAction, keyRouter } from "./keys.ts";
import { LobbyScreen, lobbyView } from "./lobby.ts";
import { LobbyFlow, lobbyEscape } from "./lobbyflow.ts";
import { kindsFor, PickScreen, waitLeft } from "./pick.ts";
import { RoundEnd, Scoreboard } from "./scoreboard.ts";
import { SettingsMenu } from "./settings.ts";
import { SkinChoices } from "./skinstore.ts";
import { repickNeeded, SkinSync } from "./skinsync.ts";
import { CHOOSE_GAP_MS, noticeOf, switchRow, TeamFlow } from "./team.ts";
import { TouchPad } from "./touchpad.ts";

const UI_MS = 100;

export type PlayOpts = {
  canvas: HTMLCanvasElement; ui: HTMLElement; banner: Banner; name: string; entry: Create | Join | Quick;
  /** Extra hooks (audio), given the session's state, settings and menu check. */
  extra?: (s: { state: GameState; settings: Settings; blocked: () => boolean }) => Extra;
};

export type Extra = { hooks: GameHooks; changed?(s: Settings): void; stop?(): void };

export function play(o: PlayOpts): void {
  const { canvas, ui, banner } = o;
  const settings = loadSettings();
  let renderer: Renderer;
  try {
    renderer = new Renderer(canvas, settings.perf);
  } catch {
    noWebGL(ui);
    return;
  }
  const state = new GameState();
  const link = new LinkMonitor(performance.now());
  let online = false; // the socket is open (between welcome and a drop)
  const feed = new Feed();
  const skins = new SkinChoices();
  const paint = new SkinSync((kind) => { socket.send({ t: "pick", kind: kind as AircraftKind, lo: loadout, skin: skins.get(kind) }); });
  const pick = new PickScreen((k) => choose(k), () => closeMenus(true), (c) => teams.choose(c, performance.now()), (lo) => chooseLoadout(lo),
    (k, s) => chooseSkin(k, s));
  const teams = new TeamFlow((team) => socket.send({ t: "team", team }), state);
  let lobbyNote = "";
  let lobbyNoteUntil = 0;
  let sideSentAt = -Infinity;
  const lobby = new LobbyScreen({
    side: (team) => {
      const now = performance.now();
      if (now - sideSentAt < CHOOSE_GAP_MS) return; // side shares the server's choice bucket
      if (socket.send({ t: "side", team })) {
        sideSentAt = now;
        chosen = null; // the server gives me the new side's aircraft; the roster shows it
      }
    },
    plane: () => openPick(),
    start: () => { if (flow.start(performance.now())) socket.send({ t: "start" }); },
    settings: () => openMenu(),
    leave: () => leaveRoom(),
  });
  const flow = new LobbyFlow();
  const menu = new SettingsMenu(settings, {
    changed: (s) => {
      extra.changed?.(s);
      renderer.setPerf(s.perf);
      hud.setStyle(s);
      syncTouch();
    },
    resume: () => closeMenus(true),
    leave: () => leaveRoom(),
    book: () => {
      menu.close();
      book.open();
    },
    lang: () => {
      openMenu(); // the team row is built per open
      if (board.isOpen()) board.show(hud.board());
    },
  });
  // The manual covers the game like a menu; closing it returns to the menu it was opened from.
  const book = new Book({
    aircraft: () => [...state.aircraft.values()],
    closed: () => {
      openMenu();
      menu.focusBook(); // back on the Kitap button that opened it
    },
  });
  const blocked = () => pick.isOpen() || menu.isOpen() || book.isOpen() || lobby.isOpen();
  const hud = new Hud(state, blocked);
  hud.setStyle(settings);
  const board = new Scoreboard();
  const roundEnd = new RoundEnd();
  const extra: Extra = o.extra?.({ state, settings, blocked }) ?? { hooks: {} };
  const loading = h("div", { class: "screen" }, h("div", { class: "panel narrow loading" }, h("span", { class: "spinner" }), lt("app.connecting")));
  fill(ui, loading);
  if (DEBUG) Object.assign(globalThis, { debugGame: { state, renderer } });

  let started = false;
  let game: Game | null = null;
  let showPick = true;              // first welcome: offer the pick screen
  let chosen: AircraftKind | null = null;
  let loadout: Loadout = "ir";      // missile loadout sent with every pick
  let repick = false;               // after a reconnect: send my pick again
  let lockMenuAt = -Infinity;
  let welcomeAt = performance.now(); // the server's pick timeout starts at each welcome

  const me = () => state.players.get(state.you);
  // In the lobby the pick only records my aircraft (the plane comes with Start): no
  // pick timeout, nothing "flying now", and the side is chosen on the lobby screen.
  const pickView = () => ({
    code: state.code, team: me()?.team ?? "none", aircraft: [...state.aircraft.values()],
    current: state.inLobby() ? null : me()?.kind ?? null, chosen: state.inLobby() ? chosen ?? me()?.kind ?? null : chosen,
    protectedNow: !!state.planes.get(state.you)?.pr, waiting: waiting(),
    waitLeft: waitLeft(welcomeAt, performance.now()),
    teamPick: state.inLobby() ? null : teams.pickView(performance.now()),
    lobby: state.inLobby(),
    loadout,
    skins: skins.all([...state.aircraft.keys()]),
  });
  const waiting = () => !state.planes.has(state.you) && !state.inLobby(); // joined, no plane until the first pick
  const showLobby = () => {
    if (state.round === null) return; // a fresh seat: the phase comes with the round message
    const turn = flow.sync(state.inLobby() && state.lobby !== null);
    if (turn === "opened") releasePointer(); // back from a round with the mouse captured: the lobby needs a cursor
    if (!state.inLobby() || !state.lobby) {
      if (lobby.isOpen()) lobby.close();
      document.body.classList.remove("in-lobby");
      if (turn === "closed") { // the host started: fly
        pick.close();
        closeMenus(true);
      }
      return;
    }
    const now = performance.now();
    lobby.show(lobbyView({ msg: state.lobby, you: state.you, mode: state.mode, code: state.code, aircraft: state.aircraft,
      note: now < lobbyNoteUntil ? lobbyNote : "" }));
    document.body.classList.add("in-lobby"); // portrait phones: no turn-sideways prompt over the lobby
  };
  let spectate: number | null = null; // the plane watched while waiting (pick screen closed)
  const cycle = (step: 1 | -1) => {
    if (!waiting() || blocked()) return;
    const ids = othersAlive(state.planes.values(), state.you);
    spectate = nextTarget(ids, spectate !== null && ids.includes(spectate) ? spectate : ids[0] ?? null, step);
  };
  canvas.addEventListener("pointerdown", (e) => { if (e.button === 0) cycle(1); });
  function choose(k: AircraftKind): void {
    paint.cancel(); // this pick carries the paint
    if (socket.send({ t: "pick", kind: k, lo: loadout, skin: skins.get(k) })) chosen = k;
    closeMenus(true);
  }
  /** A loadout click: flying or in the lobby, it goes out at once with my aircraft (now if protected, else next spawn); before the first plane it waits for the aircraft pick. */
  function chooseLoadout(lo: Loadout): void {
    loadout = lo;
    const kind = chosen ?? me()?.kind;
    if (!waiting() && kind) {
      paint.cancel();
      socket.send({ t: "pick", kind, lo, skin: skins.get(kind) });
    }
    pick.show(pickView());
  }
  /**
   * A paint chip: stored for that jet at once; flying, my jet's paint goes
   * out once the browsing settles or the screen closes (ui/skinsync.ts), one
   * pick for any number of chips.
   */
  function chooseSkin(k: AircraftKind, s: SkinId): void {
    skins.set(k, s);
    if (!waiting() && k === (chosen ?? me()?.kind)) paint.later(k);
    pick.show(pickView());
  }
  /** A seat flying in another paint than mine (pick-timeout spawn, team switch, reconnect): asked for once, settled. */
  function mendPaint(): void {
    const mine = me();
    if (mine && !waiting() && online) paint.mend(mine.kind, mine.skin ?? STANDARD_SKIN, skins.get(mine.kind));
  }
  const releasePointer = () => { if (document.pointerLockElement) document.exitPointerLock(); };
  function openPick(): void {
    if (!me()) return;
    menu.close();
    book.hide();
    releasePointer();
    pick.show(pickView());
  }
  function openMenu(): void {
    pick.close();
    book.hide();
    releasePointer();
    menu.open(state.code, switchRow(teams.switchView(performance.now()), (to) => { teams.choose(to, performance.now()); closeMenus(true); }));
  }
  function closeMenus(relock: boolean): void {
    if (pick.isOpen()) paint.flush(); // a paint still settling goes out with the screen
    pick.close();
    menu.close();
    book.hide();
    if (relock && settings.scheme === "mouse" && started && !state.inLobby()) {
      try {
        void Promise.resolve(canvas.requestPointerLock()).catch(() => {});
      } catch {
        // needs a fresh gesture: the HUD asks for a click
      }
    }
  }

  const hooks = mergeHooks(hud.hooks(), extra.hooks, {
    camera: (c) => pad?.replayState(c.canReplay, c.replay),
    kill: (victim) => { if (victim === state.you) chatMenu.close(); }, // touch: the menu would cover the TEKRAR hint
    lockLost: () => {
      if (blocked() || !started) return;
      lockMenuAt = performance.now();
      openMenu();
    },
  });

  const chatGate = new ChatThrottle(); // the server drops chats inside its cooldown silently
  const sendChat = (id: number) => {
    if (chatGate.ok(performance.now())) socket.send({ t: "chat", id });
  };
  const showBoard = (show: boolean) => {
    if (show && state.round?.phase !== "ended") board.show(hud.board());
    else if (!show) board.hide();
  };
  const togglePick = () => {
    if (pick.isOpen()) closeMenus(true);
    else openPick();
  };

  // Touch scheme: the on-screen controls, no pointer lock; tilt aim when enabled.
  const touch = newTouchState();
  const tilt = new Tilt(touch);
  const chatMenu = new ChatMenu(sendChat);
  let pad: TouchPad | null = null;
  function syncTouch(): void {
    const on = started && settings.scheme === "touch";
    document.body.classList.toggle("touch", on);
    if (on && !pad) {
      releasePointer();
      pad = new TouchPad(touch, {
        bomb: state.mode === "base", onChat: () => chatMenu.toggle(), onMenu: openMenu, onPick: togglePick, onBoard: showBoard,
        onReplay: () => void game?.replayKey(),
      });
      pad.el.append(chatMenu.view());
      // Tilt saved as on after a reload: iOS sends no orientation events until
      // permission is asked inside a gesture, so ask on the first touch.
      if (settings.tilt) pad.el.addEventListener("pointerdown", () => void requestTilt().then((ok) => { if (!ok) tilt.stop(); }), { once: true, capture: true });
      ui.insertBefore(pad.el, hud.el); // under the HUD, whose widgets let touches through
    } else if (!on && pad) {
      pad.dispose();
      pad = null;
      chatMenu.close();
    }
    if (on && settings.tilt) tilt.start(); // the pose at start is level flight
    else tilt.stop();
  }

  const onKey = keyRouter({
    active: () => started,
    blocked,
    menuOpen: () => menu.isOpen() || book.isOpen(),
    board: showBoard,
    escape: () => {
      if (lobbyEscape({ lobby: lobby.isOpen(), pick: pick.isOpen(), menu: menu.isOpen(), book: book.isOpen() }) === "menu") {
        openMenu(); // the lobby alone on screen: Esc opens the menu (Leave, settings, language)
        return;
      }
      const act = escapeAction({ sinceLockMenuMs: performance.now() - lockMenuAt, blocked: blocked(), replaying: !!game?.replaying() });
      if (act === "close") {
        if (pick.isOpen()) pick.leave(() => closeMenus(false)); // waiting: Esc flies the selected card, like Back
        else closeMenus(false);
      }
      else if (act === "menu") openMenu();
      else if (act === "skip") {
        game?.skipReplay();
        closeMenus(true); // no menu is open: this only asks for the pointer lock again
      }
    },
    pick: togglePick,
    chat: sendChat,
    spectate: cycle,
    replay: () => void game?.replayKey(),
  });
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);

  const tick = () => {
    if (!started) return;
    const r = state.round;
    if (r?.phase === "ended") {
      board.hide();
      roundEnd.show(r.winner ?? "", hud.board(), hud.roundLeft(), r.wt);
    } else {
      roundEnd.hide();
      if (board.isOpen()) board.show(hud.board());
    }
    showLobby();
    if (pick.isOpen()) pick.show(pickView());
    mendPaint(); // also after a pick-timeout spawn, which changes no roster
    hud.waiting(waiting(), waitLeft(welcomeAt, performance.now()), settings.scheme === "touch");
    const now = performance.now();
    if (online) link.ping(now, (ts) => socket.send({ t: "ping", ts }));
    hud.link(online ? link.view(now) : null);
    pad?.sync();
  };
  const uiTimer = setInterval(tick, UI_MS);

  const onMsg = (m: ServerMsg) => {
    const now = performance.now();
    if (m.t === "welcome") link.reset(now);
    link.received(now);
    if (m.t === "snap") link.snap(m.tick);
    if (m.t === "pong") link.pong(m.ts, now);
    const evs = state.apply(m, now);
    feed.emit(m, evs);
    // Switched teams: the new team's aircraft, with a fresh pick timer (the lobby keeps its own screen).
    if (teams.apply(m, evs, performance.now()) && !state.inLobby()) { chosen = null; welcomeAt = performance.now(); openPick(); }
    if (m.t === "lobby" || m.t === "round") showLobby();
    if (m.t === "welcome") {
      if (m.tok) { // a new pilot: keep the token for the next hello and /api/me
        storeToken(m.tok);
        socket.setToken(m.tok);
      }
      welcomeAt = performance.now();
      if (location.pathname !== `/r/${m.code}`) history.replaceState(null, "", `/r/${m.code}`);
      if (!started) {
        started = true;
        fill(ui, hud.el, board.el, roundEnd.el, lobby.el, pick.el, menu.el, book.el);
        document.body.classList.add("in-game"); // portrait phones: the turn-sideways prompt
        syncTouch();
        game = startGame({
          socket, renderer, state, settings, feed, hooks, blocked, touch, spectate: () => spectate,
          silentMs: () => link.silentMs(performance.now()),
        });
      } else {
        repick = chosen !== null;
        extra.stop?.(); // reconnected: no plane yet, so nothing would quiet the engine drone
      }
    }
    if (m.t === "chat") hud.chat(m.from, m.id);
    if (m.t === "notice" && m.code === "lobby_closed") { // the server is being updated: this lobby is gone
      endSession(t("notice.lobby_closed"));
      return;
    }
    if (m.t === "notice") { // a refused team choice or lobby request
      hooks.notice?.(noticeOf(m));
      lobbyNote = noticeOf(m);
      lobbyNoteUntil = performance.now() + 4000;
      showLobby();
    }
    if (m.t === "players") {
      const mine = me();
      if (!mine) return;
      if (repick && chosen) {
        repick = false;
        const ok = kindsFor(mine.team, [...state.aircraft.values()]).some((a) => a.kind === chosen);
        if (ok && repickNeeded(mine, chosen, loadout, skins.get(chosen))) {
          paint.cancel();
          socket.send({ t: "pick", kind: chosen, lo: loadout, skin: skins.get(chosen) }); // a new seat starts on IR, in standard
        }
      }
      mendPaint();
    }
    // The first round message says whether the room waits in its lobby (the
    // roster came before it): the lobby screen, or the pick screen as before.
    if (m.t === "round" && showPick && me()) {
      showPick = false;
      if (!state.inLobby()) openPick();
    }
  };

  function leaveRoom(): void {
    clearInterval(uiTimer);
    pick.dispose(); // the hangar's renderer and thumbnails
    socket.close();
    location.assign("/");
  }

  /** The session ends on our side (a closed lobby): stop, close the socket, a card with the way home. */
  function endSession(msg: string): void {
    clearInterval(uiTimer);
    game?.stop();
    extra.stop?.();
    closeMenus(false);
    board.hide();
    releasePointer();
    pick.dispose();
    socket.close();
    document.body.classList.remove("in-game", "in-lobby", "touch");
    errorCard(ui, t("lobby.closedTitle"), msg);
  }

  const socket: Socket = openSocket(socketURL(location), o.name, o.entry, {
    onMsg,
    onStatus: (s) => {
      online = s === "open";
      banner.status(s);
    },
    onFatal: (code, raw) => {
      const msg = errorText(code, raw);
      clearInterval(uiTimer);
      banner.fatal(msg);
      game?.stop(); // the socket is gone for good: freeze, do not fly on
      extra.stop?.();
      closeMenus(false);
      board.hide();
      releasePointer();
      if (!started && code === NAME_BLOCKED) { // the server's blocked-name list: back to the name field
        refuseName();
        location.reload(); // home or /r/CODE asks for a name again, with the reason
        return;
      }
      if (!started) { // nothing behind it yet: a centered card instead of the top banner
        banner.hide();
        errorCard(ui, t("card.joinFail"), msg);
      }
    },
    onUnreachable: () => unreachableCard(ui, () => { fill(ui, loading); socket.retry(); }),
  });
  socket.setToken(loadToken()); // before onopen writes the hello
}
