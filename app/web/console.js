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

  const cs = CD.consoleState;
  const MAX_LINES = 2500;
  const POLL_MS = 1100;

  let timer = null;
  let inflight = false;
  let lastServerId = null;

  const STATUS_LABEL = {
    running: 'Bağlı',
    starting: 'Başlatılıyor',
    stopping: 'Durduruluyor',
    stopped: 'Sunucu kapalı',
    crashed: 'Sunucu çöktü',
  };

  function resetForServer(serverId) {
    if (lastServerId === serverId) return;
    lastServerId = serverId;
    Object.assign(cs, {
      serverId, seq: 0, lines: [], autoscroll: true, filter: '', history: [], historyIndex: -1,
    });
  }

  function activeServer() {
    const server = CD.currentServer();
    return server || null;
  }

  function isRunning(server) {
    const status = CD.statusOf(server);
    return status === 'running' || status === 'starting';
  }

  function lineHTML(line) {
    const stream = esc(line.stream || 'stdout');
    let text = esc(line.text || '');
    if (cs.filter) {
      const needle = esc(cs.filter);
      if (needle) {
        const pattern = new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        text = text.replace(pattern, '<mark>$1</mark>');
      }
    }
    return `<div class="line ${stream}"><span class="t">${esc(CD.fmtTime(line.t))}</span><span class="x">${text}</span></div>`;
  }

  function visibleLines() {
    if (!cs.filter) return cs.lines;
    const needle = cs.filter.toLocaleLowerCase('tr');
    return cs.lines.filter((line) => String(line.text || '').toLocaleLowerCase('tr').includes(needle));
  }

  function paintLog({ keepScroll = false } = {}) {
    const box = $('#consoleLog');
    if (!box) return;
    const lines = visibleLines();
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    box.innerHTML = lines.length
      ? lines.map(lineHTML).join('')
      : `<div class="empty">${cs.filter ? 'Filtreyle eşleşen satır yok.' : (cs.lines.length ? 'Görüntülenecek satır yok.' : 'Henüz konsol çıktısı yok. Sunucuyu başlatın.')}</div>`;
    if (cs.autoscroll && (!keepScroll || nearBottom)) box.scrollTop = box.scrollHeight;
  }

  function appendLines(lines) {
    if (!lines || !lines.length) return;
    cs.lines.push(...lines);
    if (cs.lines.length > MAX_LINES) cs.lines.splice(0, cs.lines.length - MAX_LINES);
    const box = $('#consoleLog');
    if (!box) return;
    const visible = cs.filter
      ? lines.filter((line) => String(line.text || '').toLocaleLowerCase('tr').includes(cs.filter.toLocaleLowerCase('tr')))
      : lines;
    if (!visible.length) return;
    const empty = box.querySelector('.empty');
    if (empty) empty.remove();
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    box.insertAdjacentHTML('beforeend', visible.map(lineHTML).join(''));
    while (box.childElementCount > MAX_LINES) box.firstElementChild.remove();
    if (cs.autoscroll && nearBottom) box.scrollTop = box.scrollHeight;
  }

  async function poll({ initial = false } = {}) {
    if (inflight || !state.currentId || state.tab !== 'console') return;
    const server = activeServer();
    if (!server) return;
    resetForServer(server.id);
    if (initial && cs.lines.length) {
      paintLog();
      return;
    }
    inflight = true;
    try {
      const limit = initial ? 800 : 1200;
      const data = await api(`/api/servers/${encodeURIComponent(server.id)}/console?since=${initial ? 0 : cs.seq}&limit=${limit}`);
      if (state.currentId !== server.id || state.tab !== 'console') return;
      const lines = data.lines || [];
      if (initial) {
        cs.lines = lines.slice(-MAX_LINES);
        cs.seq = Number(data.last_seq) || cs.lines.reduce((max, line) => Math.max(max, Number(line.seq) || 0), 0);
        paintLog();
      } else {
        cs.seq = Math.max(cs.seq, Number(data.last_seq) || 0);
        appendLines(lines);
      }
      updateStatusInline(server);
    } catch (err) {

    } finally {
      inflight = false;
    }
  }

  function updateStatusInline(server) {
    const node = $('#consoleStatus');
    if (!node) return;
    const status = CD.statusOf(server);
    node.innerHTML = `<span class="status-dot ${esc(status)}"></span><span>${esc(STATUS_LABEL[status] || CD.statusLabel(status))}</span><span class="dot-sep">·</span><span>${esc(cs.lines.length)} satır</span>`;
  }

  function rememberCommand(command) {
    if (!command) return;
    if (cs.history[cs.history.length - 1] !== command) cs.history.push(command);
    if (cs.history.length > 80) cs.history.shift();
    cs.historyIndex = cs.history.length;
  }

  function setHistory(delta) {
    if (!cs.history.length) return;
    cs.historyIndex = CD.clamp((cs.historyIndex == null ? cs.history.length : cs.historyIndex) + delta, 0, cs.history.length);
    const input = $('#consoleCommand');
    if (!input) return;
    input.value = cs.historyIndex >= cs.history.length ? '' : cs.history[cs.historyIndex];
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function bindInput() {
    const input = $('#consoleCommand');
    if (!input) return;
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowUp') { event.preventDefault(); setHistory(-1); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); setHistory(1); }
      else if (event.key === 'l' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        clearView();
      }
    });
  }

  function clearView() {
    cs.lines = [];
    const box = $('#consoleLog');
    if (box) box.innerHTML = '<div class="empty">Görünüm temizlendi. Yeni satırlar burada görünecek.</div>';
    toast('Konsol görünümü temizlendi', 'info');
  }

  function startTimer() {
    if (timer) return;
    timer = setInterval(() => {
      if (state.tab !== 'console' || !state.currentId) return;
      poll();
    }, POLL_MS);
  }

  function renderConsole() {
    const server = activeServer();
    const view = $('#view');
    if (!view) return;
    if (!server) {
      CD.setHTML(view, `<div class="empty-state">${icon('alert')}<h3>Sunucu seçilmedi</h3></div>`);
      return;
    }
    resetForServer(server.id);
    const status = CD.statusOf(server);
    const running = isRunning(server);
    const loader = CD.loaderMeta(server.loader);

    const html = `<div class="console-shell">
      <div class="page-head" style="margin-bottom:0">
        <div>
          <h2>${icon('terminal')} Canlı konsol</h2>
          <p>${esc(server.name)} · ${esc(loader.name || server.loader)} · MC ${esc(server.mc_version)} · Port ${esc(server.port)}</p>
        </div>
        <div class="actions">
          <button type="button" class="btn sm ghost" data-action="console-clear" title="Görünümü temizle (Ctrl+L)">${icon('eraser')} Temizle</button>
          <a class="btn sm ghost" href="/api/servers/${encodeURIComponent(server.id)}/console.txt?lines=5000" download>${icon('download')} Log indir</a>
        </div>
      </div>

      <div class="console-toolbar">
        <div class="search">
          ${icon('search')}
          <input class="input" id="consoleFilter" data-input="console-filter" value="${esc(cs.filter)}" placeholder="Konsolda filtrele…" autocomplete="off" spellcheck="false">
        </div>
        <label class="check" style="gap:6px;font-size:11.5px">
          <input type="checkbox" id="consoleAutoscroll" data-change="console-autoscroll" ${cs.autoscroll ? 'checked' : ''}>
          <span class="check-text">Otomatik kaydır</span>
        </label>
        <span class="spacer"></span>
        <span class="status-inline" id="consoleStatus"><span class="status-dot ${esc(status)}"></span><span>${esc(STATUS_LABEL[status] || CD.statusLabel(status))}</span><span class="dot-sep">·</span><span>${esc(cs.lines.length)} satır</span></span>
      </div>

      <div class="console-log" id="consoleLog" aria-live="polite" aria-label="Sunucu konsolu"></div>

      <form class="console-input-row" data-form="console-command" autocomplete="off">
        <span class="prompt">&gt;</span>
        <input class="input" id="consoleCommand" name="command" placeholder="${running ? 'Komut yazın (örn. list, say Merhaba, stop) — ↑/↓ geçmiş' : 'Sunucu çalışmıyorken komut gönderilemez'}" ${running ? '' : 'disabled'} autocomplete="off" spellcheck="false" maxlength="1000">
        <button type="submit" class="btn primary" ${running ? '' : 'disabled'}>${icon('send')} Gönder</button>
      </form>
    </div>`;

    CD.setHTML(view, html);
    bindInput();
    paintLog();
    poll({ initial: true });
    startTimer();
  }
  CD.renderConsole = renderConsole;

  CD.inputs['console-filter'] = (input) => {
    cs.filter = String(input.value || '');
    paintLog({ keepScroll: true });
    updateStatusInline(activeServer());
  };

  CD.changes['console-autoscroll'] = (input) => {
    cs.autoscroll = Boolean(input.checked);
    if (cs.autoscroll) {
      const box = $('#consoleLog');
      if (box) box.scrollTop = box.scrollHeight;
    }
  };

  CD.actions['console-clear'] = clearView;

  CD.forms['console-command'] = async (form) => {
    const input = $('#consoleCommand', form);
    if (!input || !state.currentId) return;
    const command = String(input.value || '').trim();
    if (!command) return;
    const server = activeServer();
    if (!server || !isRunning(server)) {
      toast('Sunucu çalışmıyor', 'warn', 'Komut göndermek için önce sunucuyu başlatın.');
      return;
    }
    input.value = '';
    rememberCommand(command);
    try {
      await api(`/api/servers/${encodeURIComponent(server.id)}/command`, { method: 'POST', body: { command } });
      input.focus();
      setTimeout(() => poll(), 120);
    } catch (err) {
      input.value = command;
      rememberCommand(command);
      showError(err);
    }
  };

  window.addEventListener('hashchange', () => {
    if (state.tab === 'console') {
      setTimeout(() => poll({ initial: true }), 60);
    }
  });
})();
