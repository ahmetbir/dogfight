// Chapter 7 tables: the six weathers' visibility, lock range and wind (the
// prose: i18n/book/*/world.ts).
import { t } from "../i18n/index.ts";
import type { WeatherKind } from "../net/protocol.ts";
import { LOOKS } from "../render/looks.ts";
import { WEATHERS, weatherName } from "../ui/create.ts";
import { b, dist, num, table, type BookCtx } from "./kit.ts";
import { RULES as R, type WeatherKey } from "./rules.ts";

const WX_KEY: Record<WeatherKind, WeatherKey> = {
  acik: "Acik", bulutlu: "Bulutlu", sisli: "Sisli", yagmurlu: "Yagmurlu", firtina: "Firtina", gece: "Gece",
};

/** Lock range in this weather, from the aircraft table when it is known. */
function lockRange(ctx: BookCtx, mul: number): string {
  const ranges = ctx.aircraft.map((a) => a.lockRange * mul);
  if (!ranges.length) return `× ${num(mul, 2)}`;
  return `× ${num(mul, 2)} (${dist(Math.min(...ranges))}–${dist(Math.max(...ranges))})`;
}

/** Visibility, lock range and wind of every weather. */
export function weatherTable(ctx: BookCtx): HTMLElement {
  return table([t("bt.weather"), t("bt.visibility"), t("bt.lockRange"), t("bt.wind")], WEATHERS.map((k) => {
    const key = WX_KEY[k], gust = R[`gust${key}`];
    return [b(weatherName(k)), `≈ ${dist(LOOKS[k].fog[1])}`, lockRange(ctx, R[`lockMul${key}`]), `${R[`wind${key}`]}${gust ? ` ± ${gust}` : ""} m/s`];
  }));
}
