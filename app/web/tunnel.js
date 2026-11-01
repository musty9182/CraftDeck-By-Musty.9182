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

  const ts = CD.tunnelState;
  const POLL_MS = 1400;
  const MAX_LINES = 800;

  const PROVIDERS = {
    ngrok: {
      title: 'ngrok',
      desc: 'Ücretsiz hesap authtoken’ı ile saniyeler içinde TCP tüneli açar.',
      badge: 'Önerilen',
    },
    playit: {
      title: 'Playit.gg',
      desc: 'Mevcut Playit hesabınla çalışır; panelden yönlendirme yapılır.',
      badge: 'Ücretsiz',
    },
    custom: {
      title: 'Özel komut',
      desc: 'bore, cloudflared, ssh gibi kendi tünel komutunu çalıştır.',
      badge: '',
    },
  };

  let timer = null;
  let inflight = false;
  let loadingAt = 0;
  let selectedProvider = 'ngrok';
  let providerServerId = null;

  function providerLabel(provider) {
    return PROVIDERS[provider] ? PROVIDERS[provider].title : (CD.tunnelProviderLabel ? CD.tunnelProviderLabel(provider) : 'Seçilmedi');
  }

  function pillClass(status) {
    if (status === 'running') return 'running';
    if (status === 'starting') return 'starting';
    if (status === 'error') return 'crashed';
    return 'stopped';
  }

  function statusLabel(status) {
    return CD.tunnelStatusLabel ? CD.tunnelStatusLabel(status) : (status || 'Hazır');
  }

  function isBusy(data) {
    return Boolean(data && (data.running || data.status === 'running' || data.status === 'starting'));
  }

  function serverOf() {
    return CD.currentServer();
  }

  function currentData() {
    const detail = state.detail;
    if (detail && detail.server && detail.server.id === state.currentId && detail.tunnel) return detail.tunnel;
    return ts.data || {};
  }

  function pickProvider(data) {
    const running = data && data.provider && data.provider !== 'none' ? data.provider : '';
    if (running && PROVIDERS[running]) return running;
    const configured = data && data.configured_provider ? data.configured_provider : '';
    if (configured && PROVIDERS[configured]) return configured;
    return 'ngrok';
  }

  function addressRow(address, manual) {
    if (!address) {
      return `<div class="ta-main">
        <div class="ta-label">Genel adres</div>
        <div class="ta-value empty">Tünel çalışınca adres burada görünecek.</div>
      </div>`;
    }
    return `<div class="ta-main">
      <div class="ta-label">Genel adres${manual ? ' · elle girildi' : ''}</div>
      <div class="ta-value">${esc(address)}</div>
    </div>
    <div class="row" style="gap:6px">
      <button type="button" class="btn sm primary" data-action="copy" data-copy="${esc(address)}" data-label="Sunucu adresi">${icon('copy')} Tek tıkla kopyala</button>
    </div>`;
  }

  function logLine(line) {
    const stream = esc(line.stream || 'tunnel');
    return `<div class="line ${stream}"><span class="t">${esc(CD.fmtTime(line.t))}</span><span class="x">${esc(line.text || '')}</span></div>`;
  }

  function paintLog() {
    const box = $('#tunnelLog');
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.innerHTML = ts.lines.length
      ? ts.lines.map(logLine).join('')
      : '<div class="empty">Henüz tünel çıktısı yok. Bir sağlayıcı seçip başlatın.</div>';
    if (nearBottom || !ts.lines.length) box.scrollTop = box.scrollHeight;
  }

  function appendLines(lines) {
    if (!lines || !lines.length) return;
    ts.lines.push(...lines);
    if (ts.lines.length > MAX_LINES) ts.lines.splice(0, ts.lines.length - MAX_LINES);
    const box = $('#tunnelLog');
    if (!box) return;
    const empty = box.querySelector('.empty');
    if (empty) empty.remove();
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.insertAdjacentHTML('beforeend', lines.map(logLine).join(''));
    while (box.childElementCount > MAX_LINES) box.firstElementChild.remove();
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }

  function providerFields(provider, data) {
    if (provider === 'ngrok') {
      return `<div class="field">
        <label for="tunnelToken">ngrok authtoken</label>
        <input class="input mono" id="tunnelToken" name="ngrok_token" type="password" autocomplete="off" spellcheck="false"
          value="${esc(data.ngrok_token || '')}" placeholder="2abc...">
        <span class="hint">Ücretsiz hesabının <a href="https://dashboard.ngrok.com/get-started/your-authtoken" target="_blank" rel="noopener">authtoken sayfasından</a> alabilirsin. Token yalnızca bu bilgisayarda saklanır.</span>
      </div>`;
    }
    if (provider === 'playit') {
      return `<div class="alert info" style="margin:0 0 10px">
        ${icon('info')}
        <div>
          <strong>Playit ajanı mevcut hesabınla çalışır.</strong>
          <div class="small" style="margin-top:4px">Ajan ilk kez çalışıyorsa çıktıda bir <em>claim</em> bağlantısı görünür. Bağlandıktan sonra
          <a href="https://playit.gg/account/tunnels" target="_blank" rel="noopener">playit.gg panelinden</a> bu sunucunun portuna TCP tüneli ekle.</div>
        </div>
      </div>
      <div class="field">
        <span class="field-label">Sunucu portu</span>
        <div class="mono small">${esc(data.port || (serverOf() && serverOf().port) || '—')} · Playit panelinde “Minecraft Java” türünde tünel oluştur.</div>
      </div>`;
    }
    return `<div class="field">
      <label for="tunnelCommand">Tünel komutu</label>
      <textarea class="textarea mono" id="tunnelCommand" name="custom_command" rows="3" maxlength="600" spellcheck="false"
        placeholder="bore local {port} --to bore.pub">${esc(data.custom_command || '')}</textarea>
      <span class="hint"><span class="mono">{port}</span> sunucunun portuyla değiştirilir. Örnek: <span class="mono">cloudflared tunnel --url tcp://127.0.0.1:{port}</span></span>
    </div>`;
  }

  function paintLive(data) {
    const merged = { ...(ts.data || {}), ...(data || {}) };
    ts.data = merged;
    const status = merged.status || 'idle';
    const busy = isBusy(merged);
    const provider = merged.provider && merged.provider !== 'none' ? merged.provider : selectedProvider;
    const address = String(merged.address || merged.manual_address || '').trim();
    const manual = Boolean(merged.manual_address) && merged.manual_address === address;

    const pill = $('#tunnelStatusPill');
    if (pill) {
      pill.innerHTML = `<span class="status-pill ${esc(pillClass(status))}">
        <span class="status-dot ${esc(pillClass(status))}"></span>${esc(statusLabel(status))}
      </span>`;
    }

    const live = $('#tunnelLive');
    if (live) {
      live.innerHTML = `<div class="tunnel-address-box">${addressRow(address, manual)}</div>
        <div class="row" style="margin-top:12px">
          <span class="chip chip-mini">${esc(providerLabel(provider))}</span>
          ${merged.port ? `<span class="tiny faint">Yerel hedef: <span class="mono">127.0.0.1:${esc(merged.port)}</span></span>` : ''}
          <span class="spacer"></span>
          ${busy ? `<button type="button" class="btn sm danger" data-action="tunnel-stop">${icon('stop')} Durdur</button>` : ''}
          <button type="button" class="btn sm ghost" data-action="tunnel-refresh">${icon('refresh')} Durumu yenile</button>
        </div>`;
    }

    const claim = $('#tunnelClaim');
    if (claim) {
      const url = CD.safeUrl(merged.claim_url || '');
      claim.innerHTML = url ? `<div class="alert info" style="margin-top:12px">${icon('link')}
        <div><strong>Playit hesabını bağla.</strong> Ajan bir bağlantı istiyor:
          <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>
          <div style="margin-top:6px"><button type="button" class="btn sm ghost" data-action="copy" data-copy="${esc(url)}" data-label="Claim bağlantısı">${icon('copy')} Bağlantıyı kopyala</button></div>
        </div></div>` : '';
    }

    const error = $('#tunnelError');
    if (error) {
      error.innerHTML = merged.error
        ? `<div class="alert warn" style="margin-top:12px">${icon('alert')}<div>${esc(merged.error)}</div></div>`
        : '';
    }
  }

  async function poll({ initial = false } = {}) {
    if (inflight || !state.currentId || state.tab !== 'tunnel') return;
    const server = serverOf();
    if (!server) return;
    inflight = true;
    try {
      const since = initial ? 0 : Number(ts.seq) || 0;
      const data = await api(`/api/servers/${encodeURIComponent(server.id)}/tunnel?since=${since}`);
      if (state.currentId !== server.id || state.tab !== 'tunnel') return;
      if (ts.serverId !== server.id) {
        ts.serverId = server.id;
        ts.lines = [];
        ts.seq = 0;
      }
      const logs = data.logs || [];
      if (initial) {
        ts.lines = logs.slice(-MAX_LINES);
        ts.loaded = true;
        paintLog();
      } else {
        appendLines(logs);
      }
      ts.seq = Math.max(Number(ts.seq) || 0, Number(data.last_seq) || 0);
      paintLive(data);
    } catch (err) {

    } finally {
      inflight = false;
    }
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function startTimer() {
    if (timer) return;
    timer = setInterval(() => {
      if (state.tab !== 'tunnel' || !state.currentId || ts.serverId !== state.currentId) {
        stopTimer();
        return;
      }
      poll();
    }, POLL_MS);
  }

  function renderTunnel() {
    const server = serverOf();
    const view = $('#view');
    if (!view) return;
    stopTimer();
    if (!server) {
      CD.setHTML(view, `<div class="empty-state">${icon('alert')}<h3>Sunucu seçilmedi</h3></div>`);
      return;
    }
    const detail = state.detail;
    if (!detail || !detail.server || detail.server.id !== server.id) {
      CD.setHTML(view, `<div class="page-head"><div><h2>${icon('globe')} Tünel</h2><p>Tünel yapılandırması yükleniyor…</p></div></div>
        <div class="loading-block"><span class="spinner"></span> Yükleniyor…</div>`);
      if (Date.now() - loadingAt > 4000) {
        loadingAt = Date.now();
        CD.loadDetail(server.id);
      }
      return;
    }

    const data = currentData();
    if (providerServerId !== server.id || !PROVIDERS[selectedProvider]) {
      providerServerId = server.id;
      selectedProvider = pickProvider(data);
    }
    ts.serverId = server.id;
    if (!ts.loaded) {
      ts.lines = (data.logs || []).slice(-MAX_LINES);
      ts.seq = Number(data.last_seq) || 0;
      ts.loaded = true;
    }

    const busy = isBusy(data);
    const status = data.status || 'idle';
    const port = data.port || server.port;

    const cards = Object.entries(PROVIDERS).map(([id, info]) => `
      <button type="button" class="tunnel-provider ${selectedProvider === id ? 'checked' : ''}" data-action="tunnel-provider" data-provider="${esc(id)}">
        <div class="tp-title">${icon(id === 'ngrok' ? 'key' : id === 'playit' ? 'globe' : 'terminal')} ${esc(info.title)}
          ${info.badge ? `<span class="chip chip-mini green" style="margin-left:auto">${esc(info.badge)}</span>` : ''}
        </div>
        <div class="tp-desc">${esc(info.desc)}</div>
      </button>`).join('');

    CD.setHTML(view, `<div class="page-head">
        <div>
          <h2>${icon('globe')} Tünel</h2>
          <p>${esc(server.name)} sunucusunu port yönlendirme olmadan arkadaşlarına aç.</p>
        </div>
        <div class="actions" id="tunnelStatusPill"></div>
      </div>

      <div class="grid cols-2" style="align-items:start">
        <section class="panel panel-pad">
          <div class="section-head" style="margin-bottom:12px">
            <div><h3>${icon('link')} Dışa açma sağlayıcısı</h3><p>Bir sağlayıcı seç, gerekli bilgileri gir ve başlat.</p></div>
          </div>

          <form data-form="tunnel-start" autocomplete="off">
            <input type="hidden" id="tunnelProviderValue" name="provider" value="${esc(selectedProvider)}">
            <div class="tunnel-providers">${cards}</div>
            <div id="tunnelProviderFields">${providerFields(selectedProvider, data)}</div>
            <div class="row" style="margin-top:14px">
              <button type="submit" class="btn primary" ${busy ? 'disabled' : ''}>${icon('play')} ${busy ? 'Tünel çalışıyor' : 'Tüneli başlat'}</button>
              <span class="tiny faint">Yeniden başlatmak için durdurup tekrar başlat.</span>
            </div>
          </form>

          <hr class="divider">
          <div id="tunnelLive"></div>
          <div id="tunnelClaim"></div>
          <div id="tunnelError"></div>

          <hr class="divider">
          <form data-form="tunnel-address" class="input-group" autocomplete="off">
            <input class="input mono sm" name="address" maxlength="200" value="${esc(data.manual_address || '')}"
              placeholder="Adresi elle gir: ornek.joinmc.link:${esc(port)}" spellcheck="false">
            <button type="submit" class="btn sm">${icon('save')} Adresi kaydet</button>
          </form>
          <div class="hint" style="margin-top:7px">Otomatik algılama başarısız olursa sağlayıcının verdiği genel adresi buraya yazabilirsin.</div>
        </section>

        <section class="panel panel-pad">
          <div class="section-head" style="margin-bottom:10px">
            <div><h3>${icon('terminal')} Tünel günlüğü</h3><p>Sağlayıcı çıktısı ve algılanan adresler.</p></div>
            <div class="actions">
              <button type="button" class="btn sm ghost" data-action="tunnel-clear-log">${icon('eraser')} Temizle</button>
            </div>
          </div>
          <div class="console-log tunnel-log" id="tunnelLog" aria-live="polite"></div>
        </section>
      </div>

      <div class="alert info" style="margin-top:16px">
        ${icon('shield')}
        <div>Tüneller yalnızca bu bilgisayar açıkken çalışır. Ücretsiz sağlayıcılarda adres her başlatmada değişebilir;
        sabit adres için sağlayıcı hesabındaki rezerve alan adı seçeneklerine bak.</div>
      </div>`);

    paintLive(data);
    paintLog();
    startTimer();
    poll({ initial: true });
  }
  CD.renderTunnel = renderTunnel;

  CD.actions['tunnel-provider'] = (el) => {
    const provider = el.dataset.provider || '';
    if (!PROVIDERS[provider]) return;
    selectedProvider = provider;
    const hidden = $('#tunnelProviderValue');
    if (hidden) hidden.value = provider;
    $$('.tunnel-provider').forEach((card) => card.classList.toggle('checked', card === el));
    const holder = $('#tunnelProviderFields');
    if (holder) holder.innerHTML = providerFields(provider, ts.data || {});
  };

  CD.actions['tunnel-refresh'] = async () => {
    await poll({ initial: true });
    toast('Tünel durumu yenilendi', 'info');
  };

  CD.actions['tunnel-stop'] = async () => {
    if (!state.currentId) return;
    try {
      const data = await api(`/api/servers/${encodeURIComponent(state.currentId)}/tunnel/stop`, { method: 'POST' });
      if (data) paintLive(data);
      toast('Tünel durduruldu', 'info');
    } catch (err) { showError(err); }
  };

  CD.actions['tunnel-clear-log'] = () => {
    ts.lines = [];
    paintLog();
    toast('Tünel günlüğü temizlendi', 'info');
  };

  CD.actions['tunnel-reset'] = async () => {
    if (!state.currentId) return;
    const confirmed = await CD.confirmDialog({
      title: 'Tüneli sıfırla',
      message: 'Tünel adresi ve günlük temizlenecek. Çalışan tünel varsa önce durdurulur.',
      confirmText: 'Sıfırla',
    });
    if (!confirmed) return;
    try {
      await api(`/api/servers/${encodeURIComponent(state.currentId)}/tunnel/stop`, { method: 'POST' });
      const data = await api(`/api/servers/${encodeURIComponent(state.currentId)}/tunnel/reset`, { method: 'POST' });
      ts.lines = [];
      ts.seq = 0;
      ts.data = data || {};
      paintLog();
      paintLive(ts.data);
      toast('Tünel sıfırlandı', 'success');
    } catch (err) { showError(err); }
  };

  CD.forms['tunnel-start'] = async (form, submitter) => {
    if (!state.currentId) return;
    const data = new FormData(form);
    const provider = String(data.get('provider') || selectedProvider);
    if (!PROVIDERS[provider]) {
      toast('Geçersiz tünel sağlayıcısı', 'warn');
      return;
    }
    const token = provider === 'ngrok' ? String(data.get('ngrok_token') || '').trim() : '';
    const command = provider === 'custom' ? String(data.get('custom_command') || '').trim() : '';
    if (provider === 'ngrok' && !token) {
      toast('ngrok authtoken gerekli', 'warn', 'Ücretsiz ngrok hesabından authtoken alıp yukarıdaki alana yapıştır.');
      const input = $('#tunnelToken', form);
      if (input) input.focus();
      return;
    }
    if (provider === 'custom' && !command) {
      toast('Tünel komutu boş', 'warn', '{port} değişkenini kullanarak bir komut yaz.');
      const input = $('#tunnelCommand', form);
      if (input) input.focus();
      return;
    }
    if (submitter) submitter.disabled = true;
    try {
      const result = await api(`/api/servers/${encodeURIComponent(state.currentId)}/tunnel/start`, {
        method: 'POST',
        body: { provider, token, command },
      });
      ts.lines = [];
      ts.seq = Number(result && result.last_seq) || 0;
      ts.data = result || {};
      paintLog();
      paintLive(ts.data);
      toast('Tünel başlatılıyor', 'success', provider === 'playit' ? 'Bağlantı istenirse günlükteki claim bağlantısını kullan.' : '');
      poll({ initial: true });
    } catch (err) {
      showError(err);
    } finally {
      if (submitter) submitter.disabled = false;
    }
  };

  CD.forms['tunnel-address'] = async (form, submitter) => {
    if (!state.currentId) return;
    const data = new FormData(form);
    const address = String(data.get('address') || '').trim();
    if (address && !/^[^\s/]+$/.test(address)) {
      toast('Geçersiz adres', 'warn', 'Boşluk ve eğik çizgi olmadan host:port biçiminde yaz.');
      return;
    }
    if (submitter) submitter.disabled = true;
    try {
      const result = await api(`/api/servers/${encodeURIComponent(state.currentId)}/tunnel/address`, {
        method: 'POST',
        body: { address },
      });
      ts.data = { ...(ts.data || {}), manual_address: address, address: address || (ts.data && ts.data.address) || '' };
      if (address) ts.data.address = address;
      paintLive(ts.data);
      const server = serverOf();
      if (server && address) CD.mergeServer({ ...server, address });
      if (CD.refreshServers) CD.refreshServers();
      toast(address ? 'Tünel adresi kaydedildi' : 'Elle girilen adres temizlendi', 'success', address || '');
    } catch (err) {
      showError(err);
    } finally {
      if (submitter) submitter.disabled = false;
    }
  };

  CD.stopTunnelPolling = stopTimer;
})();
