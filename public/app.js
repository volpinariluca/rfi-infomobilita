const STORAGE_KEYS = {
  theme: 'rfi_theme',
  region: 'rfi_region',
  watchlist: 'rfi_watchlist',
  readIds: 'rfi_read_ids',
  notify: 'rfi_notify_enabled'
};

const QUICK_STATIONS = [
  'Bologna',
  'Modena',
  'Reggio Emilia',
  'Parma',
  'Piacenza',
  'Rimini',
  'Ravenna',
  'Ferrara',
  'Milano',
  'Firenze',
  'Roma'
];

const TRAIN_LABELS = {
  av: 'Frecce / AV',
  ic: 'Intercity',
  reg: 'Regionale'
};

const state = {
  region: localStorage.getItem(STORAGE_KEYS.region) || 'emilia_romagna',
  items: [],
  counts: { total: 0, updates: 0, notices: 0 },
  fetchedAt: null,
  fromCache: false,
  filters: {
    search: '',
    feedType: 'all',
    status: 'all',
    trainType: 'all',
    onlyWatchlist: false,
    onlyUnread: false
  },
  watchlist: loadJsonArray(STORAGE_KEYS.watchlist, ['Bologna', 'Milano']),
  readIds: new Set(loadJsonArray(STORAGE_KEYS.readIds, [])),
  knownIds: new Set(),
  notifyEnabled: localStorage.getItem(STORAGE_KEYS.notify) === '1',
  autoRefresh: true,
  countdownSec: 180,
  isLoading: false
};

const el = {
  regionSelect: document.getElementById('regionSelect'),
  lastSyncText: document.getElementById('lastSyncText'),
  errorBanner: document.getElementById('errorBanner'),
  refreshBtn: document.getElementById('refreshBtn'),
  refreshLabel: document.getElementById('refreshLabel'),
  themeBtn: document.getElementById('themeBtn'),
  themeIcon: document.getElementById('themeIcon'),
  notifyBtn: document.getElementById('notifyBtn'),
  watchlistBtn: document.getElementById('watchlistBtn'),
  watchlistCount: document.getElementById('watchlistCount'),
  searchInput: document.getElementById('searchInput'),
  searchKbd: document.getElementById('searchKbd'),
  clearSearchBtn: document.getElementById('clearSearchBtn'),
  stationChips: document.getElementById('stationChips'),
  onlyWatchlistBtn: document.getElementById('onlyWatchlistBtn'),
  onlyUnreadBtn: document.getElementById('onlyUnreadBtn'),
  markAllReadBtn: document.getElementById('markAllReadBtn'),
  resultsCountText: document.getElementById('resultsCountText'),
  autoRefreshCheckbox: document.getElementById('autoRefreshCheckbox'),
  countdownText: document.getElementById('countdownText'),
  feedList: document.getElementById('feedList'),
  countAll: document.getElementById('countAll'),
  countSuspended: document.getElementById('countSuspended'),
  countDelayed: document.getElementById('countDelayed'),
  countResolved: document.getElementById('countResolved'),
  countPlanned: document.getElementById('countPlanned'),
  drawerBackdrop: document.getElementById('drawerBackdrop'),
  detailDrawer: document.getElementById('detailDrawer'),
  closeDrawerBtn: document.getElementById('closeDrawerBtn'),
  drawerBadges: document.getElementById('drawerBadges'),
  drawerTitle: document.getElementById('drawerTitle'),
  drawerMeta: document.getElementById('drawerMeta'),
  drawerContent: document.getElementById('drawerContent'),
  drawerExternalLink: document.getElementById('drawerExternalLink'),
  watchlistModalBackdrop: document.getElementById('watchlistModalBackdrop'),
  watchlistModal: document.getElementById('watchlistModal'),
  closeWatchlistBtn: document.getElementById('closeWatchlistBtn'),
  watchlistForm: document.getElementById('watchlistForm'),
  watchlistInput: document.getElementById('watchlistInput'),
  watchlistItems: document.getElementById('watchlistItems'),
  vtMonitorBtn: document.getElementById('vtMonitorBtn'),
  vtActiveCount: document.getElementById('vtActiveCount'),
  vtModalBackdrop: document.getElementById('vtModalBackdrop'),
  vtModal: document.getElementById('vtModal'),
  closeVtModalBtn: document.getElementById('closeVtModalBtn'),
  vtRefreshBtn: document.getElementById('vtRefreshBtn'),
  vtRouteForm: document.getElementById('vtRouteForm'),
  vtOrigInput: document.getElementById('vtOrigInput'),
  vtDestInput: document.getElementById('vtDestInput'),
  vtSogliaInput: document.getElementById('vtSogliaInput'),
  vtRoutesList: document.getElementById('vtRoutesList'),
  vtLiveTrainsList: document.getElementById('vtLiveTrainsList'),
  vtDiscoveredList: document.getElementById('vtDiscoveredList'),
  appVersion: document.getElementById('appVersion')
};

