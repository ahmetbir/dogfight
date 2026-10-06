// Chapter 9: short, practical tactics.
import { b, dist, list, p, sec, sub, type Chapter } from "./kit.ts";
import { RULES as R } from "./rules.ts";

export const tips: Chapter = {
  id: "ipuclari",
  title: "İpuçları ve taktikler",
  render: () => [
    sub("Enerji"),
    list(
      ["Köşe hızının üstünde gir, dönüşü kısa tut: uzun çekiş hızını yer, yavaş uçak kolay hedeftir."],
      ["İrtifa yedek hızdır: yukarıda bekle, dalışla saldır, sonra yine tırman."],
      ["AB'yi gerektiğinde yak; kilitli AB ile füzeden kaçılmaz."]),
    sub("Saldırı"),
    list(
      ["Füzeyi arkadan ve menzilin rahatça içinden at: hedef kaçacak açı bulamaz. Önden ya da menzil sınırından atılan füze kolay kaçırılır."],
      ["Kilit kurarken burnunu düşmanda tut; koni dar (", `${R.lockConeDeg}°`, ")."],
      ["Top için öndelik halkasını kullan, ", dist(R.gunRange), " içinde kısa seriler at; ısı dolarsa ", sec(R.overheatS), " silahsızsın."]),
    sub("Savunma"),
    list(
      ["FÜZE UYARISI'nda füzeye doğru sert dön (dik açı), sonra ", b("FLARE!"), " yanınca flare at; birkaç flare art arda daha güvenlidir."],
      ["Uyarı RADAR diyorsa flare boşa gider: ", b("DİK UÇ!"), " — füzeye dik dön ve ", sec(R.radarBeamS), " öyle kal. Uzaktaysan önce sen de at: ",
        "atan, füzesi vurana dek burnunu sende tutmak zorunda."],
      ["Alçakta, vadide ya da binalar arasında dönmek takipçiyi araziye çarptırabilir — ama sen de çarpabilirsin."],
      ["Can azsa savaşı uzatma: kendi üssüne in, ", sec(R.rearmS), " dur, tam dolu kalk."]),
    sub("Takım ve Üs Saldırısı"),
    list(
      ["1–6 hızlı sohbet tuşlarıyla takımına haber ver: \"Arkandayım!\", \"Yardım lazım!\"."],
      ["Bombacıysan önce uçaksavarı yık; AA ", dist(R.aaRange), " içinde sürekli ateş eder."],
      ["Bombayı hedefin önünden bırak; uçağın hızıyla ileri gider."],
      ["Kendi üssünü boş bırakma: düşman bombacıyı hedefe varmadan düşür."]),
    p("İyi uçuşlar, pilot."),
  ],
};
