# Dogfight — Tasarım (Spec)

Tarih: 2026-10-06 · Durum: uygulandı (son doküman geçişi G9: kod ile hizalı)

Tarayıcıda oynanan, 3D arcade, çok oyunculu jet it dalaşı. Go authoritative sunucu,
TypeScript + Three.js client. Tek binary: `localhost`, LAN ya da üretimde
kendi alan adında (§11).

## 1. Hedef ve kapsam

**Başarı ölçütü:** `go run ./cmd/dogfight` → tarayıcıda `http://localhost:8080` → oda kur →
botlarla ya da LAN'daki arkadaşlarla, takımlı veya FFA, akıcı (60 fps) ve hatasız bir maç.

**Kapsam içi:** 4 farklı jet, top + ısı güdümlü füze + flare, 4 power-up, takımlı ve FFA
modları, botlar (3 zorluk), fare-nişan ve klavye kontrolleri, prosedürel arazi, kodla
üretilen low-poly modeller, prosedürel sesler, HUD, menüler.

**Kapsam dışı (YAGNI):** ~~deploy/Dockerfile~~ (§11: artık kapsam içi), hesap/giriş, kalıcı istatistik, sohbet,
lag compensation (önce gecikmeli test, gerekirse sonra), mobil/dokunmatik, bomba.

**Sonraki proje:** F1 yarışı aynı `wsconn`/`lobby`/`room` çekirdeğini kullanacak; bu
paketler dogfight'a özgü tip bilmez.

## 2. Mimari

```
cmd/dogfight/        main: flag'ler, HTTP sunucusu, embed'lenmiş web/, graceful shutdown, -healthcheck
internal/server/     rotalar (/, /r/{kod}, /healthz, /ws), güvenlik başlıkları, el sıkışma, limitler
internal/limit/      token bucket, adres başına bucket tablosu, bağlantı kapısı (§11)
internal/wsconn/     WebSocket bağlantısı; okuyucu + yazıcı goroutine, sınırlı kuyruk
internal/lobby/      oda kodu üretme/bulma (/r/KOD), oda sınırı
internal/room/       oda actor'ı: 60 Hz tick, input kuyruğu, snapshot ve olay yayını, boş oda kapatma
internal/protocol/   JSON mesaj tipleri (§6)
internal/game/       bir odanın maçı: World + Rules + Scoreboard + botlar + oyuncu listesi
internal/sim/        saf, deterministik simülasyon (I/O yok)
internal/bot/        sim snapshot'ını okuyup Input üreten bot beyni
internal/mode/       Rules interface'i (takımlı, FFA); Scoreboard
internal/terrain/    seed'den heightmap üretimi ve bilinear örnekleme
internal/geom/       Vec3, Quat
client/src/          net, predict, render, input, audio, ui, game
client/static/models isteğe bağlı .glb modeller (build manifest'e yazar; yoksa prosedürel model)
testdata/vectors/    Go'nun ürettiği, TS'in doğruladığı uçuş ve arazi vektörleri
```

**Bağımlılıklar:** Go: yalnızca `github.com/coder/websocket`. Client: `three`; geliştirme:
`esbuild`, `typescript`. Client `npm run build` (esbuild) ile
`cmd/dogfight/web` altına derlenir; Go `embed` ile gömer.

**Sınırlar:**
- `sim.Step(*World, []Input) []Event` — I/O, zaman, rastgelelik yok (rastgelelik
  World içindeki seed'li PRNG'den).
- `bot.Brain.Think(snap *sim.Snapshot, t *terrain.Map) sim.Input` — bot ile insan sunucu için aynı.
- `mode.Rules` — `Kind`, `Slots`, `FriendlyFire`, `KillLimit`, `DurationTicks`, `TeamFor`,
  `Over(*Scoreboard)`; skor `mode.Scoreboard`'da (`Apply(event)`). Sim'e sızmaz.
