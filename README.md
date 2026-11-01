# CraftDeck — Yerel Minecraft Sunucu Stüdyosu

[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-64748b)](#)

CraftDeck; tamamen ücretsiz, kendi bilgisayarınızda çalışan bir Minecraft sunucu kurucu ve yönetim aracıdır. Modrinth mağazası, `.mrpack` kurulumu, sunucu motoru/Java otomasyonu, canlı konsol ve ngrok/Playit.gg tünelleri tek bir yerel arayüzde toplanır.

**Hızlı bağlantılar:** [Nasıl kullanılır?](<How Can I Use.md>) · [Tünel kurulumu](#tünel-kurulumu-ngrok-veya-playitgg) · [Lisans](LICENSE)

- **Sunucu tarafı:** Python 3.10+ (yalnızca standart kütüphane)
- **Arayüz:** Vanilla HTML/CSS/JavaScript (framework yok)
- **Dış bağımlılık:** Yok. `pip install` gerekmez.
- **Platform:** Windows, Linux, macOS

> CraftDeck yalnızca `127.0.0.1` üzerinde dinler. Arayüzde kimlik doğrulama yoktur; bu nedenle uygulamayı internete açmayın. Dışarıya açılacak olan yalnızca Minecraft sunucu portudur (tünel aracılığıyla).

---

## Neden bu stack?

| İhtiyaç | Çözüm |
| --- | --- |
| Sıfır kurulum, sıfır ücret | Python standart kütüphanesi (`http.server`, `subprocess`, `threading`, `zipfile`, `urllib`) |
| UI thread'i donmasın | Her indirme/kurulum/başlatma işi ayrı worker thread + `JobManager`; HTTP `ThreadingHTTPServer` |
| Çapraz platform | `pathlib`, platforma göre Java/ngrok/Playit ikilisi ve `creationflags`/`start_new_session` |
| Hızlı ve bakımı kolay UI | Modüler vanilla JS (`window.CD`), sunucu tarafında tek JSON API |
| Masaüstü hissi | Windows'ta Edge/Chrome `--app` penceresi; diğerlerinde varsayılan tarayıcı |

---

## Hızlı başlangıç

### Windows

```bat
start.bat
```

### Linux / macOS

```sh
chmod +x start.sh
./start.sh
```

### Doğrudan Python

```sh
python run.py
```

Arayüz varsayılan olarak <http://127.0.0.1:8765> adresinde açılır. Port doluysa 25 portluk aralıkta boş port aranır.

#### Seçenekler

```text
python run.py --help

--host 127.0.0.1     Dinlenecek adres
--port 8765          Tercih edilen HTTP portu
--data ./data        Veri dizini (varsayılan ./data)
--no-browser         Arayüzü otomatik açma
--tab                Uygulama penceresi yerine normal sekme
--debug              Ayrıntılı HTTP logları
```

`CRAFTDECK_DATA` ortam değişkeni de veri dizinini değiştirir:

```sh
CRAFTDECK_DATA=/mnt/servers/craftdeck python run.py
```

### Tünel kurulumu (ngrok veya Playit.gg)

Sunucunu port yönlendirme olmadan internete açmak için önce bir tünel aracı kur:

```bat
tunnel-setup.bat
```

Linux / macOS:

```sh
chmod +x tunnel-setup.sh
./tunnel-setup.sh
```

Betik hangi sağlayıcıyı kullanacağını sorar, seçtiğin istemciyi indirir ve CraftDeck'e tanıtır:

- **ngrok:** ücretsiz hesabının authtoken'ını ister ve kaydeder.
- **Playit.gg:** ajanı indirir, tarayıcıda `claim` bağlantısı açar.

Kurulumdan sonra CraftDeck'i yeniden başlat; sağlayıcı **Tünel** sekmesinde hazır seçili olur. Ayrıntılı adımlar: [How Can I Use.md](<How Can I Use.md>).

---

## Klasör yapısı

```text
.
├── run.py                    # Başlatıcı
├── start.bat / start.sh      # Platform kısayolları
├── tunnel-setup.bat / .sh    # ngrok / Playit.gg kurulum betiği
├── How Can I Use.md          # Ayrıntılı kullanım rehberi
├── LICENSE                   # MIT lisansı
├── app/
│   ├── main.py               # HTTP sunucusu, tarayıcı açılışı, kapanış temizliği
│   ├── api.py                # JSON API yönlendirme + multipart yükleme
│   ├── server.py             # Sunucu yaşam döngüsü, konsol, içerik, modpack
│   ├── engines.py            # Fabric/Quilt/Forge/NeoForge/Paper/Purpur/Vanilla
│   ├── java_manager.py       # Java tespiti, sürüm önerisi, Adoptium kurulumu
│   ├── modrinth.py           # Arama, sürüm/bağımlılık çözümleme
│   ├── mrpack.py             # .mrpack ayrıştırma, indirme, override çıkarma
│   ├── tunnel.py             # ngrok / Playit.gg / özel komut süreçleri
│   ├── tunnel_setup.py       # Tünel kurulum menüsü ve otomatik indirme
│   ├── jobs.py               # Arka plan işleri ve ilerleme
│   ├── store.py              # state.json kalıcılığı
│   └── web/                  # index.html + modüler CSS/JS
└── data/                     # Çalışma zamanı (git dışı)
    ├── state.json
    ├── servers/<id>/         # Her sunucu kendi klasöründe
    ├── java/                 # CraftDeck'in indirdiği JRE'ler
    ├── bin/                  # ngrok / playit ikilileri
    ├── cache/                # İndirme önbelleği ve ikonlar
    └── uploads/              # Geçici .mrpack yüklemeleri
```

---

## Kullanım

### 1. Sunucu oluşturma

**Sunucular → Yeni Sunucu**:

1. Ad, Minecraft sürümü ve motor (Fabric, Quilt, Forge, NeoForge, Paper, Purpur, Vanilla) seçin.
2. RAM aralığını slider'larla belirleyin (`-Xms` / `-Xmx`).
3. Port boş bırakılırsa uygun bir port otomatik atanır.
4. **Motoru kur** işaretiyle oluşturursanız motor arka planda indirilir.

Motor seçimi `.mrpack` kurulumunda paketin `dependencies` alanından otomatik belirlenir; gerekirse sunucunun sürümü/yükleyicisi pakete göre güncellenir.

### 2. Modrinth mağazası

- Mod, modpack, plugin, datapack, shader ve resourcepack arayın.
- Yükleyici (Fabric/Forge/NeoForge/Paper…) ve Minecraft sürümüne göre filtreleyin.
- Bir projede sürüm seçip **Sunucuya Ekle** deyin. Zorunlu bağımlılıklar otomatik çözülür.
- Kurallar:
  - Modlar → `mods/`
  - Plugin'ler → `plugins/` (Paper/Purpur)
  - Resourcepack'ler → `resourcepacks/`
  - Shader'lar → `shaderpacks/`
  - Datapack'ler → `<dünya>/datapacks/`
- Yalnızca istemci için olan dosyalar (`server_side: unsupported` veya `.mrpack` içinde `env.server: unsupported`) sunucuya kurulmaz.
- Modrinth'te plugin'ler bazen `project_type: mod` olarak döner (ör. LuckPerms). CraftDeck hedef klasörü proje türüne değil, seçilen sürümün yükleyicisine göre belirler.

### 3. `.mrpack` kurulumu

**Modrinth → .mrpack Yükle** ile dosyayı seçin. CraftDeck:

1. Arşivi ZIP olarak açar ve `modrinth.index.json` dosyasını okur.
2. `dependencies.minecraft` ve loader bilgisinden motoru belirler.
3. `files[]` içindeki her dosyayı SHA doğrulamasıyla indirir.
4. `overrides/` ve `server-overrides/` içeriklerini sunucu köküne çıkarır.
5. `env.server: unsupported` dosyaları atlar, bozuk/asılsız paketlerde anlaşılır hata döndürür.

Mevcut bir sunucuda **Modpack** sekmesinden de paket uygulanabilir. Yükleme dosyası iş bitince veya hata alınca otomatik silinir.

### 4. Canlı konsol ve kontrol

- **Başlat / Durdur / Yeniden Başlat / Zorla Kapat**
- Komut gönderme (`list`, `say ...`, `stop` vb.), komut geçmişi (↑/↓)
- Canlı filtre, log indirme
- Oyuncu işlemleri: op/deop, kick, ban/pardon, whitelist
- Sunucu çökerse durum `crashed` olarak işaretlenir ve çıkış kodu/konsol çıktısı korunur.

### 5. Ayarlar

- Genel: ad, port, RAM, ek JVM argümanları, otomatik yeniden başlatma
- `server.properties`: 49 anahtarın tamamı, altı açılır grup hâlinde:
  - **Ağ ve bağlantı**: `server-ip`, `server-port`, `online-mode`, `enable-status`,
    `prevent-proxy-connections`, `use-native-transport`,
    `network-compression-threshold`, `rate-limit`
  - **Dünya**: `level-name`, `level-seed`, `level-type`, `generator-settings`,
    `generate-structures`, `allow-nether`, `spawn-protection`, `max-world-size`,
    `hardcore`, `max-tick-time`, `max-chained-neighbor-updates`
  - **Oyun kuralları**: `gamemode`, `force-gamemode`, `difficulty`, `pvp`,
    `max-players`, `player-idle-timeout`, `spawn-monsters`, `spawn-animals`,
    `spawn-npcs`, `allow-flight`, `hide-online-players`, `view-distance`,
    `simulation-distance`, `entity-broadcast-range-percentage`
  - **Oyuncular ve izinler**: `white-list`, `enforce-whitelist`,
    `op-permission-level`, `function-permission-level`, `enable-command-block`,
    `enforce-secure-profile`
  - **RCON**: `enable-rcon`, `rcon.port`, `rcon.password`, `broadcast-rcon-to-ops`,
    `broadcast-console-to-ops`
  - **Mesaj ve kaynak paketi**: `motd`, `resource-pack`, `resource-pack-sha1`,
    `require-resource-pack`, `resource-pack-prompt`
- Sayı alanları `min`/`max` ile doğrulanır; boş bırakılan sayı alanı dosyaya yazılmaz.
- `server.properties` dosyasında olup arayüzde tanımlı olmayan anahtarlar
  **Gelişmiş** bölümünde otomatik olarak listelenir.
- Java: tespit edilen çalışma zamanları arasından seçim, özel yol doğrulama, tek tıkla JRE indirme
- Tehlikeli bölge: sunucuyu kayıtla veya dosyalarıyla birlikte silme

`eula.txt` ilk kurulumda otomatik olarak `eula=true` yazılır. Sunucuyu başlatarak Minecraft EULA'sını kabul etmiş olursunuz: <https://aka.ms/MinecraftEULA>

### 6. Dışarı açma (tünel)

**Tünel** sekmesinde üç sağlayıcı vardır:

#### ngrok

1. Ücretsiz ngrok hesabı açın ve dashboard'dan **authtoken** alın.
2. Token'ı Tünel sekmesine girip **Başlat** deyin.
3. CraftDeck ngrok'u `tcp` modunda başlatır, yerel API'den `tcp://...` adresini yakalar ve **Tek Tıkla Kopyala** sunar.

Token yoksa işlem anlaşılır bir hata ile durur.

#### Playit.gg

- Playit ajanı mevcut hesap yapılandırmasıyla `--stdout` modunda çalışır.
- İlk bağlantıda günlükte `https://playit.gg/claim/...` bağlantısı görünürse arayüzde buton olarak sunulur.
- Tünel yönlendirmesini Playit panelinden sunucu portuna yapın.
- macOS'ta Playit resmî CLI ikilisi yayınlamadığı için ngrok veya özel komut kullanın.

#### Özel komut

`{port}` yer tutucusu sunucunun portuyla değiştirilir. Örnek:

```text
bore local {port} --to bore.pub
```

Adres günlükten otomatik yakalanır; yakalanamazsa **Adresi elle gir** alanı kullanılabilir.

> Tünel süreçleri arka planda çalışır. Uygulama kapanırken sunucular ve tüneller temiz şekilde sonlandırılır.

---

## API özeti

Tüm yanıtlar JSON'dur (log indirme ve statik dosyalar hariç). Hatalar `{"error": "...", "detail": "..."}` biçimindedir.

| Yöntem | Yol | Açıklama |
| --- | --- | --- |
| GET | `/api/health` | Sağlık kontrolü |
| GET | `/api/bootstrap` | Uygulama, sunucular, Java, sürümler, işler |
| GET | `/api/meta` | Modrinth etiketleri, yükleyiciler, JVM bayrakları |
| GET | `/api/java` | Tespit edilen Java çalışma zamanları |
| POST | `/api/java/install` | Adoptium JRE indir (`{major, server_id?}`) |
| POST | `/api/java/validate` | Java yolunu doğrula |
| GET | `/api/modrinth/search` | Arama (`query,type,loader,version,index,offset,limit`) |
| GET | `/api/modrinth/project/<id>` | Proje ayrıntısı + sürümler |
| GET | `/api/modrinth/versions` | Sürüm listesi (`project_id,loader,version`) |
| GET | `/api/modrinth/resolve` | Sürüm + bağımlılık çözümü |
| GET | `/api/servers` | Sunucu listesi |
| POST | `/api/servers` | Sunucu oluştur (`name,mc_version,loader,port?,ram_*`) |
| POST | `/api/servers/from-modrinth` | Modrinth modpack'inden sunucu oluştur |
| POST | `/api/servers/from-mrpack` | `.mrpack` yükle ve sunucu oluştur (multipart) |
| GET | `/api/servers/<id>` | Sunucu ayrıntısı, özellikler, içerik, tünel |
| PATCH | `/api/servers/<id>` | Ad, port, RAM, Java, JVM argümanları, tünel ayarları |
| DELETE | `/api/servers/<id>?files=1` | Sunucuyu sil (dosyalar dahil) |
| POST | `/api/servers/<id>/start` · `stop` · `restart` · `kill` | Yaşam döngüsü |
| POST | `/api/servers/<id>/engine/install` | Motoru kur/yenile |
| GET | `/api/servers/<id>/console?since=` | Konsol satırları |
| GET | `/api/servers/<id>/console.txt` | Konsolu indir |
| POST | `/api/servers/<id>/command` | Komut gönder |
| GET/PUT | `/api/servers/<id>/properties` | `server.properties` oku/yaz |
| GET/POST/DELETE | `/api/servers/<id>/content` | İçerik listele/kur/sil |
| POST | `/api/servers/<id>/modpack` | Modrinth modpack uygula |
| POST | `/api/servers/<id>/modpack/upload` | `.mrpack` yükle (multipart) |
| GET/POST | `/api/servers/<id>/tunnel` | Tünel durumu / başlat·durdur·sıfırla·adres |
| GET | `/api/jobs` | İş listesi |
| GET | `/api/jobs/<id>?since=` | İş ilerlemesi ve logları |
| POST | `/api/jobs/<id>/cancel` | İşi iptal et |
| POST | `/api/app/shutdown` | Uygulamayı kapat |

Log/konsol uç noktaları `since` (son görülen `seq`) ile artımlı okunur; böylece arayüz sürekli tam log indirmez.

---

## Sorun giderme

| Belirti | Çözüm |
| --- | --- |
| `Python 3.10+ bulunamadı` | Python'u kurun ve PATH'e ekleyin (`py -3` veya `python`). |
| Arayüz açılmıyor | Terminaldeki adresi elle açın; port çakışıyorsa `--port` verin. |
| `Port ... kullanılıyor` | Ayarlar'dan farklı port seçin veya çakışan süreci kapatın. |
| Java bulunamadı / sürüm düşük | **Ayarlar → Java** bölümünden uygun sürümü indirin (1.17+ → 17/21, eski sürümler → 8). |
| Fabric/Forge kurulumu başarısız | İnternet bağlantısını kontrol edin; işi iptal edip yeniden deneyin. Ayrıntılar iş loglarındadır. |
| Bozuk `.mrpack` | Hata mesajı `modrinth.index.json` veya ZIP ile ilgilidir; dosyayı yeniden indirin. |
| ngrok başlamıyor | Authtoken girildiğinden emin olun. Ücretsiz planda eşzamanlı tünel sınırı vardır. |
| Playit adresi görünmüyor | Günlükteki claim bağlantısını açın; panelden tüneli sunucu portuna yönlendirin. |
| Sunucuya dışarıdan bağlanılamıyor | Tünel çalışıyor mu, adres/port doğru mu ve yerel sunucu `running` mi kontrol edin. |
| Windows'ta pencere açılmıyor | Edge/Chrome yoksa varsayılan tarayıcı kullanılır; `--tab` ile normal sekmede açın. |

### Veri yedekleme

CraftDeck otomatik dünya yedeği almaz. Sunucuyu durdurup `data/servers/<id>/` klasörünü (özellikle `world*`, `mods`, `config`) kopyalayın.

---

## Geliştirme notları

- Python sözdizimi ve API'yi hızlı kontrol:

  ```sh
  python -m compileall app
  ```

- Arayüz modülleri `app/web/index.html` içinde şu sırayla yüklenir:
  `core.js → servers.js → console.js → store.js → content.js → settings.js → tunnel.js → app.js`
- Ortak yardımcılar `window.CD` altındadır (`api`, `state`, `actions`, `forms`, `render*`, `toast`).
- Yeni bir API ucu eklerken `app/api.py` içindeki `_dispatch` yönlendirmesine ve README tablosuna ekleyin.
- Motor kurucuları `app/engines.py` içindeki `INSTALLERS` sözlüğünde toplanmıştır.

## Lisans

[MIT](LICENSE) © 2026 Musty

CraftDeck bağımsız bir topluluk aracıdır; Mojang, Microsoft, Modrinth, ngrok veya Playit.gg ile bağlantılı değildir. Minecraft sunucusu çalıştırmak için Minecraft EULA'sını kabul etmeniz gerekir. İndirilen mod/modpack'lerin lisansları kendi yazarlarına aittir.
