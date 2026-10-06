// The Turkish source dictionary: every key the UI may ask for (areas must not share keys; i18n.test.ts checks).
import { book } from "./book.ts";
import { common } from "./common.ts";
import { errors } from "./errors.ts";
import { game } from "./game.ts";
import { home } from "./home.ts";
import { hud } from "./hud.ts";
import { input } from "./input.ts";

export const TR_AREAS = { common, home, errors, game, input, hud, book } as const;
export const TR = { ...common, ...home, ...errors, ...game, ...input, ...hud, ...book } as const;
export type Key = keyof typeof TR;
