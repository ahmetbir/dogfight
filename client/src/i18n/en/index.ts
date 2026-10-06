// The English dictionary: each area is typed against its Turkish source, so
// a missing or an extra key fails to compile.
import type { Msg } from "../types.ts";
import type { Key } from "../tr/index.ts";
import { book } from "./book.ts";
import { common } from "./common.ts";
import { errors } from "./errors.ts";
import { game } from "./game.ts";
import { home } from "./home.ts";
import { hud } from "./hud.ts";
import { input } from "./input.ts";

export const EN_AREAS = { common, home, errors, game, input, hud, book } as const;
export const EN: Readonly<Record<Key, Msg>> = { ...common, ...home, ...errors, ...game, ...input, ...hud, ...book };
