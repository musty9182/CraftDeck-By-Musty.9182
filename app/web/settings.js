(() => {
  'use strict';

  const CD = window.CD;
  const state = CD.state;
  const $ = CD.$;
  const esc = CD.esc;
  const icon = CD.icon;
  const api = CD.api;
  const toast = CD.toast;
  const showError = CD.showError;

  const PROP_GROUPS = [
    {
      title: 'Ağ ve bağlantı', icon: 'globe', open: true,
      keys: [
        'server-ip', 'server-port', 'online-mode', 'enable-status',
        'prevent-proxy-connections', 'use-native-transport',
        'network-compression-threshold', 'rate-limit',
      ],
    },
    {
      title: 'Dünya', icon: 'box', open: true,
      keys: [
        'level-name', 'level-seed', 'level-type', 'generator-settings',
        'generate-structures', 'allow-nether', 'spawn-protection', 'max-world-size',
        'hardcore', 'max-tick-time', 'max-chained-neighbor-updates',
      ],
    },
    {
      title: 'Oyun kuralları', icon: 'grid', open: true,
      keys: [
        'gamemode', 'force-gamemode', 'difficulty', 'pvp', 'max-players',
        'player-idle-timeout', 'spawn-monsters', 'spawn-animals', 'spawn-npcs',
        'allow-flight', 'hide-online-players', 'view-distance', 'simulation-distance',
        'entity-broadcast-range-percentage',
      ],
    },
    {
      title: 'Oyuncular ve izinler', icon: 'shield', open: false,
      keys: [
        'white-list', 'enforce-whitelist', 'op-permission-level',
        'function-permission-level', 'enable-command-block', 'enforce-secure-profile',
      ],
    },
    {
      title: 'RCON (uzaktan konsol)', icon: 'terminal', open: false,
      keys: [
        'enable-rcon', 'rcon.port', 'rcon.password',
        'broadcast-rcon-to-ops', 'broadcast-console-to-ops',
      ],
    },
    {
      title: 'Mesaj ve kaynak paketi', icon: 'list', open: false,
      keys: [
        'motd', 'resource-pack', 'resource-pack-sha1',
        'require-resource-pack', 'resource-pack-prompt',
      ],
    },
  ];

  const LEVEL_TYPES = [
    ['minecraft:normal', 'Normal'],
    ['minecraft:flat', 'Süper düz (flat)'],
    ['minecraft:large_biomes', 'Geniş biyomlar'],
    ['minecraft:amplified', 'Yükseltilmiş (amplified)'],
    ['minecraft:single_biome_surface', 'Tek biyom'],
  ];

  const PROP_FIELDS = {
    'server-ip': { label: 'Sunucu IP', type: 'text', placeholder: 'Boş = tüm arayüzler', span: 1 },
    'server-port': { label: 'Sunucu portu', type: 'number', min: 1, max: 65535, hint: 'Genel sekmedeki port ile senkronize edilir.' },
    'online-mode': { label: 'Online mod (Mojang doğrulaması)', type: 'bool', hint: 'Kapatılırsa korsan istemciler de bağlanabilir.' },
    'enable-status': { label: 'Sunucu listesinde görün', type: 'bool' },
    'prevent-proxy-connections': { label: 'Proxy bağlantılarını engelle', type: 'bool' },
    'use-native-transport': { label: 'Yerel ağ aktarımı (Linux)', type: 'bool' },
    'network-compression-threshold': { label: 'Ağ sıkıştırma eşiği', type: 'number', min: -1, max: 65536, hint: '-1 sıkıştırmayı kapatır.' },
    'rate-limit': { label: 'Paket hızı sınırı', type: 'number', min: 0, max: 2147483647, hint: '0 = sınırsız.' },

    'level-name': { label: 'Dünya adı', type: 'text' },
    'level-seed': { label: 'Dünya tohumu (seed)', type: 'text', placeholder: 'Boş = rastgele' },
    'level-type': { label: 'Dünya türü', type: 'select', options: LEVEL_TYPES },
    'generator-settings': { label: 'Generator ayarları (JSON)', type: 'textarea', span: 2, placeholder: '{}', mono: true },
    'generate-structures': { label: 'Yapılar oluşturulsun', type: 'bool' },
    'allow-nether': { label: 'Nether açık', type: 'bool' },
    'spawn-protection': { label: 'Spawn koruması (blok)', type: 'number', min: 0, max: 1000 },
    'max-world-size': { label: 'Maksimum dünya boyutu', type: 'number', min: 1, max: 29999984 },
    'hardcore': { label: 'Hardcore mod', type: 'bool', hint: 'Ölünce oyuncu izleyiciye düşer.' },
    'max-tick-time': { label: 'Maksimum tick süresi (ms)', type: 'number', min: -1, max: 2147483647, hint: '-1 = watchdog kapalı.' },
    'max-chained-neighbor-updates': { label: 'Maksimum zincir güncellemesi', type: 'number', min: -1, max: 2147483647 },

    gamemode: { label: 'Oyun modu', type: 'select', options: [['survival', 'Hayatta kalma'], ['creative', 'Yaratıcı'], ['adventure', 'Macera'], ['spectator', 'İzleyici']] },
    'force-gamemode': { label: 'Oyun modunu zorunlu tut', type: 'bool' },
    difficulty: { label: 'Zorluk', type: 'select', options: [['peaceful', 'Barışçıl'], ['easy', 'Kolay'], ['normal', 'Normal'], ['hard', 'Zor']] },
    pvp: { label: 'PvP', type: 'bool' },
    'max-players': { label: 'Maksimum oyuncu', type: 'number', min: 1, max: 1000 },
    'player-idle-timeout': { label: 'Boşta kalma zaman aşımı (dk)', type: 'number', min: 0, max: 1440, hint: '0 = kapatma.' },
    'spawn-monsters': { label: 'Canavarlar oluşsun', type: 'bool' },
    'spawn-animals': { label: 'Hayvanlar oluşsun', type: 'bool' },
    'spawn-npcs': { label: 'NPC’ler oluşsun', type: 'bool' },
    'allow-flight': { label: 'Uçmaya izin ver', type: 'bool' },
    'hide-online-players': { label: 'Oyuncu listesini gizle', type: 'bool' },
    'view-distance': { label: 'Görüş mesafesi (chunk)', type: 'number', min: 2, max: 32 },
    'simulation-distance': { label: 'Simülasyon mesafesi (chunk)', type: 'number', min: 2, max: 32 },
    'entity-broadcast-range-percentage': { label: 'Varlık yayın menzili (%)', type: 'number', min: 10, max: 1000 },

    'white-list': { label: 'Beyaz liste', type: 'bool' },
    'enforce-whitelist': { label: 'Beyaz listeyi zorunlu tut', type: 'bool' },
    'op-permission-level': { label: 'OP yetki seviyesi', type: 'select', options: [['0', '0 — Hiçbiri'], ['1', '1 — Atlama'], ['2', '2 — Komut blokları'], ['3', '3 — Oyuncu yönetimi'], ['4', '4 — Tam yetki']] },
    'function-permission-level': { label: 'Fonksiyon yetki seviyesi', type: 'select', options: [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']] },
    'enable-command-block': { label: 'Komut bloğu', type: 'bool' },
    'enforce-secure-profile': { label: 'Güvenli profil zorunlu', type: 'bool', hint: 'Kapalıysa imzasız istemciler bağlanabilir.' },

    'enable-rcon': { label: 'RCON açık', type: 'bool' },
    'rcon.port': { label: 'RCON portu', type: 'number', min: 1, max: 65535 },
    'rcon.password': { label: 'RCON şifresi', type: 'password', placeholder: 'Boş = RCON şifresiz (önerilmez)' },
    'broadcast-rcon-to-ops': { label: 'RCON komutlarını OP’lere yayınla', type: 'bool' },
    'broadcast-console-to-ops': { label: 'Konsol komutlarını OP’lere yayınla', type: 'bool' },

    motd: { label: 'MOTD (sunucu listesi mesajı)', type: 'text', span: 2, placeholder: 'A Minecraft Server' },
    'resource-pack': { label: 'Kaynak paketi URL', type: 'text', span: 2, placeholder: 'https://…' },
    'resource-pack-sha1': { label: 'Kaynak paketi SHA-1', type: 'text', mono: true, placeholder: '40 karakterlik hash' },
    'require-resource-pack': { label: 'Kaynak paketini zorunlu tut', type: 'bool' },
    'resource-pack-prompt': { label: 'Kaynak paketi istemi', type: 'textarea', span: 2, placeholder: 'İsteğe bağlı mesaj' },
  };

  const GROUPED_KEYS = new Set(PROP_GROUPS.flatMap((group) => group.keys));
  const BOOL_VALUES = new Set(['true', 'false']);

  let loadingDetailAt = 0;

  function ramLabel(mb) {
    const value = Number(mb) || 0;
    if (value >= 1024 && value % 1024 === 0) return `${value / 1024} GB`;
    return `${value} MB`;
  }

  function paintRange(input) {
    if (!input) return;
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const value = Number(input.value) || 0;
    const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--fill', `${Math.max(0, Math.min(100, pct))}%`);
  }

  function fieldLabel(key, label) {
    return `<label for="prop-${esc(key)}">${esc(label || key)}<span class="prop-key">${esc(key)}</span></label>`;
  }

  function numberField(key, value, cfg = {}) {
    const min = cfg.min == null ? '' : ` min="${cfg.min}"`;
    const max = cfg.max == null ? '' : ` max="${cfg.max}"`;
    const step = cfg.step == null ? ' step="1"' : ` step="${cfg.step}"`;
    return `<div class="field${cfg.span === 2 ? ' span-2' : ''}">
      ${fieldLabel(key, cfg.label)}
      <input class="input" id="prop-${esc(key)}" data-prop="${esc(key)}" data-kind="number" type="number"${min}${max}${step} value="${esc(value)}"${cfg.placeholder ? ` placeholder="${esc(cfg.placeholder)}"` : ''}>
      ${cfg.hint ? `<span class="hint">${esc(cfg.hint)}</span>` : ''}
    </div>`;
  }

  function boolField(key, value, cfg = {}) {
    const checked = String(value).toLowerCase() === 'true';
    return `<div class="field${cfg.span === 2 ? ' span-2' : ''}">
      ${fieldLabel(key, cfg.label)}
      <select class="select" id="prop-${esc(key)}" data-prop="${esc(key)}" data-kind="bool">
        <option value="true" ${checked ? 'selected' : ''}>Açık</option>
        <option value="false" ${!checked ? 'selected' : ''}>Kapalı</option>
      </select>
      ${cfg.hint ? `<span class="hint">${esc(cfg.hint)}</span>` : ''}
    </div>`;
  }

  function textField(key, value, cfg = {}) {
    const type = cfg.type === 'password' ? 'password' : 'text';
    const mono = cfg.mono ? ' mono' : '';
    return `<div class="field${cfg.span === 2 ? ' span-2' : ''}">
      ${fieldLabel(key, cfg.label)}
      <input class="input${mono}" id="prop-${esc(key)}" data-prop="${esc(key)}" data-kind="text" type="${type}" value="${esc(value)}" maxlength="800" spellcheck="false"${cfg.placeholder ? ` placeholder="${esc(cfg.placeholder)}"` : ''}>
      ${cfg.hint ? `<span class="hint">${esc(cfg.hint)}</span>` : ''}
    </div>`;
  }

  function textareaField(key, value, cfg = {}) {
    const mono = cfg.mono ? ' mono' : '';
    return `<div class="field${cfg.span === 2 ? ' span-2' : ''}">
      ${fieldLabel(key, cfg.label)}
      <textarea class="textarea${mono}" id="prop-${esc(key)}" data-prop="${esc(key)}" data-kind="text" rows="2" maxlength="2000" spellcheck="false"${cfg.placeholder ? ` placeholder="${esc(cfg.placeholder)}"` : ''}>${esc(value)}</textarea>
      ${cfg.hint ? `<span class="hint">${esc(cfg.hint)}</span>` : ''}
    </div>`;
  }

  function optionsField(key, value, cfg = {}) {
    const options = (cfg.options || []).slice();
    const text = String(value);
    if (!options.some(([option]) => String(option) === text)) options.unshift([text, text]);
    return `<div class="field${cfg.span === 2 ? ' span-2' : ''}">
      ${fieldLabel(key, cfg.label)}
      <select class="select" id="prop-${esc(key)}" data-prop="${esc(key)}" data-kind="select">
        ${options.map(([option, optionText]) => `<option value="${esc(option)}" ${text === String(option) ? 'selected' : ''}>${esc(optionText)}</option>`).join('')}
      </select>
      ${cfg.hint ? `<span class="hint">${esc(cfg.hint)}</span>` : ''}
    </div>`;
  }

  function propField(key, value) {
    const cfg = PROP_FIELDS[key] || {};
    const text = String(value ?? '');
    if (cfg.type === 'number') return numberField(key, text, cfg);
    if (cfg.type === 'bool') return boolField(key, text, cfg);
    if (cfg.type === 'select') return optionsField(key, text, cfg);
    if (cfg.type === 'textarea') return textareaField(key, text, cfg);
    if (cfg.type === 'password' || cfg.type === 'text') return textField(key, text, cfg);

    const fallback = { label: key };
    if (BOOL_VALUES.has(text.toLowerCase())) return boolField(key, text, fallback);
    if (/^-?\d+$/.test(text)) return numberField(key, text, { ...fallback, min: -2147483648, max: 2147483647 });
    return textField(key, text, fallback);
  }

  function propGroup(group, values) {
    const body = group.keys.map((key) => propField(key, values[key])).join('');
    return `<details class="props-group" ${group.open ? 'open' : ''}>
      <summary>${icon(group.icon || 'list')} ${esc(group.title)}<span class="cg-count">${group.keys.length} ayar</span></summary>
      <div class="props-grid">${body}</div>
    </details>`;
  }

  function javaRows(selected) {
    const runtimes = CD.javaRuntimes();
    const rows = [`<label class="java-row ${!selected ? 'checked' : ''}">
      <input type="radio" name="java_path" value="" ${!selected ? 'checked' : ''}>
      <div class="jr-main">
        <div class="jr-title">Otomatik seçim <span class="chip chip-mini green">Önerilen</span></div>
        <div class="jr-path">Sunucu sürümüne göre en uygun Java otomatik seçilir.</div>
      </div>
    </label>`];
    for (const runtime of runtimes) {
      const active = runtime.path === selected;
      rows.push(`<label class="java-row ${active ? 'checked' : ''}">
        <input type="radio" name="java_path" value="${esc(runtime.path)}" ${active ? 'checked' : ''}>
        <div class="jr-main">
          <div class="jr-title">Java ${esc(runtime.major)} <span class="chip chip-mini">${esc(runtime.version || '')}</span>${runtime.source === 'managed' ? ' <span class="chip chip-mini accent">CraftDeck</span>' : ''}</div>
          <div class="jr-path" title="${esc(runtime.path)}">${esc(runtime.vendor || 'Bilinmeyen üretici')} · ${esc(runtime.path)}</div>
        </div>
      </label>`);
    }
    if (!runtimes.length) {
      rows.push('<div class="alert warn" style="margin:0">Sistemde Java bulunamadı. Aşağıdaki düğmelerle indirebilirsin.</div>');
    }
    return rows.join('');
  }

  function engineCard(server) {
    const engine = server.engine || {};
    const version = engine.loader_version || engine.version || '';
    return `<section class="panel settings-card">
      <div class="sc-head">
        <div>
          <h3>${icon('wrench')} Sunucu motoru</h3>
          <p>${esc(CD.loaderMeta(server.loader).name || server.loader)} motoru ve sürümü. Yeniden kurmak dosyaları günceller.</p>
        </div>
        <div class="sc-actions">
          <button type="button" class="btn sm ${server.installed ? 'ghost' : 'primary'}" data-action="install-engine">${icon('download')} ${server.installed ? 'Yeniden kur' : 'Motoru kur'}</button>
        </div>
      </div>
      <dl class="kv">
        <dt>Yükleyici</dt><dd>${esc(CD.loaderMeta(server.loader).name || server.loader)}</dd>
        <dt>Minecraft</dt><dd>${esc(server.mc_version)}</dd>
        <dt>Motor sürümü</dt><dd>${esc(version || 'Kurulmadı')}</dd>
        <dt>Gerekli Java</dt><dd>Java ${esc(server.java_required || CD.recommendedJava(server.mc_version))}+</dd>
        <dt>Durum</dt><dd>${server.installed ? '<span class="chip chip-mini green">Hazır</span>' : '<span class="chip chip-mini amber">Kurulmadı</span>'}</dd>
      </dl>
    </section>`;
  }

  function renderSettings() {
    const view = $('#view');
    if (!view) return;
    const server = CD.currentServer();
    if (!server) {
      CD.setHTML(view, `<div class="empty-state">${icon('alert')}<h3>Sunucu seçilmedi</h3></div>`);
      return;
    }
    const detail = state.detail;
    if (!detail || !detail.server || detail.server.id !== server.id || !detail.properties) {
      CD.setHTML(view, `<div class="page-head"><div><h2>${icon('settings')} Ayarlar</h2><p>Sunucu yapılandırması yükleniyor…</p></div></div>
        <div class="loading-block"><span class="spinner"></span> Ayarlar yükleniyor…</div>`);
      if (Date.now() - loadingDetailAt > 4000) {
        loadingDetailAt = Date.now();
        CD.loadDetail(server.id);
      }
      return;
    }

    const merged = { ...(CD.currentServer() || {}), ...detail.server };
    const config = detail.config || {};
    const props = (detail.properties && detail.properties.values) || {};
    const values = { ...(detail.properties.defaults || {}), ...props };
    const javaRequired = Number(merged.java_required || config.java_required || CD.recommendedJava(merged.mc_version)) || 21;
    const ramMin = Number(merged.ram_min_mb) || 1024;
    const ramMax = Number(merged.ram_max_mb) || 4096;
    const selectedJava = merged.java_path || '';

    const advanced = Object.keys(values)
      .filter((key) => !GROUPED_KEYS.has(key))
      .sort();

    const running = CD.statusOf(merged) === 'running' || CD.statusOf(merged) === 'starting';

    CD.setHTML(view, `<div class="page-head">
        <div>
          <h2>${icon('settings')} Ayarlar</h2>
          <p>${esc(merged.name)} · değişiklikler çoğunlukla sunucu yeniden başlatıldığında etkili olur.</p>
        </div>
        <div class="actions">
          <button type="button" class="btn sm ghost" data-action="settings-open-folder" data-which="server">${icon('folder')} Sunucu klasörü</button>
        </div>
      </div>
      <div class="settings-grid">

        <section class="panel settings-card">
          <div class="sc-head">
            <div><h3>${icon('server')} Genel</h3><p>Sunucu adı, port, bellek ve JVM seçenekleri.</p></div>
            ${running ? '<span class="chip chip-mini amber">Çalışırken bazı değişiklikler yeniden başlatma ister</span>' : ''}
          </div>
          <form data-form="server-general" autocomplete="off">
            <div class="form-grid">
              <div class="field">
                <label for="setName">Sunucu adı</label>
                <input class="input" id="setName" name="name" maxlength="48" required value="${esc(merged.name)}">
              </div>
              <div class="field">
                <label for="setPort">Port</label>
                <input class="input" id="setPort" name="port" type="number" min="1" max="65535" value="${esc(merged.port)}">
                <span class="hint">Değiştirirsen server.properties ve tünel hedefi güncellenir.</span>
              </div>
              <div class="field span-2">
                <span class="field-label">Bellek (RAM)</span>
                <div class="range-wrap">
                  <span class="tiny faint" style="min-width:28px">Min</span>
                  <input type="range" id="setRamMin" name="ram_min_mb" min="512" max="32768" step="512" value="${ramMin}" data-input="settings-ram">
                  <span class="range-value" id="setRamMinValue">${esc(ramLabel(ramMin))}</span>
                </div>
                <div class="range-wrap">
                  <span class="tiny faint" style="min-width:28px">Max</span>
                  <input type="range" id="setRamMax" name="ram_max_mb" min="512" max="65536" step="512" value="${ramMax}" data-input="settings-ram">
                  <span class="range-value" id="setRamMaxValue">${esc(ramLabel(ramMax))}</span>
                </div>
                <span class="hint">Sunucu komut satırına <span class="mono">-Xms${esc(ramMin)}M -Xmx${esc(ramMax)}M</span> olarak eklenir. 4 GB çoğu modpack için yeterlidir.</span>
              </div>
              <div class="field span-2">
                <label class="check"><input type="checkbox" name="auto_restart" value="1" ${merged.auto_restart ? 'checked' : ''}><span class="check-text">Beklenmedik kapanmada otomatik yeniden başlat<small>Sunucu çökerse kısa bir gecikmeyle tekrar başlatılır.</small></span></label>
              </div>
              <div class="field span-2">
                <label for="setJvmArgs">Ek JVM parametreleri <span class="faint">(isteğe bağlı)</span></label>
                <textarea class="textarea mono" id="setJvmArgs" name="extra_jvm_args" maxlength="600" placeholder="-XX:+UseZGC">${esc(config.extra_jvm_args || '')}</textarea>
                <span class="hint">Boşlukla ayrılır; RAM parametreleri CraftDeck tarafından otomatik eklenir.</span>
              </div>
            </div>
            <div class="sc-actions" style="margin-top:14px">
              <button type="submit" class="btn primary">${icon('save')} Genel ayarları kaydet</button>
            </div>
          </form>
        </section>

        <section class="panel settings-card">
          <div class="sc-head">
            <div>
              <h3>${icon('coffee')} Java</h3>
              <p>Minecraft ${esc(merged.mc_version)} için Java ${javaRequired}+ önerilir. Eksik sürümleri Adoptium Temurin ile indirebilirsin.</p>
            </div>
            <div class="sc-actions">
              <button type="button" class="btn sm ghost" data-action="settings-refresh-java">${icon('refresh')} Yeniden tara</button>
              <button type="button" class="btn sm primary" data-action="java-install" data-major="${javaRequired}">${icon('download')} Java ${javaRequired} indir</button>
            </div>
          </div>
          <form data-form="server-java">
            <div class="java-list">${javaRows(selectedJava)}</div>
            <div class="sc-actions" style="margin-top:12px">
              <button type="submit" class="btn primary">${icon('save')} Java seçimini kaydet</button>
            </div>
          </form>
          <hr class="divider">
          <div class="row">
            <span class="small faint">Diğer sürümler:</span>
            ${[8, 17, 21, 25].map((major) => `<button type="button" class="btn sm ghost" data-action="java-install" data-major="${major}">Java ${major}</button>`).join('')}
          </div>
          <form data-form="java-validate" class="input-group" style="margin-top:12px" autocomplete="off">
            <input class="input mono sm" name="path" placeholder="Özel java yolu: /yol/java veya C:\\...\\java.exe" spellcheck="false">
            <button type="submit" class="btn sm">${icon('check')} Doğrula ve kullan</button>
          </form>
        </section>

        <section class="panel settings-card">
          <div class="sc-head">
            <div><h3>${icon('list')} server.properties</h3><p>Sunucu oyun ayarları. Kaydettiğinde dosya güvenli biçimde güncellenir.</p></div>
            ${running ? '<span class="chip chip-mini amber">Yeniden başlatma gerekir</span>' : ''}
          </div>
          <form data-form="server-properties" autocomplete="off">
            <div class="props-groups">
              ${PROP_GROUPS.map((group) => propGroup(group, values)).join('')}
            </div>
            ${advanced.length ? `<details class="props-group">
              <summary>${icon('settings')} Gelişmiş<span class="cg-count">${advanced.length} ayar</span></summary>
              <div class="props-grid">${advanced.map((key) => propField(key, values[key])).join('')}</div>
            </details>` : ''}
            <div class="sc-actions" style="margin-top:14px">
              <button type="submit" class="btn primary">${icon('save')} Sunucu ayarlarını kaydet</button>
              <button type="button" class="btn ghost" data-action="settings-open-folder" data-which="properties">${icon('folder')} Dosyayı aç</button>
            </div>
          </form>
        </section>

        ${engineCard(merged)}

        <section class="panel settings-card" style="border-color:rgba(248,113,113,.28)">
          <div class="sc-head">
            <div><h3 style="color:var(--red)">${icon('alert')} Tehlikeli bölge</h3><p>Sunucuyu ve tüm dosyalarını kalıcı olarak siler. Bu işlem geri alınamaz.</p></div>
            <div class="sc-actions">
              <button type="button" class="btn danger" data-action="settings-delete">${icon('trash')} Sunucuyu sil</button>
            </div>
          </div>
          <dl class="kv">
            <dt>Sunucu klasörü</dt><dd class="mono small break">${esc(merged.dir || (detail.server && detail.server.dir) || '—')}</dd>
            <dt>Oluşturuldu</dt><dd>${esc(CD.fmtDate(config.created_at || merged.created_at))}</dd>
          </dl>
        </section>
      </div>`);

    paintRange($('#setRamMin'));
    paintRange($('#setRamMax'));
  }
  CD.renderSettings = renderSettings;

  async function refreshJava() {
    try {
      const data = await api('/api/java');
      state.java = data;
      if (state.detail) state.detail.java = data;
      CD.renderSidebarFooter();
      if (state.tab === 'settings') renderSettings();
      return data;
    } catch (err) {
      showError(err);
      return null;
    }
  }
  CD.refreshJava = refreshJava;

  CD.actions['settings-refresh-java'] = async () => {
    const data = await refreshJava();
    if (data) toast('Java taraması tamamlandı', 'success', `${(data.runtimes || []).length} çalışma zamanı bulundu.`);
  };

  CD.actions['java-install'] = async (el) => {
    const major = Number(el.dataset.major) || 21;
    try {
      const data = await api('/api/java/install', {
        method: 'POST',
        body: { major, server_id: state.currentId || '' },
      });
      if (data && data.job) {
        CD.noteJob(data.job);
        toast(`Java ${major} indiriliyor`, 'info', 'İndirme arka planda sürüyor; tamamlanınca otomatik seçilecek.');
        setTimeout(() => CD.openJobModal(data.job.id), 320);
      }
      CD.refreshJobs();
    } catch (err) { showError(err); }
  };

  CD.actions['settings-open-folder'] = async (el) => {
    if (!state.currentId) return;
    try {
      await api(`/api/servers/${encodeURIComponent(state.currentId)}/open`, { method: 'POST', body: { which: el.dataset.which || 'server' } });
    } catch (err) { showError(err); }
  };

  CD.actions['settings-delete'] = async () => {
    const server = CD.currentServer();
    if (!server) return;
    const confirmed = await CD.confirmDialog({
      title: 'Sunucuyu sil',
      message: `<strong>${esc(server.name)}</strong> sunucusu, dünyası, modları ve tüm dosyaları kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
      confirmText: 'Sil',
      requireText: server.name,
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api(`/api/servers/${encodeURIComponent(server.id)}?files=1`, { method: 'DELETE' });
      toast('Sunucu silindi', 'success', server.name);
      state.detail = null;
      CD.mergeServer(null);
      await CD.refreshServers();
      if (!state.servers.length) location.hash = '#/welcome';
      else CD.enterServer(state.servers[0].id, 'overview');
    } catch (err) { showError(err); }
  };

  CD.inputs['settings-ram'] = (input) => {
    const form = input.closest('form');
    if (!form) return;
    const min = $('#setRamMin', form);
    const max = $('#setRamMax', form);
    if (!min || !max) return;
    if (min === input && Number(min.value) > Number(max.value)) max.value = min.value;
    if (max === input && Number(max.value) < Number(min.value)) min.value = max.value;
    paintRange(min);
    paintRange(max);
    const minLabel = $('#setRamMinValue', form);
    const maxLabel = $('#setRamMaxValue', form);
    if (minLabel) minLabel.textContent = ramLabel(min.value);
    if (maxLabel) maxLabel.textContent = ramLabel(max.value);
  };

  CD.forms['server-general'] = async (form, submitter) => {
    if (!state.currentId) return;
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const port = Number(data.get('port'));
    const ramMin = Number(data.get('ram_min_mb')) || 1024;
    const ramMax = Number(data.get('ram_max_mb')) || 4096;
    if (!name) { toast('Sunucu adı boş olamaz', 'warn'); return; }
    if (!Number.isInteger(port) || port < 1 || port > 65535) { toast('Geçersiz port', 'warn', '1-65535 arasında olmalı.'); return; }
    if (ramMax < ramMin) { toast('RAM aralığı geçersiz', 'warn', 'Maksimum, minimumdan küçük olamaz.'); return; }
    if (submitter) submitter.disabled = true;
    try {
      const result = await api(`/api/servers/${encodeURIComponent(state.currentId)}`, {
        method: 'PATCH',
        body: {
          name,
          port,
          ram_min_mb: ramMin,
          ram_max_mb: ramMax,
          auto_restart: data.get('auto_restart') != null,
          extra_jvm_args: String(data.get('extra_jvm_args') || ''),
        },
      });
      toast('Genel ayarlar kaydedildi', 'success', result && result.restart_required ? 'Değişiklikler için sunucuyu yeniden başlat.' : '');
      await CD.refreshServers();
      await CD.loadDetail(state.currentId);
    } catch (err) {
      showError(err);
    } finally {
      if (submitter) submitter.disabled = false;
    }
  };

  CD.forms['server-java'] = async (form, submitter) => {
    if (!state.currentId) return;
    const picked = form.querySelector('input[name="java_path"]:checked');
    const javaPath = picked ? picked.value : '';
    if (submitter) submitter.disabled = true;
    try {
      await api(`/api/servers/${encodeURIComponent(state.currentId)}`, { method: 'PATCH', body: { java_path: javaPath } });
      toast('Java seçimi kaydedildi', 'success', javaPath ? CD.basename(javaPath) : 'Otomatik seçim kullanılacak.');
      await CD.refreshServers();
      await CD.loadDetail(state.currentId);
    } catch (err) {
      showError(err);
    } finally {
      if (submitter) submitter.disabled = false;
    }
  };

  CD.forms['java-validate'] = async (form, submitter) => {
    if (!state.currentId) return;
    const path = String((new FormData(form).get('path')) || '').trim();
    if (!path) { toast('Java yolu girin', 'warn'); return; }
    if (submitter) submitter.disabled = true;
    try {
      const checked = await api('/api/java/validate', { method: 'POST', body: { path } });
      const info = checked && checked.java;
      await api(`/api/servers/${encodeURIComponent(state.currentId)}`, { method: 'PATCH', body: { java_path: info.path || path } });
      toast('Java doğrulandı ve seçildi', 'success', `Java ${info.major} · ${info.version || ''}`);
      await CD.refreshJava();
      await CD.loadDetail(state.currentId);
    } catch (err) {
      showError(err);
    } finally {
      if (submitter) submitter.disabled = false;
    }
  };

  CD.forms['server-properties'] = async (form, submitter) => {
    if (!state.currentId) return;
    const values = {};
    let invalid = null;
    form.querySelectorAll('[data-prop]').forEach((input) => {
      const key = input.dataset.prop;
      const kind = input.dataset.kind;
      if (kind === 'number') {
        const raw = String(input.value).trim();

        if (raw === '') { input.classList.remove('invalid'); return; }
        const num = Number(raw);
        if (!Number.isFinite(num)) { invalid = invalid || input; return; }
        const min = input.min === '' ? null : Number(input.min);
        const max = input.max === '' ? null : Number(input.max);
        if ((min !== null && num < min) || (max !== null && num > max)) {
          invalid = invalid || input;
          return;
        }
        input.classList.remove('invalid');
        values[key] = String(Number.isInteger(num) ? num : raw);
        return;
      }
      values[key] = input.value;
    });
    if (invalid) {
      invalid.classList.add('invalid');
      invalid.focus();
      toast('Geçersiz değer', 'warn', `${invalid.dataset.prop}: ${invalid.min || '—'} – ${invalid.max || '—'} aralığında bir sayı gir.`);
      return;
    }
    if (!Object.keys(values).length) { toast('Kaydedilecek ayar yok', 'warn'); return; }
    if (submitter) submitter.disabled = true;
    try {
      const result = await api(`/api/servers/${encodeURIComponent(state.currentId)}/properties`, {
        method: 'PUT',
        body: { values },
      });
      toast('server.properties kaydedildi', 'success', result && result.restart_required ? 'Değişiklikler yeniden başlatmada etkili olur.' : '');
      await CD.loadDetail(state.currentId);

      if ('server-port' in values) await CD.refreshServers();
    } catch (err) {
      showError(err);
    } finally {
      if (submitter) submitter.disabled = false;
    }
  };
})();