function loadJsonArray(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function saveReadIds() {
  const arr = Array.from(state.readIds).slice(-300);
  localStorage.setItem(STORAGE_KEYS.readIds, JSON.stringify(arr));
}

function saveWatchlist() {
  localStorage.setItem(STORAGE_KEYS.watchlist, JSON.stringify(state.watchlist));
  el.watchlistCount.textContent = String(state.watchlist.length);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlightMatch(text, query) {
  const safe = escapeHtml(text);
  const q = query.trim();
  if (!q) return safe;
  const escapedQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(`(${escapedQ})`, 'gi'), '<mark>$1</mark>');
}

function formatItalianDate(isoDate) {
  if (!isoDate) return 'Data non disponibile';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return 'Data non disponibile';

  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const absMin = Math.round(Math.abs(diffMs) / 60000);

  const exact = d.toLocaleString('it-IT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  if (diffMs >= 0 && absMin < 60) {
    return `${absMin <= 1 ? 'ora' : `${absMin} min fa`} · ${exact}`;
  }
  if (diffMs >= 0 && absMin < 1440) {
    const hrs = Math.round(absMin / 60);
    return `${hrs} ${hrs === 1 ? 'ora' : 'ore'} fa · ${exact}`;
  }
  if (diffMs < 0) {
    return `Programmato · ${exact}`;
  }
  return exact;
}

function matchesWatchlist(item) {
  if (!state.watchlist.length) return false;
  const haystack = `${item.title} ${item.line} ${item.regions.join(' ')}`.toLowerCase();
  return state.watchlist.some((kw) => haystack.includes(kw.toLowerCase()));
}

function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEYS.theme);
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  el.themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
  localStorage.setItem(STORAGE_KEYS.theme, theme);
}

async function loadRegions() {
  try {
    const res = await fetch('/api/regions');
    const data = await res.json();
    if (Array.isArray(data.regions)) {
      el.regionSelect.innerHTML = data.regions
        .map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.label)}</option>`)
        .join('');
      el.regionSelect.value = state.region;
    }
  } catch {
    // Keep default Emilia-Romagna option
  }
}

async function loadFeeds(forceRefresh = false) {
  if (state.isLoading) return;
  state.isLoading = true;
  el.refreshBtn.querySelector('.refresh-spinner').classList.add('spinning');
  el.refreshLabel.textContent = 'Aggiorno…';

  try {
    const url = `/api/feeds?region=${encodeURIComponent(state.region)}${forceRefresh ? '&refresh=1' : ''}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Errore nel caricamento dei feed');
    }

    const previousCount = state.knownIds.size;
    const newCritical = [];
    for (const item of data.items || []) {
      if (previousCount > 0 && !state.knownIds.has(item.id)) {
        if (item.status === 'suspended' || item.status === 'strike' || matchesWatchlist(item)) {
          newCritical.push(item);
        }
      }
      state.knownIds.add(item.id);
    }

    if (newCritical.length > 0 && state.notifyEnabled && 'Notification' in window && Notification.permission === 'granted') {
      const first = newCritical[0];
      new Notification(`RFI Infomobilità (${data.regionLabel})`, {
        body: first.title,
        icon: '/icon.svg'
      });
    }

    state.items = data.items || [];
    state.counts = data.counts || { total: 0, updates: 0, notices: 0 };
    state.fetchedAt = data.fetchedAt;
    state.fromCache = Boolean(data.fromCache);
    state.countdownSec = data.cacheTtlSeconds || 180;

    if (data.errors && data.errors.length > 0) {
      el.errorBanner.textContent = `Attenzione: alcuni feed non hanno risposto (${data.errors.join('; ')})`;
      el.errorBanner.classList.remove('hidden');
    } else {
      el.errorBanner.classList.add('hidden');
    }

    const syncTime = new Date(data.fetchedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.lastSyncText.textContent = `${data.regionLabel} · Aggiornato alle ${syncTime}${data.fromCache ? ' (cache)' : ''}`;

    updateStatusCounts();
    renderFeeds();
  } catch (err) {
    el.errorBanner.textContent = `Impossibile recuperare i feed RFI: ${err.message}`;
    el.errorBanner.classList.remove('hidden');
  } finally {
    state.isLoading = false;
    el.refreshBtn.querySelector('.refresh-spinner').classList.remove('spinning');
    el.refreshLabel.textContent = 'Aggiorna';
  }
}

