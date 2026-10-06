# Dogfight

Tarayıcıda oynanan, 3D arcade, çok oyunculu jet it dalaşı. Sunucu Go'da yazılmıştır ve oyunun
tek otoritesidir (60 Hz simülasyon). İstemci TypeScript ve Three.js ile yazılmıştır. İstemci
derlenip Go binary'sine gömülür, yani sunucu tek bir dosyadır.

- 4 jet: F-16 ve F-15 (NATO), MiG-29 ve Su-27 (Sovyet).
- Silahlar: top, ısı güdümlü füze, flare; Üs Saldırısı modunda bomba.
- 3 power-up: füze, tamir, turbo.
- Üç mod: takımlı, herkes herkese (FFA) ve **Üs Saldırısı** (rakibin 6 yapısını yık; ya da
  10 dk sonunda kalan yapı canı fazla olan kazanır).
- Üç zorlukta botlar (kolay, normal, zor). Botlar pistten kalkar, iner ve ikmal yapar.
- 4 prosedürel harita (Ada, Şehir, Çöl, Dağ; seed'li) ve 6 hava durumu (Açık, Bulutlu, Sisli,
  Yağmurlu, Fırtına, Gece; rüzgâr uçuşu etkiler, kötü havada füze kilit menzili kısalır).
- İki başlangıç: **Havada** (varsayılan; takımlar haritanın iki ucundan doğar) ya da **Pist**
  (hangarda doğ, taksi yap, pistten kalk).
- İniş takımı, fren, taksi; üsse inip durunca 3 sn'de ikmal ve tamir.
- Oda listesi, **Hızlı Oyna** (uygun açık odaya katılır, yoksa oda kurar), açık/özel oda.
- Hızlı sohbet: 6 hazır mesaj (1–6; takım modlarında yalnız takıma).
- Kalıcı pilot kartı (anonim token, hesap yok) ve haftalık / tüm zamanlar liderlik tablosu.
- Mobil: yatay ekranda dokunmatik çubuk, gaz ve düğmeler; isteğe bağlı eğimle nişan.
- Füze kamerası (resim içinde resim), killcam, izleyici modu ve son 10 sn tekrar.
- Prosedürel jet sesi (motor, AB, rüzgâr), low-poly modeller.

Canlı sürüm: https://dogfight.ahmetbirinci.dev

## Gereksinimler

- Go 1.26 (`go.mod`)
- Node 22 ve npm. Yalnızca istemciyi derlemek için gerekir. Bu depoda Node 22
  `.tools/node/bin` altında durur: `export PATH=$PWD/.tools/node/bin:$PATH`.
- WebGL destekleyen güncel bir tarayıcı (Chrome, Firefox, Safari).

Go tarafının tek dış bağımlılığı `github.com/coder/websocket` paketidir. İstemcinin runtime
bağımlılığı yalnızca `three`, geliştirme bağımlılıkları ise `esbuild` ve `typescript`'tir.

## Derleme

```sh
cd client && npm install && npm run build   # cmd/dogfight/web/ üretir (DEBUG=false)
cd .. && go build ./cmd/dogfight            # istemci gömülü tek binary: ./dogfight
```

