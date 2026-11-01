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

  const st = CD.storeState;

  const TYPE_LABELS = {
    mod: 'Mod', modpack: 'Modpack', plugin: 'Plugin', datapack: 'Datapack',
    shader: 'Shader', resourcepack: 'Resource Pack',
  };
  const TYPE_ICONS = {
    mod: 'puzzle', modpack: 'package', plugin: 'zap', datapack: 'database',
    shader: 'sparkles', resourcepack: 'image',
  };
  const LOADER_OPTIONS = [
    ['', 'Tüm yükleyiciler'],
    ['fabric', 'Fabric'], ['quilt', 'Quilt'], ['forge', 'Forge'], ['neoforge', 'NeoForge'],
    ['paper', 'Paper'], ['purpur', 'Purpur'], ['spigot', 'Spigot'], ['bukkit', 'Bukkit'], ['folia', 'Folia'],
    ['datapack', 'Datapack'], ['minecraft', 'Minecraft'], ['iris', 'Iris'], ['optifine', 'OptiFine'],
  ];
  const SORT_OPTIONS = [
    ['relevance', 'İlgiye göre'], ['downloads', 'İndirmeye göre'], ['follows', 'Takipçiye göre'],
    ['newest', 'En yeni'], ['updated', 'Son güncellenen'],
  ];
  const MODDED_LOADERS = new Set(['fabric', 'quilt', 'forge', 'neoforge']);
  const PLUGIN_LOADERS = new Set(['paper', 'purpur', 'spigot', 'bukkit', 'folia']);

  let searchTimer = null;
  let activeProject = null;

  function serverContext() {
    return state.currentId ? CD.currentServer() : null;
  }

  function loaderLabel(id) {
    const found = LOADER_OPTIONS.find((row) => row[0] === id);
    return found ? found[1] : (id || '—');
  }

  function inlineMd(text) {
    let out = esc(text);
    out = out.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1 (görsel)</a>');
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    return out;
  }

  function renderMarkdown(markdown) {
    const source = String(markdown || '').replace(/\r/g, '').slice(0, 16000);
    if (!source.trim()) return '<p class="faint">Açıklama yok.</p>';
    const lines = source.split('\n');
    const out = [];
    let paragraph = [];
    let list = [];
    let code = null;
    let codeLines = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      out.push(`<p>${inlineMd(paragraph.join(' '))}</p>`);
      paragraph = [];
    };
    const flushList = () => {
      if (!list.length) return;
      out.push(`<ul>${list.map((item) => `<li>${inlineMd(item)}</li>`).join('')}</ul>`);
      list = [];
    };
    const flushAll = () => { flushParagraph(); flushList(); };

    for (const rawLine of lines) {
      const line = rawLine.replace(/\t/g, '    ');
      if (code !== null) {
        if (/^\s*```/.test(line)) {
          out.push(`<pre class="pre-wrap"><code>${esc(codeLines.join('\n'))}</code></pre>`);
          code = null;
          codeLines = [];
        } else {
          codeLines.push(line);
        }
        continue;
      }
      if (/^\s*```/.test(line)) {
        flushAll();
        code = '';
        continue;
      }
      if (!line.trim()) { flushAll(); continue; }
      const heading = line.match(/^\s*#{1,6}\s+(.+)$/);
      if (heading) { flushAll(); out.push(`<h4>${inlineMd(heading[1])}</h4>`); continue; }
      const bullet = line.match(/^\s*[-*+]\s+(.+)$/) || line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (bullet) { flushParagraph(); list.push(bullet[1]); continue; }
      if (/^\s*>\s?/.test(line)) { flushAll(); out.push(`<p class="muted">${inlineMd(line.replace(/^\s*>\s?/, ''))}</p>`); continue; }
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flushAll(); out.push('<hr>'); continue; }
      paragraph.push(line.trim());
      if (paragraph.join(' ').length > 900) flushParagraph();
    }
    if (code !== null) out.push(`<pre class="pre-wrap"><code>${esc(codeLines.join('\n'))}</code></pre>`);
    flushAll();
    return out.join('') || '<p class="faint">Açıklama yok.</p>';
  }
  CD.renderMarkdown = renderMarkdown;

  function buildQuery() {
    const params = new URLSearchParams();
    if (st.query) params.set('query', st.query);
    if (st.type) params.set('type', st.type);
    if (st.loader) params.set('loader', st.loader);
    if (st.version) params.set('version', st.version);
    params.set('index', st.index || 'relevance');
    params.set('offset', String(st.offset || 0));
    params.set('limit', String(st.limit || 24));
    return params.toString();
  }

  async function runStoreSearch() {
    const ticket = ++st.requestSeq;
    st.loading = true;
    st.error = '';
    paintStoreChrome();
    try {
      const data = await api(`/api/modrinth/search?${buildQuery()}`);
      if (ticket !== st.requestSeq) return;
      st.result = data;
      st.error = '';
    } catch (err) {
      if (ticket !== st.requestSeq) return;
      st.error = err && err.message ? err.message : 'Arama başarısız';
      st.result = null;
    } finally {
      if (ticket === st.requestSeq) {
        st.loading = false;
        if (state.tab === 'store') renderStoreResults();
      }
    }
  }
  CD.runStoreSearch = runStoreSearch;

  const debouncedSearch = CD.debounce(() => {
    st.offset = 0;
    runStoreSearch();
  }, 380);

  function versionOptions(selected) {
    const versions = state.gameVersions || [];
    const rows = [`<option value="">Tüm Minecraft sürümleri</option>`];
    for (const item of versions) {
      const id = item.id || item;
      rows.push(`<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(id)}${item.type && item.type !== 'release' ? ` (${esc(item.type)})` : ''}</option>`);
    }
    return rows.join('');
  }

  function loaderOptions(selected) {
    return LOADER_OPTIONS.map(([value, label]) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`).join('');
  }

  function typeOptions(selected) {
    const rows = [`<option value="">Tüm türler</option>`];
    for (const [value, label] of Object.entries(TYPE_LABELS)) {
      rows.push(`<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`);
    }
    return rows.join('');
  }

  function sortOptions(selected) {
    return SORT_OPTIONS.map(([value, label]) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`).join('');
  }

  function initFiltersIfNeeded() {
    const server = serverContext();
    const serverId = server ? server.id : null;
    if (st.initialized && st.serverId === serverId) return;
    st.initialized = true;
    st.serverId = serverId;
    st.offset = 0;
    st.error = '';
    if (server) {
      st.loader = MODDED_LOADERS.has(server.loader) || PLUGIN_LOADERS.has(server.loader) ? server.loader : '';
      st.version = server.mc_version || '';
    } else {
      st.loader = '';
      st.version = '';
    }
    st.result = null;
    runStoreSearch();
  }

  function contextBanner(server) {
    if (!server) {
      return `<div class="alert info" style="margin:0">${icon('store')}<div><strong>Modrinth mağazası.</strong> Bir sunucu seçtiğinde filtreler o sunucunun yükleyicisi ve Minecraft sürümüne göre otomatik ayarlanır.</div></div>`;
    }
    return `<div class="alert info" style="margin:0">${icon('info')}<div><strong>${esc(server.name)}</strong> için filtreler: ${esc(loaderLabel(server.loader))} · Minecraft ${esc(server.mc_version)}. Kurulumlar doğrudan bu sunucuya yapılır. <button type="button" class="linklike" data-action="store-reset-filters">Filtreleri temizle</button></div></div>`;
  }

  function renderStore() {
    initFiltersIfNeeded();
    const view = $('#view');
    if (!view) return;
    const server = serverContext();
    const html = `<div class="page-head">
      <div>
        <h2>${icon('store')} Modrinth Mağazası</h2>
        <p>Mod, modpack, plugin, datapack, shader ve resource pack ara; sürüm ve yükleyiciye göre filtrele, tek tıkla kur.</p>
      </div>
      <div class="actions">
        ${server ? `<button type="button" class="btn sm ghost" data-action="store-back">${icon('chevron-left')} Sunucuya dön</button>` : ''}
        <button type="button" class="btn sm ghost" data-action="store-refresh">${icon('refresh')} Yenile</button>
      </div>
    </div>
    <div class="section" style="margin-bottom:14px">${contextBanner(server)}</div>
    <form class="store-filters" data-form="store-search" autocomplete="off">
      <div class="search">
        ${icon('search')}
        <input class="input" id="storeQuery" data-input="store-query" value="${esc(st.query)}" placeholder="Modrinth'te ara… (Ctrl+K)" spellcheck="false">
      </div>
      <div class="field"><label for="storeType">Tür</label><select class="select" id="storeType" data-change="store-filter">${typeOptions(st.type)}</select></div>
      <div class="field"><label for="storeLoader">Yükleyici</label><select class="select" id="storeLoader" data-change="store-filter">${loaderOptions(st.loader)}</select></div>
      <div class="field"><label for="storeVersion">Minecraft</label><select class="select" id="storeVersion" data-change="store-filter">${versionOptions(st.version)}</select></div>
      <div class="field"><label for="storeIndex">Sıralama</label><select class="select" id="storeIndex" data-change="store-filter">${sortOptions(st.index)}</select></div>
    </form>
    <div id="storeResults">${resultsHTML()}</div>`;
    CD.setHTML(view, html);
  }
  CD.renderStore = renderStore;

  function resultsHTML() {
    if (st.loading && !st.result) return `<div class="store-loading"><span class="spinner"></span> Modrinth taranıyor…</div>`;
    if (st.error) {
      return `<div class="alert error">${icon('alert')}<div><strong>Arama başarısız.</strong> ${esc(st.error)}<div style="margin-top:8px"><button type="button" class="btn sm" data-action="store-retry">${icon('refresh')} Tekrar dene</button></div></div></div>`;
    }
    if (!st.result) return `<div class="store-loading">Arama bekleniyor…</div>`;
    const hits = st.result.hits || [];
    if (!hits.length) {
      return `<div class="empty-state">${icon('search')}<h3>Sonuç bulunamadı</h3><p>Farklı bir arama veya filtre deneyin.</p><div style="margin-top:12px"><button type="button" class="btn sm ghost" data-action="store-reset-filters">Filtreleri temizle</button></div></div>`;
    }
    const total = Number(st.result.total_hits) || 0;
    const offset = Number(st.result.offset) || st.offset || 0;
    const limit = Number(st.result.limit) || st.limit;
    const page = Math.floor(offset / limit) + 1;
    const pages = Math.max(1, Math.ceil(total / limit));
    const cards = hits.map(storeCard).join('');
    return `<div class="row between" style="margin-bottom:10px">
        <span class="small muted">${CD.fmtNum(total)} sonuç · sayfa ${page} / ${pages}</span>
        ${st.loading ? '<span class="status-inline"><span class="spinner"></span> güncelleniyor…</span>' : ''}
      </div>
      <div class="store-grid">${cards}</div>
      <div class="pager">
        <button type="button" class="btn sm ghost" data-action="store-prev" ${offset <= 0 ? 'disabled' : ''}>${icon('chevron-left')} Önceki</button>
        <span>${CD.fmtNum(offset + 1)}–${CD.fmtNum(Math.min(offset + limit, total))} / ${CD.fmtNum(total)}</span>
        <button type="button" class="btn sm ghost" data-action="store-next" ${offset + limit >= total ? 'disabled' : ''}>Sonraki ${icon('chevron-right')}</button>
      </div>`;
  }

  function storeCard(hit) {
    const type = hit.type || 'mod';
    const iconUrl = CD.safeUrl(hit.icon_url);
    const cats = (hit.display_categories || hit.categories || []).slice(0, 4);
    const title = hit.title || hit.slug || 'Bilinmeyen proje';
    const initials = String(title).trim().slice(0, 1).toUpperCase() || '?';
    const clientOnly = hit.server_side === 'unsupported';
    const server = serverContext();
    const blocked = type === 'mod' && clientOnly;
    const mismatch = Boolean(server) && (
      (type === 'mod' && !MODDED_LOADERS.has(server.loader)) ||
      (type === 'plugin' && !PLUGIN_LOADERS.has(server.loader))
    );
    const quickTitle = blocked
      ? 'Bu mod yalnızca istemcide çalışır; sunucuya kurulamaz.'
      : mismatch
        ? `${loaderLabel(server.loader)} sunucusuyla uyumlu değil.`
        : server
          ? `${server.name} sunucusuna tek tıkla kur`
          : 'Kurmak için önce bir sunucu seç';
    return `<article class="store-card" data-project="${esc(hit.id)}" role="button" tabindex="0" aria-label="${esc(title)}">
      ${iconUrl
        ? `<img class="store-icon" src="${esc(iconUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        : `<div class="store-icon placeholder">${esc(initials)}</div>`}
      <div class="store-body">
        <div class="store-top">
          <div class="store-title">${esc(title)}</div>
          <span class="chip chip-mini ${clientOnly ? 'red' : ''}" title="${clientOnly ? 'Sunucuya kurulamaz (yalnızca istemci)' : ''}">${esc(TYPE_LABELS[type] || type)}</span>
        </div>
        <div class="tiny faint" style="margin-top:2px">${esc(hit.author || 'Modrinth')}</div>
        <div class="store-desc">${esc(hit.description || '')}</div>
        ${cats.length ? `<div class="store-cats">${cats.map((cat) => `<span class="chip chip-mini">${esc(cat)}</span>`).join('')}</div>` : ''}
        <div class="store-meta">
          <span class="m" title="İndirme">${icon('download')} ${esc(CD.fmtCompact(hit.downloads))}</span>
          <span class="m" title="Takipçi">${icon('users')} ${esc(CD.fmtCompact(hit.follows))}</span>
          ${hit.date_modified ? `<span class="m" title="Son güncelleme">${icon('clock')} ${esc(CD.timeAgo(hit.date_modified))}</span>` : ''}
          ${clientOnly ? '<span class="chip chip-mini red">İstemci</span>' : ''}
        </div>
        <div class="store-actions">
          <button type="button" class="btn sm primary" data-action="quick-install" data-id="${esc(hit.id)}" data-type="${esc(type)}" title="${esc(quickTitle)}" ${blocked || mismatch ? 'disabled' : ''}>${icon('download')} Kur</button>
          <button type="button" class="btn sm" data-action="open-project" data-id="${esc(hit.id)}">${icon('eye')} Ayrıntı</button>
          <a class="btn sm ghost" href="https://modrinth.com/${esc(type)}/${esc(hit.slug || hit.id)}" target="_blank" rel="noreferrer noopener" data-stop>${icon('external')} Modrinth</a>
        </div>
      </div>
    </article>`;
  }

  function paintStoreChrome() {
    if (state.tab !== 'store') return;
    const box = $('#storeResults');
    if (!box) return;
    box.innerHTML = resultsHTML();
  }

  function renderStoreResults() {
    if (state.tab !== 'store') return;
    paintStoreChrome();
  }

  function versionLabel(version) {
    const parts = [version.version_number || version.name || version.id];
    if (version.version_type && version.version_type !== 'release') parts.push(version.version_type);
    if ((version.game_versions || []).length) parts.push((version.game_versions || []).slice(0, 3).join(', '));
    if ((version.loaders || []).length) parts.push((version.loaders || []).slice(0, 3).join('/'));
    return parts.join(' · ');
  }

  function compatibleVersions(project, server) {
    const all = project.versions_all || [];
    if (!server) return all;
    const type = project.type;
    const sameMc = all.filter((version) => (version.game_versions || []).includes(server.mc_version));
    if (type === 'mod' || type === 'plugin' || type === 'modpack') {
      const both = sameMc.filter((version) => (version.loaders || []).includes(server.loader));
      if (both.length) return both;
      const byLoader = all.filter((version) => (version.loaders || []).includes(server.loader));
      if (byLoader.length) return byLoader;
      return all;
    }
    if (sameMc.length) return sameMc;
    return all;
  }

  function projectFooter(project) {
    const server = serverContext();
    const type = project.type;
    const clientOnly = type === 'mod' && project.server_side === 'unsupported';
    const close = `<button type="button" class="btn ghost" data-action="modal-close">Kapat</button>`;
    if (clientOnly && server) {
      return `${close}<button type="button" class="btn" disabled>Sunucuya kurulamaz</button>`;
    }
    if (!server && type !== 'modpack') {
      return `${close}<button type="button" class="btn primary" data-action="project-create-server">${icon('plus')} Bu proje için sunucu oluştur</button>`;
    }
    if (!server && type === 'modpack') {
      return `${close}<button type="button" class="btn primary" data-action="project-install">${icon('download')} Modpack sunucusu oluştur</button>`;
    }
    const label = type === 'modpack' ? 'Modpack’i bu sunucuya kur' : 'Sunucuya kur';
    return `${close}<button type="button" class="btn primary" data-action="project-install" ${project.versions_all && project.versions_all.length ? '' : 'disabled'}>${icon('download')} ${label}</button>`;
  }

  function projectBody(project) {
    const server = serverContext();
    const type = project.type || 'mod';
    const iconUrl = CD.safeUrl(project.icon_url);
    const versions = compatibleVersions(project, server);
    const clientOnly = type === 'mod' && project.server_side === 'unsupported';
    const incompatible = server && (
      (type === 'mod' && !MODDED_LOADERS.has(server.loader)) ||
      (type === 'plugin' && !PLUGIN_LOADERS.has(server.loader))
    );
    const versionRows = versions.slice(0, 80).map((version) => `<option value="${esc(version.id)}">${esc(versionLabel(version))}</option>`).join('');
    const gameVersions = (project.game_versions || []).slice(0, 12);
    const loaders = project.loaders || [];

    return `<div class="project-hero">
      ${iconUrl
        ? `<img class="store-icon" src="${esc(iconUrl)}" alt="" referrerpolicy="no-referrer">`
        : `<div class="store-icon placeholder">${esc(String(project.title || '?').slice(0, 1).toUpperCase())}</div>`}
      <div style="min-width:0;flex:1">
        <h2>${esc(project.title || project.slug || 'Proje')}</h2>
        <div class="by">${esc(TYPE_LABELS[type] || type)} · ${esc(project.license || 'Lisans belirtilmemiş')} · <a href="https://modrinth.com/${esc(type)}/${esc(project.slug || project.id)}" target="_blank" rel="noreferrer noopener">Modrinth’te aç ${icon('external')}</a></div>
        <p class="small muted" style="margin-top:7px">${esc(project.description || '')}</p>
        <div class="project-stats">
          <span class="chip">${icon('download')} ${esc(CD.fmtNum(project.downloads))} indirme</span>
          <span class="chip">${icon('users')} ${esc(CD.fmtNum(project.follows))} takipçi</span>
          <span class="chip ${clientOnly ? 'red' : 'green'}">${clientOnly ? 'Yalnızca istemci' : 'Sunucu dostu'}</span>
          ${(project.date_modified || project.updated) ? `<span class="chip">${icon('clock')} ${esc(CD.timeAgo(project.date_modified || project.updated))}</span>` : ''}
        </div>
        ${gameVersions.length ? `<div class="row" style="margin-top:9px;gap:4px">${gameVersions.map((v) => `<span class="chip chip-mini">${esc(v)}</span>`).join('')}</div>` : ''}
        ${loaders.length ? `<div class="row" style="margin-top:5px;gap:4px">${loaders.slice(0, 10).map((l) => `<span class="chip chip-mini blue">${esc(loaderLabel(l))}</span>`).join('')}</div>` : ''}
      </div>
    </div>

    ${clientOnly ? `<div class="alert error" style="margin-top:14px">${icon('alert')}<div>Bu proje yalnızca istemci tarafında çalışır; sunucuya kurulamaz.</div></div>` : ''}
    ${incompatible ? `<div class="alert warn" style="margin-top:14px">${icon('alert')}<div>Bu proje türü <strong>${esc(loaderLabel(server.loader))}</strong> sunucusuyla uyumlu değil. Uygun bir sunucu oluşturup oradan kurabilirsin.</div></div>` : ''}
    ${server && versions.length && !versions.some((version) => (version.game_versions || []).includes(server.mc_version)) ? `<div class="alert warn" style="margin-top:14px">${icon('alert')}<div>Sunucunun Minecraft ${esc(server.mc_version)} sürümüyle birebir eşleşen sürüm bulunamadı. Uyumluluk sunucu tarafından ayrıca kontrol edilir.</div></div>` : ''}

    <form data-form="project-install" data-project-id="${esc(project.id)}" data-project-type="${esc(type)}" class="stack" style="margin-top:16px" autocomplete="off">
      <div class="form-grid">
        <div class="field span-2">
          <label for="projectVersion">Sürüm</label>
          <select class="select" id="projectVersion" name="version_id">
            <option value="">${server ? 'Otomatik (sunucuya en uygun)' : 'Otomatik (en yeni kararlı)'}</option>
            ${versionRows}
          </select>
          <span class="hint">${server ? `Yalnızca ${esc(server.mc_version)} / ${esc(loaderLabel(server.loader))} uyumlu sürümler önce listelenir.` : 'Kurulumdan sonra sürüm değiştirmek için mağazayı yeniden kullanabilirsin.'}</span>
        </div>
        ${type !== 'modpack' ? `<div class="field span-2">
          <label class="check"><input type="checkbox" name="with_dependencies" value="1" checked><span class="check-text">Zorunlu bağımlılıkları da kur<small>Örn. Fabric API, kütüphaneler.</small></span></label>
        </div>` : ''}
      </div>
      ${type === 'modpack' && server ? `<div class="alert warn" style="margin:0">${icon('alert')}<div>Modpack kurulumu sunucunun Minecraft sürümünü ve yükleyicisini paketle değiştirebilir; motor gerekirse yeniden kurulur. Mevcut dünya korunur.</div></div>` : ''}
      ${type === 'modpack' && !server ? `<div class="alert info" style="margin:0">${icon('info')}<div>Yeni bir sunucu oluşturulur; seçilen sürüm indirilir, motor ve modlar otomatik kurulur.</div></div>` : ''}
    </form>

    <div class="project-body">${renderMarkdown(project.body)}</div>
    ${(project.gallery || []).length ? `<div class="project-gallery">${project.gallery.slice(0, 6).map((img) => {
      const url = CD.safeUrl(img.url);
      return url ? `<a href="${esc(url)}" target="_blank" rel="noreferrer noopener"><img src="${esc(url)}" alt="${esc(img.title || '')}" loading="lazy" referrerpolicy="no-referrer"></a>` : '';
    }).join('')}</div>` : ''}`;
  }

  async function openProject(projectId) {
    if (!projectId) return;
    const modal = CD.openModal({
      title: 'Proje ayrıntısı',
      subtitle: 'Modrinth',
      size: 'xl',
      body: '<div class="loading-block"><span class="spinner"></span> Proje yükleniyor…</div>',
      footer: '<button type="button" class="btn ghost" data-action="modal-close">Kapat</button>',
    });
    if (!modal) return;
    try {
      const project = await api(`/api/modrinth/project/${encodeURIComponent(projectId)}`);
      activeProject = project;
      modal.body.innerHTML = projectBody(project);
      modal.setFooter(projectFooter(project));
      const heading = $('.modal-head h2', modal.el);
      if (heading) heading.textContent = project.title || 'Proje';
      const sub = $('.modal-head p', modal.el);
      if (sub) sub.textContent = `${TYPE_LABELS[project.type] || project.type || 'Proje'} · Modrinth`;
    } catch (err) {
      modal.body.innerHTML = `<div class="alert error">${icon('alert')}<div><strong>Proje yüklenemedi.</strong><br>${esc(err.message || '')}</div></div>`;
      showError(err);
    }
  }
  CD.openProject = openProject;

  async function installProject(form, submitter) {
    if (!form) return;
    const projectId = form.dataset.projectId;
    const type = form.dataset.projectType;
    const versionSelect = form.querySelector('[name="version_id"]');
    const versionId = versionSelect ? versionSelect.value : '';
    const depsInput = form.querySelector('[name="with_dependencies"]');
    const withDependencies = depsInput ? depsInput.checked : true;
    if (!projectId) { toast('Proje bilgisi eksik', 'warn'); return; }

    const modalEl = form.closest('.modal-backdrop');
    const closeModal = () => { if (modalEl && modalEl.__modal) modalEl.__modal.close(); };
    if (submitter) { submitter.disabled = true; submitter.dataset.busy = '1'; }
    const note = toast(type === 'modpack' ? 'Modpack kurulumu başlatılıyor…' : 'İçerik kurulumu başlatılıyor…', 'info', 'İndirme arka planda devam edecek.', { timeout: 0 });

    try {
      if (type === 'modpack') {
        if (state.currentId) {
          const data = await api(`/api/servers/${encodeURIComponent(state.currentId)}/modpack`, {
            method: 'POST',
            body: { project_id: projectId, version_id: versionId || null },
          });
          note.close();
          closeModal();
          if (data && data.job) {
            CD.noteJob(data.job);
            toast('Modpack kurulumu başladı', 'success', 'Sunucunun sürümü ve yükleyicisi pakete göre güncellenebilir.');
            setTimeout(() => CD.openJobModal(data.job.id), 320);
          }
          CD.refreshJobs();
          if (typeof CD.refreshContent === 'function') CD.refreshContent(true);
          CD.loadDetail(state.currentId);
          return;
        }
        const data = await api('/api/servers/from-modrinth', {
          method: 'POST',
          body: { project_id: projectId, version_id: versionId || null },
        });
        note.close();
        closeModal();
        const server = data && data.server;
        if (data && data.job) CD.noteJob(data.job);
        toast('Modpack sunucusu oluşturuldu', 'success', 'Kurulum arka planda sürüyor.');
        await CD.refreshServers();
        if (server) {
          CD.navigate(server.id, 'overview');
          if (data.job) setTimeout(() => CD.openJobModal(data.job.id), 320);
        }
        CD.refreshJobs();
        return;
      }

      if (!state.currentId) {
        note.close();
        closeModal();
        presetCreateServer();
        return;
      }
      const data = await api(`/api/servers/${encodeURIComponent(state.currentId)}/content`, {
        method: 'POST',
        body: { project_id: projectId, version_id: versionId || null, with_dependencies: withDependencies },
      });
      note.close();
      closeModal();
      if (data && data.job) {
        CD.noteJob(data.job);
        toast('Kurulum başladı', 'success', 'Modrinth dosyaları indiriliyor.');
        setTimeout(() => CD.openJobModal(data.job.id), 320);
      }
      CD.refreshJobs();
    } catch (err) {
      note.close();
      showError(err);
    } finally {
      if (submitter) { submitter.disabled = false; delete submitter.dataset.busy; }
    }
  }

  async function quickInstall(projectId, type, submitter) {
    if (!projectId) return;
    if (!state.currentId && type !== 'modpack') {
      toast('Önce bir sunucu seç', 'info', 'Ayrıntı penceresinden bu proje için yeni sunucu oluşturabilirsin.');
      return openProject(projectId);
    }
    if (type === 'modpack') {
      const ok = await CD.confirmDialog({
        title: state.currentId ? 'Modpack bu sunucuya kurulsun mu?' : 'Modpack sunucusu oluşturulsun mu?',
        message: state.currentId
          ? 'Paket, sunucunun Minecraft sürümünü ve yükleyicisini değiştirebilir. Mevcut dünya korunur.'
          : 'Seçilen paket için yeni bir sunucu oluşturulur; sürüm, motor ve modlar otomatik kurulur.',
        confirmText: state.currentId ? 'Kur' : 'Oluştur',
      });
      if (!ok) return;
    }
    const form = document.createElement('form');
    form.dataset.projectId = projectId;
    form.dataset.projectType = type;
    return installProject(form, submitter);
  }

  function presetCreateServer() {
    const project = activeProject;
    if (!project) return;
    const projectLoaders = (project.loaders || []).filter((id) => state.loaders.some((loader) => loader.id === id));
    const loader = projectLoaders[0] || (project.type === 'plugin' ? 'paper' : 'fabric');
    const mcVersion = (project.game_versions || [])[0] || (state.gameVersions[0] && state.gameVersions[0].id) || '26.3';
    if (typeof CD.openCreateServerModal === 'function') {
      CD.openCreateServerModal({ name: project.title, loader, mc_version: mcVersion });
    }
  }

  CD.forms['store-search'] = () => {
    st.offset = 0;
    runStoreSearch();
  };

  CD.inputs['store-query'] = (input) => {
    st.query = String(input.value || '').trim();
    debouncedSearch();
  };

  CD.changes['store-filter'] = (select) => {
    const map = { storeType: 'type', storeLoader: 'loader', storeVersion: 'version', storeIndex: 'index' };
    const key = map[select.id];
    if (!key) return;
    st[key] = select.value;
    st.offset = 0;
    runStoreSearch();
  };

  CD.actions['store-refresh'] = () => runStoreSearch();
  CD.actions['store-retry'] = () => runStoreSearch();
  CD.actions['store-back'] = () => { if (state.currentId) CD.navigate(state.currentId, 'overview'); };
  CD.actions['store-prev'] = () => {
    st.offset = Math.max(0, st.offset - st.limit);
    runStoreSearch();
  };
  CD.actions['store-next'] = () => {
    const total = st.result ? Number(st.result.total_hits) || 0 : 0;
    if (total && st.offset + st.limit >= total) return;
    st.offset += st.limit;
    runStoreSearch();
  };
  CD.actions['store-reset-filters'] = () => {
    st.query = '';
    st.type = '';
    st.loader = '';
    st.version = '';
    st.index = 'relevance';
    st.offset = 0;
    runStoreSearch();
    renderStore();
  };
  CD.actions['open-project'] = (el) => openProject(el.dataset.id);
  CD.actions['quick-install'] = (el) => quickInstall(el.dataset.id, el.dataset.type || 'mod', el);

  CD.actions['project-install'] = (el) => {
    const modal = el.closest('.modal-backdrop');
    const form = modal ? modal.querySelector('form[data-form="project-install"]') : null;
    if (!form) { toast('Kurulum formu bulunamadı', 'error'); return; }
    return installProject(form, el);
  };
  CD.forms['project-install'] = (form, submitter) => installProject(form, submitter);

  CD.actions['project-create-server'] = (el) => {
    const modal = el.closest('.modal-backdrop');
    if (modal && modal.__modal) modal.__modal.close();
    presetCreateServer();
  };

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest && event.target.closest('.store-card[data-project]');
    if (!card || event.target.closest('button, a, input, select')) return;
    event.preventDefault();
    openProject(card.dataset.project);
  });

  document.addEventListener('click', (event) => {
    const link = event.target.closest && event.target.closest('[data-stop]');
    if (link) event.stopPropagation();
  }, true);
})();
