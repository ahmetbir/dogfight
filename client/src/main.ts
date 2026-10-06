import { AudioEngine } from "./audio/audio.ts";
import { audioHooks } from "./audio/wire.ts";
import { runDebug } from "./debug/index.ts";
import { initialLang, lt, setLang } from "./i18n/index.ts";
import { play } from "./ui/app.ts";
import { Banner, noWebGL } from "./ui/banner.ts";
import { showHome, showJoin, type Start } from "./ui/home.ts";

const ui = document.getElementById("ui");
const canvas = document.getElementById("game") as HTMLCanvasElement | null;
const bannerEl = document.getElementById("banner");

// The stored language, else the browser's (tr* → Turkish, anything else English); stored from now on.
setLang(initialLang(navigator.languages ?? [navigator.language]));
document.getElementById("rotate")?.replaceChildren(lt("app.rotate"));

// Debug scenes are compiled out of production builds (esbuild --define:DEBUG=false).
if (!(DEBUG && canvas && runDebug(canvas, new URLSearchParams(location.search))) && canvas && ui && bannerEl) {
  route(canvas, ui, new Banner(bannerEl));
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** "/" → home; "/r/CODE" → join that room. */
function route(canvas: HTMLCanvasElement, ui: HTMLElement, banner: Banner): void {
  if (!hasWebGL()) {
    noWebGL(ui);
    return;
  }
  const audio = new AudioEngine(); // waits for the first gesture to create its AudioContext
  const start: Start = (name, entry) => play({
    canvas, ui, banner, name, entry,
    extra: ({ state, settings, blocked }) => {
      audio.setVolume(settings.volume);
      return {
        hooks: audioHooks(audio, state, blocked),
        changed: (s) => audio.setVolume(s.volume),
        stop: () => audio.silence(),
      };
    },
  });
  const m = /^\/r\/([^/]{1,16})\/?$/.exec(location.pathname);
  if (m) showJoin(ui, m[1].toUpperCase(), start);
  else {
    if (location.pathname !== "/") history.replaceState(null, "", "/"); // e.g. /r/<too long>
    showHome(ui, start);
  }
}
