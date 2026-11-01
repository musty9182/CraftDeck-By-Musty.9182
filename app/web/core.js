(() => {
  'use strict';

  const CD = (window.CD = {});
  CD.version = '0.1.0';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  CD.$ = $;
  CD.$$ = $$;

  const ICON_PATHS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    terminal: '<path d="m5 7 5 5-5 5M13 17h6"/>',
    store: '<path d="M4 9h16l-1.2 11a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8L4 9Z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/>',
    box: '<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    settings: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h10M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
    upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    download: '<path d="M12 4v12m0 0 5-5m-5 5-5-5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
    restart: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
    power: '<path d="M12 3v9"/><path d="M6.4 6.4a8 8 0 1 0 11.2 0"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    alert: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><path d="M16 5a3 3 0 0 1 0 6M18 14a6 6 0 0 1 4 6"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
    puzzle: '<path d="M9 4a2 2 0 0 1 4 0v1h3a1 1 0 0 1 1 1v3h1a2 2 0 0 1 0 4h-1v3a1 1 0 0 1-1 1h-3v1a2 2 0 0 1-4 0v-1H6a1 1 0 0 1-1-1v-3H4a2 2 0 0 1 0-4h1V6a1 1 0 0 1 1-1h3V4Z"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m4 17 5-5 4 4 3-3 4 4"/>',
    sparkles: '<path d="m12 3 1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7L12 3Z"/><path d="M19 15l.9 2.4 2.1.6-2.1.9L19 21l-.9-2.1-2.1-.9 2.1-.6L19 15Z"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
    'chevron-left': '<path d="m14 6-6 6 6 6"/>',
    'chevron-right': '<path d="m10 6 6 6-6 6"/>',
    'chevron-down': '<path d="m6 10 6 6 6-6"/>',
    'arrow-right': '<path d="M4 12h16m0 0-6-6m6 6-6 6"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 .5l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7-.5l-2 2a5 5 0 0 0 7 7l1-1"/>',
    send: '<path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/>',
    eraser: '<path d="m7 21-4-4L17 3l4 4L7 21Z"/><path d="M9 9l8 8"/><path d="M3 21h10"/>',
    save: '<path d="M5 3h11l3 3v15H5V3Z"/><path d="M8 3v6h7V3M8 21v-7h8v7"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z"/>',
    package: '<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/>',
    server: '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
    coffee: '<path d="M4 8h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Z"/><path d="M16 9h2a2 2 0 0 1 0 4h-2M6 3v2M10 3v2M14 3v2"/>',
    spark: '<path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    wrench: '<path d="M14 7a4 4 0 0 1 5.6-3.6L16 7l1 1 3.6-3.6A4 4 0 0 1 15 9.6L7 17.6a2.8 2.8 0 1 1-4-4L11 5.6"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 3l3 3M14 6l3 3"/>',
    loader: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    activity: '<path d="M3 12h4l3-9 4 18 3-9h4"/>',
  };

  function icon(name, cls = '') {
    return `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
  }
  CD.icon = icon;
  CD.hasIcon = (name) => Boolean(ICON_PATHS[name]);

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  CD.esc = esc;

  function safeUrl(url) {
    const text = String(url || '').trim();
    return /^https?:\/\//i.test(text) ? text : '';
  }
  CD.safeUrl = safeUrl;

  const numberFmt = new Intl.NumberFormat('tr-TR');

  function fmtNum(value) {
    const n = Number(value);
    return Number.isFinite(n) ? numberFmt.format(n) : '0';
  }
  CD.fmtNum = fmtNum;

  function fmtCompact(value) {
    const n = Number(value) || 0;
    if (n >= 1e9) return `${(n / 1e9).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Mr`;
    if (n >= 1e6) return `${(n / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Mn`;
    if (n >= 1e3) return `${(n / 1e3).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} B`;
    return fmtNum(n);
  }
  CD.fmtCompact = fmtCompact;

  function fmtBytes(value) {
    const n = Number(value) || 0;
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = n / 1024;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
    return `${size.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} ${units[index]}`;
  }
  CD.fmtBytes = fmtBytes;

  function fmtDuration(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (days) return `${days} gün ${hours} sa`;
    if (hours) return `${hours} sa ${minutes} dk`;
    if (minutes) return `${minutes} dk ${secs} sn`;
    return `${secs} sn`;
  }
  CD.fmtDuration = fmtDuration;

  function fmtTime(unixSeconds) {
    const date = new Date((Number(unixSeconds) || 0) * 1000);
    return date.toLocaleTimeString('tr-TR', { hour12: false });
  }
  CD.fmtTime = fmtTime;

  function fmtDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  CD.fmtDate = fmtDate;

  function timeAgo(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diff < 60) return 'az önce';
    if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} sa önce`;
    return `${Math.floor(diff / 86400)} gün önce`;
  }
  CD.timeAgo = timeAgo;

  function debounce(fn, wait = 300) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }
  CD.debounce = debounce;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }
  CD.clamp = clamp;

  function basename(path) {
    return String(path || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
  }
  CD.basename = basename;

  function setHTML(el, html) {
    if (!el) return;
    if (el.__lastHTML === html) return;
    el.__lastHTML = html;
    el.innerHTML = html;
  }
  CD.setHTML = setHTML;

  CD.state = {
    app: null,
    servers: [],
    loaders: [],
    loaderMap: {},
    gameVersions: [],
    jobs: [],
    currentId: null,
    lastServer: '',
    tab: 'overview',
    detail: null,
    java: null,
    warnings: [],
    connected: null,
    seenJobs: new Map(),
    booted: false,
    closed: false,
  };

  CD.consoleState = { serverId: null, seq: 0, lines: [], autoscroll: true, filter: '', history: [], historyIndex: -1 };
  CD.tunnelState = { serverId: null, seq: 0, lines: [], data: null, loaded: false };
  CD.storeState = { initialized: false, serverId: null, query: '', type: '', loader: '', version: '', index: 'relevance', offset: 0, limit: 24, result: null, loading: false, error: '', requestSeq: 0 };
  CD.contentState = { loaded: false, loading: false, data: null, serverId: null };

  CD.actions = {};
  CD.forms = {};
  CD.changes = {};
  CD.inputs = {};

  class AppError extends Error {
    constructor(message, detail = '', extra = {}) {
      super(message);
      this.name = 'AppError';
      this.detail = detail;
      Object.assign(this, extra);
    }
  }
  CD.AppError = AppError;

  function setOffline(offline) {
    const banner = $('#offlineBanner');
    if (banner) banner.hidden = !offline;
    const changed = CD.state.connected !== !offline;
    CD.state.connected = !offline;
    if (changed && !offline && CD.state.booted) {

    }
  }
  CD.setOffline = setOffline;

  async function api(path, options = {}) {
    const opts = { method: options.method || 'GET', headers: { ...(options.headers || {}) }, cache: 'no-store' };
    if (options.body !== undefined) {
      if (options.body instanceof FormData) {
        opts.body = options.body;
      } else {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(options.body);
      }
    }
    let response;
    try {
      response = await fetch(path, opts);
    } catch (err) {
      setOffline(true);
      throw new AppError('CraftDeck arka ucuna ulaşılamıyor', 'Uygulama kapandıysa yeniden başlatın. Aksi halde birkaç saniye içinde tekrar denenecek.');
    }
    setOffline(false);
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!response.ok) {
      const message = (data && data.error) || `İstek başarısız (HTTP ${response.status})`;
      const detail = data && data.detail ? String(data.detail) : '';
      throw new AppError(message, detail);
    }
    return data;
  }
  CD.api = api;

  function showError(err) {
    const message = err && err.message ? err.message : String(err);
    const detail = err && err.detail ? String(err.detail) : '';
    toast(message, 'error', detail);
  }
  CD.showError = showError;

  function noteJob(job) {
    if (!job || !job.id) return;
    CD.state.seenJobs.set(job.id, job.status || 'queued');
  }
  CD.noteJob = noteJob;

  const TOAST_ICONS = { success: 'check', error: 'alert', warn: 'alert', info: 'info' };

  function toast(message, kind = 'info', detail = '', options = {}) {
    const root = $('#toasts');
    if (!root) return { update() {}, close() {} };
    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.innerHTML = `<div class="ti">${icon(TOAST_ICONS[kind] || 'info')}</div>
      <div class="tb"><div class="tt"></div><div class="td" hidden></div>${options.progress != null ? '<div class="progress"><span></span></div>' : ''}</div>
      <div class="tx">${icon('x')}</div>`;
    const titleEl = node.querySelector('.tt');
    const detailEl = node.querySelector('.td');
    const barEl = node.querySelector('.progress > span');
    titleEl.textContent = String(message);
    if (detail) { detailEl.hidden = false; detailEl.textContent = String(detail); }
    root.appendChild(node);
    while (root.children.length > 5) root.firstElementChild.remove();

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 190);
    };
    node.addEventListener('click', close);
    const timeout = options.timeout != null ? options.timeout : (kind === 'error' ? 10000 : 5200);
    let timer = timeout > 0 ? setTimeout(close, timeout) : null;

    return {
      node,
      close,
      clearTimer() { if (timer) clearTimeout(timer); timer = null; },
      update(nextMessage, nextDetail = '', progress = null) {
        if (nextMessage != null) titleEl.textContent = String(nextMessage);
        if (nextDetail) { detailEl.hidden = false; detailEl.textContent = String(nextDetail); }
        if (progress != null) {
          let bar = node.querySelector('.progress');
          if (!bar) {
            bar = document.createElement('div');
            bar.className = 'progress';
            bar.innerHTML = '<span></span>';
            node.querySelector('.tb').appendChild(bar);
          }
          bar.firstElementChild.style.width = `${clamp(progress, 0, 100)}%`;
        }
        if (timer) { clearTimeout(timer); timer = setTimeout(close, Math.max(4000, timeout)); }
      },
    };
  }
  CD.toast = toast;

  async function copyText(text, label = 'Adres') {
    const value = String(text || '').trim();
    if (!value) { toast('Kopyalanacak bir değer yok', 'warn'); return false; }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        const area = document.createElement('textarea');
        area.value = value;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      toast(`${label} kopyalandı`, 'success', value);
      return true;
    } catch (err) {
      toast('Panoya kopyalanamadı', 'error', 'Adresi elle seçip kopyalayabilirsiniz.');
      return false;
    }
  }
  CD.copyText = copyText;

  const modalStack = [];

  function openModal(options = {}) {
    const root = $('#modalRoot');
    if (!root) return null;
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal ${options.size || ''}" role="dialog" aria-modal="true" aria-label="${esc(options.title || 'Pencere')}">
      <div class="modal-head">
        <div><h2>${esc(options.title || '')}</h2>${options.subtitle ? `<p>${esc(options.subtitle)}</p>` : ''}</div>
        <button type="button" class="icon-btn" data-action="modal-close" aria-label="Kapat">${icon('x')}</button>
      </div>
      <div class="modal-body">${options.body || ''}</div>
      <div class="modal-foot"${options.footer === undefined ? ' hidden' : ''}>${options.footer || ''}</div>
    </div>`;
    root.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('open'));

    let closed = false;
    const handle = {
      el: wrap,
      body: wrap.querySelector('.modal-body'),
      foot: wrap.querySelector('.modal-foot'),
      close() {
        if (closed) return;
        closed = true;
        const index = modalStack.indexOf(handle);
        if (index >= 0) modalStack.splice(index, 1);
        wrap.classList.remove('open');
        setTimeout(() => wrap.remove(), 170);
        if (typeof options.onClose === 'function') options.onClose();
      },
      setFooter(html) {
        handle.foot.hidden = false;
        handle.foot.innerHTML = html;
      },
      setBody(html) { handle.body.innerHTML = html; },
    };
    wrap.__modal = handle;
    modalStack.push(handle);
    wrap.addEventListener('mousedown', (event) => { if (event.target === wrap) handle.close(); });
    if (typeof options.onMount === 'function') setTimeout(() => options.onMount(handle), 0);
    return handle;
  }
  CD.openModal = openModal;

  function closeTopModal() {
    const handle = modalStack[modalStack.length - 1];
    if (handle) handle.close();
  }
  CD.closeTopModal = closeTopModal;

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modalStack.length) {
      event.preventDefault();
      closeTopModal();
    }
  });

  function confirmDialog(options = {}) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value, modal) => {
        if (settled) return;
        settled = true;
        modal.close();
        resolve(value);
      };
      const requireText = options.requireText ? String(options.requireText) : '';
      const body = `${options.message ? `<div class="alert ${options.danger ? 'error' : 'info'}">${icon(options.danger ? 'alert' : 'info')}<div>${options.message}</div></div>` : ''}
        ${requireText ? `<div class="field" style="margin-top:14px"><label>Onaylamak için <strong>${esc(requireText)}</strong> yazın</label><input class="input" id="confirmText" autocomplete="off"></div>` : ''}`;
      const modal = openModal({
        title: options.title || 'Emin misiniz?',
        size: 'sm',
        body,
        footer: `<button type="button" class="btn ghost" data-action="confirm-cancel">${esc(options.cancelText || 'Vazgeç')}</button>
          <button type="button" class="btn ${options.danger ? 'danger' : 'primary'}" data-action="confirm-accept" ${requireText ? 'disabled' : ''}>${esc(options.confirmText || 'Onayla')}</button>`,
      });
      if (!modal) { resolve(false); return; }
      const input = $('#confirmText', modal.el);
      const accept = $('[data-action="confirm-accept"]', modal.el);
      if (input && accept) {
        input.addEventListener('input', () => { accept.disabled = input.value.trim() !== requireText; });
        setTimeout(() => input.focus(), 60);
      }
      $('[data-action="confirm-cancel"]', modal.el).addEventListener('click', () => finish(false, modal));
      accept.addEventListener('click', () => finish(true, modal));
      modal.el.addEventListener('click', (event) => {
        if (event.target === modal.el) finish(false, modal);
      });
      modal.el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !accept.disabled) { event.preventDefault(); finish(true, modal); }
      });
    });
  }
  CD.confirmDialog = confirmDialog;

  function currentServer() {
    const id = CD.state.currentId;
    if (!id) return null;
    const fromList = CD.state.servers.find((item) => item.id === id);
    if (fromList) return fromList;
    if (CD.state.detail && CD.state.detail.server && CD.state.detail.server.id === id) return CD.state.detail.server;
    return null;
  }
  CD.currentServer = currentServer;

  function mergeServer(server) {
    if (!server || !server.id) return;
    const index = CD.state.servers.findIndex((item) => item.id === server.id);
    if (index >= 0) CD.state.servers[index] = { ...CD.state.servers[index], ...server };
    else CD.state.servers.push(server);
  }
  CD.mergeServer = mergeServer;

  function loaderMeta(loaderId) {
    return CD.state.loaderMap[loaderId] || { id: loaderId, name: loaderId || '—', color: '#61748a' };
  }
  CD.loaderMeta = loaderMeta;

  const STATUS_LABELS = {
    idle: 'Hazır',
    installing: 'Kuruluyor',
    starting: 'Başlatılıyor',
    running: 'Çalışıyor',
    stopping: 'Durduruluyor',
    stopped: 'Durduruldu',
    crashed: 'Çöktü',
    error: 'Hata',
  };

  function statusLabel(status) {
    return STATUS_LABELS[status] || status || 'Bilinmiyor';
  }
  CD.statusLabel = statusLabel;

  function statusOf(server) {
    if (!server) return 'stopped';
    if (server.running) return 'running';
    return server.status || 'stopped';
  }
  CD.statusOf = statusOf;

  function serverAddress(server) {
    if (!server) return '';
    return String(server.address || (server.tunnel && server.tunnel.address) || '').trim();
  }
  CD.serverAddress = serverAddress;

  function recommendedJava(mcVersion) {
    const raw = String(mcVersion || '').trim();
    const numbers = raw.match(/\d+/g) || [];
    if (!numbers.length) return 21;
    if (raw.startsWith('1.') && numbers.length >= 2) {
      const minor = Number(numbers[1]);
      const patch = numbers.length >= 3 ? Number(numbers[2]) : 0;
      if (minor > 20 || (minor === 20 && patch >= 5)) return 21;
      if (minor >= 17) return 17;
      return 8;
    }
    const year = Number(numbers[0]);
    if (year >= 25) return 25;
    return 21;
  }
  CD.recommendedJava = recommendedJava;

  function javaRuntimes() {
    return (CD.state.java && CD.state.java.runtimes) || [];
  }
  CD.javaRuntimes = javaRuntimes;

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (reason && reason.name === 'AppError') {
      showError(reason);
      event.preventDefault();
    }
  });
})();
