// Chapter 2: the three control schemes, rendered from the bindings the
// schemes read (input/bindings.ts), so the lists cannot drift from the game.
import { keyRows, type Scheme } from "../input/bindings.ts";
import { MAX_AIM_OFF } from "../input/schemes.ts";
import { CHAT_TEXT } from "../ui/chat.ts";
import { art, b, figure, kbd, label, list, note, p, s, sub, table, type Chapter } from "./kit.ts";

const SCHEMES: [Scheme, string, string][] = [
  ["mouse", "Fare ile nişan", "Masaüstü varsayılanı. Fare nişan yönünü gösterir, otopilot burnu oraya çevirir."],
  ["keyboard", "Klavye", "Çubuk doğrudan tuşlarda: burun, yatış ve sapma senin elinde."],
  ["touch", "Dokunmatik", "Telefon ve tablet varsayılanı. Telefonu yatay tut."],
];

/** Mouse aim: the aim circle leads, the nose cross follows. */
function aimArt(): SVGSVGElement {
  return art(320, 150, "Fare ile nişan: nişan halkası önde, burun artısı onu izler",
    s("rect", { x: 10, y: 10, width: 300, height: 130, rx: 10, class: "screen" }),
    s("circle", { cx: 220, cy: 60, r: 14, class: "hud-mark" }),
    s("path", { d: "M128 88 h16 M136 80 v16", class: "hud-mark" }),
    s("path", { d: "M146 84 Q180 64 204 62", class: "arrow dashed" }),
    label(220, 36, "nişan (fare)", "mid"), label(136, 116, "burun", "mid"));
}

export const controls: Chapter = {
  id: "kontroller",
  title: "Kontroller",
  render: () => [
    p("Şemayı oyunda ", b("Esc → Ayarlar"), " (dokunmatik: MENÜ) menüsünden seçersin; seçim tarayıcıda saklanır. ",
      "Aşağıdaki listeler oyunun tuş tablosundan üretilir."),
    figure(aimArt(), `Fare ile nişan: fareyi gitmek istediğin yere götür, uçak döner. Nişan burnun ${Math.round((MAX_AIM_OFF * 180) / Math.PI)}° konisinde kalır.`),
    ...SCHEMES.flatMap(([k, title, about]) => [
      sub(title), p(about),
      table(["Tuş", "İşlev"], keyRows(k).map(([key, what]) => [kbd(key), what])),
    ]),
    sub("Hızlı sohbet"),
    p("1–6 tuşları (dokunmatik: SOHBET) hazır mesaj yollar; takımlı modlarda yalnız takımına gider."),
    list(...CHAT_TEXT.slice(1).map((t, i) => [kbd(String(i + 1)), " ", t])),
    sub("Ayarlar"),
    list(
      [b("Y eksenini ters çevir"), ": burun yukarı/aşağı yönünü değiştirir (klavyede W/S, farede yukarı/aşağı, dokunmatikte çubuk)."],
      [b("Fare hassasiyeti"), ": yalnız fare ile nişanda."],
      [b("G efektleri"), ": yüksek G'de ekran kenarlarının kararması, eksi G'de kızarma (yalnız görsel)."],
      [b("Füze kamerası"), ": attığın füzeyi küçük bir pencerede izler."],
      [b("Performans modu"), ": daha az bulut, yağmur ve parçacık; zayıf cihazlarda akıcılık için."],
      [b("Eğimle nişan"), ": dokunmatikte, çubuk boştayken cihazı eğerek nişan alırsın."]),
    note("tip", "Mac trackpad'de füze için iki parmakla tıkla ya da ctrl+tık kullan."),
  ],
};
