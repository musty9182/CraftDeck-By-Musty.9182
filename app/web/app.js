(() => {
  'use strict';

  const CD = window.CD;
  const state = CD.state;
  const $ = CD.$;
  const $$ = CD.$$;
  const esc = CD.esc;
  const icon = CD.icon;
  const api = CD.api;
  const toast = CD.toast;
  const showError = CD.showError;

  const TABS = [
    { id: 'overview', label: 'Genel Bakış', icon: 'grid' },
    { id: 'console', label: 'Konsol', icon: 'terminal' },
    { id: 'store', label: 'Mağaza', icon: 'store' },
    { id: 'content', label: 'İçerik', icon: 'box' },
    { id: 'settings', label: 'Ayarlar', icon: 'settings' },
    { id: 'tunnel', label: 'Tünel', icon: 'globe' },
  ];
  const TAB_IDS = new Set(TABS.map((tab) => tab.id));
  CD.TABS = TABS;

  let pollTimer = null;
  let lastDetailAt = 0;
  let serversRequest = null;
  let closed = false;

  function navigate(id, tab = 'overview', replace = false) {
    const hash = `#/srv/${encodeURIComponent(id)}/${TAB_IDS.has(tab) ? tab : 'overview'}`;
    if (location.hash === hash) {
      applyRoute();
      return;
    }
    if (replace) {
      history.replaceState(null, '', hash);
      applyRoute();
    } else {
      location.hash = hash;
    }
  }
  CD.navigate = navigate;

  function navigateStore(replace = false) {
    if (location.hash === '#/store') { applyRoute(); return; }
    if (replace) { history.replaceState(null, '', '#/store'); applyRoute(); }
    else location.hash = '#/store';
  }
  CD.navigateStore = navigateStore;

  function applyRoute() {
    if (closed) return;
    const raw = location.hash.replace(/^#\/?/, '');
    const parts = raw.split('/').filter(Boolean).map((part) => {
      try { return decodeURIComponent(part); } catch { return part; }
    });
    if (!parts.length || parts[0] === 'welcome') { enterWelcome(); return; }
    if (parts[0] === 'store') { enterStoreStandalone(); return; }
    if (parts[0] === 'srv' && parts[1]) {
      const id = parts[1];
      const tab = TAB_IDS.has(parts[2]) ? parts[2] : 'overview';
      if (!state.servers.some((server) => server.id === id)) {
        refreshServers().then(() => {
          if (state.servers.some((server) => server.id === id)) enterServer(id, tab);
          else { toast('Sunucu bulunamadı', 'warn'); enterDefault(); }
        });
        return;
      }
      enterServer(id, tab);
      return;
    }
    enterDefault();
  }
  CD.applyRoute = applyRoute;

  function enterDefault() {
    if (state.servers.length) {
      const current = state.currentId && state.servers.some((server) => server.id === state.currentId) ? state.currentId : '';
      const last = state.lastServer && state.servers.some((server) => server.id === state.lastServer) ? state.lastServer : '';
      navigate(current || last || state.servers[0].id, state.tab && TAB_IDS.has(state.tab) ? state.tab : 'overview', true);
    } else {
      enterWelcome();
    }
  }

  function enterWelcome() {
    state.currentId = null;
    state.detail = null;
    state.tab = '';
    renderTopbar();
    renderTabs();
    renderWelcome();
  }

  function enterStoreStandalone() {
    state.currentId = null;
    state.detail = null;
    state.tab = 'store';
    renderTopbar();
    renderTabs();
    renderView();
  }

  function enterServer(id, tab) {
    const changed = state.currentId !== id;
    if (changed) {
      state.detail = null;
      Object.assign(CD.consoleState, { serverId: id, seq: 0, lines: [], filter: '', autoscroll: true, history: [], historyIndex: -1 });
      Object.assign(CD.tunnelState, { serverId: id, seq: 0, lines: [], data: null, loaded: false });
      Object.assign(CD.storeState, {
        initialized: false, serverId: id, query: '', type: '', loader: '', version: '',
        index: 'relevance', offset: 0, result: null, loading: false, error: '',
      });
      Object.assign(CD.contentState, { loaded: false, loading: false, data: null, serverId: id });
    }
    state.currentId = id;
    state.tab = tab;
    renderSidebar();
    renderTopbar();
    renderTabs();
    renderView();
    loadDetail(id);
  }
  CD.enterServer = enterServer;

  async function loadBootstrap() {
    const data = await api('/api/bootstrap');
    state.app = data.app || state.app;
    state.servers = data.servers || [];
    state.lastServer = data.last_server || '';
    state.java = data.java || state.java;
    state.gameVersions = data.game_versions || [];
    state.loaders = data.loaders || [];
    state.loaderMap = {};
    for (const loader of state.loaders) state.loaderMap[loader.id] = loader;
    state.jobs = data.jobs || [];
    state.warnings = data.warnings || [];
    state.seenJobs = new Map();
    for (const job of state.jobs) CD.noteJob(job);
    state.booted = true;
    renderSidebar();
    renderSidebarFooter();
    renderTopbar();
    renderTabs();
    renderJobTray();
    for (const warning of state.warnings) toast(warning, 'warn');
    return true;
  }

  async function ensureBoot() {
    if (state.booted) return true;
    try {
      await loadBootstrap();
      return true;
    } catch (err) {
      CD.setOffline(true);
      return false;
    }
  }
  CD.ensureBoot = ensureBoot;

  async function refreshServers() {
    if (serversRequest) return serversRequest;
    serversRequest = (async () => {
      try {
        const data = await api('/api/servers');
        state.servers = data.servers || [];
        renderSidebar();
        renderTopbar();
        renderTabs();
        if (state.currentId && !state.servers.some((server) => server.id === state.currentId)) {
          toast('Seçili sunucu artık yok', 'warn');
          enterDefault();
        }
      } catch (err) {

      } finally {
        serversRequest = null;
      }
    })();
    return serversRequest;
  }
  CD.refreshServers = refreshServers;

  async function refreshJobs() {
    try {
      const data = await api('/api/jobs');
      state.jobs = data.jobs || [];
      trackJobs(state.jobs);
      renderJobTray();
    } catch (err) {  }
  }
  CD.refreshJobs = refreshJobs;

  async function loadDetail(id = state.currentId) {
    if (!id) return null;
    try {
      const data = await api(`/api/servers/${encodeURIComponent(id)}`);
      if (state.currentId !== id) return null;
      lastDetailAt = Date.now();
      state.detail = data;
      if (data.java) state.java = data.java;
      CD.mergeServer(data.server);
      renderSidebar();
      renderTopbar();
      renderTabs();
      if (state.tab === 'overview' || state.tab === 'settings' || state.tab === 'tunnel') renderView();
      return data;
    } catch (err) {
      if (!/ulaşılamıyor/.test(err && err.message ? err.message : '')) showError(err);
      return null;
    }
  }
  CD.loadDetail = loadDetail;

  function renderSidebar() {
    const root = $('#serverList');
    if (!root) return;
    if (!state.servers.length) {
      CD.setHTML(root, `<div class="sidebar-empty">Henüz sunucu yok.<br>Başlamak için “Yeni Sunucu” seçin.</div>`);
      return;
    }
    const html = state.servers.map((server) => {
      const loader = CD.loaderMeta(server.loader);
      const status = CD.statusOf(server);
      const active = server.id === state.currentId;
      const playerText = server.running ? `${server.player_count || 0} oyuncu` : CD.statusLabel(status);
      return `<button type="button" class="server-item ${active ? 'active' : ''}" data-action="select-server" data-id="${esc(server.id)}" style="--loader-color:${esc(loader.color || '#61748a')}">
        <span class="status-dot ${esc(status)}"></span>
        <span class="server-item-body">
          <span class="server-item-name">${esc(server.name)}</span>
          <span class="server-item-meta">${esc(loader.name || server.loader)} <span class="dot-sep">·</span> ${esc(server.mc_version)} <span class="dot-sep">·</span> :${esc(server.port)} <span class="dot-sep">·</span> ${esc(playerText)}</span>
        </span>
      </button>`;
    }).join('');
    CD.setHTML(root, html);
  }
  CD.renderSidebar = renderSidebar;

  function renderSidebarFooter() {
    const root = $('#sidebarFooter');
    if (!root) return;
    const app = state.app || {};
    const runtimes = (state.java && state.java.runtimes) || [];
    const bestJava = runtimes.length ? `Java ${runtimes[0].major}` : 'Bulunamadı';
    CD.setHTML(root, `<div class="sf-row"><span>Java</span><span class="sf-value">${esc(bestJava)}</span></div>
      <div class="sf-row"><span>Platform</span><span class="sf-value" title="${esc(app.platform || '')}">${esc(app.platform || '—')}</span></div>
      <div class="sf-links">
        <button type="button" class="linklike" data-action="help">Yardım</button><span>·</span>
        <button type="button" class="linklike" data-action="open-data">Veri klasörü</button><span>·</span>
        <button type="button" class="linklike" data-action="shutdown-app">Kapat</button>
      </div>
      <div class="sf-row"><span>v${esc(app.version || CD.version)}</span><span class="sf-value" title="${esc(app.data_dir || '')}">${esc(app.data_dir || '')}</span></div>`);
  }
  CD.renderSidebarFooter = renderSidebarFooter;

  function genericTopbar() {
    return `<div class="server-heading">
      <div class="loader-chip" style="--c:#5eead4">CD</div>
      <div style="min-width:0">
        <div class="server-title-row"><h1>CraftDeck</h1></div>
        <div class="server-sub">Yerel Minecraft sunucu stüdyosu</div>
      </div>
    </div>
    <div class="topbar-actions">
      <button type="button" class="btn ghost" data-action="open-store">${icon('store')}<span>Mağaza</span></button>
      <button type="button" class="btn primary" data-action="new-server">${icon('plus')}<span>Yeni Sunucu</span></button>
    </div>`;
  }

  function renderTopbar() {
    const root = $('#topbar');
    if (!root) return;
    const server = CD.currentServer();
    if (!server) {
      CD.setHTML(root, genericTopbar());
      return;
    }
    const loader = CD.loaderMeta(server.loader);
    const status = CD.statusOf(server);
    const running = status === 'running' || status === 'starting';
    const actions = [];
    if (!server.installed) {
      actions.push(`<button type="button" class="btn primary" data-action="install-engine">${icon('download')}<span>Motoru Kur</span></button>`);
    } else if (running) {
      actions.push(`<button type="button" class="btn danger" data-action="stop">${icon('stop')}<span>Durdur</span></button>`);
      actions.push(`<button type="button" class="btn" data-action="restart">${icon('restart')}<span>Yeniden</span></button>`);
    } else {
      actions.push(`<button type="button" class="btn primary" data-action="start">${icon('play')}<span>Başlat</span></button>`);
    }
    if (running) actions.push(`<button type="button" class="btn ghost" data-action="kill" title="Zorla kapat">${icon('power')}</button>`);
    actions.push(`<button type="button" class="btn ghost" data-action="open-folder" data-which="server" title="Sunucu klasörünü aç">${icon('folder')}</button>`);

    const uptime = server.uptime ? CD.fmtDuration(server.uptime) : '';
    CD.setHTML(root, `<div class="server-heading">
      <div class="loader-chip" style="--c:${esc(loader.color || '#61748a')}">${esc(String(loader.name || server.loader || '?').slice(0, 2).toUpperCase())}</div>
      <div style="min-width:0">
        <div class="server-title-row">
          <h1 title="${esc(server.name)}">${esc(server.name)}</h1>
          <span class="status-pill ${esc(status)}"><span class="status-dot ${esc(status)}"></span>${esc(CD.statusLabel(status))}</span>
        </div>
        <div class="server-sub">
          <span class="chip chip-mini">${esc(loader.name || server.loader)}</span>
          <span class="chip chip-mini">MC ${esc(server.mc_version)}</span>
          <span>Port ${esc(server.port)}</span>
          <span class="dot-sep">·</span><span>${CD.fmtNum(server.player_count || 0)} oyuncu</span>
          ${uptime ? `<span class="dot-sep">·</span><span>${esc(uptime)}</span>` : ''}
          ${server.port_busy ? '<span class="chip chip-mini red">Port dolu</span>' : ''}
          ${server.auto_restart ? '<span class="chip chip-mini amber">Oto. yeniden başlat</span>' : ''}
        </div>
      </div>
    </div>
    <div class="topbar-actions">${actions.join('')}</div>`);
  }
  CD.renderTopbar = renderTopbar;

  function renderTabs() {
    const root = $('#tabs');
    if (!root) return;
    const server = CD.currentServer();
    if (!server) {
      CD.setHTML(root, '');
      return;
    }
    const contentTotal = state.detail && state.detail.content ? state.detail.content.total : null;
    const html = TABS.map((tab) => {
      let badge = '';
      if (tab.id === 'content' && contentTotal != null && contentTotal > 0) badge = `<span class="tab-badge">${esc(contentTotal)}</span>`;
      if (tab.id === 'console' && server.player_count) badge = `<span class="tab-badge">${esc(server.player_count)}</span>`;
      return `<a class="tab ${state.tab === tab.id ? 'active' : ''}" href="#/srv/${encodeURIComponent(server.id)}/${tab.id}">${icon(tab.icon)}<span>${tab.label}</span>${badge}</a>`;
    }).join('');
    CD.setHTML(root, html);
  }
  CD.renderTabs = renderTabs;

  function loadingBlock(text = 'Yükleniyor…') {
    return `<div class="loading-block"><span class="spinner"></span> ${esc(text)}</div>`;
  }
  CD.loadingBlock = loadingBlock;

  function renderView() {
    if (closed) return;
    if (!state.currentId) {
      if (state.tab === 'store') {
        if (typeof CD.renderStore === 'function') CD.renderStore();
        else CD.setHTML($('#view'), loadingBlock('Mağaza yükleniyor…'));
      } else if (typeof CD.renderWelcome === 'function') {
        CD.renderWelcome();
      }
      return;
    }
    const server = CD.currentServer();
    if (!server) {
      CD.setHTML($('#view'), loadingBlock('Sunucu yükleniyor…'));
      return;
    }
    switch (state.tab) {
      case 'overview': renderOverview(); break;
      case 'console': typeof CD.renderConsole === 'function' ? CD.renderConsole() : placeholder('Konsol modülü yüklenemedi'); break;
      case 'store': typeof CD.renderStore === 'function' ? CD.renderStore() : placeholder('Mağaza modülü yüklenemedi'); break;
      case 'content': typeof CD.renderContent === 'function' ? CD.renderContent() : placeholder('İçerik modülü yüklenemedi'); break;
      case 'settings': typeof CD.renderSettings === 'function' ? CD.renderSettings() : placeholder('Ayarlar modülü yüklenemedi'); break;
      case 'tunnel': typeof CD.renderTunnel === 'function' ? CD.renderTunnel() : placeholder('Tünel modülü yüklenemedi'); break;
      default: renderOverview();
    }
  }
  CD.renderView = renderView;

  function placeholder(text) {
    CD.setHTML($('#view'), `<div class="empty-state">${icon('alert')}<h3>${esc(text)}</h3></div>`);
  }

  let lastOverviewConsoleAt = 0;

  function statCard(iconName, label, value, sub) {
    return `<div class="stat">
      <div class="stat-label">${icon(iconName)}<span>${esc(label)}</span></div>
      <div class="stat-value">${value}</div>
      <div class="stat-sub">${sub || ''}</div>
    </div>`;
  }

  function jobBanner(job) {
    const pct = CD.clamp(job.progress || 0, 0, 100);
    return `<div class="job-banner">
      <div style="min-width:0">
        <div class="jb-title"><span class="spinner"></span> ${esc(job.title)}</div>
        <div class="jb-msg">${esc(job.message || 'Çalışıyor…')}</div>
        <div class="progress"><span style="width:${pct}%"></span></div>
      </div>
      <button type="button" class="btn sm ghost" data-action="job-open" data-id="${esc(job.id)}">Ayrıntı</button>
    </div>`;
  }

  function renderOverview() {
    const view = $('#view');
    const data = state.detail;
    const listed = CD.currentServer();
    if (!data || !data.server) {
      CD.setHTML(view, loadingBlock('Sunucu bilgileri yükleniyor…'));
      return;
    }
    const server = { ...(listed || {}), ...data.server };
    const loader = CD.loaderMeta(server.loader);
    const status = CD.statusOf(server);
    const running = status === 'running' || status === 'starting';
    const address = CD.serverAddress(server);
    const tunnel = data.tunnel || server.tunnel || {};
    const props = (data.properties && data.properties.values) || {};
    const players = server.players || [];
    const maxPlayers = props['max-players'] || '20';
    const ramMin = Number(server.ram_min_mb || 1024);
    const ramMax = Number(server.ram_max_mb || 4096);
    const engineVersion = (server.engine && (server.engine.loader_version || server.engine.version)) || server.loader_version || '';
    const mrpack = server.mrpack;
    const job = server.job;
    const uptime = server.uptime ? CD.fmtDuration(server.uptime) : '';
    const tunnelStatus = tunnel.status || 'idle';
    const tunnelAddress = tunnel.address || '';
    const installed = Boolean(server.installed);

    const startButtons = installed
      ? (running
        ? `<button type="button" class="btn danger" data-action="stop">${icon('stop')} Durdur</button>
           <button type="button" class="btn" data-action="restart">${icon('restart')} Yeniden başlat</button>`
        : `<button type="button" class="btn primary" data-action="start">${icon('play')} Başlat</button>`)
      : `<button type="button" class="btn primary" data-action="install-engine">${icon('download')} Motoru kur</button>`;

    const playerRows = players.length
      ? players.map((name) => `<div class="player-row">
          <span class="player-avatar">${esc(String(name).slice(0, 1).toUpperCase())}</span>
          <span class="player-name">${esc(name)}</span>
          <button type="button" class="btn ghost sm" data-action="player-action" data-op="op" data-player="${esc(name)}" ${running ? '' : 'disabled'}>OP</button>
          <button type="button" class="btn ghost sm" data-action="player-action" data-op="kick" data-player="${esc(name)}" ${running ? '' : 'disabled'}>At</button>
          <button type="button" class="btn ghost sm" data-action="player-action" data-op="ban" data-player="${esc(name)}" ${running ? '' : 'disabled'}>Ban</button>
        </div>`).join('')
      : `<div class="empty-state" style="padding:18px"><p>Şu anda bağlı oyuncu yok.</p></div>`;

    const html = `${job ? jobBanner(job) : ''}
      <section class="hero" style="--loader-color:${esc(loader.color || '#5eead4')}">
        <div class="hero-main">
          <div class="hero-title">
            <h2>${esc(server.name)}</h2>
            <span class="status-pill ${esc(status)}"><span class="status-dot ${esc(status)}"></span>${esc(CD.statusLabel(status))}</span>
            ${server.port_busy ? '<span class="chip red">Port kullanımda</span>' : ''}
          </div>
          <div class="hero-sub">
            <span class="chip">${esc(loader.name || server.loader)}</span>
            <span class="chip">Minecraft ${esc(server.mc_version)}</span>
            ${engineVersion ? `<span class="chip">v${esc(engineVersion)}</span>` : '<span class="chip amber">Motor kurulmadı</span>'}
            <span>${running ? `Çalışma süresi: ${esc(uptime || 'yeni başladı')}` : 'Sunucu durduruldu'}</span>
          </div>
          <div class="hero-actions">
            ${startButtons}
            <button type="button" class="btn ghost" data-action="go-tab" data-tab="console">${icon('terminal')} Konsol</button>
            <button type="button" class="btn ghost" data-action="go-tab" data-tab="content">${icon('box')} İçerik</button>
            <button type="button" class="btn ghost" data-action="open-folder" data-which="server">${icon('folder')} Klasör</button>
          </div>
        </div>
        <div class="hero-address">
          <div class="ha-label">Oyuncuların katılacağı adres</div>
          ${address ? `<div class="ha-value">${esc(address)}</div>` : `<div class="ha-value empty">Henüz kamuya açık adres yok</div>`}
          <div class="ha-actions">
            ${address ? `<button type="button" class="btn sm primary" data-action="copy" data-copy="${esc(address)}" data-label="Sunucu adresi">${icon('copy')} Tek tıkla kopyala</button>` : ''}
            <button type="button" class="btn sm ghost" data-action="go-tab" data-tab="tunnel">${icon('globe')} Tünel</button>
          </div>
          <div class="tiny faint">Yerel adres: <span class="mono">127.0.0.1:${esc(server.port)}</span></div>
        </div>
      </section>

      <div class="grid cols-3" style="margin-bottom:18px">
        ${statCard('activity', 'Durum', `<span class="status-pill ${esc(status)}" style="font-size:13px;padding:2px 9px"><span class="status-dot ${esc(status)}"></span>${esc(CD.statusLabel(status))}</span>`, uptime ? `Çalışma süresi ${esc(uptime)}` : 'Sunucu kapalı')}
        ${statCard('users', 'Oyuncular', `${CD.fmtNum(server.player_count || 0)} <span class="faint" style="font-size:12px;font-weight:500">/ ${esc(maxPlayers)}</span>`, players.length ? esc(players.slice(0, 3).join(', ')) : 'Kimse bağlı değil')}
        ${statCard('server', 'Port', esc(server.port), server.port_busy ? '<span style="color:var(--red)">Başka program kullanıyor</span>' : 'Kullanıma hazır')}
        ${statCard('cpu', 'Bellek', `${esc(ramMin / 1024)}–${esc(ramMax / 1024)} GB`, `<span class="mono">-Xms${ramMin}M -Xmx${ramMax}M</span>`)}
        ${statCard('coffee', 'Java', `Java ${esc(server.java_required)}+`, server.java_path ? esc(CD.basename(server.java_path)) : 'Otomatik seçim')}
        ${statCard('wrench', 'Motor', installed ? `v${esc(engineVersion || '—')}` : 'Kurulmadı', installed ? esc(loader.name || server.loader) : 'Ayarlar’dan kurabilirsiniz')}
      </div>

      <div class="grid cols-2" style="margin-bottom:18px">
        <section class="panel panel-pad">
          <div class="section-head" style="margin-bottom:10px"><div><h3>${icon('info')} Sunucu bilgileri</h3></div></div>
          <dl class="kv">
            <dt>Yükleyici</dt><dd>${esc(loader.name || server.loader)}</dd>
            <dt>Minecraft</dt><dd>${esc(server.mc_version)}</dd>
            <dt>Motor sürümü</dt><dd>${esc(engineVersion || 'Kurulmadı')}</dd>
            <dt>Java yolu</dt><dd class="mono small break">${esc(server.java_path || 'Otomatik')}</dd>
            <dt>Bellek</dt><dd>${esc(ramMin)} MB – ${esc(ramMax)} MB</dd>
            <dt>Son çıkış kodu</dt><dd>${server.last_exit_code == null ? '—' : esc(server.last_exit_code) + (server.last_exit_code === 0 ? ' (normal)' : '')}</dd>
            <dt>Oto. yeniden başlat</dt><dd>${server.auto_restart ? 'Açık' : 'Kapalı'}</dd>
            <dt>Oluşturuldu</dt><dd>${esc(CD.fmtDate((data.config && data.config.created_at) || server.created_at))}</dd>
          </dl>
          ${server.error ? `<div class="alert error" style="margin-top:12px">${icon('alert')}<div>${esc(server.error)}</div></div>` : ''}
        </section>

        <section class="panel panel-pad">
          <div class="section-head" style="margin-bottom:10px">
            <div><h3>${icon('globe')} Tünel</h3><p>Arkadaşlarının port yönlendirme olmadan katılması.</p></div>
            <button type="button" class="btn sm ghost" data-action="go-tab" data-tab="tunnel">Yönet</button>
          </div>
          <div class="row" style="margin-bottom:10px">
            <span class="status-pill ${esc(tunnelStatus === 'running' ? 'running' : tunnelStatus === 'error' ? 'crashed' : tunnelStatus === 'starting' ? 'starting' : 'stopped')}">
              <span class="status-dot ${esc(tunnelStatus === 'running' ? 'running' : tunnelStatus === 'error' ? 'crashed' : tunnelStatus === 'starting' ? 'starting' : 'stopped')}"></span>
              ${esc(tunnelStatusLabel(tunnelStatus))}
            </span>
            <span class="chip chip-mini">${esc(tunnelProviderLabel(tunnel.provider))}</span>
          </div>
          <div class="tunnel-address-box" style="padding:12px">
            <div class="ta-main">
              <div class="ta-label">Genel adres</div>
              ${tunnelAddress ? `<div class="ta-value" style="font-size:14px">${esc(tunnelAddress)}</div>` : `<div class="ta-value empty">Tünel başlatılmadı</div>`}
            </div>
            ${tunnelAddress ? `<button type="button" class="btn sm primary" data-action="copy" data-copy="${esc(tunnelAddress)}" data-label="Tünel adresi">${icon('copy')} Kopyala</button>` : `<button type="button" class="btn sm primary" data-action="go-tab" data-tab="tunnel">${icon('play')} Başlat</button>`}
          </div>
          ${tunnel.error ? `<div class="alert warn" style="margin-top:10px">${icon('alert')}<div>${esc(tunnel.error)}</div></div>` : ''}
        </section>
      </div>

      <div class="grid cols-2">
        <section class="panel panel-pad">
          <div class="section-head" style="margin-bottom:10px">
            <div><h3>${icon('users')} Oyuncular</h3><p>${esc(server.player_count || 0)} / ${esc(maxPlayers)} bağlı</p></div>
          </div>
          <form data-form="add-player" class="input-group" style="margin-bottom:10px">
            <input class="input sm" name="player" placeholder="Oyuncu adı" autocomplete="off" maxlength="16" ${running ? '' : 'disabled'}>
            <button type="submit" class="btn sm" ${running ? '' : 'disabled'}>Beyaz listeye ekle</button>
          </form>
          <div class="player-list" style="max-height:220px;overflow-y:auto">${playerRows}</div>
        </section>

        <section class="panel panel-pad">
          <div class="section-head" style="margin-bottom:10px">
            <div><h3>${icon('terminal')} Son konsol</h3><p>Canlı çıktının son satırları.</p></div>
            <button type="button" class="btn sm ghost" data-action="go-tab" data-tab="console">Tümü</button>
          </div>
          <div class="console-log" id="ovConsole" style="min-height:170px;max-height:230px"><div class="empty">Yükleniyor…</div></div>
        </section>
      </div>

      ${mrpack ? `<section class="panel panel-pad" style="margin-top:18px">
        <div class="section-head" style="margin-bottom:10px"><div><h3>${icon('package')} Modpack</h3><p>${esc(mrpack.name || '')}</p></div></div>
        <dl class="kv">
          <dt>Paket</dt><dd>${esc(mrpack.name || mrpack.project_name || '—')}</dd>
          <dt>Sürüm</dt><dd>${esc(mrpack.project_version || mrpack.version_id || '—')}</dd>
          <dt>Dosya / override</dt><dd>${esc(mrpack.file_count || 0)} / ${esc(mrpack.override_count || 0)}</dd>
          <dt>Kuruldu</dt><dd>${esc(CD.fmtDate(mrpack.installed_at))}</dd>
          <dt>Kaynak</dt><dd class="mono small break">${esc(mrpack.source || mrpack.project_id || '—')}</dd>
        </dl>
      </section>` : ''}

      ${server.error ? '' : ''}
    `;

    CD.setHTML(view, html);
    loadOverviewConsole(server);
  }
  CD.renderOverview = renderOverview;

  function tunnelStatusLabel(status) {
    return { idle: 'Hazır', starting: 'Başlatılıyor', running: 'Çalışıyor', stopped: 'Durduruldu', error: 'Hata' }[status] || 'Hazır';
  }
  CD.tunnelStatusLabel = tunnelStatusLabel;

  function tunnelProviderLabel(provider) {
    return { ngrok: 'ngrok', playit: 'Playit.gg', custom: 'Özel komut', none: 'Seçilmedi' }[provider] || 'Seçilmedi';
  }
  CD.tunnelProviderLabel = tunnelProviderLabel;

  function loadOverviewConsole(server) {
    if (Date.now() - lastOverviewConsoleAt < 3500) {
      const box = $('#ovConsole');
      if (box) box.scrollTop = box.scrollHeight;
      return;
    }
    lastOverviewConsoleAt = Date.now();
    const id = server.id;
    const since = Math.max(0, (server.last_seq || 0) - 60);
    api(`/api/servers/${encodeURIComponent(id)}/console?since=${since}&limit=60`).then((res) => {
      if (state.currentId !== id || state.tab !== 'overview') return;
      const box = $('#ovConsole');
      if (!box) return;
      const lines = res.lines || [];
      box.innerHTML = lines.length
        ? lines.map(consoleLineHTML).join('')
        : '<div class="empty">Henüz konsol çıktısı yok.</div>';
      box.scrollTop = box.scrollHeight;
    }).catch(() => {});
  }

  function consoleLineHTML(line) {
    return `<div class="line ${esc(line.stream || 'stdout')}"><span class="t">${esc(CD.fmtTime(line.t))}</span><span class="x">${esc(line.text)}</span></div>`;
  }
  CD.consoleLineHTML = consoleLineHTML;

  function renderWelcome() {
    const view = $('#view');
    if (!view) return;
    const servers = state.servers.slice().slice(-6).reverse();
    const resume = servers.length ? `<div class="section" style="margin-top:24px">
      <div class="section-head"><div><h3>Sunucuların</h3><p>Kaldığın yerden devam et.</p></div></div>
      <div class="grid cols-3">${servers.map((server) => {
        const loader = CD.loaderMeta(server.loader);
        const status = CD.statusOf(server);
        return `<button type="button" class="stat" data-action="select-server" data-id="${esc(server.id)}" style="text-align:left;cursor:pointer">
          <div class="stat-label">${icon('server')}<span>${esc(loader.name || server.loader)} · MC ${esc(server.mc_version)}</span></div>
          <div class="stat-value" style="font-size:16px">${esc(server.name)}</div>
          <div class="stat-sub"><span class="status-dot ${esc(status)}" style="display:inline-block;margin-right:5px"></span>${esc(CD.statusLabel(status))} · :${esc(server.port)}</div>
        </button>`;
      }).join('')}</div>
    </div>` : '';

    CD.setHTML(view, `<div class="welcome">
      <section class="welcome-hero">
        <span class="welcome-kicker">${icon('spark')} Ücretsiz · yerel · senin bilgisayarında</span>
        <h1>Kendi Minecraft sunucunu <em>tek tıkla</em> kur.</h1>
        <p>Modrinth mağazasından mod veya modpack seç; Fabric, Forge, NeoForge, Paper ya da Purpur motoru ve doğru Java sürümü otomatik hazırlansın. Arkadaşların için tünel aç, canlı konsoldan yönet. Hiçbir ücret yok, tüm veriler sende kalır.</p>
        <div class="welcome-actions">
          <button type="button" class="btn primary" data-action="new-server">${icon('plus')} Yeni Sunucu</button>
          <button type="button" class="btn" data-action="upload-mrpack-create">${icon('upload')} .mrpack Yükle</button>
          <button type="button" class="btn ghost" data-action="open-store">${icon('store')} Modrinth Mağazası</button>
        </div>
      </section>
      ${resume}
      <div class="feature-grid">
        <div class="feature"><div class="f-icon">${icon('store')}</div><h3>Modrinth tarayıcısı</h3><p>Mod, modpack, plugin, shader ve resource pack araması; yükleme sürümüne göre filtreleme ve bağımlılıklarla tek tıkla kurulum.</p></div>
        <div class="feature"><div class="f-icon">${icon('wrench')}</div><h3>Otomatik motor</h3><p>Fabric, Quilt, Forge, NeoForge, Paper, Purpur ve Vanilla için doğru sürüm jar dosyası arka planda indirilir.</p></div>
        <div class="feature"><div class="f-icon">${icon('coffee')}</div><h3>Java yönetimi</h3><p>Java 8/17/21/25 taraması; eksikse Adoptium Temurin otomatik indirilir. Sunucu sürümüne uygun sürüm önerilir.</p></div>
        <div class="feature"><div class="f-icon">${icon('globe')}</div><h3>Sıfır port yönlendirme</h3><p>ngrok veya Playit.gg ile sunucun kamuya açılır; adres otomatik yakalanır ve tek tıkla kopyalanır.</p></div>
        <div class="feature"><div class="f-icon">${icon('terminal')}</div><h3>Canlı konsol</h3><p>stdout/stderr akışı, komut geçmişi, filtreleme ve log indirme. Başlat, durdur, yeniden başlat ve zorla kapat.</p></div>
        <div class="feature"><div class="f-icon">${icon('package')}</div><h3>.mrpack desteği</h3><p>Paketi ZIP gibi açar, modrinth.index.json okur, override dosyalarını çıkarır; istemci dosyalarını sunucuya kurmaz.</p></div>
      </div>
      <div class="tip" style="margin-top:16px">${icon('info')}<div>Başlamak için <strong>Yeni Sunucu</strong> deyin: sürüm ve yükleyiciyi seçin, RAM'i ayarlayın; motor ve Java gerisini halleder. Modpack için <strong>.mrpack</strong> dosyanı sürükleyip bırakabilir veya mağazadan seçebilirsin.</div></div>
    </div>`);
  }
  CD.renderWelcome = renderWelcome;

  function renderJobTray() {
    const root = $('#jobTray');
    if (!root) return;
    const active = (state.jobs || []).filter((job) => job.status === 'queued' || job.status === 'running');
    const html = active.slice(0, 4).map((job) => `<div class="job-card ${esc(job.status)}" data-action="job-open" data-id="${esc(job.id)}" role="button" tabindex="0">
      <div class="jc-top">
        <span class="jc-icon">${icon(job.status === 'error' ? 'alert' : 'loader')}</span>
        <div style="min-width:0;flex:1">
          <div class="jc-title">${esc(job.title)}</div>
          <div class="jc-msg">${esc(job.message || 'Çalışıyor…')}</div>
        </div>
        <span class="chip chip-mini">${Math.round(job.progress || 0)}%</span>
      </div>
      <div class="progress"><span style="width:${CD.clamp(job.progress || 2, 2, 100)}%"></span></div>
    </div>`).join('');
    CD.setHTML(root, html);
  }
  CD.renderJobTray = renderJobTray;

  function trackJobs(jobs) {
    for (const job of jobs) {
      const previous = state.seenJobs.get(job.id);
      if (previous == null) {
        state.seenJobs.set(job.id, job.status);
        continue;
      }
      if (previous !== job.status) {
        state.seenJobs.set(job.id, job.status);
        if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') onJobFinished(job);
      }
    }
  }
  CD.trackJobs = trackJobs;

  function onJobFinished(job) {
    if (job.status === 'done') toast(`Tamamlandı: ${job.title}`, 'success', job.message && job.message !== job.title ? job.message : '');
    else if (job.status === 'error') toast(`İşlem başarısız: ${job.title}`, 'error', job.error || job.message || '');
    else if (job.status === 'cancelled') toast(`İptal edildi: ${job.title}`, 'warn');

    const kind = String(job.kind || '');
    const separator = kind.indexOf(':');
    const serverId = separator >= 0 ? kind.slice(0, separator) : '';
    const suffix = separator >= 0 ? kind.slice(separator + 1) : kind;

    if (serverId && serverId === state.currentId) {
      if (suffix === 'engine') {
        loadDetail(serverId);
      } else if (suffix === 'content' || suffix === 'modpack') {
        if (typeof CD.refreshContent === 'function') CD.refreshContent(true);
        loadDetail(serverId);
      }
    }
    if (suffix === 'java' || kind === 'java') {
      if (typeof CD.refreshJava === 'function') CD.refreshJava();
      if (state.currentId) loadDetail(state.currentId);
    }
    refreshServers();
  }
  CD.onJobFinished = onJobFinished;

  function openJobModal(jobId) {
    let since = 0;
    let timer = null;
    let lastJob = null;
    const modal = CD.openModal({
      title: 'Arka plan işi',
      subtitle: 'İndirme ve kurulum ilerlemesi',
      size: 'lg',
      body: '<div class="loading-block"><span class="spinner"></span> Yükleniyor…</div>',
      footer: '<button type="button" class="btn ghost" data-action="modal-close">Kapat</button>',
      onClose() { if (timer) clearTimeout(timer); },
    });
    if (!modal) return;

    const renderBody = (job) => {
      lastJob = job;
      const pct = CD.clamp(job.progress || 0, 0, 100);
      const statusClass = job.status === 'done' ? 'green' : job.status === 'error' ? 'red' : job.status === 'cancelled' ? 'amber' : 'blue';
      const logs = (job.logs || []).map((line) => `<div class="line ${esc(line.stream || 'info')}"><span class="t">${esc(CD.fmtTime(line.t))}</span><span class="x">${esc(line.text)}</span></div>`).join('');
      modal.body.innerHTML = `<div class="row between" style="margin-bottom:12px">
          <div><div style="font-weight:650">${esc(job.title)}</div><div class="small muted">${esc(job.message || '')}</div></div>
          <span class="chip ${statusClass}">${esc(jobStatusLabel(job.status))}</span>
        </div>
        <div class="progress" style="margin-bottom:14px"><span style="width:${pct}%"></span></div>
        <div class="console-log" id="jobLog" style="min-height:220px;max-height:46vh">${logs || '<div class="empty">Henüz log yok.</div>'}</div>
        ${job.error ? `<div class="alert error" style="margin-top:10px">${icon('alert')}<div>${esc(job.error)}</div></div>` : ''}`;
      const box = $('#jobLog', modal.el);
      if (box) box.scrollTop = box.scrollHeight;
      const active = job.status === 'queued' || job.status === 'running';
      modal.setFooter(`<button type="button" class="btn ghost" data-action="modal-close">Kapat</button>
        <button type="button" class="btn danger" data-action="job-cancel" data-id="${esc(job.id)}" ${active ? '' : 'disabled'}>İptal et</button>`);
    };

    const appendLogs = (logs) => {
      const box = $('#jobLog', modal.el);
      if (!box) return;
      if (box.querySelector('.empty')) box.innerHTML = '';
      box.insertAdjacentHTML('beforeend', logs.map((line) => `<div class="line ${esc(line.stream || 'info')}"><span class="t">${esc(CD.fmtTime(line.t))}</span><span class="x">${esc(line.text)}</span></div>`).join(''));
      while (box.childElementCount > 900) box.firstElementChild.remove();
      box.scrollTop = box.scrollHeight;
    };

    const tick = async (initial) => {
      try {
        const job = await api(`/api/jobs/${encodeURIComponent(jobId)}?since=${initial ? 0 : since}`);
        const logs = job.logs || [];
        if (initial || !lastJob) {
          since = job.log_count != null ? job.log_count : logs.length;
          renderBody(job);
        } else {
          since = job.log_count != null ? job.log_count : since + logs.length;
          if (logs.length) appendLogs(logs);
          const header = modal.body.querySelector('.row.between .small.muted');
          if (header) header.textContent = job.message || '';
          const bar = modal.body.querySelector('.progress > span');
          if (bar) bar.style.width = `${CD.clamp(job.progress || 0, 0, 100)}%`;
          const pill = modal.body.querySelector('.row.between .chip');
          if (pill) {
            pill.className = `chip ${job.status === 'done' ? 'green' : job.status === 'error' ? 'red' : job.status === 'cancelled' ? 'amber' : 'blue'}`;
            pill.textContent = jobStatusLabel(job.status);
          }
          lastJob = job;
        }
        if (job.status === 'queued' || job.status === 'running') timer = setTimeout(() => tick(false), 1000);
        else modal.setFooter(`<button type="button" class="btn ghost" data-action="modal-close">Kapat</button>
          <button type="button" class="btn danger" data-action="job-cancel" data-id="${esc(job.id)}" disabled>İptal et</button>`);
      } catch (err) {
        modal.body.innerHTML = `<div class="alert error">${icon('alert')}<div>${esc(err.message || 'İş okunamadı')}</div></div>`;
      }
    };
    tick(true);
  }
  CD.openJobModal = openJobModal;

  function jobStatusLabel(status) {
    return { queued: 'Sırada', running: 'Çalışıyor', done: 'Tamamlandı', error: 'Hata', cancelled: 'İptal edildi' }[status] || status;
  }
  CD.jobStatusLabel = jobStatusLabel;

  CD.actions['select-server'] = (el) => {
    const id = el.dataset.id;
    if (id) navigate(id, 'overview');
  };
  CD.actions['go-tab'] = (el) => {
    if (state.currentId) navigate(state.currentId, el.dataset.tab || 'overview');
  };
  CD.actions['open-store'] = () => navigateStore();
  CD.actions['refresh-servers'] = async () => {
    await refreshServers();
    await refreshJobs();
    toast('Sunucular yenilendi', 'success');
  };
  CD.actions['copy'] = (el) => CD.copyText(el.dataset.copy || '', el.dataset.label || 'Adres');
  CD.actions['modal-close'] = (el) => {
    const backdrop = el.closest('.modal-backdrop');
    if (backdrop && backdrop.__modal) backdrop.__modal.close();
    else CD.closeTopModal();
  };
  CD.actions['job-open'] = (el) => { if (el.dataset.id) openJobModal(el.dataset.id); };
  CD.actions['job-cancel'] = async (el) => {
    const id = el.dataset.id;
    if (!id) return;
    try {
      await api(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
      toast('İş iptal ediliyor', 'warn');
    } catch (err) { showError(err); }
  };
  CD.actions['open-folder'] = async (el) => {
    if (!state.currentId) return;
    try {
      await api(`/api/servers/${encodeURIComponent(state.currentId)}/open`, { method: 'POST', body: { which: el.dataset.which || 'server' } });
    } catch (err) { showError(err); }
  };
  CD.actions['open-data'] = async () => {
    try {
      await api('/api/app/open-data', { method: 'POST' });
    } catch (err) { showError(err); }
  };
  CD.actions['install-engine'] = async () => {
    if (!state.currentId) return;
    try {
      const data = await api(`/api/servers/${encodeURIComponent(state.currentId)}/engine/install`, { method: 'POST' });
      if (data && data.job) CD.noteJob(data.job);
      toast('Motor kurulumu başladı', 'info', 'İlerlemeyi sağ alttaki iş kartından izleyebilirsin.');
      refreshJobs();
    } catch (err) { showError(err); }
  };
  CD.actions['start'] = async () => {
    if (!state.currentId) return;
    const id = state.currentId;
    try {
      await api(`/api/servers/${encodeURIComponent(id)}/start`, { method: 'POST' });
      toast('Sunucu başlatılıyor', 'success');
      setTimeout(() => { if (state.currentId === id) loadDetail(id); }, 700);
      refreshServers();
    } catch (err) { showError(err); }
  };
  CD.actions['stop'] = async () => {
    if (!state.currentId) return;
    const id = state.currentId;
    try {
      await api(`/api/servers/${encodeURIComponent(id)}/stop`, { method: 'POST' });
      toast('Durdurma isteği gönderildi', 'info', 'Sunucunun düzgün kapanması birkaç saniye sürebilir.');
      setTimeout(() => { if (state.currentId === id) loadDetail(id); }, 1200);
    } catch (err) { showError(err); }
  };
  CD.actions['restart'] = async () => {
    if (!state.currentId) return;
    const id = state.currentId;
    try {
      await api(`/api/servers/${encodeURIComponent(id)}/restart`, { method: 'POST' });
      toast('Sunucu yeniden başlatılıyor', 'info');
      setTimeout(() => { if (state.currentId === id) loadDetail(id); }, 1800);
    } catch (err) { showError(err); }
  };
  CD.actions['kill'] = async () => {
    if (!state.currentId) return;
    const confirmed = await CD.confirmDialog({
      title: 'Sunucuyu zorla kapat',
      message: 'Bu işlem süreci hemen sonlandırır. Dünya kaydedilmemiş olabilir. Devam edilsin mi?',
      confirmText: 'Zorla kapat',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api(`/api/servers/${encodeURIComponent(state.currentId)}/kill`, { method: 'POST' });
      toast('Sunucu zorla kapatıldı', 'warn');
      loadDetail(state.currentId);
    } catch (err) { showError(err); }
  };
  CD.actions['player-action'] = async (el) => {
    const op = el.dataset.op;
    const player = el.dataset.player;
    if (!state.currentId || !op || !player) return;
    if (op === 'ban' || op === 'kick') {
      const confirmed = await CD.confirmDialog({
        title: op === 'ban' ? 'Oyuncuyu banla' : 'Oyuncuyu at',
        message: `<strong>${esc(player)}</strong> ${op === 'ban' ? 'sunucudan banlanacak.' : 'sunucudan atılacak.'} Onaylıyor musun?`,
        confirmText: op === 'ban' ? 'Banla' : 'At',
        danger: op === 'ban',
      });
      if (!confirmed) return;
    }
    try {
      await api(`/api/servers/${encodeURIComponent(state.currentId)}/players`, { method: 'POST', body: { action: op, player } });
      toast(`Komut gönderildi: ${op} ${player}`, 'success');
    } catch (err) { showError(err); }
  };
  CD.forms['add-player'] = async (form) => {
    if (!state.currentId) return;
    const data = new FormData(form);
    const player = String(data.get('player') || '').trim();
    if (!player) { toast('Oyuncu adı girin', 'warn'); return; }
    try {
      await api(`/api/servers/${encodeURIComponent(state.currentId)}/players`, { method: 'POST', body: { action: 'whitelist_add', player } });
      toast(`Beyaz listeye eklendi: ${player}`, 'success', 'Not: Sunucuda white-list kapalıysa liste etkili olmaz.');
      form.reset();
    } catch (err) { showError(err); }
  };
  CD.actions['help'] = () => openHelp();
  CD.actions['shutdown-app'] = async () => {
    const confirmed = await CD.confirmDialog({
      title: 'CraftDeck’i kapat',
      message: 'Çalışan tüm sunucular ve tüneller durdurulacak. Uygulamayı kapatmak istediğine emin misin?',
      confirmText: 'Kapat',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api('/api/app/shutdown', { method: 'POST' });
      closed = true;
      state.closed = true;
      if (pollTimer) clearTimeout(pollTimer);
      showClosedScreen();
    } catch (err) { showError(err); }
  };

  function showClosedScreen() {
    document.body.innerHTML = `<div style="min-height:100vh;display:grid;place-items:center;padding:24px;text-align:center">
      <div class="panel panel-pad" style="max-width:460px">
        <div style="font-size:42px;line-height:1">👋</div>
        <h1 style="margin-top:10px;font-size:20px">CraftDeck kapatıldı</h1>
        <p class="muted" style="margin-top:6px">Sunucular ve tüneller durduruldu. Bu pencereyi kapatabilirsin.</p>
        <p class="tiny faint" style="margin-top:10px">Yeniden başlatmak için <span class="mono">start.bat</span> / <span class="mono">./start.sh</span> kullan.</p>
      </div>
    </div>`;
  }

  function openHelp() {
    const app = state.app || {};
    CD.openModal({
      title: 'CraftDeck yardım',
      subtitle: `${app.name || 'CraftDeck'} v${app.version || CD.version} · ${app.platform || ''}`,
      size: 'lg',
      body: `<div class="stack">
        <div class="alert info">${icon('info')}<div><strong>Hızlı başlangıç:</strong> Yeni Sunucu → sürüm + yükleyici seç → Motoru Kur → Başlat → Tünel sekmesinden ngrok/Playit başlat → adresi kopyala.</div></div>
        <div>
          <h3 style="font-size:14px">Sunucu yönetimi</h3>
          <ul class="small muted" style="margin:8px 0 0;padding-left:20px;line-height:1.8">
            <li>RAM'i <strong>Ayarlar → Bellek</strong> bölümünden <span class="mono">-Xms/-Xmx</span> olarak ayarlayabilirsin.</li>
            <li><strong>Konsol</strong> sekmesinde komut yazabilir, ↑/↓ ile geçmişe gidebilirsin.</li>
            <li>Mod/plugin/resource pack'leri <strong>Mağaza</strong> veya <strong>İçerik</strong> sekmesinden kurabilirsin.</li>
            <li>Modpack için mağazadan modpack seçebilir veya <span class="mono">.mrpack</span> yükleyebilirsin. Paket sunucunun sürümünü/yükleyicisini değiştirebilir.</li>
          </ul>
        </div>
        <div>
          <h3 style="font-size:14px">Tünel</h3>
          <ul class="small muted" style="margin:8px 0 0;padding-left:20px;line-height:1.8">
            <li><strong>ngrok:</strong> Ücretsiz hesap açıp <a href="https://dashboard.ngrok.com/get-started/your-authtoken" target="_blank" rel="noreferrer">authtoken</a> alman gerekir. Token'ı Ayarlar → Tünel veya Tünel sekmesine gir.</li>
            <li><strong>Playit.gg:</strong> Hesabına bağlı ajan çalıştırılır; tüneli panelden bu sunucunun portuna yönlendir. Claim bağlantısı arayüzde görünür.</li>
            <li><strong>Özel komut:</strong> <span class="mono">{port}</span> değişkenini kullanan herhangi bir TCP tünel komutu çalıştırılabilir.</li>
            <li>Adres otomatik algılanmazsa Tünel sekmesindeki <strong>elle adres</strong> alanına yazabilirsin.</li>
          </ul>
        </div>
        <div>
          <h3 style="font-size:14px">Kısayollar</h3>
          <div class="row small muted" style="margin-top:6px"><span class="kbd">Ctrl</span> + <span class="kbd">K</span> mağaza araması · <span class="kbd">Esc</span> pencereyi kapat</div>
        </div>
        <div>
          <h3 style="font-size:14px">Bağlantılar</h3>
          <div class="row" style="margin-top:8px">
            <a class="btn sm ghost" href="https://modrinth.com" target="_blank" rel="noreferrer">${icon('external')} Modrinth</a>
            <a class="btn sm ghost" href="https://playit.gg" target="_blank" rel="noreferrer">${icon('external')} Playit.gg</a>
            <a class="btn sm ghost" href="https://dashboard.ngrok.com" target="_blank" rel="noreferrer">${icon('external')} ngrok</a>
            <a class="btn sm ghost" href="https://adoptium.net" target="_blank" rel="noreferrer">${icon('external')} Adoptium</a>
          </div>
        </div>
        <div class="kv small">
          <dt>Veri klasörü</dt><dd class="mono break">${esc(app.data_dir || '—')}</dd>
          <dt>Platform</dt><dd>${esc(app.platform || '—')}</dd>
        </div>
      </div>`,
      footer: `<button type="button" class="btn ghost" data-action="open-data">Veri klasörünü aç</button><button type="button" class="btn primary" data-action="modal-close">Kapat</button>`,
    });
  }
  CD.openHelp = openHelp;

  function bindDelegates() {
    document.addEventListener('click', (event) => {
      const actionEl = event.target.closest('[data-action]');
      if (actionEl) {
        const action = actionEl.getAttribute('data-action');
        const handler = CD.actions[action];
        if (!handler) return;
        event.preventDefault();
        try {
          const result = handler(actionEl, event);
          if (result && typeof result.catch === 'function') result.catch(showError);
        } catch (err) {
          showError(err);
        }
        return;
      }
      const card = event.target.closest('.store-card[data-project]');
      if (card && !event.target.closest('button, a') && typeof CD.openProject === 'function') {
        CD.openProject(card.dataset.project);
      }
    });

    document.addEventListener('submit', (event) => {
      const form = event.target.closest('form[data-form]');
      if (!form) return;
      event.preventDefault();
      const handler = CD.forms[form.dataset.form];
      if (!handler) return;
      try {
        const result = handler(form, event.submitter);
        if (result && typeof result.catch === 'function') result.catch(showError);
      } catch (err) {
        showError(err);
      }
    });

    document.addEventListener('change', (event) => {
      const target = event.target;
      const key = target.dataset ? (target.dataset.change || target.id) : '';
      if (key && CD.changes[key]) {
        try {
          const result = CD.changes[key](target, event);
          if (result && typeof result.catch === 'function') result.catch(showError);
        } catch (err) { showError(err); }
      }
      const javaRow = target.closest && target.closest('.java-row');
      if (javaRow) {
        $$('.java-row').forEach((row) => row.classList.toggle('checked', row === javaRow));
      }
    });

    document.addEventListener('input', (event) => {
      const target = event.target;
      const key = target.dataset ? (target.dataset.input || target.id) : '';
      if (key && CD.inputs[key]) {
        try { CD.inputs[key](target, event); } catch (err) { console.warn(err); }
      }
    });

    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (state.currentId) navigate(state.currentId, 'store');
        else navigateStore();
        setTimeout(() => { const input = $('#storeQuery'); if (input) input.focus(); }, 180);
      }
    });

    window.addEventListener('hashchange', applyRoute);
  }

  function isEditingInView() {
    const active = document.activeElement;
    const view = $('#view');
    return Boolean(active && view && view.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
  }

  function maybeRefreshDetail() {
    if (!state.currentId) return;
    if (state.tab === 'settings' || state.tab === 'store') return;
    if (isEditingInView()) return;
    if ($('#modalRoot').children.length) return;
    if (Date.now() - lastDetailAt < 5000) return;
    lastDetailAt = Date.now();
    const id = state.currentId;
    api(`/api/servers/${encodeURIComponent(id)}`).then((data) => {
      if (state.currentId !== id) return;
      state.detail = data;
      if (data.java) state.java = data.java;
      CD.mergeServer(data.server);
      renderTopbar();
      renderTabs();
      if (state.tab === 'overview') renderOverview();
    }).catch(() => {});
  }

  async function pollTick() {
    if (closed) return;
    if (!state.booted) {
      const ok = await ensureBoot();
      if (ok) applyRoute();
      pollTimer = setTimeout(pollTick, 2500);
      return;
    }
    try {
      const [serversData, jobsData] = await Promise.all([api('/api/servers'), api('/api/jobs')]);
      state.servers = serversData.servers || [];
      state.jobs = jobsData.jobs || [];
      trackJobs(state.jobs);
      renderSidebar();
      renderTopbar();
      renderTabs();
      renderJobTray();
      if (state.currentId && !state.servers.some((server) => server.id === state.currentId)) {
        toast('Seçili sunucu artık yok', 'warn');
        enterDefault();
      } else {
        maybeRefreshDetail();
      }
    } catch (err) {  }
    pollTimer = setTimeout(pollTick, 2000);
  }

  function startPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(pollTick, 600);
  }
  CD.startPolling = startPolling;

  async function init() {
    bindDelegates();
    const ok = await ensureBoot();
    if (!ok) {
      toast('CraftDeck arka ucuna ulaşılamıyor', 'error', 'Uygulama kapandıysa yeniden başlatın. Bağlantı kurulunca arayüz kendini yeniler.', { timeout: 0 });
    }
    applyRoute();
    startPolling();
    if (typeof CD.afterInit === 'function') CD.afterInit();
  }

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    setTimeout(init, 0);
  }
})();