- `room` dışarıya yalnızca kanal sunar (`Join`, `Leave`, `Input`). Paylaşılan state yok.
  JSON encode ve socket yazımı `wsconn` yazıcı goroutine'inde yapılır; room hazır,
  değişmez snapshot değerleri gönderir.
- Her dosya ~300 satırı aşmaz.

## 3. Simülasyon

Birimler: metre, saniye, radyan. Sabit adım `dt = 1/60`. Y ekseni yukarı.

### 3.1 Uçak tablosu (`sim/aircraft.go`; denge testiyle ayarlandı: F-15 pitch 1.3→1.36, Su-27 kilit 1200→1100)

| Alan | F-16 | F-15 | MiG-29 | Su-27 |
|---|---|---|---|---|
| Takım | NATO | NATO | Sovyet | Sovyet |
| Can | 90 | 120 | 100 | 110 |
| Maks hız (m/s, AB'siz / AB) | 230 / 290 | 240 / 310 | 225 / 285 | 245 / 315 |
| Roll hızı (rad/s) | 4.2 | 3.0 | 3.4 | 3.1 |
| Pitch hızı (rad/s, köşe hızında) | 1.6 | 1.36 | 1.75 | 1.4 |
| Yaw hızı (rad/s) | 0.5 | 0.45 | 0.5 | 0.45 |
| İtki ivmesi (m/s², tam gaz) | 48 | 44 | 46 | 45 |
| Köşe hızı (m/s) | 170 | 185 | 150 | 175 |
| Füze / flare | 2 / 6 | 4 / 6 | 2 / 8 | 3 / 6 |
| Füze kilit menzili (m) | 900 | 1000 | 900 | 1100 |

FFA'da her uçak serbest; takımlı modda oyuncu kendi takımının iki uçağından birini seçer.
Tablo `welcome` mesajıyla client'a gider; TS fizik sabitlerini kendisi tutmaz.

### 3.2 Uçuş modeli (arcade)

- Durum: konum, yönelim (quaternion), hız büyüklüğü `v`, hız yönü (vektör), gaz `[0,1]`, AB.
- Hız: `dv = (thrust − k·v² − g·fwd.y)·dt`, `k = accel/maxSpeed²` (tam gaz maks hızda dengelenir),
  `g = 14`. `thrust = accel·gaz`; AB'de gazdan bağımsız `k·maxSpeedAB²`; turbo itkiyi ×1.69
  yapar (denge hızı ×1.3). Hız **20 m/s'nin altına inmez** (uçak hiç durmaz).
- `v < stallSpeed (90 m/s)` iken pitch/yaw yetkisi %30'a iner, **roll %50'de kalır**
  (`max(yetki, 0.5)`), burun hızla orantılı olarak yere doğru düşer.
- Dönüş yetkisi: stall'da 0.3 → köşe hızında 1.0 (lineer), üstünde lineer düşer ve
  **AB maks hızında (`maxSpeedAB`) 0.6** olur.
- Hız yönü burun yönüne `slip = 3/s` ile yaklaşır → hafif kayma hissi.
- Input: `pitch, roll, yaw ∈ [−1,1]`, `throttle ∈ [0,1]`, `ab, fire, missile, flare bool`.
- Harita: 8×8 km ada, etrafı deniz. Tavan 3000 m (yumuşak: tavanda dikey hız kesilir,
  burnu yukarıda kalan uçak hız kaybeder). Sınır dışı: 5 sn uyarı, sonra 10 can/sn.
- Arazi/deniz ile temas = ölüm (kendi kendine çakma, −1 puan).
- Uçak–uçak: küre (r=9 m); temas anında her ikisine `0.5·göreli hız` hasar.

### 3.3 Silahlar

- **Top:** 15 atış/sn, mermi hızı 900 m/s + uçak hızı, ömür 1.2 sn, hasar 6. Isı: atış
  başına +0.04, soğuma 0.25/sn; 1.0'da 2 sn kilit. İsabet: tick başına mermi yolu
  (segment) ile uçak küresi (r=7 m) kesişimi (swept).
- **Füze:** Kilit, hedef 20°'lik koni (yarı açı 10°) ve kilit menzili içinde 1 sn kalınca oluşur. Hız
  420 m/s, dönüş limiti 3.2 rad/s, öne nişanlı takip (lead pursuit), yakıt 7 sn, yakınlık
  tapası 12 m, hasar 70, atışlar arası 1 sn. Sınırlı sayıda; spawn ve power-up ile dolar.
  Sahibi odadan çıkan füze bir sonraki tick'te `mgone` olayıyla biter.
- Top mermisi aynı tick içinde birden fazla uçağın küresinden geçerse, yol üzerinde en yakın
  olan vurulur.
- **Flare:** 1 sn bekleme; atıldığında 600 m içindeki, o uçağı takip eden her füze %65
  ihtimalle flare'e sapar (PRNG ile, deterministik).

### 3.4 Power-up'lar

Sabit 8 noktada süzülen kasalar; alınınca 20 sn sonra yeniden çıkar. Toplama yarıçapı 30 m (tick başı swept).
`missiles` (+2, tavan tablodaki sayı), `repair` (+50 can), `shield` (8 sn hasar yok),
`turbo` (10 sn maks hız ×1.3, top ısınmaz).

### 3.5 Ölüm ve spawn

Can 0 → patlama olayı, 3 sn sonra takımın spawn bölgesinde 1500 m irtifada, 200 m/s ile
yeniden doğma; 2 sn spawn koruması (hasar yok, ateş edince biter).

## 4. Modlar (`internal/mode`)

- **Takımlı:** NATO vs Sovyet, takım başı 1–6; boş yerleri bot doldurur. 25 takım kill'i
  veya 8 dk. Dost ateşi kapalı.
- **FFA:** boyut 2–12 (toplam koltuk); boş koltukları bot doldurur.
  15 kill veya 8 dk.
- Puan: kill +1, kendi çakması −1. Raund sonu skor tablosu, 10 sn sonra yeni raund.
- Oda ayarları (kuran seçer): mod, boyut, bot zorluğu, harita seed'i (boşsa rastgele).
- İnsan katılınca bir bot hemen çıkar (takım dengesi katılımda kurulur); insan çıkınca
  yerine bot girer.
- Katılan insan skor tablosunda görünür ama **uçağı ilk `pick` ile doğar**; 15 sn içinde
  seçmezse takımının varsayılan uçağıyla doğar (HUD geri sayar). Raund sonu ekranı sırasında
  seçim/zaman aşımı olursa yeni raundla birlikte tek bir spawn ile doğar.
- Koruma süresindeki uçak için `pick` her hayatta bir kez anında yeniden doğurur (koruma
  uzamaz); diğer seçimler sonraki doğuşta geçerli olur.
- Takım arkadaşına çarpmak hasar verir; çarpan için skor değişmez, çarpılan yalnızca ölüm
  alır (−1 yok: takım arkadaşı çarparak puan düşüremez).
- "Berabere" berabere sonucunu ifade eder; oyuncu ismi olarak ayrılmıştır.

## 5. Botlar (`internal/bot`)

Durum makinesi, 10 Hz düşünme (botlar tick'lere dağıtılır), aradaki tick'lerde son karar
uygulanır. Her durumda önce **arazi kaçınma**: önündeki 3 sn'lik yörünge arazi + 150 m'nin
altına iniyorsa burnu kaldır.

Öncelik sırası (uygulanan, karar kaydıyla):

1. **Kaçış:** kendisine kilitli füze varsa sert dönüş + flare.
2. **Toplama:** can < %40 veya füze 0 ise en yakın uygun power-up.
3. **Saldırı:** en yakın/en tehlikeli düşmanı seç; öne nişan noktasına otopilotla dön;
   açı hatası < 3° ve menzil < 800 m ise top; kilit varsa füze. Çarpışma riski varsa
   kırma dönüşü.
4. **Devriye:** haritanın ortasına doğru, 1200 m irtifada dolaş.

**Otopilot:** hedef yönü → stick input'ları (roll ile hizala, pitch ile çek; PD denetleyici).
Aynı mantık client'ta fare-nişan modu için TS'te de var (yalnızca input üretir, eşleşmesi
gerekmez).

**Zorluk:** kolay / normal / zor → tepki gecikmesi 600/300/120 ms, nişan hatası 4°/2°/0.7°,
flare kullanım ihtimali %30/%70/%95.

## 6. Netcode

JSON, her mesajda `t` alanı. Protokol sürümü `hello` içinde.

Alan adları uygulanan haliyle (`internal/protocol`, `client/src/net/protocol.ts`):

**Client → sunucu:** `hello{v,name}`, `create{mode: team|ffa, size, diff: easy|normal|hard, seed}`,
`join{code}`, `pick{kind: f16|f15|mig29|su27}`, `in{seq,p,r,y,th,ab,f,m,fl}` (60 Hz, `seq` 1'den
başlar), `ping{ts}` (her 15 sn; sunucu 30 sn mesajsız bağlantıyı kapatır).

**Sunucu → client:**
- `welcome{you,code,mode,aircraft[],terrain{size,res,heights(base64 LE uint16),spots[],seed},tick}`
- `snap{tick,ack,planes[],missiles[],pu[],ev[]}` (30 Hz). Uçak: `{id,k,tm,p,q[w,x,y,z],v,th,hp,a,
  ht,oh,ms,fl,lk?,lp?,ld?,sh?,tb?,pr?,oob?,ab?,rs?}`; füze `{id,tg,p,v}`; power-up `{s,k,a}`.
- Olaylar snapshot içinde `ev[]`: `{k,tick,a,b?,p?,v?,val?,w?,item?}`, `k` ∈ `fire|hit|kill|lock|
  spawn|pickup|flare|mlaunch|mgone`, `w` ∈ `cannon|missile|crash|ram|bounds`,
  `item` ∈ `missiles|repair|shield|turbo`.
- `round{phase: playing|ended, left(tick), winner?, nato, soviet, board[{id,k,d,s}]}` (her saniye,
  faz veya takım skoru değişince), `players{list[{id,name,team,kind,bot}]}` (liste değişince), `pong{ts}`,
  `error{msg}` (Türkçe; client için ölümcül).

- **Kendi uçağın:** prediction; snapshot gelince `ack`'e kadar olan input'lar atılır,
  sunucu state'inden kalan input'lar yeniden oynatılır; görsel düzeltme 100 ms'de yumuşatılır.
- **Diğer uçaklar:** 100 ms interpolation buffer, quaternion slerp.
- **Mermiler:** snapshot'ta yok; `fire` olayından client simüle eder. Kendi mermin anında çizilir.
- **Füzeler:** az sayıda, snapshot'ta.
- **Sağlamlık:** input'lar sunucuda clamp edilir (NaN/Inf nötrlenir); bozuk mesaj → bağlantı
  kesilir. Sunucu oyuncu başına 8 input tamponlar, tick'te 4'ten fazla birikmişse fazlasını
  atar (atılanlardaki füze/flare basışı korunur); kuyruk boşsa son input'u füze/flare'siz
  tekrarlar. Yazıcı kuyruğu 64 mesaj; dolarsa en eski snapshot düşer (olayları sonraki snapshot'a aktarılır; hata hiç düşmez),
  2 sn boyunca dolu kalırsa bağlantı kesilir.
  Kopma sonrası client 0.5→8 sn artan aralıkla yeniden bağlanır ve odaya yeni oyuncu olarak katılır.
- `-lag 100ms` flag'i: sunucu tarafında yapay gecikme (test için).

## 7. Client (`client/src`)

- `net/`: socket, yeniden bağlanma, mesaj tipleri.
- `predict/`: TS uçuş modeli (Go ile aynı formüller), input geçmişi, reconcile.
- `render/`: sahne (arazi vertex renkleri, deniz, gökyüzü gradyanı, sis, bulutlar), prosedürel
  uçak modelleri (F-16 tek kuyruk, F-15 çift kuyruk/kutu giriş, MiG-29 ve Su-27 çift kuyruk,
  kanat-gövde birleşimi), takım renkleri, AB alevi, kanat ucu izi, hasar dumanı, tracer'lar,
  füze izi, patlama ve kıvılcım parçacıkları. `.glb` varsa onu yükler.
- `camera`: yumuşak takip, hızla artan FOV, geri bakma (C tuşu). Kendi uçağın konumu ve
  yönelimi, kare başına kalan tick süresiyle ileri taşınır (her ekran hızında akıcı).
- `input/` (uygulanan haliyle): fare-nişan (otopilot) ve klavye şemaları; varsayılan fare-nişan.
  - Fare-nişan (pointer lock): fare nişan yönü verir (burnun 60° konisiyle sınırlı);
    W/S gaz, Shift AB, A/D ek yatış (roll), sol tık top, sağ tık füze, Space flare, C geri bak.
  - Klavye: W/S pitch (W burun aşağı; "Y ters" değiştirir), A/D roll, Q/E yaw, R/F gaz,
    X AB, Space top, V füze, G flare, C geri bak.
  - Ortak: Tab (basılı) skor tablosu, P uçak seçimi, Esc ayarlar. Menü açıkken Tab/Space/oklar
    tarayıcı davranışını korur (odak, butonlar).
- `audio/`: Web Audio ile prosedürel motor, top, füze, kilit tonu, uyarı, patlama.
- `ui/` (DOM): ana sayfa, oda/uçak seçimi, ayarlar (şema, hassasiyet, Y ters, ses; localStorage),
  HUD (hız, irtifa, gaz/AB, ısı, can, füze/flare, kilit/füze uyarısı, radar, kill feed,
  Tab skor tablosu), raund sonu ekranı.
- Hedef: dizüstü dahili GPU'da 60 fps. Mermi ve parçacıklar instanced çizilir.

## 8. Hata yönetimi

- Sunucu: oda goroutine'inde panic → oda kapanır, log'lanır, oyuncular ana sayfaya düşer;
  süreç ayakta kalır.
- Geçersiz oda kodu → `error{msg:"oda bulunamadı"}`, ana sayfa.
- Client: WebGL yoksa açıklayıcı ekran; bağlantı koparsa banner + yeniden bağlanma.

## 9. Test ve doğrulama

- **Go birim:** sim (stall, çakma, isabet/swept, füze takibi, flare, power-up, spawn koruması),
  terrain (örnekleme), mode (skor, raund bitişi), bot (arazi kaçınma, hedef seçimi).
- **Headless bot maçları:** 4v4 normal bot, 3 dk simüle (10 farklı seed): her maçta toplam
  kill ≥ 15 ve bot başına çakma < 0.5/dk.
- **Denge:** her uçak eşleşmesi için 1v1 zor bot maçları (200 tekrar); kazanma oranı %40–60.
- **Entegrasyon:** `httptest` sunucusu + gerçek WebSocket client: oda kur, katıl, input gönder,
  snapshot al, `ack` ilerliyor mu.
- **Ortak vektörler:** Go, 10 senaryoluk çok tick'lik uçuş yörüngelerini (stall, AB, dalış,
  turbo, sınır) `testdata/vectors/*.json`'a yazar; TS testi (`node --test`) aynı sonucu
  `1e-3` toleransla doğrular.
- Hepsi `go test ./... -race`; `go vet`.
- **Uçtan uca:** binary çalıştırılır, Chrome'da açılır, botlu odada sahne render'ı ekran
  görüntüsüyle, konsolda hata olmadığı ve uçağın hareket edip ateş ettiği doğrulanır;
  `-lag 100ms` ile hissin kabul edilebilirliği gözlenir.

## 10. Çalıştırma

```
cd client && npm install && npm run build   # cmd/dogfight/web üretir
go run ./cmd/dogfight -addr :8080           # http://localhost:8080
```
LAN'dan katılım: `http://<makine-ip>:8080/r/KOD`. Tüm flag'ler ve üretim adımları README'de.


## 11. Plan düzeltmeleri ve üretim

Yukarıdaki 4 sayı plan Task 0 ile düzeltildi (ısı, kilit yarı açısı, lead pursuit, toplama yarıçapı).
Kapsam değişikliği (kullanıcı talebi, 2026-10-06): oyun herkese açık bir sunucuda (`PUBLIC_HOST`, ör. `dogfight.example.com`) yayınlanır; §1'deki "deploy/Dockerfile kapsam dışı" maddesi geçersizdir. Herkese açık internette çalıştığı için bağlantı/oda/mesaj limitleri, origin kontrolü ve rate limit gerekir.

### 11.1 Üretim mimarisi (uygulanan)

```
tarayıcı ─TLS→ Cloudflare (proxy) ─TLS, origin cert→ nginx ─HTTP, edge ağı→ dogfight:8080
```

- **Build:** `scripts/release.sh` (temiz ağaç şart) istemciyi derler ve statik `linux/arm64`
  binary üretir (`dist/`, git dışı). `scripts/deploy.sh` binary'yi gönderir, sunucuda distroless
  runtime imajı (`Dockerfile.runtime`) kurar, healthcheck'i bekler; healthy değilse önceki
  sürüme döner. Her sürüm kendi compose dosyasıyla başlar; `current`/`previous` dosyaları
  geri dönüş hedefini tutar (`--rollback <sürüm>`).
- **Edge ağı:** container port yayınlamaz; nginx container'ının docker ağına (`EDGE_NETWORK`,
  `deploy/deploy.env`) `dogfight` adıyla katılır. nginx onu docker DNS'iyle
  (`resolver 127.0.0.11 valid=10s ipv6=off`) değişken `proxy_pass` ile bulur.
  `-trust-proxy` yalnızca bu ağın IPv4 subnet'idir (deploy `docker network inspect` ile bulur).
- **nginx:** yalnızca Cloudflare aralıkları (`geo $realip_remote_addr`, aksi 403); istemci
  IP'si `CF-Connecting-IP` → `X-Real-IP`; `/ws` upgrade, 120 sn timeout, buffering kapalı;
  80 → 443 yönlendirme.
- **Container:** read-only kök FS, uid 65532, `cap_drop: ALL`, `no-new-privileges`,
  256 MB (`GOMEMLIMIT=200MiB`), 1 CPU, 128 pid, `-healthcheck` ile sağlık kontrolü,
  `SIGTERM`'de 9 sn içinde boşaltma (oyunculara close frame).
- **Limitler (varsayılan, flag ile ayarlı):** 128 soket toplam, adres başına 6; en fazla
  16 oda; adres başına 3 oda kurma/dk (token atomik alınır, başarısız kurmada iade edilir);
  10 başarısız, 20 başarılı katılma/dk; bağlantı başına 90 mesaj/sn, patlama 120; pick ve ping ayrı
  sınırlı; mesaj ≤ 1 KB; el sıkışma 5 sn; 30 sn sessiz bağlantı kapanır; hiç kullanılmayan
  oda 15 sn, boşalan oda 60 sn sonra kapanır. Adres tablosu sınırlıdır (65 536 anahtar).
- **Başlıklar:** CSP (`default-src 'self'`, `connect-src 'self'` + `-public-origin`,
  `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`),
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy: same-origin`; HSTS Cloudflare'de. Dizin listesi yok;
  `/models/*` bir gün önbellekte, diğer dosyalar `no-cache`.
- **WebSocket origin:** yalnızca `-origin` listesi (üretimde `PUBLIC_HOST`).
