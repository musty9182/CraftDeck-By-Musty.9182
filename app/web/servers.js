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

  const LOADER_DESCRIPTIONS = {
    fabric: 'Hafif ve hızlı mod yükleyici. Çoğu modpack Fabric ile gelir.',
    quilt: 'Fabric uyumlu, deneysel mod yükleyici.',
    forge: 'Klasik mod yükleyici; geniş mod uyumluluğu.',
    neoforge: 'Forge’un modern çatalı; yeni sürümler için önerilir.',
    paper: 'Yüksek performanslı plugin sunucusu.',
    purpur: 'Paper tabanlı; ekstra yapılandırma seçenekleri.',
    vanilla: 'Modsuz, pluginsiz saf Minecraft sunucusu.',
  };

  const LOADER_KIND_LABEL = { modded: 'Mod', plugin: 'Plugin', vanilla: 'Saf' };

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

  function versionOptions(selected) {
    const versions = state.gameVersions || [];
    if (!versions.length) return `<option value="26.3">26.3</option>`;
    return versions.map((item) => {
      const id = item.id || item;
      return `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(id)}${item.type && item.type !== 'release' ? ` (${esc(item.type)})` : ''}</option>`;
    }).join('');
  }

  function loaderCards(selected) {
    const loaders = state.loaders && state.loaders.length ? state.loaders : [
      { id: 'fabric', name: 'Fabric', kind: 'modded' },
      { id: 'forge', name: 'Forge', kind: 'modded' },
      { id: 'neoforge', name: 'NeoForge', kind: 'modded' },
      { id: 'paper', name: 'Paper', kind: 'plugin' },
      { id: 'purpur', name: 'Purpur', kind: 'plugin' },
      { id: 'vanilla', name: 'Vanilla', kind: 'vanilla' },
    ];
    return loaders.map((loader) => `<label class="radio-card ${loader.id === selected ? 'checked' : ''}" style="padding:10px 12px">
      <input type="radio" name="loader" value="${esc(loader.id)}" data-change="new-server-loader" ${loader.id === selected ? 'checked' : ''}>
      <span class="rc-body">
        <span class="rc-title">${esc(loader.name)}
          <span class="chip chip-mini">${esc(LOADER_KIND_LABEL[loader.kind] || loader.kind || '')}</span>
        </span>
        <span class="rc-desc">${esc(LOADER_DESCRIPTIONS[loader.id] || '')}</span>
      </span>
    </label>`).join('');
  }

  function javaOptions(selected) {
    const runtimes = CD.javaRuntimes();
    const rows = [`<option value="">Otomatik seçim (önerilen)</option>`];
    for (const runtime of runtimes) {
      rows.push(`<option value="${esc(runtime.path)}" ${runtime.path === selected ? 'selected' : ''}>Java ${esc(runtime.major)} — ${esc(CD.basename(runtime.path))}${runtime.vendor ? ` (${esc(runtime.vendor)})` : ''}</option>`);
    }
    return rows.join('');
  }

  function updateJavaHint(form) {
    const hint = $('#newJavaHint', form);
    if (!hint) return;
    const version = String((new FormData(form).get('mc_version')) || '');
    const required = CD.recommendedJava(version);
    const best = CD.javaRuntimes().reduce((max, runtime) => Math.max(max, Number(runtime.major) || 0), 0);
    if (!best) {
      hint.innerHTML = `${icon('alert')} Sistemde Java bulunamadı. Kurulumdan sonra <strong>Ayarlar → Java</strong> bölümünden Java ${required} indirebilirsiniz.`;
    } else if (best < required) {
      hint.innerHTML = `${icon('alert')} Minecraft ${esc(version)} için Java ${required}+ gerekir; bulunan en yüksek sürüm Java ${best}. Kurulum öncesi Ayarlar’dan Java ${required} indirin.`;
    } else {
      hint.innerHTML = `${icon('check')} Minecraft ${esc(version)} için Java ${required}+ yeterli (en yüksek: Java ${best}).`;
    }
  }

  function openCreateServerModal(prefill = {}) {
    const defaultVersion = prefill.mc_version || (state.gameVersions[0] && state.gameVersions[0].id) || '26.3';
    const defaultLoader = prefill.loader || (state.loaders.some((item) => item.id === 'fabric') ? 'fabric' : 'paper');
    const body = `<form data-form="create-server" id="createServerForm" class="stack" autocomplete="off">
      <div class="form-grid">
        <div class="field span-2">
          <label for="newServerName">Sunucu adı</label>
          <input class="input" id="newServerName" name="name" maxlength="48" required value="${esc(prefill.name || 'Yeni Sunucu')}" placeholder="Örn. Arkadaşlar Sunucusu">
        </div>
        <div class="field">
          <label for="newServerVersion">Minecraft sürümü</label>
          <select class="select" id="newServerVersion" name="mc_version" data-change="new-server-version">${versionOptions(defaultVersion)}</select>
        </div>
        <div class="field">
          <label for="newServerPort">Port <span class="faint">(isteğe bağlı)</span></label>
          <input class="input" id="newServerPort" name="port" type="number" min="1" max="65535" placeholder="Otomatik (25565+)">
          <span class="hint">Boş bırakırsanız boş bir port otomatik seçilir.</span>
        </div>
        <div class="field span-2">
          <span class="field-label">Sunucu motoru</span>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px">${loaderCards(defaultLoader)}</div>
        </div>
        <div class="field span-2">
          <span class="field-label">Bellek (RAM)</span>
          <div class="range-wrap">
            <span class="tiny faint" style="min-width:28px">Min</span>
            <input type="range" id="newRamMin" name="ram_min_mb" min="512" max="16384" step="512" value="1024" data-input="new-ram">
            <span class="range-value" id="newRamMinValue">1 GB</span>
          </div>
          <div class="range-wrap">
            <span class="tiny faint" style="min-width:28px">Max</span>
            <input type="range" id="newRamMax" name="ram_max_mb" min="512" max="32768" step="512" value="4096" data-input="new-ram">
            <span class="range-value" id="newRamMaxValue">4 GB</span>
          </div>
          <span class="hint">Sunucuya ayrılacak bellek <span class="mono">-Xms/-Xmx</span> olarak uygulanır. 4 GB çoğu modpack için iyi bir başlangıçtır.</span>
        </div>
        <div class="field">
          <label for="newServerJava">Java</label>
          <select class="select" id="newServerJava" name="java_path">${javaOptions('')}</select>
        </div>
        <div class="field">
          <span class="field-label">Kurulum</span>
          <label class="check"><input type="checkbox" name="install" value="1" checked><span class="check-text">Motoru hemen kur<small>İndirme arka planda çalışır.</small></span></label>
        </div>
        <div class="alert info span-2" id="newJavaHint" style="margin:0"></div>
      </div>
      <p class="tiny faint">Kurulum sırasında <span class="mono">eula.txt</span> otomatik olarak <span class="mono">eula=true</span> yapılır. Minecraft EULA’sını kabul etmiş olursunuz.</p>
    </form>`;

    const modal = CD.openModal({
      title: 'Yeni sunucu',
      subtitle: 'Sürüm, motor ve belleği seçin; gerisini CraftDeck halleder.',
      size: 'lg',
      body,
      footer: `<button type="button" class="btn ghost" data-action="modal-close">Vazgeç</button>
        <button type="submit" class="btn primary" form="createServerForm">${icon('plus')} Sunucu oluştur</button>`,
      onMount(handle) {
        const form = $('#createServerForm', handle.el);
        if (!form) return;
        ['#newRamMin', '#newRamMax'].forEach((selector) => {
          const input = $(selector, form);
          if (input) paintRange(input);
        });
        updateJavaHint(form);
        const name = $('#newServerName', form);
        if (name) { name.focus(); name.select(); }
      },
    });
    return modal;
  }
  CD.openCreateServerModal = openCreateServerModal;

  CD.inputs['new-ram'] = (input) => {
    const form = input.closest('form');
    if (!form) return;
    const min = $('#newRamMin', form);
    const max = $('#newRamMax', form);
    if (!min || !max) return;
    if (min === input && Number(min.value) > Number(max.value)) max.value = min.value;
    if (max === input && Number(max.value) < Number(min.value)) min.value = max.value;
    paintRange(min);
    paintRange(max);
    const minLabel = $('#newRamMinValue', form);
    const maxLabel = $('#newRamMaxValue', form);
    if (minLabel) minLabel.textContent = ramLabel(min.value);
    if (maxLabel) maxLabel.textContent = ramLabel(max.value);
  };

  CD.changes['new-server-loader'] = (input) => {
    const form = input.closest('form');
    if (!form) return;
    form.querySelectorAll('.radio-card').forEach((card) => card.classList.toggle('checked', Boolean(card.querySelector('input:checked'))));
    updateJavaHint(form);
  };

  CD.changes['new-server-version'] = (select) => {
    const form = select.closest('form');
    if (form) updateJavaHint(form);
  };

  CD.forms['create-server'] = async (form, submitter) => {
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const mcVersion = String(data.get('mc_version') || '').trim();
    const loader = String(data.get('loader') || '').trim();
    const portRaw = String(data.get('port') || '').trim();
    const ramMin = Number(data.get('ram_min_mb')) || 1024;
    const ramMax = Number(data.get('ram_max_mb')) || 4096;
    if (!name) { toast('Sunucu adı girin', 'warn'); return; }
    if (!mcVersion) { toast('Minecraft sürümü seçin', 'warn'); return; }
    if (!loader) { toast('Sunucu motoru seçin', 'warn'); return; }
    if (ramMin < 512 || ramMax < ramMin) { toast('RAM aralığı geçersiz', 'warn', 'Maksimum RAM, minimumdan küçük olamaz.'); return; }
    if (portRaw) {
      const port = Number(portRaw);
      if (!Number.isInteger(port) || port < 1 || port > 65535) { toast('Geçersiz port', 'warn', 'Port 1-65535 arasında olmalı.'); return; }
    }

    if (submitter) { submitter.disabled = true; submitter.dataset.busy = '1'; }
    const note = toast('Sunucu oluşturuluyor…', 'info', `${name} · ${loader} · MC ${mcVersion}`, { timeout: 0 });
    try {
      const payload = {
        name, mc_version: mcVersion, loader,
        ram_min_mb: ramMin,
        ram_max_mb: ramMax,
        java_path: String(data.get('java_path') || ''),
        install: data.get('install') != null,
      };
      if (portRaw) payload.port = Number(portRaw);
      const result = await api('/api/servers', { method: 'POST', body: payload });
      const server = result && result.server;
      const job = result && result.job;
      if (job) CD.noteJob(job);
      note.close();
      if (server) {
        CD.mergeServer(server);
        toast('Sunucu oluşturuldu', 'success', job ? 'Motor kurulumu arka planda başladı.' : 'Motoru Ayarlar’dan kurabilirsiniz.');
        await CD.refreshServers();
        const modal = form.closest('.modal-backdrop');
        if (modal && modal.__modal) modal.__modal.close();
        CD.navigate(server.id, 'overview');
        if (job) setTimeout(() => CD.openJobModal(job.id), 350);
        CD.refreshJobs();
      } else {
        toast('Sunucu oluşturuldu', 'success');
        await CD.refreshServers();
      }
    } catch (err) {
      note.close();
      showError(err);
    } finally {
      if (submitter) { submitter.disabled = false; delete submitter.dataset.busy; }
    }
  };

  function uploadMrpack(file) {
    if (!file) return;
    if (!/\.mrpack$/i.test(file.name)) {
      toast('Geçersiz dosya', 'warn', 'Lütfen .mrpack uzantılı bir Modrinth paketi seçin.');
      return;
    }
    const note = toast('.mrpack yükleniyor…', 'info', `${file.name} · ${CD.fmtBytes(file.size)}`, { timeout: 0, progress: 0 });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/servers/from-mrpack');
    xhr.responseType = 'text';
    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      const pct = event.total ? (event.loaded / event.total) * 100 : 0;
      note.update('Paket yükleniyor…', `${CD.fmtBytes(event.loaded)} / ${CD.fmtBytes(event.total)} · ${Math.round(pct)}%`, pct);
    });
    xhr.addEventListener('error', () => {
      note.close();
      toast('Yükleme başarısız', 'error', 'Sunucu bağlantısı kesildi. Tekrar deneyin.');
      CD.setOffline(true);
    });
    xhr.addEventListener('abort', () => {
      note.close();
      toast('Yükleme iptal edildi', 'warn');
    });
    xhr.addEventListener('load', async () => {
      let data = null;
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { data = null; }
      if (xhr.status < 200 || xhr.status >= 300) {
        note.close();
        const message = (data && data.error) || `Paket yüklenemedi (HTTP ${xhr.status})`;
        const detail = (data && data.detail) || 'Dosyanın bozuk olmadığından ve Modrinth formatında olduğundan emin olun.';
        toast(message, 'error', detail);
        return;
      }
      note.close();
      const server = data && data.server;
      const job = data && data.job;
      if (job) CD.noteJob(job);
      const pack = (data && data.pack) || {};
      toast('Modpack sunucusu oluşturuldu', 'success', `${pack.name || file.name} · MC ${pack.mc_version || '—'} · ${pack.loader || '—'}`);
      await CD.refreshServers();
      if (server) {
        CD.navigate(server.id, 'overview');
        if (job) setTimeout(() => CD.openJobModal(job.id), 350);
      }
      CD.refreshJobs();
    });
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  }
  CD.uploadMrpack = uploadMrpack;

  CD.actions['new-server'] = () => openCreateServerModal();
  CD.actions['upload-mrpack-create'] = () => {
    const input = $('#mrpackInput');
    if (input) { input.value = ''; input.click(); }
    else toast('.mrpack seçici bulunamadı', 'error');
  };

  document.addEventListener('DOMContentLoaded', () => {
    const input = $('#mrpackInput');
    if (input) {
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        input.value = '';
        if (file) uploadMrpack(file);
      });
    }
  });

  let dragDepth = 0;
  window.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) return;
    dragDepth += 1;
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
  });
  window.addEventListener('dragover', (event) => {
    if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('drop', (event) => {
    dragDepth = 0;
    const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
    if (!files.length) return;
    const mrpack = files.find((file) => /\.mrpack$/i.test(file.name));
    if (!mrpack) return;
    event.preventDefault();
    if (files.length > 1) toast('Yalnızca ilk .mrpack dosyası yüklenecek', 'info');
    uploadMrpack(mrpack);
  });
})();