`npm run build` şunları yapar:
- `client/src` kodunu esbuild ile `cmd/dogfight/web/app.js` dosyasına derler (minify; source map yok, `watch`'un bıraktığı `app.js.map` silinir).
- `client/static/` altındaki her şeyi (`index.html`, `style.css`, `favicon.svg`, `models/`)
  `cmd/dogfight/web/` altına kopyalar.
- `cmd/dogfight/web/models/manifest.json` dosyasını yazar.

İstemci derlenmeden çalıştırılan sunucu, ana sayfada "client derlenmemiş" der.

## Çalıştırma

```sh
go run ./cmd/dogfight                  # http://localhost:8080
go run ./cmd/dogfight -addr :9000      # başka port
go run ./cmd/dogfight -lag 100ms       # yapay gecikmeyle test
```

Tarayıcıda `http://localhost:8080` adresini aç, ismini yaz, odayı kur ve uçağını seç.
Oda kodunu ya da "Linki kopyala" ile aldığın `/r/KOD` linkini arkadaşına gönder.

### Flag'ler

| Flag | Varsayılan | Açıklama |
|---|---|---|
| `-addr` | `:8080` | Dinlenecek adres |
| `-lag` | `0` | Sunucudan istemciye yapay gecikme (ör. `100ms`); yalnızca test için |
| `-origin` | boş | İzin verilen WebSocket Origin host'ları, virgülle ayrılır. Boş bırakılırsa yalnızca aynı host kabul edilir |
| `-trust-proxy` | boş | `X-Real-IP` başlığına güvenilecek proxy CIDR'ları, virgülle ayrılır. Boş bırakılırsa hiçbir proxy'ye güvenilmez |
| `-public-origin` | boş | CSP `connect-src` için ek kaynaklar (ör. `wss://dogfight.example.com`) |
| `-log` | `text` | Log biçimi: `text` veya `json` |
| `-version` | | Sürümü yazar ve çıkar |
| `-healthcheck URL` | | URL'ye GET atar; 200 dönerse çıkış kodu 0, aksi halde 1 (container sağlık kontrolü) |
| `-max-rooms` | `16` | Aynı anda açık oda sayısı (`0` = sınırsız) |
| `-max-conns` | `128` | Sunucu genelinde açık oyun soketi |
| `-max-conns-ip` | `6` | Adres başına açık oyun soketi |
| `-create-per-min-ip` | `3` | Adres başına dakikada oda kurma |
| `-join-fail-per-min-ip` | `10` | Adres başına dakikada başarısız katılma |
| `-join-per-min-ip` | `20` | Adres başına dakikada başarılı katılma |
| `-msg-rate` | `90` | Bağlantı başına saniyede gelen mesaj |
| `-msg-burst` | `120` | Bağlantı başına mesaj patlaması (yaklaşık 2 sn'lik input) |
| `-data` | boş | Pilot istatistiklerinin dizini (`pilots.jsonl` günlük, `pilots.snap.json` anlık görüntü; dizin 0700, dosyalar 0600). Boşsa istatistik kapalıdır; dizin açılamaz ya da yazılamazsa sunucu `stats disabled` log'lar ve oyun istatistiksiz çalışır |
| `-metrics-addr` | boş | Prometheus metin formatında `GET /metrics` dinleyicisi (ör. `127.0.0.1:9090`). Boşsa kapalıdır. Asla yayınlama |
| `-get URL` | | URL'ye GET atar, gövdeyi (en çok 1 MB) stdout'a yazar; 200 ise çıkış kodu 0, aksi halde 1 (distroless'ta curl yok) |
| `-drain-max` | `30m` | `SIGUSR1` (boşaltma) sonrası en geç bu sürede çıkar; son oyun soketi kapanınca daha erken |
| `-stats-wait` | `40m` | Başka bir sunucunun `-data` kilidini (`stats.lock`) bırakmasını en çok bu kadar bekler; sonra `stats disabled` |

`-max-rooms` dışındaki limit flag'lerinde `0` değeri varsayılanı seçer.

`/api/*` uç noktaları (yalnız GET/HEAD, JSON, `no-store`, adres başına 120/dk ortak limit):
- `/api/rooms`: açık odalar (1 sn önbellek).
- `/api/leaderboard?period=week|all`: ilk 20 (10 sn önbellek).
- `/api/me`: `X-Pilot-Token` başlığıyla kendi pilot kartın; token yok, geçersiz ya da bilinmiyorsa
  `{"pilot":null}`. İstatistik kapalıysa leaderboard ve me 503 döner.

`SIGINT` veya `SIGTERM` gelince sunucu yeni bağlantı almaz. Açık odaları kapatır, oyunculara
close frame gönderir ve en geç 9 sn içinde çıkar.

`SIGUSR1` sunucuyu **boşaltır** (blue/green deploy'un eski rengi):
- Odadaki oyuncular oynamaya devam eder.
- Yeni her soket `1012` ("sunucu güncelleniyor, yeniden bağlan") ile kapanır; `/api/*` 503 döner.
- İstatistik deposu hemen kapanır: son anlık görüntü yazılır, `/data/stats.lock` bırakılır ve yeni
  sürümün deposu açılır.
- Son oyun soketi kapanınca ya da `-drain-max` dolunca sunucu normal kapanışla çıkar. Bu durumda
  kalan oyunculara da `1012` gider.

İstemci `1012` alınca "Sunucu güncelleniyor, yeniden bağlanılıyor…" gösterir ve aynı oda koduyla yeniden
bağlanır. Oda yeni sunucuda yoksa ana sayfaya dönmeyi öneren bir mesaj çıkar.

`SIGUSR2` boşaltmayı ya da istatistik bırakmayı geri alır (geri dönüş): sunucu yeniden yeni oyuncu
kabul eder ve istatistik kilidini bekler.

`SIGWINCH` yalnız istatistik deposunu bırakır: açık skorları yazar, son anlık görüntüyü kaydeder ve
kilidi bırakır. Sunucu oyuncu kabul etmeye devam eder ve kendiliğinden çıkmaz. Bunu eski container'a
geri dönüş (`legacy-rollback.sh`) kullanır.

İstatistik deposu `-data` dizinini `flock` ile kilitler. Aynı dizini aynı anda yalnız bir sunucu yazar.
Kilit doluyken açılan sunucu oyunu hemen başlatır; deposu kilit boşalınca açılır. O ana kadarki
skorlar bellekte bekler (en çok 512 kayıt).

## LAN'dan katılım

Sunucu varsayılan olarak tüm arayüzlerde dinler (`-addr :8080`). Aynı ağdaki bir cihazdan
`http://<makine-ip>:8080` adresine gir, ya da doğrudan `http://<makine-ip>:8080/r/KOD` linkini aç.
Gerekirse güvenlik duvarında 8080 portuna izin ver. `-origin` boş kaldığında sayfa hangi
host'tan açıldıysa WebSocket de yalnızca o host'tan kabul edilir. LAN için bu yeterlidir.

## Kontroller

Şemayı Esc ile açılan ayarlar menüsünden seçersin. Varsayılan şema fare-nişandır; dokunmatik
cihazda dokunmatik şema açılır. Ayarlar `localStorage`'da saklanır: şema, fare hassasiyeti,
Y ekseni ters, G efektleri, performans modu, eğimle nişan ve ses.

**Fare-nişan** (pointer lock; kilidi almak için tuval üzerine tıkla)

| Tuş | İşlev |
|---|---|
| Fare | Nişan yönü. Otopilot burnu o yöne çevirir. Nişan burnun 60° konisinde kalır |
| W / S | Gaz artır / azalt |
| Shift | Afterburner |
| A / D | Ek yatış (roll), sola / sağa |
| Sol tık | Top |
| Sağ tık / E | Füze (kilit varken; Mac trackpad: iki parmak tık veya ctrl+tık). Kilit yokken basınca HUD "KİLİT YOK" der |
| Space | Flare |
| H / orta tık | Bomba (Üs Saldırısı) |
| C | Geri bak |

**Klavye**

| Tuş | İşlev |
|---|---|
| W / S | Pitch. W burnu indirir (uçuş simülatörü geleneği). Ayarlardaki "Y ters" bunu değiştirir |
| A / D | Roll (sola / sağa) |
| Q / E | Yaw (sola / sağa) |
| R / F | Gaz artır / azalt |
| X | Afterburner |
| Space | Top |
| V | Füze (kilit varken) |
| G | Flare |
| H | Bomba (Üs Saldırısı) |
| C | Geri bak |

**Her iki şemada**

| Tuş | İşlev |
|---|---|
| L | İniş takımı aç / kapa |
| B (basılı tut) | Tekerlek freni (yerde) |
| 1–6 | Hızlı sohbet: Arkandayım!, Yardım lazım!, Hedefe saldırıyorum, Üsse dönüyorum, Tamam, Teşekkürler (2 sn'de 1) |
| R | Ölünce: son 10 sn tekrarını başlat / atla (klavye şemasında uçarken gaz artırır) |
| ← / → | Uçağın yokken izlenen uçağı değiştir |
| Tab (basılı tut) | Skor tablosu |
| P | Uçak seçimi. Koruma süresinde seçim hemen geçerli olur, aksi halde sonraki doğuşta |
| Esc | Ayarlar menüsü (fare-nişanda pointer lock'u da bırakır) |

**Dokunmatik** (telefonu yatay tut)

| Kontrol | İşlev |
|---|---|
| Sol yarı (yüzen çubuk) | Burun / yatış; bırakınca düzler |
| Sol kenar | Gaz kaydırıcısı (GAZ) |
| ATEŞ | Top (basılı) |
| FÜZE / FLARE / BOMBA | Tek basış (BOMBA yalnız Üs Saldırısı'nda görünür) |
| AB | Afterburner aç / kapa |
| TEKER / FREN | İniş takımı / fren |
| SOHBET | 6 hazır mesajlık menü |
| GERİ | Geri bak (basılı) |
| MENÜ / UÇAK / SKOR | Ayarlar / uçak seçimi / skor tablosu (basılı) |
| Eğim | Ayarlarda "Eğimle nişan" açıksa, çubuk boştayken cihaz eğimi nişan alır |

Pist başlangıcında uçak hangarda park freniyle bekler; gaz verince bırakır. Gazı aç, kalkış
hızında burnu kaldır, havalanınca tekeri topla (L). Pist dışında motor uçağı 28 m/s'nin (~100 km/s)
üstüne itemez; pist dışında 35 m/s üstü teker teması ya da sert iniş düşürür. Kendi üssünde durunca
(≤ 3 m/s) 3 sn'de füze, flare, bomba ve can dolar.

Odaya giren oyuncunun uçağı ilk uçak seçimiyle doğar. 15 sn içinde seçim yapmazsa takımının
varsayılan uçağıyla doğar. HUD bu süreyi geri sayar.

## Özel `.glb` modeller

Her uçak kodla üretilmiş bir low-poly modelle gelir. Bunun yerine kendi modelini kullanmak için:

1. Modeli `client/static/models/<kind>.glb` olarak koy. `<kind>` şunlardan biridir: `f16`,
   `f15`, `mig29`, `su27`.
   - Model yönü: burun yerel **−Z**, sağ kanat **+X**, üst **+Y**.
   - Birim metredir; uçağın orijini merkezinde olmalıdır.
2. `cd client && npm run build` komutunu çalıştır.
   - Build dosyayı `cmd/dogfight/web/models/` altına kopyalar.
   - `models/manifest.json` dosyasına o uçak türünü yazar.
3. Go binary'sini yeniden derle (`go build ./cmd/dogfight` ya da `go run ./cmd/dogfight`).
   Modeller binary'ye gömülür.

İstemci yalnızca manifest'te listelenen modelleri ister, yani eksik bir dosya için istek
atılmaz. Listelenen bir model yüklenemezse konsola uyarı yazar ve yerleşik modeli kullanır.
Takım rengi, AB alevi ve isim etiketi her iki modelde de çizilir. Modeller tarayıcıda bir gün
önbellekte tutulur.

## Geliştirme

İki terminal kullan:

```sh
# 1) istemci: DEBUG build, her kayıtta yeniden derler
export PATH=$PWD/.tools/node/bin:$PATH
cd client && npm run build && npm run watch

# 2) sunucu
go run ./cmd/dogfight
```

- `npm run watch` yalnızca `app.js` dosyasını yeniden üretir (`DEBUG=true`).
  - `client/static/` altındaki değişiklikler (`index.html`, `style.css`, modeller) için
    `npm run build` komutunu tekrar çalıştır.
  - Go `embed` kullandığı için web dosyaları değişince `go run` komutunu yeniden başlat.
- DEBUG build'de konsolda `debugGame` nesnesi bulunur (`state`, `renderer`).
- Yine yalnızca DEBUG build'de, sunucusuz test sahneleri açılır:
  - `?debug=fly`: tek uçaklı uçuş sahnesi.
  - `?debug=terrain`: arazi sahnesi.
  - `?debug=models`: uçak modelleri sahnesi.
  - `?debug=fx`: efekt sahnesi.
- Commit ve deploy öncesinde `cmd/dogfight/web` klasörünü `npm run build` ile üretim
  build'ine (`DEBUG=false`) döndür.

## Test

```sh
go build ./... && go vet ./... && go test ./... -race     # Go: tüm paketler
go test ./... -short                                        # uzun maç simülasyonları hariç
go test ./internal/game/ -run TestBalance -v -balance       # denge: 1v1 zor bot, 200 tekrar/eşleşme, %40–60

cd client && npm run check && npm test && npm run build     # TS tip kontrolü, node --test, prod build
```

Uçuş modeli Go'da (`internal/sim/flight.go`) ve TS'te (`client/src/sim/flight.ts`) aynı
formüllerle yazılmıştır. Go, ortak uçuş senaryolarını `testdata/vectors/flight.json`
dosyasına yazar ve TS testi aynı yörüngeyi `1e-3` toleransla doğrular. Sim kodunu
değiştirdiysen vektörleri yeniden üretmek için şunu çalıştır:

```sh
go test ./internal/sim/ -run TestFlightVectors -update
```

## Üretim

Trafik şu yoldan geçer:

```
Cloudflare (proxy, TLS strict) → nginx container'ı (origin cert) → canlı renk (dogfight-blue | dogfight-green)
```

Sunucuya özgü bütün değerler `deploy/deploy.env` dosyasındadır (git'e girmez). Şablondan kopyala
ve doldur:

```sh
cp deploy/deploy.env.example deploy/deploy.env
```

| Anahtar | Anlamı |
|---|---|
| `DEPLOY_HOST` | Sunucunun ssh hedefi (`~/.ssh/config` alias'ı) ya da `local` (komutlar bu makinede çalışır) |
| `DEPLOY_DIR` | Sunucuda compose/env dosyaları, deploy kilidi ve yedekler için dizin (ör. `/srv/dogfight`) |
| `NGINX_CONTAINER` | Oyunu proxy'leyen nginx container'ının adı |
| `NGINX_CONF` | Sunucuda `set $dogfight_upstream ...;` satırını içeren vhost dosyası (container'a tek dosya bind-mount) |
| `EDGE_NETWORK` | nginx ile dogfight container'larının paylaştığı harici docker ağı |
| `PUBLIC_HOST` | Oyunun herkese açık alan adı (`-origin` ve `-public-origin=wss://…`) |
| `DRAIN_MAX` | Boşalan rengin oyuncularını en çok ne kadar tuttuğu (ör. `30m`) |

Dosya yoksa ya da bir anahtar eksikse `scripts/deploy.sh` hiçbir şey yapmadan durur. Ortamda
tanımlı bir değişken dosyadakini ezer; `DEPLOY_ENV` başka bir dosya gösterir.

### 1. Release

```sh
scripts/release.sh
```

- Çalışma ağacı temiz değilse reddeder.
- `.tools` altındaki Node 22 ile `npm ci && npm run build` çalıştırır.
- Statik bir `linux/arm64` binary üretir: `dist/dogfight-linux-arm64`.
- Sürümü `dist/VERSION` dosyasına yazar (`git describe`).
- `dist/` git'e girmez.

### 2. Deploy (sıfır kesinti, blue/green)

```sh
scripts/deploy.sh              # dist/ sürümünü canlıya al
scripts/deploy.sh --status     # canlı renk, sürümler, açık soketler
scripts/deploy.sh --doctor     # değişmezler: nginx'in hedefi çalışıyor ve healthy, tek canlı sunucu,
                               # bayat yardımcı yok, nginx -t geçiyor (sorun varsa çıkış kodu 1)
```

İki renk vardır: `dogfight-blue` ve `dogfight-green`. İkisi de aynı adlı compose projesi ve container
olarak çalışır. Hangisinin canlı olduğunu nginx belirler: `NGINX_CONF` içindeki tek
`set $dogfight_upstream http://dogfight-<renk>:8080;` satırı.

Script şu adımları izler:
1. `DEPLOY_HOST` üzerinden sunucuya bağlanır. Boştaki renk hâlâ başka bir sürümle boşalıyorsa
   hiçbir şey göndermeden durur ve açık soket sayısını yazar.
2. `DEPLOY_DIR` altına şunları gönderir: binary, `Dockerfile.runtime`, `compose-<sürüm>.yml`,
   `switch-upstream.sh`, `legacy-handoff.sh` ve `legacy-rollback.sh`. Sonra imajı kurar (`dogfight:<sürüm>`).
3. Yeni sürümü **boştaki renkte** başlatır ve healthcheck'i bekler (45 × 2 sn). Healthy değilse
   onu durdurur. Canlı renk hiç değişmez.
4. nginx'i yeni renge çevirir (`deploy/switch-upstream.sh`):
   - `NGINX_CONF` tek dosya bind-mount olduğu için dosya yerinde yazılır (`cat yeni > <conf>`;
     inode korunur, `sed -i`/`mv` kullanılmaz).
   - Sırayla `nginx -t`, `nginx -T` (container yeni satırı görüyor mu) ve `nginx -s reload` çalışır.
   - Herhangi biri başarısız olursa eski dosya geri yazılır, yeni renk durdurulur ve eski renk
     hizmete devam eder.
   - Reload açık WebSocket'leri kesmez: eski nginx worker'ları kendi bağlantılarını kapanana kadar
     tutar, yeni bağlantılar yeni renge gider.
5. Eski rengi boşaltır: restart policy `no` yapılır ve `SIGUSR1` gönderilir.
   - Oyuncular kendi odalarında oynamaya devam eder.
   - İstatistik kilidi hemen yeni renge geçer.
   - Container son oyuncu çıkınca ya da 30 dk sonra kendiliğinden kapanır. Script bunu beklemez.
6. Yeni rengin istatistik deposunun açıldığını log'dan doğrular (`stats opened`). `stats disabled`
   görürse uyarı verir.
7. İki rengin sürümünü tutar, daha eski imajları ve dosyaları siler.

Güvenlik ayrıntıları:
- **Kilit:** deploy, rollback ve `switch-upstream.sh` çalıştıkları süre boyunca sunucuda
  `$DEPLOY_DIR/deploy.lock` üzerinde `flock` tutar. İkinci bir çalıştırma hemen durur
  ("another deploy ... is running") ve hiçbir şeyi değiştirmez. Kilidi tutan ssh oturumu tek başına
  koparsa script sonraki sunucu komutundan önce durur ("STOPPED: ... deploy.lock dropped").
- **Yazma hatası:** `switch-upstream.sh` dosyayı yazdığı andan reload başarılı olana kadar, herhangi
  bir hata ya da sinyalde yedeği bayt bayt geri yazar (aynı inode) ve sonucu `nginx -t` ile denetler.
  Geri yazma başarısız olursa yüksek sesle uyarır ve yedeğin yerini yazar. Her çalıştırmanın yedeği
  ayrı tutulur (`<conf adı>.bak.<zaman>.<pid>`, son 10).
- **Belirsiz hata (ör. ssh kopması):** script yeni rengi durdurmadan önce sunucuya nginx'in nereye
  baktığını sorar. Yeni rengi gösteriyorsa reload'ı tekrarlar ve devam eder. Eskiyi gösteriyorsa yeni
  rengi kapatır. Bilinemiyorsa hiçbir şeye dokunmaz ve `--status` önerir.
- **Üç container olmasın:** geçişten sonra eski `dogfight` container'ı (ya da yardımcısı) hâlâ
  boşalırken yeni deploy reddedilir. Yalnızca `--force-drain-overlap` (ilk argüman) ile geçilir.
- **Kapasite:** compose `-max-conns=72 -max-rooms=8` verir. Küçük bir arm64 sanal sunucuda
  (1 CPU limiti) yük testine göre yaklaşık 64 eşzamanlı oyuncu sağlıklı kalır. Kendi donanımında
  `cmd/loadtest` ile yeniden ölç.

Yerel test için `DEPLOY_HOST=local` verilebilir (komutlar bu makinede çalışır).

Container port yayınlamaz. Paylaşılan docker ağına (`EDGE_NETWORK`)
kendi adıyla (`dogfight-blue` / `dogfight-green`) katılır. Yalnızca bu ağın IPv4 subnet'i
`-trust-proxy` olarak verilir; deploy bu değeri sunucuda `docker network inspect` ile bulur.

**Bir defalık geçiş.** Eski tek container `dogfight` blue/green'den önceki sürümdür: boşaltma ve
istatistik kilidi yoktur. Bu yüzden ilk deploy onu şöyle devralır:
- Blue başlamadan önce küçük bir busybox yardımcı (`dogfight-handoff`, `deploy/legacy-handoff.sh`)
  eski container adına `/data/stats.lock` kilidini tutar. Böylece blue'nun deposu bekler; eski sunucu
  yazarken yanına yazmaz.
- nginx blue'ya geçince yardımcı eski container'ın metriklerini izler. Açık soket kalmayınca (ya da
  30 dk sonra) ona `SIGTERM` gönderir. Eski sunucu son anlık görüntüyü yazıp çıkar, kilit boşalır ve
  blue'nun deposu açılır.
- Çıkmış eski container bir sonraki deploy'da silinir.

Container ayarları (`deploy/compose.yml`):
- Read-only kök dosya sistemi, root olmayan kullanıcı (65532), `cap_drop: ALL`, `no-new-privileges`.
- Kaynak limitleri: 256 MB bellek (`GOMEMLIMIT=200MiB`), 1 CPU, 128 pid. Deploy sırasında iki renk
  birlikte çalışır (bellek en çok ~2×).
- `-origin=$PUBLIC_HOST` ve `-public-origin=wss://$PUBLIC_HOST` (CSP `connect-src`'ye açıkça eklenir);
  deploy bu değeri renk env dosyasına yazar.
- JSON log, döndürmeli (10 MB × 3).
- `-data=/data`: pilot istatistikleri harici (`external`) adlı hacim `dogfight-data`'da (`/data`).
  İki renk aynı hacmi bağlar, kilit sayesinde aynı anda yalnız biri yazar. Kök FS read-only kalır;
  yalnız `/data` yazılabilir.
- `-metrics-addr=127.0.0.1:9090`: metrikler yalnız container içinden okunur; port yayınlanmaz,
  nginx'te yoktur, edge ağındaki diğer container'lar erişemez.

### 3. Geri dönüş

```sh
scripts/deploy.sh --rollback <sürüm>
```

Sunucuda imajı bulunan bir sürümü yeniden canlıya alır:
- Sürüm boştaki renkte hâlâ boşalıyorsa ona `SIGUSR2` gönderir (boşaltmayı geri alır) ve nginx'i ona
  çevirir. Container yeniden başlamaz, oyuncuları kalır.
- Aksi halde sürümü boştaki renkte başlatır ve deploy gibi çevirir.
- Her iki durumda da canlı renk boşaltılır.
- `current` canlı sürümü, `previous` ondan öncekini tutar.

Blue/green öncesi bir sürüme (`compose` dosyasında `# bluegreen: 1` satırı olmayan) script dönmez;
o sürümde kilit ve boşaltma yoktur.

**Geçişi geri almak** (ilk blue/green deploy'dan sonra, eski `dogfight` container'ına dönmek) için
sunucuda, ssh kopsa da yarıda kalmasın diye ayrık çalıştır:

```sh
cd "$DEPLOY_DIR" && setsid nohup ./legacy-rollback.sh >legacy-rollback.log 2>&1; cat legacy-rollback.log
```

- `NGINX_CONTAINER` ve `NGINX_CONF` değerlerini yanındaki `server.env` dosyasından okur (deploy yazar).
- Deploy kilidini tutar. Compose ya da env dosyası kullanmaz; eski container'ı kendisi yeniden kullanır.
  Deploy o container'ı geçişten sonraki ilk deploy'a kadar, imajını ve dosyalarını da ondan sonrakine
  kadar silmez.
- **Değişmez:** nginx hiçbir zaman durmuş bir container'ı göstermez. Blue, nginx healthy eski container'ı
  gösterene kadar ayakta kalır ve hizmet verir.
- Herhangi bir hata ya da sinyalde script önce `NGINX_CONF` içindeki satırı okur:
  - nginx zaten eski container'ı gösteriyorsa geri dönüşü bitirir.
  - Göstermiyorsa geri alır: eski container durur ya da yeniden boşalmaya döner, blue hizmete devam eder.
  - nginx'in gösterdiği container'ı asla durdurmaz.
- **Eski container hâlâ çalışıyorsa:** script şu sırayla ilerler:
  1. Yardımcıyı dondurur (`docker pause`).
  2. Eski container'ın restart policy'sini `unless-stopped` yapar.
  3. nginx'i eski container'a çevirir.
  4. 3 sn bekler, blue'yu durdurur ve yardımcıyı siler.

  502 penceresi yoktur.
- **Eski container çıkmışsa:** script şu sırayla ilerler:
  1. Blue'ya `SIGWINCH` gönderir: blue istatistiğini bırakır ama hizmete devam eder.
  2. Eski container'ı başlatır ve en çok 60 sn healthy olmasını bekler.
  3. nginx'i çevirir, 3 sn sonra blue'yu durdurur.

  Bu yolda da kesinti yoktur. `SIGWINCH`'ü tanımayan eski bir blue (`4e5de28` dahil) `SIGUSR1` ile
  boşaltılır; boşsa hemen çıkar. Bu durumda eski container healthy olup nginx çevrilene kadar yaklaşık
  5–10 sn yeni istek cevapsız kalır.
- Blue'da oda kurmuş oyuncular her iki yolda da odalarını kaybeder.

### 4. `/data` hacmi, yedek, metrikler

Pilot istatistikleri `dogfight-data` adlı docker hacminde durur. Ad compose dosyasında sabittir
(`name: dogfight-data`), bu yüzden her sürümün `compose-<sürüm>.yml` dosyası aynı hacmi bağlar.
Deploy ve geri dönüş hacmi hiç silmez (`down -v` kullanılmaz; elle de çalıştırma).

- **Sahiplik:** imaj `/data` dizinini uid 65532'ye ait (0755) oluşturur; sunucu açılışta dizini
  0700 yapar (dosyalar 0600). Boş bir adlı hacim ilk bağlanışta bu sahipliği kopyalar; ek kurulum
  gerekmez.
- **İstatistik açık mı:** canlı renkte `docker logs dogfight-<renk> 2>&1 | grep -E "stats (opened|disabled)"`
  çıktısı `stats opened` olmalı.
- **Yedek** (sunucuda, yedeğin yazılacağı dizinde):

  ```sh
  docker run --rm -v dogfight-data:/data:ro -v "$PWD":/b busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e tar czf /b/dogfight-data.tgz -C /data .
  ```

  Tutarlı bir kopya için önce `docker stop dogfight-<renk>` (kapanışta anlık görüntü yazılır; oyuncular
  düşer), sonra `docker start dogfight-<renk>`. Çalışırken alınan yedek açılır (yarım son günlük satırı atlanır), ama
  `tar` iki dosyayı okurken bir sıkıştırma (anlık görüntü yazılıp günlük kesilir) araya girerse
  son birkaç dakikanın istatistiği eksik kalabilir; tutarlı kopya için container'ı durdur.
  busybox imajı digest ile sabittir (root olarak istatistik hacmine dokunur).
- **Geri yükleme:** container durdurulmuşken
  `docker run --rm -v dogfight-data:/data -v "$PWD":/b busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e sh -c 'tar xzf /b/dogfight-data.tgz -C /data && chown -R 65532:65532 /data'`.
- **Metrikler:** `docker exec dogfight-<renk> /dogfight -get http://127.0.0.1:9090/metrics`.
  Ayrıca her 60 sn'de bir `stats` özet satırı log'lanır.

### nginx

`deploy/nginx-dogfight.conf` örnek bir vhost'tur; nginx'in `http{}` seviyesine include edilir.
`server_name` (`dogfight.example.com`) ve sertifika yollarını kendi değerlerinle değiştir.
- 80 → 443 yönlendirmesi yapar; 443'te origin cert kullanır.
- `$realip_remote_addr` üzerinde `geo` kullanır: yalnızca Cloudflare aralıkları geçer, diğerleri 403 alır.
- İstemci IP'si `CF-Connecting-IP` başlığından alınır ve upstream'e `X-Real-IP` olarak gider.
- Upstream adı docker DNS ile çözülür (`resolver 127.0.0.11 valid=10s ipv6=off`); container
  kapalıyken de nginx başlar.
- `set $dogfight_upstream http://dogfight-<renk>:8080;` satırını deploy yerinde değiştirir. Bu satır
  dosyada tek olmalı ve bu biçimde kalmalı.
- `/ws` için upgrade, 120 sn timeout ve `proxy_buffering off` kullanılır.

Kurulum:
1. Origin sertifikası (`dogfight-origin.pem`, `dogfight-origin-key.pem`) nginx container'ında
   `/etc/nginx/certs/` altında görünmelidir:
   `docker exec "$NGINX_CONTAINER" ls /etc/nginx/certs/dogfight-origin.pem`.
   Sertifika ve anahtar dosyaları bu depoya girmez (`.gitignore`: `*.pem`, `*.key`).
2. Dosyayı nginx'in `http{}` seviyesinde okuduğu yapılandırmaya ekle (`NGINX_CONF`).
   Yapılandırma tek dosya olarak bind-mount ediliyorsa değişiklik container yeniden
   başlatılmadan görünmez.
3. `docker exec "$NGINX_CONTAINER" nginx -t` geçmeden reload etme: `http{}` bağlamı başka
   vhost'larla paylaşılıyorsa hatalı bir include hepsini düşürür. Geçerse
   `docker exec "$NGINX_CONTAINER" nginx -s reload`.

Cloudflare IP listesi dosyada iki yerde geçer: `geo` ve `set_real_ip_from`. Cloudflare
aralıkları değişirse ikisini birlikte güncelle.

### Docker ile tekrarlanabilir build (isteğe bağlı)

```sh
docker buildx build --platform linux/arm64 --build-arg VERSION=$(git describe --always --dirty) -t dogfight:dev .
```

Bu komut çok aşamalı `Dockerfile` kullanır. Base imajlar digest ile sabitlenmiştir.

## Güvenlik notları

Oyun herkese açık internette çalışır. Sunucu istemciye güvenmez.

- **Otorite:** tüm simülasyon sunucuda çalışır.
  - İstemci yalnızca input gönderir. Input'lar clamp edilir; NaN ve Inf nötrlenir.
  - Bilinmeyen uçak türü ve bozuk mesaj bağlantıyı keser.
- **Bağlantı limitleri:**
  - Sunucu genelinde 128 soket, adres başına 6 soket.
  - En fazla 16 oda.
  - Adres başına dakikada 3 oda kurma; başarısız oda kurma token harcamaz.
  - Adres başına dakikada 10 başarısız ve 20 başarılı katılma.
- **Mesaj limitleri:**
  - Bağlantı başına 90 mesaj/sn, patlama 120.
  - Mesaj boyutu en fazla 1 KB.
  - Pick ve ping için ayrı, daha sıkı limitler vardır.
  - Taşma bağlantıyı policy-violation kodu ile kapatır.
- **Zaman aşımları:**
  - El sıkışma 5 sn.
  - 30 sn mesajsız bağlantı kapanır; istemci her 15 sn ping atar.
  - Yazıcı kuyruğu 64 mesajdır ve dolunca en eski snapshot düşer; içindeki olaylar sonraki
    snapshot'a aktarılır. Kuyruk 2 sn dolu kalırsa bağlantı kapanır.
  - Hiç kullanılmayan oda 15 sn, boşalan oda 60 sn sonra kapanır.
- **Origin:** WebSocket yalnızca `-origin` listesindeki host'lardan (boşsa aynı host'tan) kabul edilir.
- **Proxy:** `X-Real-IP` yalnızca `-trust-proxy` CIDR'larından gelirse kullanılır. Üretimde
  bu, edge ağının subnet'idir.
- **HTTP başlıkları:**
  - Sıkı CSP: `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`.
  - Ayrıca `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
    `Permissions-Policy` ve `Cross-Origin-Opener-Policy`.
  - Dizin listesi kapalıdır.
  - HSTS'i Cloudflare verir.
- **İsimler:** kontrol ve görünmez/bidi karakterler ayıklanır, en fazla 16 karakter.
  "Berabere" ismi ayrılmıştır.
- **Panic:** bir odada panic olursa yalnızca o oda kapanır ve log'lanır; süreç ayakta kalır.
- **`/api/*`:** yalnız GET/HEAD; adres başına 120/dk ortak limit (patlama 30, `-trust-proxy` ile
  gerçek IP); yanıt önbelleği (1 sn / 10 sn) sorgu maliyetini sabitler; CORS yok; `no-store`;
  tek sorgu parametresi `period` (beyaz liste).
- **Pilot token'ı:** 128 bit `crypto/rand`, istemcide `localStorage`'da. Sunucu yalnız SHA-256
  özetini saklar; token log'a (log handler'ı ayrıca maskeler), metriğe, URL'ye ve diske ham yazılmaz.
  HTTP'de yalnız `X-Pilot-Token` başlığıyla gelir; biçimi (22 karakter, base64url) hash'ten önce
  denetlenir. `/api/me` geçersiz, bilinmeyen ya da çok uzun token için aynı `{"pilot":null}`
  yanıtını verir (token var mı yok mu ayırt edilemez). Hesap yoktur: token'ı kaybeden kartını kaybeder,
  token'ı ele geçiren kartı görür.
- **İstatistik deposu:** tek actor; günlük satırı ≤ 4 KB; en çok 20 000 pilot, 180 gün görülmeyen
  silinir; dosya 0600, dizin 0700; atomik rename + `seq` ile çökme güvenli, bozuk satır atlanır.
  Liderlik tablosu çiftlenmeye karşı yalnız açık (listelenen) odalardaki insan kurbanlarını sayar;
  bot ve özel oda kill'leri yalnız kişisel karta yazılır. Maç ve galibiyet için raundda en az 60 sn
  kalıp bir kez havalanmak gerekir.
- **Herkese açık isimler:** ana sayfadaki liderlik tablosu oyuncuların seçtiği isimleri gösterir.
  İsimler metin düğümü olarak basılır (XSS yok) ama küfür filtresi yoktur.
- **Hızlı sohbet:** serbest metin yok, yalnız 1–6 ID; oyuncu başına 2 sn'de 1; takım
  modlarında yalnız takıma gider.
- **Oda listesi / Hızlı Oyna:** yalnız açık odalar, yalnız kod ve sayılar; özel odanın kodu
  listelenmez. Hızlı Oyna normal katılma ve kurma limitlerini sayar.
- **Metrik dinleyicisi:** üretimde `127.0.0.1:9090`, yayınlanmaz, nginx'te yok; etiket kümeleri
  sabit, IP/isim/token içermez; `ReadHeaderTimeout` 5 sn.
- **`/data` hacmi:** kök FS read-only kalır; yalnız `/data` yazılabilir, sahibi uid 65532.
- **Dokunmatik / eğim:** `Permissions-Policy` yalnız `accelerometer=(self), gyroscope=(self)` açar;
  kamera, mikrofon ve konum kapalı kalır. Eğim izni kullanıcı dokunuşuyla istenir.
- **Bilinen sınırlama (düşman görünürlüğü):** düşman isim etiketleri yakında (1,2 km) ya da top
  hattına yakınken, radar noktaları 2,5 km içinde görünür. Bu yalnız istemci tarafında bir gizlemedir:
  sunucu her snapshot'ta odadaki tüm uçakların konumunu gönderir, değiştirilmiş bir istemci
  düşmanları her mesafede görebilir.

## Mimari

```
cmd/dogfight/        main: flag'ler, HTTP sunucusu, gömülü web/, graceful shutdown, -healthcheck
internal/server/     HTTP rotaları (/, /r/{kod}, /healthz, /ws), güvenlik başlıkları, el sıkışma, limitler
internal/limit/      token bucket, adres başına bucket tablosu (sınırlı bellek), bağlantı kapısı
internal/wsconn/     WebSocket bağlantısı: okuyucu + yazıcı goroutine, sınırlı kuyruk
internal/lobby/      oda kodları (4 harf), oda yaşam döngüsü, oda sınırı
internal/room/       oda actor'ı: tek goroutine, 60 Hz tick, 30 Hz snapshot, input kuyrukları
internal/protocol/   JSON mesaj tipleri ve dönüşümler
internal/game/       bir odanın maçı: dünya, kurallar, skor tablosu, botlar, oyuncu listesi
internal/mode/       takımlı / FFA / Üs Saldırısı kuralları, skor tablosu, hedef canı
internal/bot/        bot beyni: kaçış > toplama > saldırı > devriye, taksi/kalkış/iniş, otopilot
internal/sim/        saf, deterministik simülasyon: uçuş, zemin/taksi/iniş, ikmal, yapılar, bomba, AA
internal/maps/       4 harita üreteci (ada, şehir, çöl, dağ): üs düzeni, pist, hangar, binalar, yüzey indeksi
internal/terrain/    seed'den heightmap, düzleştirme, bilinear örnekleme
internal/weather/    6 hava durumu: rüzgâr, hamle, füze kilit menzili çarpanı (görseller istemcide)
internal/rng/        seed'li splitmix (global rastgelelik yok)
internal/pilot/      pilot token'ı: üretim, biçim denetimi, SHA-256 özet, log maskeleme
internal/stats/      pilot istatistik deposu: actor, JSONL günlük + anlık görüntü, liderlik tablosu
internal/metrics/    elle yazılmış Prometheus metin formatı, 60 sn özet log
internal/geom/       vektör ve quaternion
client/src/          net (socket), predict (prediction + interpolation), render (Three.js),
                     input (fare, klavye, dokunmatik, eğim), audio (Web Audio jet sesi),
                     ui (DOM), game (döngü, kameralar, killcam, tekrar), sim (TS uçuş/zemin portu)
testdata/vectors/    Go'nun ürettiği, TS'in doğruladığı uçuş, arazi ve harita vektörleri
deploy/, scripts/    compose, nginx vhost, release ve deploy script'leri
```

- **Oda:** her oda bir actor'dır. Dış dünyayla yalnızca kanallar üzerinden konuşur ve
  paylaşılan durum tutmaz.
- **Netcode:** JSON üzerinden çalışır.
  - Kendi uçağın tahmin edilir (client-side prediction). Sunucu snapshot'ı gelince
    onaylanmamış input'lar yeniden oynatılır; düzeltme 100 ms'de yumuşatılır.
  - Diğer uçaklar interpolation buffer ile çizilir.
  - Mermiler `fire` olayından istemcide simüle edilir; füzeler snapshot'ta gelir.
- **Ayrıntılar:** tasarım `docs/superpowers/specs/2026-10-06-dogfight-design.md` (v1) ve
  `docs/superpowers/specs/2026-10-07-dogfight-v2-design.md` (v2) dosyalarında,
  uygulama planı `docs/superpowers/plans/` altındadır.
