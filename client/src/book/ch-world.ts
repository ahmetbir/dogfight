// Chapter 7: the four maps and the six weathers (visibility, lock range, wind).
import type { MapKind, WeatherKind } from "../net/protocol.ts";
import { LOOKS } from "../render/looks.ts";
import { MAP_NAMES, WEATHER_NAMES } from "../ui/create.ts";
import { b, dist, list, note, num, p, sub, table, type BookCtx, type Chapter } from "./kit.ts";
import { RULES as R, type WeatherKey } from "./rules.ts";

const MAP_ABOUT: Record<MapKind, string> = {
  ada: "Denizle çevrili bir ada: geniş açık alan, alçak tepeler. İlk uçuşlar için en rahatı.",
  sehir: "Şehir blokları ve yüksek binalar. Binalar katıdır: çarpmak ölümdür, ama aralarına dalmak takipçiyi silkeler.",
  col: "Kum tepeleri ve düzlükler; saklanacak yer az, ufuk geniş.",
  dag: "Sarp dağlar ve karlı zirveler. Vadiler örtü sağlar, ama arazi en büyük düşmandır.",
};

const WX_KEY: Record<WeatherKind, WeatherKey> = {
  acik: "Acik", bulutlu: "Bulutlu", sisli: "Sisli", yagmurlu: "Yagmurlu", firtina: "Firtina", gece: "Gece",
};

const WX_ABOUT: Record<WeatherKind, string> = {
  acik: "Berrak gökyüzü.", bulutlu: "Alçak bulutlar, hafif rüzgâr.", sisli: "Görüş çok kısa; kilit menzili de kısalır.",
  yagmurlu: "Yağmur, alçak bulutlar, rüzgâr.", firtina: "Şimşek, sağanak, sert ve değişken rüzgâr.",
  gece: "Karanlık; ay ışığı, yıldızlar, pist ve motor ışıkları.",
};

/** Lock range in this weather, from the aircraft table when it is known. */
function lockRange(ctx: BookCtx, mul: number): string {
  const ranges = ctx.aircraft.map((a) => a.lockRange * mul);
  if (!ranges.length) return `× ${num(mul, 2)}`;
  return `× ${num(mul, 2)} (${dist(Math.min(...ranges))}–${dist(Math.max(...ranges))})`;
}

export const world: Chapter = {
  id: "dunya",
  title: "Haritalar ve hava",
  render: (ctx) => [
    p("Haritayı ve havayı oda kurarken seçersin; aynı seed aynı haritayı verir. Oynanan alan merkezden her yöne ", b(dist(R.playHalf)),
      "; dışarı çıkarsan önce uyarı gelir, kısa süre sonra hasar alırsın. İki üs haritanın iki ucundadır."),
    sub("Haritalar"),
    list(...(Object.keys(MAP_NAMES) as MapKind[]).map((k) => [b(MAP_NAMES[k]), ": ", MAP_ABOUT[k]])),
    sub("Hava durumu"),
    p("Hava raund boyunca değişmez. Görüşü (sis) ve füze kilit menzilini etkiler; rüzgâr havadaki uçağı sürükler."),
    table(["Hava", "Görüş", "Kilit menzili", "Rüzgâr"], (Object.keys(WEATHER_NAMES) as WeatherKind[]).map((k) => {
      const key = WX_KEY[k], gust = R[`gust${key}`];
      return [b(WEATHER_NAMES[k]), `≈ ${dist(LOOKS[k].fog[1])}`, lockRange(ctx, R[`lockMul${key}`]), `${R[`wind${key}`]}${gust ? ` ± ${gust}` : ""} m/s`];
    })),
    list(...(Object.keys(WEATHER_NAMES) as WeatherKind[]).map((k) => [b(WEATHER_NAMES[k]), ": ", WX_ABOUT[k]])),
    note("tip", "Sisli ve fırtınalı havada kilit menzili kısalır: yaklaşmak zorundasın, top daha çok konuşur. HUD'daki MENZİL o anki değeri gösterir."),
    note("tip", "Rüzgâr mermi ve füzeyi etkilemez, yalnız uçağı sürükler: inişte burnu rüzgâra doğru hafifçe çevir (yengeç açısı)."),
  ],
};
