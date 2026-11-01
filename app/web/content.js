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

  const cs = CD.contentState;

  const GROUPS = [
    { key: 'mods', label: 'Modlar', icon: 'puzzle', folder: 'mods', empty: 'Sunucuda mod yok.' },
    { key: 'plugins', label: 'Pluginler', icon: 'zap', folder: 'plugins', empty: 'Sunucuda plugin yok.' },
    { key: 'resourcepacks', label: 'Resource Pack’ler', icon: 'image', folder: 'resourcepacks', empty: 'Resource pack yok.' },
    { key: 'shaderpacks', label: 'Shader’lar', icon: 'sparkles', folder: 'shaderpacks', empty: 'Shader yok.' },
    { key: 'datapacks', label: 'Datapack’ler', icon: 'database', folder: 'datapacks', empty: 'Datapack yok.' },
  ];

  function currentData() {
    if (cs.serverId === state.currentId && cs.data) return cs.data;
    if (state.detail && state.detail.content) return state.detail.content;
    return null;
  }

  async function refreshContent(force = false) {
    const id = state.currentId;
    if (!id) return null;
    if (cs.loading) return null;
    if (!force && cs.loaded && cs.serverId === id) return cs.data;
    cs.loading = true;
    try {
      const data = await api(`/api/servers/${encodeURIComponent(id)}/content`);
      if (state.currentId !== id) return null;
      cs.data = data;
      cs.serverId = id;
      cs.loaded = true;
      if (state.detail && state.detail.server && state.detail.server.id === id) {
        state.detail.content = data;
      }
      if (state.tab === 'content') {
        const view = $('#view');
        if (view) renderContent();
      }
      return data;
    } catch (err) {
      if (state.tab === 'content') {
        const view = $('#view');
        if (view) {
          CD.setHTML(view, `<div class="alert error">${icon('alert')}<div><strong>İçerik listesi alınamadı.</strong><br>${esc(err.message || '')}<div style="margin-top:8px"><button type="button" class="btn sm" data-action="content-refresh">${icon('refresh')} Tekrar dene</button></div></div></div>`);
        }
      }
      return null;
    } finally {
      cs.loading = false;
    }
  }
  CD.refreshContent = refreshContent;

  function groupRow(item) {
    const projectLink = item.project_id
      ? CD.safeUrl(`https://modrinth.com/${encodeURIComponent(item.type || 'mod')}/${encodeURIComponent(item.project_id)}`)
      : '';
    const isDisabled = /\.disabled$/i.test(item.name || '');
    return `<div class="content-row">
      <div class="content-name">
        <div class="cn-title">${esc(item.title || item.name)}${isDisabled ? ' <span class="chip chip-mini amber">Devre dışı</span>' : ''}</div>
        <div class="cn-file">${esc(item.path || item.name)}</div>
      </div>
      <span class="content-size">${esc(CD.fmtBytes(item.size))}</span>
      <span class="content-date" title="${esc(item.installed_at || '')}">${esc(item.installed_at ? CD.timeAgo(item.installed_at) : CD.fmtDate((item.mtime || 0) * 1000))}</span>
      <div class="row" style="gap:4px;flex-wrap:nowrap">
        ${projectLink ? `<a class="btn sm ghost" href="${esc(projectLink)}" target="_blank" rel="noreferrer noopener" title="Modrinth sayfası">${icon('external')}</a>` : ''}
        <button type="button" class="btn sm ghost" data-action="content-delete" data-path="${esc(item.path)}" data-title="${esc(item.title || item.name)}" title="Dosyayı sil">${icon('trash')}</button>
      </div>
    </div>`;
  }

  function groupHTML(group, items) {
    if (!items || !items.length) return '';
    return `<details class="content-group" open>
      <summary>${icon(group.icon)} ${esc(group.label)} <span class="cg-count">${items.length} dosya</span></summary>
      <div class="cg-body">${items.map(groupRow).join('')}</div>
    </details>`;
  }

  function renderContent() {
    const view = $('#view');
    if (!view) return;
    const server = CD.currentServer();
    if (!server) {
      CD.setHTML(view, `<div class="empty-state">${icon('alert')}<h3>Sunucu seçilmedi</h3></div>`);
      return;
    }
    if (cs.serverId !== server.id) {
      Object.assign(cs, { loaded: false, loading: false, data: null, serverId: server.id });
    }
    const data = currentData();
    if (!data) {
      CD.setHTML(view, `<div class="page-head">
          <div><h2>${icon('box')} İçerik</h2><p>${esc(server.name)} sunucusundaki dosyalar.</p></div>
        </div>
        <div class="loading-block"><span class="spinner"></span> İçerik listesi yükleniyor…</div>`);
      if (!cs.loading) refreshContent(true);
      return;
    }

    const groups = data.groups || {};
    const total = Number(data.total) || 0;
    const summary = GROUPS.filter((group) => (groups[group.key] || []).length).map((group) => {
      const count = (groups[group.key] || []).length;
      return `<span class="chip">${icon(group.icon)} ${esc(group.label)} · ${count}</span>`;
    }).join('');

    const groupsHTML = GROUPS.map((group) => groupHTML(group, groups[group.key])).join('');
    const blank = `<div class="empty-state">${icon('box')}<h3>Henüz içerik yok</h3><p>Modrinth mağazasından mod, plugin veya resource pack kurarak başla.</p>
      <div class="row" style="justify-content:center;margin-top:14px">
        <button type="button" class="btn primary" data-action="content-open-store">${icon('store')} Mağazayı aç</button>
        <button type="button" class="btn ghost" data-action="content-open-folder" data-which="mods">${icon('folder')} Mods klasörü</button>
      </div></div>`;

    CD.setHTML(view, `<div class="page-head">
        <div>
          <h2>${icon('box')} İçerik</h2>
          <p>${esc(server.name)} · ${esc(CD.loaderMeta(server.loader).name || server.loader)} · MC ${esc(server.mc_version)}. Kurulan dosyalar sunucu klasöründe tutulur.</p>
        </div>
        <div class="actions">
          <button type="button" class="btn sm ghost" data-action="content-refresh">${icon('refresh')} Yenile</button>
          <button type="button" class="btn sm ghost" data-action="content-open-folder" data-which="mods">${icon('folder')} Mods</button>
          <button type="button" class="btn sm primary" data-action="content-open-store">${icon('store')} Mağaza</button>
        </div>
      </div>
      ${total ? `<div class="content-summary">${summary}<span class="chip chip-mini">${total} dosya</span></div>${groupsHTML}` : blank}
      <div class="tip" style="margin-top:16px">${icon('info')}<div>Dosyayı silmek için satırdaki çöp kutusunu kullan. Sunucu çalışırken silinen mod/plugin dosyaları bir sonraki yeniden başlatmada etkili olur.</div></div>`);
  }
  CD.renderContent = renderContent;

  CD.actions['content-refresh'] = async () => {
    await refreshContent(true);
    toast('İçerik listesi yenilendi', 'success');
  };

  CD.actions['content-open-store'] = () => {
    if (state.currentId) CD.navigate(state.currentId, 'store');
    else CD.navigateStore();
  };

  CD.actions['content-open-folder'] = async (el) => {
    if (!state.currentId) return;
    try {
      await api(`/api/servers/${encodeURIComponent(state.currentId)}/open`, { method: 'POST', body: { which: el.dataset.which || 'mods' } });
    } catch (err) { showError(err); }
  };

  CD.actions['content-delete'] = async (el) => {
    if (!state.currentId) return;
    const path = el.dataset.path;
    const title = el.dataset.title || path;
    if (!path) return;
    const confirmed = await CD.confirmDialog({
      title: 'Dosyayı sil',
      message: `<strong>${esc(title)}</strong> sunucudan kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
      confirmText: 'Sil',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api(`/api/servers/${encodeURIComponent(state.currentId)}/content?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
      toast('Dosya silindi', 'success', path);
      await refreshContent(true);
      if (state.tab === 'overview') CD.loadDetail(state.currentId);
    } catch (err) { showError(err); }
  };
})();