function updateStatusCounts() {
  const items = state.items;
  el.countAll.textContent = String(items.length);
  el.countSuspended.textContent = String(items.filter((i) => i.status === 'suspended' || i.status === 'strike').length);
  el.countDelayed.textContent = String(items.filter((i) => i.status === 'delayed').length);
  el.countResolved.textContent = String(items.filter((i) => i.status === 'resolved').length);
  el.countPlanned.textContent = String(items.filter((i) => i.status === 'planned').length);
}

function getFilteredItems() {
  const q = state.filters.search.trim().toLowerCase();
  return state.items.filter((item) => {
    if (state.filters.feedType !== 'all' && item.feedType !== state.filters.feedType) return false;

    if (state.filters.status !== 'all') {
      if (state.filters.status === 'suspended') {
        if (item.status !== 'suspended' && item.status !== 'strike') return false;
      } else if (item.status !== state.filters.status) {
        return false;
      }
    }

    if (state.filters.trainType !== 'all' && !item.trainTypes.includes(state.filters.trainType)) {
      return false;
    }

    if (state.filters.onlyWatchlist && !matchesWatchlist(item)) {
      return false;
    }

    if (state.filters.onlyUnread && state.readIds.has(item.id)) {
      return false;
    }

    if (q) {
      const text = `${item.title} ${item.line} ${item.cause || ''} ${item.regions.join(' ')}`.toLowerCase();
      const terms = q.split(/\s+/).filter(Boolean);
      if (!terms.every((t) => text.includes(t))) return false;
    }

    return true;
  });
}

function renderFeeds() {
  const filtered = getFilteredItems();
  el.resultsCountText.textContent = `${filtered.length} ${filtered.length === 1 ? 'risultato' : 'risultati'} su ${state.items.length} totali`;

  if (filtered.length === 0) {
    el.feedList.innerHTML = `
      <div class="empty-state">
        <h3>Nessuna comunicazione trovata</h3>
        <p>Prova a rimuovere qualche filtro o a cambiare i termini di ricerca.</p>
      </div>
    `;
    return;
  }

  const q = state.filters.search.trim();

  el.feedList.innerHTML = filtered
    .map((item) => {
      const isRead = state.readIds.has(item.id);
      const isWatch = matchesWatchlist(item);
      const trainBadges = item.trainTypes
        .map((t) => `<span class="badge badge-train-${t}">${escapeHtml(TRAIN_LABELS[t] || t)}</span>`)
        .join('');

      const feedLabel = item.feedType === 'updates' ? 'LIVE' : 'AVVISO';
      const regionsText = item.regions.length > 0 ? item.regions.slice(0, 4).join(', ') + (item.regions.length > 4 ? ` +${item.regions.length - 4}` : '') : '';

      return `
        <article class="feed-card status-${escapeHtml(item.status)} ${isRead ? 'is-read' : ''} ${isWatch ? 'is-watchlist' : ''}" data-id="${escapeHtml(item.id)}" tabindex="0">
          <div class="card-top">
            <div class="card-badges">
              ${!isRead ? '<span class="unread-dot" title="Non letto"></span>' : ''}
              <span class="badge badge-status-${escapeHtml(item.status)}">${escapeHtml(item.statusLabel)}</span>
              <span class="badge badge-feed-type">${feedLabel}</span>
              ${trainBadges}
              ${isWatch ? '<span class="badge badge-watchlist">★ Mia tratta</span>' : ''}
            </div>
            <span class="card-time">${escapeHtml(formatItalianDate(item.isoDate))}</span>
          </div>

          ${item.line ? `<p class="card-line">${highlightMatch(item.line, q)}</p>` : ''}
          <h2 class="card-title">${highlightMatch(item.title, q)}</h2>

          <div class="card-meta-row">
            <div class="card-tags">
              ${item.delayMinutes ? `<span class="meta-tag meta-tag-delay">Ritardi fino a ${item.delayMinutes} min</span>` : ''}
              ${item.eventTime ? `<span class="meta-tag">Dalle ore ${escapeHtml(item.eventTime)}</span>` : ''}
              ${item.cause ? `<span class="meta-tag">${escapeHtml(item.cause)}</span>` : ''}
              ${regionsText ? `<span class="meta-tag">${escapeHtml(regionsText)}</span>` : ''}
            </div>
            <span class="card-action-hint">Dettagli completo →</span>
          </div>
        </article>
      `;
    })
    .join('');
}

