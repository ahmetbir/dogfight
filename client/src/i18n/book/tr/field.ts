// Pilot El Kitabı (Türkçe), bölüm 7–9: haritalar ve hava, HUD, ipuçları.
import { deg, hudArt } from "../../../book/ch-hud.ts";
import { weatherTable } from "../../../book/ch-world.ts";
import { b, dist, figure, list, note, p, sec, sub } from "../../../book/kit.ts";
import { RULES as R } from "../../../book/rules.ts";
import { RADAR_ENEMY_M, TAG_GUN_M, TAG_GUN_RAD, TAG_NEAR_M } from "../../../game/sight.ts";
import type { MapKind, WeatherKind } from "../../../net/protocol.ts";
import { MAPS, mapName, WEATHERS, weatherName } from "../../../ui/create.ts";
import type { Child } from "../../../ui/dom.ts";
import { RADAR_M } from "../../../ui/radar.ts";
import type { Field } from "../types.ts";

const MAP_ABOUT: Record<MapKind, string> = {
  ada: "Denizle çevrili bir ada: geniş açık alan, alçak tepeler. İlk uçuşlar için en rahatı.",
  sehir: "Şehir blokları ve yüksek binalar. Binalar katıdır: çarpmak ölümdür, ama aralarına dalmak takipçiyi silkeler.",
  col: "Kum tepeleri ve düzlükler; saklanacak yer az, ufuk geniş.",
  dag: "Sarp dağlar ve karlı zirveler. Vadiler örtü sağlar, ama arazi en büyük düşmandır.",
};

const WX_ABOUT: Record<WeatherKind, string> = {
  acik: "Berrak gökyüzü.", bulutlu: "Alçak bulutlar, hafif rüzgâr.", sisli: "Görüş çok kısa; kilit menzili de kısalır.",
  yagmurlu: "Yağmur, alçak bulutlar, rüzgâr.", firtina: "Şimşek, sağanak, sert ve değişken rüzgâr.",
  gece: "Karanlık; ay ışığı, yıldızlar, pist ve motor ışıkları.",
};

const item = (n: number, title: string, ...c: Child[]) => p(b(`${n}. ${title}`), " — ", ...c);

export const field: Field = {
  world: (ctx) => [
    p("Haritayı ve havayı oda kurarken seçersin; aynı seed aynı haritayı verir. Oynanan alan merkezden her yöne ", b(dist(R.playHalf)),
      "; dışarı çıkarsan önce uyarı gelir, kısa süre sonra hasar alırsın. İki üs haritanın iki ucundadır."),
    sub("Haritalar"),
    list(...MAPS.map((k) => [b(mapName(k)), ": ", MAP_ABOUT[k]])),
    sub("Hava durumu"),
    p("Hava raund boyunca değişmez. Görüşü (sis) ve füze kilit menzilini etkiler; rüzgâr havadaki uçağı sürükler."),
    weatherTable(ctx),
    list(...WEATHERS.map((k) => [b(weatherName(k)), ": ", WX_ABOUT[k]])),
    note("tip", "Sisli ve fırtınalı havada kilit menzili kısalır: yaklaşmak zorundasın, top daha çok konuşur. HUD'daki MENZİL o anki değeri gösterir."),
    note("tip", "Rüzgâr mermi ve füzeyi etkilemez, yalnız uçağı sürükler: inişte burnu rüzgâra doğru hafifçe çevir (yengeç açısı)."),
  ],

  hud: () => [
    figure(hudArt(), "Temsili HUD; numaralar aşağıdaki açıklamalara karşılık gelir."),
    item(1, "Radar", "Kuzey (K) yukarıda, ", dist(RADAR_M), " yarıçap. Dostlar ve üs hedefleri her zaman görünür; düşman yalnız ",
      b(dist(RADAR_ENEMY_M)), " içindeyse."),
    item(2, "Skor ve süre", "Takım skorları (Üs Saldırısı'nda iki tarafın hedef canı) ve raundun kalan süresi."),
    item(3, "FÜZE UYARISI", "Sana kilitli bir füze yolda; yanında en yakın füzenin türü (IR ya da RADAR) ve uzaklığı. Kaç, dön, flare'e hazırlan."),
    item(4, "FLARE! / DİK UÇ!", "Seni izleyen IR füze ", b(dist(R.flareWarn)), " içinde ve flare'in hazır: şimdi at (yanında flare tuşu; dokunmatikte ",
      "FLARE düğmesi yanar). Flare füzeyi kandırınca ", b("FÜZE ATLATILDI!"), " yazar. Radar füzesinde mavi ", b("DİK UÇ!"),
      ": flare işlemez, füzeye dik uç."),
    item(5, "Olay akışı", "Kim kimi neyle düşürdü; hızlı sohbet mesajları da burada görünür."),
    item(6, "Nişan halkası", "Fare ile nişanda gitmek istediğin yön. Otopilot burnu buraya çevirir."),
    item(7, "Burun artısı", "Uçağın burnu, yani topun ateş yönü."),
    item(8, "Kilit kutusu", "Koni içinde burnuna en yakın (en küçük açıdaki) düşmanı çevreler; kilit ilerledikçe daralır, ", sec(R.lockS),
      " (radar ", sec(R.radarLockS), ", kesik çizgili kutu) sonra kilitlenir. Altında füze türü, uzaklık ve o türün menzil çubuğu: ",
      "çubuk dolu = kilit menzilinin kenarı."),
    item(9, "Öndelik halkası", "Top mermisinin hedefle buluşacağı nokta. Halkayı burun artısının üstüne getir ve ateş et."),
    item(10, "MENZİL DIŞI", "Koni içinde düşman var ama kilit menzilinin dışında: yaklaş."),
    item(11, "Sol panel", "HIZ (km/h), İRT (m), GAZ çubuğu, AB ışığı ve AB ısı çubuğu (kilitliyken yanıp söner). Altında ışıklar: ",
      b("TEKER"), " (takım açık; istenenle gerçek farklıyken yanıp söner), ", b("FREN"), " (fren ya da park freni), ", b("BOMBA n"),
      " (Üs Saldırısı) ve ", b("İKMAL %"), " (kendi üssünde dururken dolum)."),
    item(12, "Sağ panel", "CAN, top ISI'sı (dolunca top susar), MENZİL (havaya göre o anki kilit menzilin; Karışık'ta IR / radar), ",
      "kalan FÜZE (türüyle: ör. 2 IR + 1 R) ve FLARE."),
    sub("Diğer işaretler"),
    p(b("KORUMA"), ": doğuş ya da yer koruması sürüyor. ", b("İsim etiketleri"), ": düşman adı yalnız ", dist(TAG_NEAR_M),
      " içinde ya da top hattının ", deg(TAG_GUN_RAD), " yakınında ve ", dist(TAG_GUN_M), " altındaysa görünür; dostlar her zaman."),
    p("Ekran kırmızı yanıp sönerse isabet aldın; ekranın ortasındaki küçük işaret isabet ettirdiğini gösterir. Can azalınca CAN çubuğu kırmızıya döner."),
  ],

  tips: () => [
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
