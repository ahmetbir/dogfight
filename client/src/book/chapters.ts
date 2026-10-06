// The manual's chapters, in reading order.
import { controls } from "./ch-controls.ts";
import { flight } from "./ch-flight.ts";
import { ground } from "./ch-ground.ts";
import { hud } from "./ch-hud.ts";
import { modes } from "./ch-modes.ts";
import { start } from "./ch-start.ts";
import { tips } from "./ch-tips.ts";
import { weapons } from "./ch-weapons.ts";
import { world } from "./ch-world.ts";
import type { Chapter } from "./kit.ts";

export const CHAPTERS: readonly Chapter[] = [start, controls, flight, ground, weapons, modes, world, hud, tips];
