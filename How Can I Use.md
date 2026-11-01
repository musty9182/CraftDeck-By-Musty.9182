# CraftDeck Nasıl Kullanılır?

Bu rehber, CraftDeck'i ilk kez kuracak biri için baştan sona yol gösterir: uygulamayı başlatma, tünel aracını otomatik kurma, sunucu oluşturma, mod kurma ve arkadaşlarınla oynama.

---

## 1. Gereksinimler

- **Windows 10/11**, Linux veya macOS
- **Python 3.10 veya daha yeni** ([python.org](https://www.python.org/downloads/))
  - Windows'ta kurulum sırasında **"Add python.exe to PATH"** kutusunu işaretle.
- İnternet bağlantısı (motor, mod ve Java indirmeleri için)
- Minecraft sunucusu için ayrılacak RAM (en az 2 GB önerilir)

`pip install` gerekmez. CraftDeck yalnızca Python standart kütüphanesini kullanır.

---

## 2. Uygulamayı başlat

### Windows

`start.bat` dosyasına çift tıkla.

### Linux / macOS

```sh
chmod +x start.sh
./start.sh
```

### Doğrudan Python

```sh
python run.py
```

Arayüz varsayılan olarak **http://127.0.0.1:8765** adresinde açılır. Terminal penceresini kapatma; kapatırsan uygulama ve sunucu durur.

> Arayüz yalnızca bu bilgisayara açıktır. İnternete açma, sadece Minecraft sunucu portu için tünel üzerinden yapılır.

---

## 3. Tünel aracını otomatik kur (ngrok veya Playit.gg)

Sunucunu port yönlendirme yapmadan arkadaşlarına açmak için bir tünel aracı gerekir. CraftDeck ikisini de destekler. Kurulum betiği hangisini kullanacağını sorar ve seçtiğin aracı otomatik indirir.

### Windows

`tunnel-setup.bat` dosyasına çift tıkla.

### Linux / macOS

```sh
chmod +x tunnel-setup.sh
./tunnel-setup.sh
```

Ekranda şu menü çıkar:

```text
  1) ngrok        (ücretsiz hesap authtoken'ı gerekir)
  2) Playit.gg    (ücretsiz hesap, tarayıcıdan claim)
  3) Vazgeç
```

### Seçenek 1: ngrok

1. Menüde `1` yaz.
2. Betik ngrok istemcisini indirir (~12 MB).
3. İstenen **authtoken**'ı [ngrok dashboard](https://dashboard.ngrok.com/get-started/your-authtoken) sayfasından kopyalayıp yapıştır.
   - Token yazarken ekranda görünmez; bu normaldir.
4. Token CraftDeck ayarlarına kaydedilir. Mevcut sunucular ve bundan sonra oluşturacağın sunucular ngrok seçili olarak gelir.

ngrok ücretsiz planda tünel adresi her başlatmada değişebilir.

### Seçenek 2: Playit.gg

1. Menüde `2` yaz.
2. Betik Playit ajanını indirir. Ajan bu bilgisayarda daha önce bir hesaba bağlandıysa bunu algılar ve yeniden claim istemez.
3. Bağlı değilse `playit setup` çalışır; konsolda bir **claim** bağlantısı görünür ve tarayıcıda açılır:
   `https://playit.gg/claim/...`
4. Bağlantıdan Playit hesabına giriş yapıp agent oluştur. Kurulum penceresi otomatik devam eder.
5. Playit panelinde **Minecraft Java** türünde bir tünel oluştur. Yerel adres `127.0.0.1`, yerel port sunucunun portu (varsayılan `25565`) olmalı.
6. Panelde verilen genel adresi kopyala. CraftDeck otomatik yakalayamazsa **Tünel** sekmesindeki **Adresi elle gir** alanına yapıştırıp kaydet.

Playit ajanı Windows'ta arka plan servisi olarak çalışır; CraftDeck yalnızca servise bağlanıp günlüğü gösterir. Tünel yönlendirmesi mutlaka Playit panelinden yapılır.

### Kurulumdan sonra

- CraftDeck açıksa kapatıp yeniden başlat; tünel seçimi **Tünel** sekmesinde hazır görünür.
- Kurulum betiğini istediğin zaman tekrar çalıştırıp sağlayıcı değiştirebilirsin.
- Windows'ta `.bat` dosyasını çift tıklamak yerine terminalden de çalıştırabilirsin:

```bat
tunnel-setup.bat ngrok
tunnel-setup.bat playit
```

---

## 4. Sunucu oluştur

1. Soldan **Sunucular** sekmesine gir.
2. **Yeni Sunucu** düğmesine bas.
3. Bir ad ver.
4. Minecraft sürümünü seç.
5. Motoru seç:
   - **Fabric / Quilt / Forge / NeoForge** → modlu sunucular
   - **Paper / Purpur** → plugin sunucuları
   - **Vanilla** → modsuz
6. RAM aralığını ayarla. 4 GB genellikle modlu sunucular için iyi bir başlangıçtır.
7. **Motoru kur** seçeneğini işaretle ve oluştur.

Motor indirme işlemi arka planda yapılır; arayüz donmaz. İlerlemeyi iş listesinden veya konsoldan takip edebilirsin.

### Java

- CraftDeck sistemindeki Java sürümlerini algılar.
- Eksikse uygun Temurin sürümünü otomatik indirir:
  - Minecraft 1.20.5+ → Java 21
  - 1.17–1.20.4 → Java 17
  - Daha eski sürümler → Java 8
  - 25.x sürümleri → Java 25
- İstersen **Ayarlar → Java** bölümünden elle de seçebilirsin.

---

## 5. Mod, plugin ve modpack kur

### Modrinth mağazası

1. **Mağaza** sekmesini aç.
2. Mod, modpack, plugin, datapack, shader veya resourcepack arayabilirsin.
3. Yükleyici ve Minecraft sürümüne göre filtrele.
4. Karttaki **Kur** düğmesi, seçili sunucuya uyumlu sürümü otomatik seçip kurar.
5. Daha fazla bilgi için **Ayrıntı** düğmesini kullan.

Kurallar:

- Modlar → `mods/`
- Plugin'ler → `plugins/` (Paper/Purpur)
- Resourcepack'ler → `resourcepacks/`
- Shader'lar → `shaderpacks/`
- Datapack'ler → dünyanın `datapacks/` klasörü
- Yalnızca istemcide çalışan modlar sunucuya kurulmaz.

### `.mrpack` dosyası

**Mağaza → .mrpack Yükle** ile dosyayı seç. CraftDeck:

1. Arşivi açar ve `modrinth.index.json` dosyasını okur.
2. Gerekli Minecraft sürümünü ve motoru belirler.
3. Dosyaları SHA doğrulamasıyla indirir.
4. `overrides/` ve `server-overrides/` içeriklerini doğru yerlere çıkarır.
5. Bozuk paketlerde anlaşılır bir hata gösterir.

---

## 6. Sunucuyu başlat ve arkadaşlarını çağır

1. Sunucuyu seç.
2. **Başlat** düğmesine bas.
3. **Konsol** sekmesinden canlı çıktıyı izle.
4. **Tünel** sekmesine git.
5. Daha önce kurduğun sağlayıcı (ngrok veya Playit.gg) seçili olacak.
6. **Tüneli başlat** düğmesine bas.
7. Genel adres göründüğünde **Tek tıkla kopyala** ile arkadaşlarına gönder.

Arkadaşların Minecraft'ta **Çok Oyunculu → Sunucu Ekle** bölümüne bu adresi yazar.

> Tünel yalnızca CraftDeck ve bilgisayarın açıkken çalışır. Ücretsiz planlarda adres değişebilir.

---

## 7. Ayarlar, konsol ve yedekleme

### `server.properties`

**Ayarlar** sekmesinde 49 anahtar altı grup hâlinde düzenlenebilir:

- Ağ ve bağlantı
- Dünya
- Oyun kuralları
- Oyuncular ve izinler
- RCON
- Mesaj ve kaynak paketi

Kaydettiğinde sunucu çalışıyorsa yeniden başlatma uyarısı gösterilir.

### Konsol

- Başlat / Durdur / Yeniden Başlat / Zorla Kapat
- Komut gönderme (`list`, `say`, `stop` vb.)
- Canlı log filtresi ve log indirme
- Oyuncu işlemleri: op/deop, kick, ban/pardon, whitelist

### Yedekleme

CraftDeck otomatik dünya yedeği almaz. Sunucuyu durdurup şu klasörü kopyala:

```text
data/servers/<sunucu-id>/
```

Özellikle `world*`, `mods` ve `config` klasörlerini sakla.

---

## 8. Sorun giderme

| Sorun | Çözüm |
| --- | --- |
| `Python 3.10+ bulunamadı` | Python'u kur ve PATH'e ekle. Terminali kapatıp yeniden aç. |
| Arayüz açılmıyor | Terminaldeki adresi elle aç. Port doluysa `python run.py --port 8770` kullan. |
| ngrok başlamıyor | Authtoken girildiğinden emin ol. Ücretsiz planda eşzamanlı tünel sınırı vardır. |
| Playit adresi görünmüyor | `tunnel-setup.bat` ile hesabı bağla; panelden tüneli sunucu portuna yönlendir. Adresi **Tünel → Adresi elle gir** alanına yapıştır. |
| Playit: `local timestamp if over 10 seconds off` | Bilgisayar saati 10 saniyeden fazla sapıyor. Ayarlar → Saat ve dil → Tarih ve saat → **Şimdi eşitle**. Yönetici terminalde `w32tm /resync` de kullanılabilir. |
| Sunucuya dışarıdan bağlanılamıyor | Yerel sunucu çalışıyor mu, tünel adresi doğru mu, port eşleşiyor mu kontrol et. |
| Java bulunamadı | **Ayarlar → Java** bölümünden uygun sürümü indir. |
| Motor kurulumu başarısız | İnterneti kontrol et, işi iptal edip yeniden dene. Ayrıntılar iş loglarında. |
| Bozuk `.mrpack` | Hata `modrinth.index.json` veya ZIP ile ilgilidir; dosyayı yeniden indir. |
| Tünel seçimi görünmüyor | CraftDeck'i kapatıp yeniden aç; kurulum betiği ayarları dosyaya yazar. |

---

## 9. Güvenlik

- CraftDeck yalnızca `127.0.0.1` üzerinde dinler; arayüzde kimlik doğrulama yoktur.
- Arayüz portunu internete açma. Dışarıya yalnızca Minecraft sunucu portunu tünel ile aç.
- ngrok authtoken'ını ve Playit hesabını kimseyle paylaşma.
- `data/` klasörünü Git'e veya herkese açık bir yere yükleme; içinde yerel yollar, tünel bilgileri ve dünya dosyaları bulunur.

---

## 10. Kaldırma

1. CraftDeck'i kapat.
2. Uygulama klasörünü sil.
3. Sunucu dünyalarını da silmek istiyorsan `data/` klasörünü sil.

Geri dönmek istersen yalnızca `data/` klasörünü yedeklemen yeterlidir.