async function openDetailDrawer(itemId) {
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return;

  state.readIds.add(item.id);
  saveReadIds();
  renderFeeds();

  el.drawerBadges.innerHTML = `
    <span class="badge badge-status-${escapeHtml(item.status)}">${escapeHtml(item.statusLabel)}</span>
    ${item.trainTypes.map((t) => `<span class="badge badge-train-${t}">${escapeHtml(TRAIN_LABELS[t] || t)}</span>`).join('')}
  `;
  el.drawerTitle.textContent = item.title;
  el.drawerMeta.innerHTML = `
    <span class="meta-tag">${escapeHtml(formatItalianDate(item.isoDate))}</span>
    ${item.cause ? `<span class="meta-tag">${escapeHtml(item.cause)}</span>` : ''}
    ${item.regions.map((r) => `<span class="meta-tag">${escapeHtml(r)}</span>`).join('')}
  `;
  el.drawerExternalLink.href = item.link || '#';

  el.drawerContent.innerHTML = `
    <div class="skeleton-line" style="width: 90%"></div>
    <div class="skeleton-line" style="width: 75%"></div>
    <div class="skeleton-line" style="width: 85%"></div>
  `;

  el.drawerBackdrop.classList.remove('hidden');
  el.detailDrawer.classList.remove('hidden');

  if (!item.link) {
    el.drawerContent.innerHTML = '<p>Nessun collegamento di dettaglio disponibile nel feed.</p>';
    return;
  }

  try {
    const res = await fetch(`/api/article?url=${encodeURIComponent(item.link)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Errore nel caricamento');

    const parts = [];
    if (data.paragraphs && data.paragraphs.length > 0) {
      parts.push(data.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join(''));
    } else {
      parts.push('<p>Nessun testo aggiuntivo estratto dalla pagina. Usa il pulsante in basso per aprire la pagina ufficiale RFI.</p>');
    }

    if (data.tables && data.tables.length > 0) {
      for (const table of data.tables) {
        const rowsHtml = table
          .map((row, idx) => {
            const tag = idx === 0 ? 'th' : 'td';
            return `<tr>${row.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join('')}</tr>`;
          })
          .join('');
        parts.push(`<div class="drawer-table-wrap"><table class="drawer-table">${rowsHtml}</table></div>`);
      }
    }

    if (data.pdfLinks && data.pdfLinks.length > 0) {
      parts.push(
        `<div class="drawer-pdfs">${data.pdfLinks
          .map((pdf) => `<a class="btn btn-secondary" href="${escapeHtml(pdf.url)}" target="_blank" rel="noopener noreferrer">📄 ${escapeHtml(pdf.label)}</a>`)
          .join('')}</div>`
      );
    }

    el.drawerContent.innerHTML = parts.join('');
  } catch (err) {
    el.drawerContent.innerHTML = `<p>Impossibile caricare il dettaglio automatico (${escapeHtml(err.message)}). Puoi aprire direttamente la pagina ufficiale RFI qui sotto.</p>`;
  }
}

function closeDetailDrawer() {
  el.drawerBackdrop.classList.add('hidden');
  el.detailDrawer.classList.add('hidden');
}

function renderStationChips() {
  el.stationChips.innerHTML = QUICK_STATIONS.map((st) => {
    const active = state.filters.search.toLowerCase() === st.toLowerCase();
    return `<button type="button" class="station-chip ${active ? 'active' : ''}" data-station="${escapeHtml(st)}">${escapeHtml(st)}</button>`;
  }).join('');
}

function renderWatchlistModal() {
  el.watchlistCount.textContent = String(state.watchlist.length);
  if (state.watchlist.length === 0) {
    el.watchlistItems.innerHTML = '<li class="watchlist-item">Nessuna tratta salvata.</li>';
    return;
  }
  el.watchlistItems.innerHTML = state.watchlist
    .map(
      (kw, idx) => `
      <li class="watchlist-item">
        <span>★ ${escapeHtml(kw)}</span>
        <button type="button" class="watchlist-remove" data-remove-idx="${idx}" title="Rimuovi">✕</button>
      </li>
    `
    )
    .join('');
}

function bindEvents() {
  el.regionSelect.addEventListener('change', () => {
    state.region = el.regionSelect.value;
    localStorage.setItem(STORAGE_KEYS.region, state.region);
    state.knownIds.clear();
    loadFeeds(false);
  });

  el.refreshBtn.addEventListener('click', () => loadFeeds(true));

  el.themeBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  el.notifyBtn.setAttribute('aria-pressed', String(state.notifyEnabled));
  el.notifyBtn.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      alert('Il tuo browser non supporta le notifiche desktop.');
      return;
    }
    if (!state.notifyEnabled && Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return;
    }
    state.notifyEnabled = !state.notifyEnabled;
    localStorage.setItem(STORAGE_KEYS.notify, state.notifyEnabled ? '1' : '0');
    el.notifyBtn.setAttribute('aria-pressed', String(state.notifyEnabled));
  });

  // Search
  el.searchInput.addEventListener('input', () => {
    state.filters.search = el.searchInput.value;
    el.clearSearchBtn.classList.toggle('hidden', !state.filters.search);
    el.searchKbd.classList.toggle('hidden', Boolean(state.filters.search));
    renderStationChips();
    renderFeeds();
  });

  el.clearSearchBtn.addEventListener('click', () => {
    state.filters.search = '';
    el.searchInput.value = '';
    el.clearSearchBtn.classList.add('hidden');
    el.searchKbd.classList.remove('hidden');
    renderStationChips();
    renderFeeds();
  });

  // Status filter pills
  document.querySelectorAll('[data-status-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-status-filter]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.filters.status = btn.dataset.statusFilter;
      renderFeeds();
    });
  });

  // Feed type segmented control
  document.querySelectorAll('[data-feed-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-feed-filter]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.filters.feedType = btn.dataset.feedFilter;
      renderFeeds();
    });
  });

  // Train type chips
  document.querySelectorAll('[data-train-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-train-filter]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.filters.trainType = btn.dataset.trainFilter;
      renderFeeds();
    });
  });

  // Quick stations
  el.stationChips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-station]');
    if (!btn) return;
    const st = btn.dataset.station;
    const next = state.filters.search.toLowerCase() === st.toLowerCase() ? '' : st;
    state.filters.search = next;
    el.searchInput.value = next;
    el.clearSearchBtn.classList.toggle('hidden', !next);
    el.searchKbd.classList.toggle('hidden', Boolean(next));
    renderStationChips();
    renderFeeds();
  });

  // Watchlist & Unread toggles
  el.onlyWatchlistBtn.addEventListener('click', () => {
    state.filters.onlyWatchlist = !state.filters.onlyWatchlist;
    el.onlyWatchlistBtn.setAttribute('aria-pressed', String(state.filters.onlyWatchlist));
    renderFeeds();
  });

  el.onlyUnreadBtn.addEventListener('click', () => {
    state.filters.onlyUnread = !state.filters.onlyUnread;
    el.onlyUnreadBtn.setAttribute('aria-pressed', String(state.filters.onlyUnread));
    renderFeeds();
  });

  el.markAllReadBtn.addEventListener('click', () => {
    for (const item of state.items) {
      state.readIds.add(item.id);
    }
    saveReadIds();
    renderFeeds();
  });

  // Card clicks
  el.feedList.addEventListener('click', (e) => {
    const card = e.target.closest('.feed-card');
    if (card) openDetailDrawer(card.dataset.id);
  });

  el.feedList.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const card = e.target.closest('.feed-card');
      if (card) openDetailDrawer(card.dataset.id);
    }
  });

  // Drawer close
  el.closeDrawerBtn.addEventListener('click', closeDetailDrawer);
  el.drawerBackdrop.addEventListener('click', closeDetailDrawer);

  // Watchlist modal
  el.watchlistBtn.addEventListener('click', () => {
    renderWatchlistModal();
    el.watchlistModalBackdrop.classList.remove('hidden');
    el.watchlistModal.classList.remove('hidden');
    el.watchlistInput.focus();
  });

  const closeWatchlist = () => {
    el.watchlistModalBackdrop.classList.add('hidden');
    el.watchlistModal.classList.add('hidden');
  };
  el.closeWatchlistBtn.addEventListener('click', closeWatchlist);
  el.watchlistModalBackdrop.addEventListener('click', closeWatchlist);

  el.watchlistForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = el.watchlistInput.value.trim();
    if (!val) return;
    if (!state.watchlist.some((w) => w.toLowerCase() === val.toLowerCase())) {
      state.watchlist.push(val);
      saveWatchlist();
      renderWatchlistModal();
      renderFeeds();
    }
    el.watchlistInput.value = '';
  });

  el.watchlistItems.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-idx]');
    if (!btn) return;
    const idx = Number(btn.dataset.removeIdx);
    state.watchlist.splice(idx, 1);
    saveWatchlist();
    renderWatchlistModal();
    renderFeeds();
  });

  // Auto-refresh timer
  el.autoRefreshCheckbox.addEventListener('change', () => {
    state.autoRefresh = el.autoRefreshCheckbox.checked;
  });

  setInterval(() => {
    if (!state.autoRefresh) return;
    state.countdownSec = Math.max(0, state.countdownSec - 1);
    const m = Math.floor(state.countdownSec / 60);
    const s = String(state.countdownSec % 60).padStart(2, '0');
    el.countdownText.textContent = `${m}:${s}`;
    if (state.countdownSec === 0) {
      loadFeeds(true);
    }
  }, 1000);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== el.searchInput && document.activeElement !== el.watchlistInput) {
      e.preventDefault();
      el.searchInput.focus();
    } else if (e.key === 'Escape') {
      closeDetailDrawer();
      closeWatchlist();
      closeVtModal();
    }
  });

  // Viaggiatreno Tratte Live modal
  const closeVtModal = () => {
    el.vtModalBackdrop.classList.add('hidden');
    el.vtModal.classList.add('hidden');
  };

  el.vtMonitorBtn.addEventListener('click', async () => {
    el.vtModalBackdrop.classList.remove('hidden');
    el.vtModal.classList.remove('hidden');
    await loadTratte();
  });

  el.closeVtModalBtn.addEventListener('click', closeVtModal);
  el.vtModalBackdrop.addEventListener('click', closeVtModal);

  el.vtRefreshBtn.addEventListener('click', async () => {
    el.vtRefreshBtn.disabled = true;
    el.vtRefreshBtn.textContent = 'Aggiorno…';
    try {
      const res = await fetch('/api/tratte/refresh', { method: 'POST' });
      const data = await res.json();
      renderVtSnapshot(data);
      await loadFeeds(false);
    } finally {
      el.vtRefreshBtn.disabled = false;
      el.vtRefreshBtn.textContent = '↻ Aggiorna ora';
    }
  });

  el.vtRouteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const origine = el.vtOrigInput.value.trim();
    const destinazione = el.vtDestInput.value.trim();
    const soglia = Number(el.vtSogliaInput.value || 10);
    if (!origine || !destinazione) return;

    await fetch('/api/tratte', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origine, destinazione, soglia_ritardo_minuti: soglia })
    });
    el.vtOrigInput.value = '';
    el.vtDestInput.value = '';
    await loadTratte();
  });

  el.vtRoutesList.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-delete-route]');
    if (!btn) return;
    await fetch(`/api/tratte/${encodeURIComponent(btn.dataset.deleteRoute)}`, { method: 'DELETE' });
    await loadTratte();
  });
}

function renderVtSnapshot(data) {
  const routes = data.tratte || [];
  const liveTrains = data.liveTrains || [];
  el.vtActiveCount.textContent = String(liveTrains.length);

  if (routes.length === 0) {
    el.vtRoutesList.innerHTML = '<li class="watchlist-item">Nessuna tratta configurata.</li>';
  } else {
    el.vtRoutesList.innerHTML = routes
      .map((r) => {
        const cats = (r.categorie || []).join('/');
        const band = r.fascia_oraria ? `${r.fascia_oraria.inizio || '00:00'}–${r.fascia_oraria.fine || '24:00'}` : 'Tutto il giorno';
        return `
          <li class="watchlist-item">
            <span>🚄 ${escapeHtml(r.origine)} → ${escapeHtml(r.destinazione)} <small class="meta-tag">soglia ≥${r.soglia_ritardo_minuti}m · ${escapeHtml(cats)} · ${escapeHtml(band)}</small></span>
            <button type="button" class="watchlist-remove" data-delete-route="${escapeHtml(r.id)}" title="Rimuovi tratta">✕</button>
          </li>
        `;
      })
      .join('');
  }

  if (liveTrains.length === 0) {
    el.vtLiveTrainsList.innerHTML = '<p class="modal-desc">Nessun treno attivo nella finestra oraria corrente (partenza -15m / arrivo +60m).</p>';
  } else {
    el.vtLiveTrainsList.innerHTML = liveTrains
      .map((t) => {
        const delayClass = t.ritardo >= 15 || t.tipoTreno === 'ST' ? 'badge-status-suspended' : t.ritardo > 0 ? 'badge-status-delayed' : 'badge-status-resolved';
        const delayLabel = t.tipoTreno === 'ST' ? 'SOPPRESSO' : t.ritardo > 0 ? `+${t.ritardo} min` : t.ritardo < 0 ? `${t.ritardo} min` : 'In orario';
        return `
          <div class="vt-train-card">
            <div class="vt-train-top">
              <strong>${escapeHtml(t.categoria)} ${escapeHtml(t.numeroTreno)} · ${escapeHtml(t.origine)} → ${escapeHtml(t.destinazione)}</strong>
              <span class="badge ${delayClass}">${escapeHtml(delayLabel)}</span>
            </div>
            <div class="vt-train-meta">
              ${t.operatore ? `${escapeHtml(t.operatore)} · ` : ''}Ultimo ril.: ${escapeHtml(t.stazioneUltimoRilevamento || 'N/D')} · Tipo: ${escapeHtml(t.tipoTreno)}
            </div>
          </div>
        `;
      })
      .join('');
  }

  const discoveredMap = data.discoveredByRoute || {};
  const allDiscovered = [];
  for (const r of routes) {
    for (const t of discoveredMap[r.id] || []) {
      allDiscovered.push({ ...t, tratta: `${r.origine} → ${r.destinazione}` });
    }
  }
  allDiscovered.sort((a, b) => (a.orarioPartenza || 0) - (b.orarioPartenza || 0));

  if (allDiscovered.length === 0) {
    el.vtDiscoveredList.innerHTML = '<p class="modal-desc">Nessun treno individuato oggi sulle tratte configurate.</p>';
  } else {
    el.vtDiscoveredList.innerHTML = allDiscovered
      .map((t) => {
        const depTime = t.orarioPartenza
          ? new Date(t.orarioPartenza).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
          : '--:--';
        return `
          <div class="vt-train-card">
            <div class="vt-train-top">
              <strong>${escapeHtml(depTime)} · ${escapeHtml(t.categoria)} ${escapeHtml(t.numeroTreno)} (${escapeHtml(t.origineTreno)} → ${escapeHtml(t.destinazioneTreno)})</strong>
              <span class="meta-tag">${escapeHtml(t.operatore || 'Trenitalia')}</span>
            </div>
            <div class="vt-train-meta">${escapeHtml(t.tratta)}</div>
          </div>
        `;
      })
      .join('');
  }
}

async function loadTratte() {
  try {
    const res = await fetch('/api/tratte');
    if (!res.ok) return;
    const data = await res.json();
    renderVtSnapshot(data);
  } catch {
    // Non-blocking
  }
}

async function loadVersion() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return;
    const data = await res.json();
    if (data.version && el.appVersion) {
      el.appVersion.textContent = `v${data.version}`;
    }
  } catch {
    // Keep fallback version
  }
}

async function init() {
  initTheme();
  saveWatchlist();
  renderStationChips();
  bindEvents();
  await loadRegions();
  await Promise.all([loadFeeds(false), loadTratte(), loadVersion()]);
}

init();
