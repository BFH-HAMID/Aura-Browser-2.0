/**
 * Aura Browser 2.0 — free research, offline, and accessibility tools.
 *
 * Adds: offline reading library, privacy erase, workspaces/notes/citations,
 * advanced filters, engine selection, comparison, RSS, translation, local
 * documents, OCR, QR/barcode scanning, selected-text actions, concept-aware
 * saved-data search, accessibility, page metadata, archive lookup, and local
 * link safety signals. All saved data stays in this browser.
 */
'use strict';

(() => {
  const byId = (id) => document.getElementById(id);
  const all = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const now = () => new Date().toISOString();
  const shortDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
  };
  let noticeTimer;
  const notice = (message, ms = 2600) => {
    const toastEl = byId('toast');
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => toastEl.classList.add('hidden'), ms);
  };
  const requestPrimarySearch = () => document.dispatchEvent(new CustomEvent('aura:request-search'));
  const local = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
  };
  const makeId = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  async function copyText(value, success = 'Copied to clipboard') {
    try {
      await navigator.clipboard.writeText(value);
      notice(`⧉ ${success}`);
    } catch {
      const area = document.createElement('textarea');
      area.value = value;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      notice(`⧉ ${success}`);
    }
  }

  function downloadText(filename, content) {
    const blob = new Blob([String(content || '')], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  }

  function textFromHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    return (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /* ──────────────────────────────────────────────────────────────────────
   * IndexedDB — larger private local content: reader articles + documents.
   * ──────────────────────────────────────────────────────────────────── */
  const DB_NAME = 'aura-research-v1';
  let databasePromise = null;

  function openDatabase() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('This browser does not support private offline storage'));
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('library')) db.createObjectStore('library', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open local storage'));
    });
    return databasePromise;
  }

  async function databaseRequest(storeName, mode, action) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let request;
      try { request = action(store); } catch (error) { reject(error); return; }
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Local storage operation failed'));
    });
  }

  const dbAll = (store) => databaseRequest(store, 'readonly', (objectStore) => objectStore.getAll());
  const dbPut = (store, value) => databaseRequest(store, 'readwrite', (objectStore) => objectStore.put(value));
  const dbDelete = (store, id) => databaseRequest(store, 'readwrite', (objectStore) => objectStore.delete(id));

  async function clearResearchDatabase() {
    if (!('indexedDB' in window)) return;
    if (databasePromise) {
      const db = await databasePromise.catch(() => null);
      db?.close();
    }
    databasePromise = null;
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Advanced filters and SearXNG engine selection.
   * ──────────────────────────────────────────────────────────────────── */
  const FILTER_KEY = 'aura.research.filters';
  const ENGINE_CHOICES = [
    ['google', 'Google'], ['bing', 'Bing'], ['duckduckgo', 'DuckDuckGo'],
    ['wikipedia', 'Wikipedia'], ['github', 'GitHub'], ['stackoverflow', 'Stack Overflow'],
    ['arxiv', 'arXiv'], ['google news', 'Google News'],
  ];
  const savedFilters = local.get(FILTER_KEY, {});
  let filters = {
    timeRange: '',
    domain: '',
    excludeDomains: '',
    filetype: '',
    engines: [],
    ...(savedFilters && typeof savedFilters === 'object' ? savedFilters : {}),
  };
  filters.engines = Array.isArray(filters.engines) ? filters.engines : [];

  const cleanDomain = (value) => String(value || '').toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
    .replace(/[^a-z0-9.-]/g, '').slice(0, 120);
  const cleanFiletype = (value) => String(value || '').replace(/^\./, '').toLowerCase()
    .replace(/[^a-z0-9]/g, '').slice(0, 16);

  function persistFilters() {
    filters = {
      ...filters,
      domain: cleanDomain(filters.domain),
      filetype: cleanFiletype(filters.filetype),
      excludeDomains: String(filters.excludeDomains || '').split(',').map(cleanDomain).filter(Boolean).join(', '),
      engines: [...new Set(filters.engines || [])].slice(0, 12),
    };
    local.set(FILTER_KEY, filters);
  }

  // app.js requests these options immediately before calling /api/search.
  window.AuraResearch = {
    getSearchOptions(rawQuery) {
      const parts = [String(rawQuery || '').trim()];
      const alreadyHas = (name) => new RegExp(`(^|\\s)${name}:`, 'i').test(parts[0]);
      if (filters.domain && !alreadyHas('site')) parts.push(`site:${filters.domain}`);
      if (filters.filetype && !alreadyHas('filetype')) parts.push(`filetype:${filters.filetype}`);
      for (const domain of String(filters.excludeDomains || '').split(',').map(cleanDomain).filter(Boolean)) {
        parts.push(`-site:${domain}`);
      }
      return {
        query: parts.filter(Boolean).join(' '),
        timeRange: ['day', 'week', 'month', 'year'].includes(filters.timeRange) ? filters.timeRange : '',
        engines: (filters.engines || []).filter((engine) => ENGINE_CHOICES.some(([key]) => key === engine)),
      };
    },
  };

  function renderFilterControls() {
    const quick = byId('quick-chips');
    if (!quick || byId('aura-research-controls')) return;
    const controls = document.createElement('div');
    controls.id = 'aura-research-controls';
    controls.className = 'flex flex-wrap justify-center gap-2 mt-4 text-xs';
    controls.innerHTML = `
      <button id="toggle-advanced-filters" class="px-3 py-1.5 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-accent hover:text-accent transition-colors">🎛️ Filters & sources</button>
      <button id="open-compare" class="px-3 py-1.5 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-accent hover:text-accent transition-colors">⇆ Compare searches</button>
      <button id="open-research-hub" class="px-3 py-1.5 rounded-full bg-accent/10 text-accent border border-accent/25 hover:bg-accent/20 transition-colors">📚 Research tools</button>`;
    quick.insertAdjacentElement('afterend', controls);

    const panel = document.createElement('div');
    panel.id = 'advanced-filter-panel';
    panel.className = 'hidden mt-3 p-4 rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 text-left';
    panel.innerHTML = `
      <div class="flex items-center gap-2 mb-3"><span class="font-semibold text-sm">Advanced search</span><span class="text-[11px] text-slate-400">Applied locally before a SearXNG request</span></div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <label class="text-[11px] text-slate-500">Freshness
          <select id="filter-time-range" class="input-field mt-1"><option value="">Any time</option><option value="day">Past 24 hours</option><option value="week">Past week</option><option value="month">Past month</option><option value="year">Past year</option></select>
        </label>
        <label class="text-[11px] text-slate-500">Only this domain
          <input id="filter-domain" class="input-field mt-1" placeholder="example.com" value="${esc(filters.domain)}">
        </label>
        <label class="text-[11px] text-slate-500">Exclude domains
          <input id="filter-exclude-domains" class="input-field mt-1" placeholder="spam.com, ads.com" value="${esc(filters.excludeDomains)}">
        </label>
        <label class="text-[11px] text-slate-500">File type
          <input id="filter-filetype" class="input-field mt-1" placeholder="pdf" value="${esc(filters.filetype)}">
        </label>
      </div>
      <fieldset class="mt-3"><legend class="text-[11px] text-slate-500 mb-1.5">Preferred SearXNG engines <span class="text-slate-400">(leave empty for category defaults)</span></legend>
        <div class="flex flex-wrap gap-2">${ENGINE_CHOICES.map(([key, label]) => `<label class="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] cursor-pointer"><input class="filter-engine" type="checkbox" value="${esc(key)}" ${filters.engines.includes(key) ? 'checked' : ''}> ${esc(label)}</label>`).join('')}</div>
      </fieldset>
      <div class="mt-3 flex gap-2"><button id="apply-advanced-filters" class="btn-accent px-3 py-1.5 rounded-lg font-semibold">Apply & search</button><button id="clear-advanced-filters" class="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700">Clear filters</button></div>`;
    controls.insertAdjacentElement('afterend', panel);
    byId('filter-time-range').value = filters.timeRange || '';

    byId('toggle-advanced-filters').addEventListener('click', () => panel.classList.toggle('hidden'));
    const sync = () => {
      filters.timeRange = byId('filter-time-range').value;
      filters.domain = byId('filter-domain').value;
      filters.excludeDomains = byId('filter-exclude-domains').value;
      filters.filetype = byId('filter-filetype').value;
      filters.engines = all('.filter-engine:checked', panel).map((input) => input.value);
      persistFilters();
    };
    all('input, select', panel).forEach((input) => input.addEventListener('change', sync));
    byId('apply-advanced-filters').addEventListener('click', () => {
      sync();
      if (byId('search-input')?.value.trim()) requestPrimarySearch();
      else notice('Type a search query, then apply the filters');
    });
    byId('clear-advanced-filters').addEventListener('click', () => {
      filters = { timeRange: '', domain: '', excludeDomains: '', filetype: '', engines: [] };
      persistFilters();
      renderFilterControlsRefresh();
      notice('Advanced filters cleared');
    });
  }

  function renderFilterControlsRefresh() {
    const oldPanel = byId('advanced-filter-panel');
    const oldControls = byId('aura-research-controls');
    oldPanel?.remove();
    oldControls?.remove();
    renderFilterControls();
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Shared research modal, selection toolbar, and injected settings controls.
   * ──────────────────────────────────────────────────────────────────── */
  let scannerStream = null;
  let scannerTimer = null;
  let selectedText = '';

  function stopScanner() {
    if (scannerTimer) clearInterval(scannerTimer);
    scannerTimer = null;
    if (scannerStream) scannerStream.getTracks().forEach((track) => track.stop());
    scannerStream = null;
    const video = byId('scanner-video');
    if (video) {
      video.srcObject = null;
      video.classList.add('hidden');
    }
    byId('stop-camera-scan')?.classList.add('hidden');
    byId('start-camera-scan')?.classList.remove('hidden');
  }

  function ensureResearchUi() {
    if (byId('research-modal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="research-modal" class="hidden fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm p-3 md:p-8" role="dialog" aria-modal="true" aria-labelledby="research-modal-title">
        <div class="max-w-5xl mx-auto h-full max-h-[90vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
          <div class="flex items-center gap-3 px-5 py-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
            <span class="text-accent">📚</span><h2 id="research-modal-title" class="font-bold truncate">Research tools</h2>
            <button id="research-modal-close" class="ml-auto p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">✕</button>
          </div>
          <div id="research-modal-body" class="flex-1 overflow-y-auto p-4 md:p-6"></div>
        </div>
      </div>
      <div id="selection-tools" class="hidden fixed z-[80] rounded-xl bg-slate-900 text-white shadow-2xl p-1 gap-1 text-xs">
        <button data-selection-action="translate" class="px-2.5 py-1.5 rounded-lg hover:bg-white/15">🌐 Translate</button>
        <button data-selection-action="ask" class="px-2.5 py-1.5 rounded-lg hover:bg-white/15">✦ Ask Aura</button>
        <button data-selection-action="note" class="px-2.5 py-1.5 rounded-lg hover:bg-white/15">📝 Save note</button>
      </div>`);

    byId('research-modal-close').addEventListener('click', closeResearchModal);
    byId('research-modal').addEventListener('click', (event) => {
      if (event.target === byId('research-modal')) closeResearchModal();
    });
    byId('selection-tools').addEventListener('click', (event) => {
      const button = event.target.closest('[data-selection-action]');
      if (!button || !selectedText) return;
      hideSelectionTools();
      if (button.dataset.selectionAction === 'translate') openTranslation(selectedText);
      if (button.dataset.selectionAction === 'ask') askAuraAbout(selectedText);
      if (button.dataset.selectionAction === 'note') openNoteWorkspaceChooser(selectedText);
    });

    const settingsBody = byId('settings-modal')?.querySelector('.space-y-5');
    if (settingsBody && !byId('research-settings-section')) {
      const section = document.createElement('div');
      section.id = 'research-settings-section';
      section.className = 'border-t border-slate-100 dark:border-slate-800 pt-4';
      section.innerHTML = `
        <label class="font-semibold block mb-1.5">🛡️ Privacy, accessibility & offline data</label>
        <p class="text-xs text-slate-400 mb-3">Research workspaces, saved reader pages and local documents stay in this browser.</p>
        <div class="flex flex-wrap gap-2">
          <button id="open-accessibility-settings" class="px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-700 text-xs font-medium">♿ Accessibility & focus</button>
          <button id="panic-erase" class="px-3 py-1.5 rounded-xl bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-medium">🚨 Erase all Aura data</button>
        </div>`;
      settingsBody.insertBefore(section, settingsBody.lastElementChild);
      byId('open-accessibility-settings').addEventListener('click', () => {
        const settingsModal = byId('settings-modal');
        settingsModal?.classList.add('hidden');
        settingsModal?.classList.remove('modal-open');
        renderAccessibilityHub();
      });
      byId('panic-erase').addEventListener('click', panicErase);
    }
  }

  function showResearchModal(title, html) {
    ensureResearchUi();
    stopScanner();
    byId('research-modal-title').textContent = title;
    byId('research-modal-body').innerHTML = html;
    const modal = byId('research-modal');
    modal.classList.remove('hidden');
    modal.classList.add('modal-open');
    document.body.style.overflow = 'hidden';
  }

  function closeResearchModal() {
    stopScanner();
    const modal = byId('research-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('modal-open');
    // Keep background scrolling locked if Aura's reader/settings modal remains open.
    if (!document.querySelector('.modal-open')) document.body.style.overflow = '';
  }

  function hideSelectionTools() {
    byId('selection-tools')?.classList.add('hidden');
  }

  function initSelectionTools() {
    document.addEventListener('mouseup', (event) => {
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return hideSelectionTools();
      const selection = window.getSelection();
      const text = selection?.toString().trim() || '';
      const anchor = selection?.anchorNode?.parentElement;
      const usableArea = anchor?.closest?.('.prose-reader, .result-card, #research-modal-body');
      if (text.length < 4 || !usableArea) return hideSelectionTools();
      selectedText = text.slice(0, 3000);
      const toolbar = byId('selection-tools');
      const x = Math.min(window.innerWidth - 260, Math.max(8, event.clientX - 95));
      const y = Math.max(8, event.clientY - 48);
      toolbar.style.left = `${x}px`;
      toolbar.style.top = `${y}px`;
      toolbar.classList.remove('hidden');
      toolbar.classList.add('flex');
    });
    document.addEventListener('mousedown', (event) => {
      if (!event.target.closest('#selection-tools')) hideSelectionTools();
    });
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Result-level actions: library, workspaces, citation, metadata, archive,
   * translation, selected context, and explainable local link safety.
   * ──────────────────────────────────────────────────────────────────── */
  function safetyChip(safety) {
    const score = Number(safety?.score ?? 0);
    const level = safety?.level || 'caution';
    const style = level === 'low-risk'
      ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
      : level === 'high-risk'
        ? 'bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300'
        : 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300';
    const icon = level === 'low-risk' ? '🛡️' : level === 'high-risk' ? '⚠️' : '🔎';
    return `<button class="${style} px-2 py-1 rounded-lg font-medium" data-research-act="safety" title="Explain local URL safety/privacy signals">${icon} ${score}/100</button>`;
  }

  let latestResults = [];
  let lastSearchQuery = '';

  function decorateResults(results = latestResults) {
    all('#results .result-card').forEach((card) => {
      if (card.dataset.researchDecorated === '1') return;
      const result = results[Number(card.dataset.idx)];
      if (!result) return;
      card.dataset.researchDecorated = '1';
      const tools = document.createElement('div');
      tools.className = 'research-result-tools mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-1.5 text-[11px]';
      tools.innerHTML = `
        ${safetyChip(result.safety)}
        <button data-research-act="metadata" class="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:text-accent">ℹ️ Details</button>
        <button data-research-act="offline" class="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:text-accent">📥 Save offline</button>
        <button data-research-act="workspace" class="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:text-accent">📚 Workspace</button>
        <button data-research-act="cite" class="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:text-accent">❝ Cite</button>
        <button data-research-act="translate" class="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:text-accent">🌐 Translate</button>
        <button data-research-act="ask" class="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:text-accent">✦ Ask</button>
        <button data-research-act="archive" class="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:text-accent">🕰 Archive</button>`;
      card.appendChild(tools);
    });
  }

  function resultForAction(button) {
    const card = button.closest('.result-card');
    return card ? latestResults[Number(card.dataset.idx)] : null;
  }

  function initResultActions() {
    document.addEventListener('aura:results', (event) => {
      latestResults = Array.isArray(event.detail?.results) ? event.detail.results : [];
      lastSearchQuery = String(event.detail?.query || lastSearchQuery);
      decorateResults(latestResults);
    });
    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-research-act]');
      if (!button) return;
      const result = resultForAction(button);
      if (!result) return;
      event.preventDefault();
      event.stopPropagation();
      switch (button.dataset.researchAct) {
        case 'offline': saveOfflineResult(result); break;
        case 'workspace': openWorkspaceChooser(result); break;
        case 'cite': openCitation(result); break;
        case 'translate': openTranslation(`${result.title}\n\n${result.content || ''}`); break;
        case 'ask': askAuraAbout(`${result.title}\n\n${result.content || ''}`); break;
        case 'metadata': openMetadata(result); break;
        case 'archive': openArchive(result); break;
        case 'safety': openSafety(result); break;
        default: break;
      }
    });
  }

  async function storeOfflinePage(page, fallback = {}) {
    const url = page.url || fallback.url || '';
    if (!url) throw new Error('This page has no URL to save');
    const record = {
      id: `library:${url}`,
      type: 'article',
      title: page.title || fallback.title || 'Untitled page',
      url,
      canonicalUrl: page.canonicalUrl || url,
      domain: page.domain || fallback.domain || '',
      byline: page.byline || '',
      published: page.published || fallback.published || '',
      description: page.description || fallback.content || '',
      text: textFromHtml(page.contentHtml) || page.excerpt || fallback.content || '',
      wordCount: page.wordCount || 0,
      readingTimeMinutes: page.readingTimeMinutes || 0,
      savedAt: now(),
    };
    await dbPut('library', record);
    return record;
  }

  async function saveOfflineResult(result) {
    notice('📥 Preparing a clean offline reader copy…', 5000);
    try {
      const page = await fetchJson(`/api/fetch?url=${encodeURIComponent(result.url)}`);
      await storeOfflinePage(page, result);
      notice('✅ Saved to your private offline reading library');
    } catch (error) {
      notice(`⚠️ Could not save offline: ${error.message}`, 5000);
    }
  }

  function initReaderLibraryAction() {
    document.addEventListener('aura:reader', (event) => {
      const page = event.detail || {};
      const actionBar = byId('reader-open')?.parentElement;
      if (!actionBar || !page.url) return;
      byId('reader-translate-full')?.remove();
      byId('reader-save-offline')?.remove();
      const translateButton = document.createElement('button');
      translateButton.id = 'reader-translate-full';
      translateButton.className = 'p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800';
      translateButton.title = 'Translate this page excerpt';
      translateButton.setAttribute('aria-label', 'Translate this page excerpt');
      translateButton.textContent = '🌐';
      translateButton.addEventListener('click', () => {
        openTranslation(textFromHtml(page.contentHtml) || page.excerpt || page.title || '');
      });
      const saveButton = document.createElement('button');
      saveButton.id = 'reader-save-offline';
      saveButton.className = 'p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800';
      saveButton.title = 'Save to offline reading library';
      saveButton.setAttribute('aria-label', 'Save to offline reading library');
      saveButton.textContent = '📥';
      saveButton.addEventListener('click', async () => {
        try {
          await storeOfflinePage(page);
          notice('✅ Saved to your private offline reading library');
        } catch (error) {
          notice(`⚠️ Could not save offline: ${error.message}`, 5000);
        }
      });
      actionBar.insertBefore(translateButton, byId('reader-open'));
      actionBar.insertBefore(saveButton, byId('reader-open'));
    });
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Workspaces, research notes, citations, and concept-expanded search.
   * ──────────────────────────────────────────────────────────────────── */
  const WORKSPACES_KEY = 'aura.research.workspaces';
  const workspaces = () => {
    const items = local.get(WORKSPACES_KEY, []);
    return Array.isArray(items) ? items : [];
  };
  const saveWorkspaces = (items) => local.set(WORKSPACES_KEY, Array.isArray(items) ? items : []);

  function sourceItem(result, extras = {}) {
    return {
      id: makeId('source'),
      type: extras.type || 'source',
      title: extras.title || result.title || 'Untitled source',
      url: result.url || '',
      content: extras.content || result.content || '',
      domain: result.domain || '',
      addedAt: now(),
    };
  }

  function addToWorkspace(workspaceId, item) {
    const items = workspaces();
    const workspace = items.find((entry) => entry.id === workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    workspace.items = Array.isArray(workspace.items) ? workspace.items : [];
    const duplicate = item.url && workspace.items.some((entry) => entry.url === item.url && entry.type === item.type);
    if (!duplicate) workspace.items.unshift(item);
    workspace.updatedAt = now();
    saveWorkspaces(items);
    return workspace;
  }

  function createWorkspace(name) {
    const title = String(name || '').trim().slice(0, 80);
    if (!title) throw new Error('Give the workspace a name');
    const items = workspaces();
    const workspace = { id: makeId('workspace'), name: title, items: [], createdAt: now(), updatedAt: now() };
    items.unshift(workspace);
    saveWorkspaces(items);
    return workspace;
  }

  function hubNav(active) {
    const entries = [
      ['library', '📥 Library'], ['workspaces', '📚 Workspaces'], ['rss', '📰 RSS'],
      ['documents', '📄 Documents'], ['ocr', '🔤 OCR'], ['scanner', '▦ Scan'], ['accessibility', '♿ Access'],
    ];
    return `<nav class="flex flex-wrap gap-1.5 pb-4 mb-4 border-b border-slate-100 dark:border-slate-800">${entries.map(([key, label]) => `<button data-hub="${key}" class="px-2.5 py-1.5 rounded-lg text-xs font-medium ${key === active ? 'bg-accent/15 text-accent' : 'bg-slate-100 dark:bg-slate-800 hover:text-accent'}">${label}</button>`).join('')}</nav>`;
  }

  function wireHubNav() {
    all('[data-hub]', byId('research-modal-body')).forEach((button) => {
      button.addEventListener('click', () => openResearchHub(button.dataset.hub));
    });
  }

  function openResearchHub(section = 'library') {
    const renderers = {
      library: renderLibraryHub,
      workspaces: renderWorkspacesHub,
      rss: renderRssHub,
      documents: renderDocumentsHub,
      ocr: renderOcrHub,
      scanner: renderScannerHub,
      accessibility: renderAccessibilityHub,
    };
    (renderers[section] || renderLibraryHub)();
  }

  function openWorkspaceChooser(result, extra = {}) {
    const source = sourceItem(result, extra);
    const items = workspaces();
    showResearchModal('Add to research workspace', `
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-4">Save <b>${esc(source.title)}</b> with its URL and context on this device.</p>
      <div id="workspace-choice-list" class="space-y-2">${items.length ? items.map((workspace) => `<button data-workspace-id="${esc(workspace.id)}" class="w-full text-left p-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-accent/10 hover:text-accent"><b>${esc(workspace.name)}</b><span class="block text-[11px] text-slate-400 mt-0.5">${(workspace.items || []).length} saved item${(workspace.items || []).length === 1 ? '' : 's'}</span></button>`).join('') : '<p class="text-sm text-slate-400 py-3">Create your first workspace below.</p>'}</div>
      <div class="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex gap-2"><input id="new-workspace-name" class="input-field" placeholder="New workspace name"><button id="create-and-save-workspace" class="btn-accent px-3 py-2 rounded-xl font-semibold text-sm">Create & save</button></div>`);
    all('[data-workspace-id]', byId('workspace-choice-list')).forEach((button) => {
      button.addEventListener('click', () => {
        addToWorkspace(button.dataset.workspaceId, source);
        notice('✅ Added to workspace');
        closeResearchModal();
      });
    });
    byId('create-and-save-workspace').addEventListener('click', () => {
      try {
        const workspace = createWorkspace(byId('new-workspace-name').value);
        addToWorkspace(workspace.id, source);
        notice(`✅ Saved in “${workspace.name}”`);
        closeResearchModal();
      } catch (error) { notice(`⚠️ ${error.message}`); }
    });
  }

  function openNoteWorkspaceChooser(text) {
    const note = {
      title: String(text).replace(/\s+/g, ' ').trim().slice(0, 80) || 'Research note',
      content: String(text).trim(),
      url: '',
      domain: '',
    };
    openWorkspaceChooser(note, { type: 'note', content: note.content });
  }

  function renderWorkspacesHub() {
    const items = workspaces();
    showResearchModal('Research workspaces', `${hubNav('workspaces')}
      <div class="flex flex-col sm:flex-row gap-2 mb-4"><input id="workspace-name-input" class="input-field" placeholder="e.g. Climate research"><button id="create-workspace" class="btn-accent px-4 py-2 rounded-xl font-semibold text-sm shrink-0">+ New workspace</button></div>
      <div id="workspace-list" class="grid md:grid-cols-2 gap-3">${items.length ? items.map((workspace) => `<article class="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50"><div class="flex gap-2"><button data-open-workspace="${esc(workspace.id)}" class="flex-1 text-left"><h3 class="font-semibold hover:text-accent">${esc(workspace.name)}</h3><p class="mt-1 text-xs text-slate-400">${(workspace.items || []).length} notes and sources · updated ${shortDate(workspace.updatedAt || workspace.createdAt)}</p></button><button data-delete-workspace="${esc(workspace.id)}" class="text-slate-300 hover:text-rose-500 px-2" title="Delete workspace">🗑</button></div></article>`).join('') : '<p class="text-sm text-slate-400 py-8 md:col-span-2 text-center">No workspaces yet. Create one, then use the “Workspace” button on a result or saved note.</p>'}</div>`);
    wireHubNav();
    byId('create-workspace').addEventListener('click', () => {
      try { createWorkspace(byId('workspace-name-input').value); renderWorkspacesHub(); notice('📚 Workspace created'); } catch (error) { notice(`⚠️ ${error.message}`); }
    });
    all('[data-open-workspace]').forEach((button) => button.addEventListener('click', () => renderWorkspaceDetail(button.dataset.openWorkspace)));
    all('[data-delete-workspace]').forEach((button) => button.addEventListener('click', () => {
      if (!confirm('Delete this workspace and its local notes/sources?')) return;
      saveWorkspaces(workspaces().filter((workspace) => workspace.id !== button.dataset.deleteWorkspace));
      renderWorkspacesHub();
    }));
  }

  function renderWorkspaceDetail(id) {
    const workspace = workspaces().find((entry) => entry.id === id);
    if (!workspace) return renderWorkspacesHub();
    const entries = workspace.items || [];
    showResearchModal(workspace.name, `${hubNav('workspaces')}
      <div class="flex items-center gap-2 mb-4"><button id="back-to-workspaces" class="text-sm text-accent">← All workspaces</button><span class="text-xs text-slate-400">${entries.length} local item${entries.length === 1 ? '' : 's'}</span></div>
      <div class="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 mb-4"><label class="text-xs font-semibold">New research note</label><textarea id="workspace-note" class="input-field mt-2 min-h-24" placeholder="Write a private note…"></textarea><div class="mt-2 flex justify-end"><button id="save-workspace-note" class="btn-accent px-3 py-1.5 rounded-lg text-sm font-semibold">Save note</button></div></div>
      <div class="space-y-2">${entries.length ? entries.map((entry) => `<article class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60"><div class="flex gap-2"><div class="min-w-0 flex-1">${entry.url ? `<a href="${esc(entry.url)}" target="_blank" rel="noopener noreferrer" class="font-medium text-sm hover:text-accent">${esc(entry.title)}</a>` : `<h3 class="font-medium text-sm">📝 ${esc(entry.title)}</h3>`}<p class="mt-1 text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap">${esc(String(entry.content || '').slice(0, 700))}</p><p class="mt-1 text-[10px] text-slate-400">${entry.domain ? `${esc(entry.domain)} · ` : ''}${shortDate(entry.addedAt)}</p></div><button data-delete-workspace-item="${esc(entry.id)}" class="text-slate-300 hover:text-rose-500 px-1" title="Remove">✕</button></div></article>`).join('') : '<p class="text-center text-sm text-slate-400 py-8">No saved sources or notes in this workspace.</p>'}</div>`);
    wireHubNav();
    byId('back-to-workspaces').addEventListener('click', renderWorkspacesHub);
    byId('save-workspace-note').addEventListener('click', () => {
      const content = byId('workspace-note').value.trim();
      if (!content) return notice('Write a note first');
      addToWorkspace(id, sourceItem({ title: content.slice(0, 80), content }, { type: 'note', content }));
      renderWorkspaceDetail(id);
      notice('📝 Note saved locally');
    });
    all('[data-delete-workspace-item]').forEach((button) => button.addEventListener('click', () => {
      const list = workspaces();
      const target = list.find((entry) => entry.id === id);
      target.items = (target.items || []).filter((entry) => entry.id !== button.dataset.deleteWorkspaceItem);
      target.updatedAt = now();
      saveWorkspaces(list);
      renderWorkspaceDetail(id);
    }));
  }

  function citationDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function buildCitation(result, style) {
    const title = String(result.title || 'Untitled page').replace(/\s+/g, ' ').trim();
    const domain = result.domain || (() => { try { return new URL(result.url).hostname; } catch { return 'Web'; } })();
    const published = citationDate(result.published);
    const accessed = citationDate(now());
    if (style === 'mla') return `${domain}. “${title}.” ${domain}, ${published || 'n.d.'}, ${result.url}. Accessed ${accessed}.`;
    if (style === 'chicago') return `${domain}. “${title}.” Accessed ${accessed}. ${result.url}.`;
    return `${domain}. (${published ? new Date(result.published).getFullYear() : 'n.d.'}). ${title}. Retrieved ${accessed}, from ${result.url}`;
  }

  function openCitation(result) {
    showResearchModal('Citation generator', `<p class="text-sm text-slate-500 dark:text-slate-400 mb-3">Citation metadata is generated locally from the search result. Review it before academic use.</p>
      <label class="text-xs text-slate-500">Style <select id="citation-style" class="ml-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1"><option value="apa">APA</option><option value="mla">MLA</option><option value="chicago">Chicago</option></select></label>
      <textarea id="citation-output" readonly class="input-field mt-3 min-h-32"></textarea>
      <div class="mt-3 flex flex-wrap gap-2"><button id="copy-citation" class="btn-accent px-3 py-2 rounded-xl text-sm font-semibold">⧉ Copy citation</button><button id="download-citation" class="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-sm">⬇ Download .txt</button><button id="save-citation-workspace" class="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-sm">📚 Add to workspace</button></div>`);
    const output = byId('citation-output');
    const update = () => { output.value = buildCitation(result, byId('citation-style').value); };
    update();
    byId('citation-style').addEventListener('change', update);
    byId('copy-citation').addEventListener('click', () => copyText(output.value, 'Citation copied'));
    byId('download-citation').addEventListener('click', () => downloadText(`aura-citation-${Date.now()}.txt`, output.value));
    byId('save-citation-workspace').addEventListener('click', () => openWorkspaceChooser(result, { type: 'citation', content: output.value, title: `Citation: ${result.title}` }));
  }

  const CONCEPTS = [
    ['ai', ['ai', 'artificial', 'intelligence', 'machine', 'learning', 'llm', 'model']],
    ['privacy', ['privacy', 'security', 'secure', 'tracking', 'tracker', 'anonymous', 'encryption']],
    ['development', ['development', 'developer', 'programming', 'code', 'software', 'javascript', 'python']],
    ['research', ['research', 'study', 'paper', 'journal', 'science', 'scientific']],
    ['climate', ['climate', 'weather', 'warming', 'carbon', 'environment']],
  ];

  function tokens(value) {
    return [...new Set(String(value || '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])];
  }

  function expandedTokens(query) {
    const base = tokens(query);
    const result = new Set(base);
    for (const [, group] of CONCEPTS) {
      if (group.some((word) => base.includes(word))) group.forEach((word) => result.add(word));
    }
    return [...result];
  }

  function conceptScore(query, item) {
    const terms = expandedTokens(query);
    const haystack = `${item.title || ''} ${item.content || ''} ${item.text || ''} ${item.domain || ''} ${(item.tags || []).join(' ')}`.toLowerCase();
    const title = String(item.title || '').toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (title.includes(term)) score += 5;
      if (haystack.includes(term)) score += 2;
    }
    const phrase = String(query || '').trim().toLowerCase();
    if (phrase && haystack.includes(phrase)) score += 8;
    return score;
  }

  async function savedKnowledge() {
    const [articles, documents] = await Promise.all([dbAll('library').catch(() => []), dbAll('documents').catch(() => [])]);
    const bookmarks = local.get('aura.bookmarks', []);
    const bookmarkItems = (Array.isArray(bookmarks) ? bookmarks : []).map((bookmark) => ({ ...bookmark, type: 'bookmark', content: `${bookmark.url} ${(bookmark.tags || []).join(' ')}` }));
    const workspaceItems = workspaces().flatMap((workspace) => (workspace.items || []).map((item) => ({ ...item, type: item.type || 'workspace', workspace: workspace.name })));
    return [...bookmarkItems, ...workspaceItems, ...articles, ...documents];
  }

  async function searchSavedKnowledge(query, target) {
    const term = String(query || '').trim();
    if (term.length < 2) { target.innerHTML = ''; return; }
    target.innerHTML = '<p class="text-xs text-slate-400">Searching only this device…</p>';
    const hits = (await savedKnowledge())
      .map((item) => ({ item, score: conceptScore(term, item) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
    target.innerHTML = hits.length ? hits.map(({ item, score }) => `<article class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60"><div class="flex gap-2"><div class="min-w-0 flex-1"><b class="text-sm">${esc(item.title || item.name || 'Saved item')}</b><span class="ml-2 text-[10px] text-accent">${esc(item.workspace || item.type || 'saved')} · relevance ${score}</span>${item.url ? `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" class="block text-xs text-accent truncate mt-1">${esc(item.url)}</a>` : ''}<p class="text-xs text-slate-500 dark:text-slate-400 mt-1">${esc(String(item.content || item.text || '').replace(/\s+/g, ' ').slice(0, 280))}</p></div></div></article>`).join('') : '<p class="text-xs text-slate-400 py-3">No matching saved items. This concept-aware search never leaves your browser.</p>';
  }

  async function renderLibraryHub() {
    showResearchModal('Offline library & private search', `${hubNav('library')}<div class="animate-pulse text-sm text-slate-400">Loading saved reader pages…</div>`);
    wireHubNav();
    const articles = await dbAll('library').catch(() => []);
    const body = byId('research-modal-body');
    if (!body) return;
    body.innerHTML = `${hubNav('library')}
      <div class="rounded-2xl border border-accent/20 bg-accent/5 p-4 mb-4"><label class="font-semibold text-sm">🔎 Search all private saved knowledge</label><p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Bookmarks, workspace notes, offline pages and local documents are searched on-device.</p><input id="saved-knowledge-query" class="input-field mt-3" placeholder="Try: privacy, AI, climate, JavaScript…"><div id="saved-knowledge-results" class="mt-3 space-y-2"></div></div>
      <div class="flex items-center gap-2 mb-3"><h3 class="font-semibold">📥 Offline reader pages</h3><span class="text-xs text-slate-400">${articles.length} saved</span></div>
      <div class="space-y-2">${articles.length ? articles.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt))).map((article) => `<article class="p-3 rounded-xl border border-slate-200 dark:border-slate-700"><div class="flex gap-3"><div class="min-w-0 flex-1"><button data-open-library="${esc(article.id)}" class="text-left font-medium text-sm hover:text-accent">${esc(article.title)}</button><p class="text-xs text-slate-400 mt-1">${esc(article.domain || '')}${article.readingTimeMinutes ? ` · ${article.readingTimeMinutes} min read` : ''} · saved ${shortDate(article.savedAt)}</p><p class="text-xs text-slate-500 dark:text-slate-400 mt-1">${esc(article.description || article.text || '').slice(0, 180)}</p></div><button data-delete-library="${esc(article.id)}" class="text-slate-300 hover:text-rose-500 px-1" title="Remove">🗑</button></div></article>`).join('') : '<p class="text-sm text-slate-400 text-center py-8">Save a search result with “Save offline” to keep a clean reader copy in this browser.</p>'}</div>`;
    wireHubNav();
    byId('saved-knowledge-query').addEventListener('input', (event) => searchSavedKnowledge(event.target.value, byId('saved-knowledge-results')));
    all('[data-open-library]').forEach((button) => button.addEventListener('click', () => viewLibraryArticle(button.dataset.openLibrary)));
    all('[data-delete-library]').forEach((button) => button.addEventListener('click', async () => {
      await dbDelete('library', button.dataset.deleteLibrary);
      renderLibraryHub();
      notice('Offline copy removed');
    }));
  }

  async function viewLibraryArticle(id) {
    const record = (await dbAll('library').catch(() => [])).find((article) => article.id === id);
    if (!record) return renderLibraryHub();
    showResearchModal(record.title, `<div class="flex flex-wrap gap-2 text-xs mb-4"><button id="back-library" class="text-accent">← Library</button><button id="translate-library" class="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800">🌐 Translate</button><button id="ask-library" class="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800">✦ Ask Aura</button><button id="workspace-library" class="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800">📚 Add to workspace</button></div><div class="prose-reader max-w-none"><p class="text-xs text-slate-400">${esc(record.domain || '')}${record.byline ? ` · ${esc(record.byline)}` : ''}${record.readingTimeMinutes ? ` · ${record.readingTimeMinutes} min read` : ''}</p><h1>${esc(record.title)}</h1><p class="whitespace-pre-wrap">${esc(record.text || record.description || 'No saved text.')}</p></div>`);
    byId('back-library').addEventListener('click', renderLibraryHub);
    byId('translate-library').addEventListener('click', () => openTranslation((record.text || '').slice(0, 3000)));
    byId('ask-library').addEventListener('click', () => askAuraAbout((record.text || '').slice(0, 3000)));
    byId('workspace-library').addEventListener('click', () => openWorkspaceChooser(record, { content: record.description || record.text || '' }));
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Side-by-side comparison.
   * ──────────────────────────────────────────────────────────────────── */
  function languageSuffix(language) {
    const value = String(language || 'en');
    if (value.startsWith('bn')) return 'bn';
    if (value.startsWith('zh')) return 'zh';
    if (value.startsWith('pt')) return 'pt';
    return value.split('-')[0];
  }

  function currentSearchContext() {
    const language = byId('lang-select')?.value || local.get('aura.lang', 'en');
    const region = byId('region-select')?.value || local.get('aura.region', 'US');
    return {
      category: document.querySelector('.tab-btn.active')?.dataset.cat || 'all',
      language,
      region,
      safesearch: byId('safesearch-toggle')?.checked ?? local.get('aura.safesearch', true),
    };
  }

  function searchParamsFor(query) {
    const opts = window.AuraResearch.getSearchOptions(query);
    const context = currentSearchContext();
    const params = new URLSearchParams({
      q: opts.query,
      category: context.category,
      language: context.language,
      safesearch: context.safesearch ? '2' : '0',
    });
    if (context.region) params.set('region', `${context.region.toLowerCase()}-${languageSuffix(context.language)}`);
    if (opts.timeRange) params.set('time_range', opts.timeRange);
    if (opts.engines?.length) params.set('engines', opts.engines.join(','));
    return params;
  }

  function openCompare() {
    const query = byId('search-input')?.value.trim() || lastSearchQuery || '';
    showResearchModal('Compare searches', `<p class="text-sm text-slate-500 dark:text-slate-400 mb-4">Run two private meta-searches side by side. Current filters and engines apply to both.</p><div class="grid md:grid-cols-2 gap-3"><input id="compare-query-a" class="input-field" placeholder="First query" value="${esc(query)}"><input id="compare-query-b" class="input-field" placeholder="Second query"></div><button id="run-compare" class="btn-accent mt-3 px-4 py-2 rounded-xl font-semibold text-sm">⇆ Compare</button><div id="compare-results" class="grid md:grid-cols-2 gap-4 mt-5"></div>`);
    byId('run-compare').addEventListener('click', runComparison);
  }

  function compareColumn(label, result) {
    if (result.error) return `<section class="rounded-2xl border border-rose-200 dark:border-rose-500/30 p-4"><h3 class="font-semibold">${esc(label)}</h3><p class="text-sm text-rose-500 mt-3">${esc(result.error)}</p></section>`;
    return `<section class="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"><header class="p-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700"><h3 class="font-semibold text-sm truncate">${esc(label)}</h3><p class="text-[11px] text-slate-400 mt-1">${result.results?.length || 0} results · ${(result.engines || []).slice(0, 3).join(', ') || 'SearXNG'}</p></header><div class="divide-y divide-slate-100 dark:divide-slate-800">${(result.results || []).slice(0, 8).map((entry) => `<a href="${esc(entry.url)}" target="_blank" rel="noopener noreferrer" class="block p-3 hover:bg-accent/5"><b class="text-sm hover:text-accent">${esc(entry.title)}</b><span class="block text-[11px] text-slate-400 mt-1">${esc(entry.domain || '')}${entry.safety ? ` · ${entry.safety.score}/100 local safety` : ''}</span><p class="text-xs text-slate-500 dark:text-slate-400 mt-1">${esc(entry.content || '').slice(0, 180)}</p></a>`).join('') || '<p class="p-4 text-sm text-slate-400">No results.</p>'}</div></section>`;
  }

  async function runComparison() {
    const a = byId('compare-query-a').value.trim();
    const b = byId('compare-query-b').value.trim();
    if (!a || !b) return notice('Enter both queries to compare');
    const box = byId('compare-results');
    box.innerHTML = '<div class="md:col-span-2 text-center text-sm text-slate-400 py-8">🔍 Searching both queries…</div>';
    const searchOne = async (query) => {
      try { return await fetchJson(`/api/search?${searchParamsFor(query)}`); } catch (error) { return { error: error.message }; }
    };
    const [first, second] = await Promise.all([searchOne(a), searchOne(b)]);
    box.innerHTML = `${compareColumn(a, first)}${compareColumn(b, second)}`;
  }

  /* ──────────────────────────────────────────────────────────────────────
   * RSS/Atom reader and OPML import.
   * ──────────────────────────────────────────────────────────────────── */
  const RSS_KEY = 'aura.research.rss-feeds';
  const rssFeeds = () => {
    const feeds = local.get(RSS_KEY, []);
    return Array.isArray(feeds) ? feeds : [];
  };
  const saveRssFeeds = (feeds) => local.set(RSS_KEY, (Array.isArray(feeds) ? feeds : []).slice(0, 40));

  function rssFeedCard(feed) {
    const items = feed.cachedItems || [];
    return `<article class="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"><header class="p-3 bg-slate-50 dark:bg-slate-800/60 flex items-start gap-2"><div class="min-w-0 flex-1"><b class="text-sm block truncate">${esc(feed.title || feed.url)}</b><a href="${esc(feed.url)}" target="_blank" rel="noopener noreferrer" class="text-[11px] text-accent truncate block mt-0.5">${esc(feed.url)}</a></div><button data-refresh-rss="${esc(feed.id)}" class="p-1 hover:text-accent" title="Refresh">↻</button><button data-delete-rss="${esc(feed.id)}" class="p-1 text-slate-300 hover:text-rose-500" title="Remove">✕</button></header><div class="divide-y divide-slate-100 dark:divide-slate-800">${items.length ? items.slice(0, 12).map((item) => `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" class="block p-3 hover:bg-accent/5"><b class="text-sm leading-snug">${esc(item.title)}</b><span class="block text-[10px] text-slate-400 mt-1">${esc(item.author || '')}${item.published ? `${item.author ? ' · ' : ''}${esc(item.published)}` : ''}</span>${item.summary ? `<p class="mt-1 text-xs text-slate-500 dark:text-slate-400">${esc(item.summary).slice(0, 220)}</p>` : ''}</a>`).join('') : `<p class="p-4 text-xs text-slate-400">No cached items yet. Press refresh.</p>`}</div></article>`;
  }

  function renderRssHub() {
    const feeds = rssFeeds();
    showResearchModal('RSS & Atom reader', `${hubNav('rss')}<div class="rounded-2xl border border-accent/20 bg-accent/5 p-4 mb-4"><label class="font-semibold text-sm">Add a feed</label><p class="text-xs text-slate-500 dark:text-slate-400 mt-1">The feed URL is fetched through Aura’s privacy gateway. Feed entries are cached only in this browser.</p><div class="flex flex-col sm:flex-row gap-2 mt-3"><input id="rss-url" type="url" class="input-field" placeholder="https://example.com/feed.xml"><button id="add-rss" class="btn-accent px-4 py-2 rounded-xl text-sm font-semibold shrink-0">+ Add feed</button></div><div class="mt-3 flex flex-wrap gap-2"><label class="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-xs cursor-pointer">↥ Import OPML<input id="opml-file" class="hidden" type="file" accept=".opml,.xml,text/xml"></label><button id="refresh-all-rss" class="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-xs">↻ Refresh all</button></div></div><div id="rss-feed-list" class="grid lg:grid-cols-2 gap-4">${feeds.length ? feeds.map(rssFeedCard).join('') : '<p class="lg:col-span-2 text-center text-sm text-slate-400 py-8">Add an RSS/Atom URL or import an OPML file.</p>'}</div>`);
    wireHubNav();
    byId('add-rss').addEventListener('click', addRssFeed);
    byId('refresh-all-rss').addEventListener('click', () => refreshRssFeeds());
    byId('opml-file').addEventListener('change', importOpml);
    wireRssButtons();
  }

  function wireRssButtons() {
    all('[data-refresh-rss]').forEach((button) => button.addEventListener('click', () => refreshRssFeeds([button.dataset.refreshRss])));
    all('[data-delete-rss]').forEach((button) => button.addEventListener('click', () => {
      saveRssFeeds(rssFeeds().filter((feed) => feed.id !== button.dataset.deleteRss));
      renderRssHub();
      notice('Feed removed');
    }));
  }

  async function addRssFeed() {
    const url = byId('rss-url').value.trim();
    if (!/^https?:\/\//i.test(url)) return notice('Paste a valid http(s) feed URL');
    notice('📡 Fetching feed…', 5000);
    try {
      const data = await fetchJson(`/api/rss?url=${encodeURIComponent(url)}`);
      const feeds = rssFeeds();
      const existing = feeds.find((feed) => feed.url === url);
      const record = { id: existing?.id || makeId('rss'), url, title: data.title || url, cachedItems: data.items || [], updatedAt: now() };
      if (existing) Object.assign(existing, record); else feeds.unshift(record);
      saveRssFeeds(feeds);
      renderRssHub();
      notice(`✅ Added ${record.title}`);
    } catch (error) { notice(`⚠️ Could not add feed: ${error.message}`, 5000); }
  }

  async function refreshRssFeeds(onlyIds = null) {
    const feeds = rssFeeds();
    const targets = onlyIds ? feeds.filter((feed) => onlyIds.includes(feed.id)) : feeds;
    if (!targets.length) return notice('No feeds to refresh');
    const list = byId('rss-feed-list');
    if (list) list.insertAdjacentHTML('afterbegin', '<p id="rss-loading" class="lg:col-span-2 text-sm text-slate-400">↻ Refreshing feeds…</p>');
    await Promise.all(targets.map(async (feed) => {
      try {
        const data = await fetchJson(`/api/rss?url=${encodeURIComponent(feed.url)}`);
        feed.title = data.title || feed.title;
        feed.cachedItems = data.items || [];
        feed.updatedAt = now();
      } catch {
        // Keep last cached feed content available offline.
      }
    }));
    saveRssFeeds(feeds);
    renderRssHub();
    notice('↻ RSS feeds refreshed');
  }

  async function importOpml(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const xml = await file.text();
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      if (doc.querySelector('parsererror')) throw new Error('Invalid OPML/XML file');
      const urls = [...doc.querySelectorAll('outline[xmlUrl]')]
        .map((outline) => outline.getAttribute('xmlUrl') || '')
        .filter((url) => /^https?:\/\//i.test(url));
      if (!urls.length) throw new Error('No feed URLs found in this OPML file');
      const feeds = rssFeeds();
      for (const url of urls.slice(0, 30)) {
        if (!feeds.some((feed) => feed.url === url)) feeds.push({ id: makeId('rss'), url, title: url, cachedItems: [], updatedAt: '' });
      }
      saveRssFeeds(feeds);
      renderRssHub();
      notice(`✅ Imported ${urls.length} feed URL${urls.length === 1 ? '' : 's'}`);
    } catch (error) { notice(`⚠️ OPML import failed: ${error.message}`); }
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Translation + Ask Aura selected text shortcuts.
   * ──────────────────────────────────────────────────────────────────── */
  const TRANSLATION_LANGUAGES = [['en', 'English'], ['bn', 'বাংলা'], ['hi', 'हिन्दी'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['ar', 'العربية'], ['pt', 'Português'], ['ja', '日本語'], ['zh', '中文']];
  const languageOptions = (selected) => TRANSLATION_LANGUAGES.map(([code, label]) => `<option value="${code}" ${code === selected ? 'selected' : ''}>${label}</option>`).join('');

  function likelyBangla(text) { return /[\u0980-\u09ff]/.test(text); }

  function openTranslation(initialText = '') {
    const source = likelyBangla(initialText) ? 'bn' : 'en';
    const target = source === 'bn' ? 'en' : 'bn';
    showResearchModal('Translate text', `<p class="text-xs text-slate-500 dark:text-slate-400 mb-3">For privacy, use a self-hosted LibreTranslate server if you configure one. Otherwise Aura uses a keyless public translation endpoint; text is not saved by Aura.</p><div class="grid grid-cols-[1fr_auto_1fr] gap-2 items-end"><label class="text-xs text-slate-500">From<select id="translate-source" class="input-field mt-1">${languageOptions(source)}</select></label><button id="swap-translation" class="mb-1.5 p-2 rounded-lg bg-slate-200 dark:bg-slate-700" title="Swap languages">⇄</button><label class="text-xs text-slate-500">To<select id="translate-target" class="input-field mt-1">${languageOptions(target)}</select></label></div><textarea id="translate-input" class="input-field mt-3 min-h-32" maxlength="3000" placeholder="Paste or select up to 3,000 characters…"></textarea><div class="mt-2 flex justify-between gap-2"><span id="translate-count" class="text-[11px] text-slate-400">0 / 3000</span><button id="run-translation" class="btn-accent px-4 py-2 rounded-xl font-semibold text-sm">Translate</button></div><div class="mt-4"><label class="text-xs font-semibold">Translation</label><div id="translation-output" class="mt-1 p-3 min-h-20 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-sm whitespace-pre-wrap text-slate-600 dark:text-slate-300"></div><div class="mt-2 flex gap-2"><button id="copy-translation" class="hidden px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-xs">⧉ Copy</button><button id="ask-translation" class="hidden px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-xs">✦ Ask Aura</button></div></div>`);
    const input = byId('translate-input');
    input.value = String(initialText || '').slice(0, 3000);
    const updateCount = () => { byId('translate-count').textContent = `${input.value.length} / 3000`; };
    updateCount();
    input.addEventListener('input', updateCount);
    byId('swap-translation').addEventListener('click', () => {
      const from = byId('translate-source');
      const to = byId('translate-target');
      [from.value, to.value] = [to.value, from.value];
    });
    byId('run-translation').addEventListener('click', async () => {
      const text = input.value.trim();
      if (!text) return notice('Add text to translate');
      const output = byId('translation-output');
      output.textContent = 'Translating…';
      try {
        const data = await fetchJson('/api/translate', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, source: byId('translate-source').value, target: byId('translate-target').value }),
        });
        output.textContent = data.translatedText || '';
        byId('copy-translation').classList.remove('hidden');
        byId('ask-translation').classList.remove('hidden');
        byId('copy-translation').onclick = () => copyText(data.translatedText || '', 'Translation copied');
        byId('ask-translation').onclick = () => askAuraAbout(data.translatedText || '');
      } catch (error) { output.textContent = `Translation unavailable: ${error.message}`; }
    });
  }

  function askAuraAbout(text) {
    const excerpt = String(text || '').trim().slice(0, 3000);
    if (!excerpt) return notice('Select or provide some text first');
    if (!byId('chat-input')) return notice('Aura chat is unavailable');
    closeResearchModal();
    document.dispatchEvent(new CustomEvent('aura:ask-text', { detail: { text: excerpt } }));
    notice('✦ Sent selected text to Aura chat');
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Local document search (PDF/TXT/MD/CSV/JSON/HTML) — browser only.
   * ──────────────────────────────────────────────────────────────────── */
  let pdfjsPromise = null;
  async function pdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import('/vendor/pdfjs/pdf.min.mjs').then((module) => {
        module.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
        return module;
      });
    }
    return pdfjsPromise;
  }

  async function readPdf(file) {
    const lib = await pdfjs();
    const loadingTask = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const documentPdf = await loadingTask.promise;
    const pages = [];
    for (let pageNo = 1; pageNo <= Math.min(documentPdf.numPages, 100); pageNo++) {
      const page = await documentPdf.getPage(pageNo);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str || '').join(' '));
    }
    return pages.join('\n\n').replace(/\s+/g, ' ').trim();
  }

  async function readLocalDocument(file) {
    const name = file.name.toLowerCase();
    if (file.size > 18 * 1024 * 1024) throw new Error('Files are limited to 18 MB for local parsing');
    if (file.type === 'application/pdf' || name.endsWith('.pdf')) return readPdf(file);
    const raw = await file.text();
    if (name.endsWith('.html') || name.endsWith('.htm') || file.type.includes('html')) return textFromHtml(raw);
    if (name.endsWith('.json')) {
      try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
    }
    return raw;
  }

  async function renderDocumentsHub() {
    showResearchModal('Local document search', `${hubNav('documents')}<div class="animate-pulse text-sm text-slate-400">Opening your local document library…</div>`);
    wireHubNav();
    const documents = await dbAll('documents').catch(() => []);
    const body = byId('research-modal-body');
    if (!body) return;
    body.innerHTML = `${hubNav('documents')}<div class="rounded-2xl border border-accent/20 bg-accent/5 p-4 mb-4"><label class="font-semibold text-sm">📄 Add local documents</label><p class="text-xs text-slate-500 dark:text-slate-400 mt-1">PDF, TXT, Markdown, CSV, JSON and HTML are parsed in this browser only. The original file is not uploaded.</p><label class="inline-flex mt-3 cursor-pointer btn-accent px-4 py-2 rounded-xl text-sm font-semibold">Choose files<input id="local-document-input" class="hidden" type="file" multiple accept=".pdf,.txt,.md,.markdown,.csv,.json,.html,.htm,text/plain,text/csv,application/pdf,application/json,text/html"></label><div id="document-import-status" class="text-xs text-slate-400 mt-2"></div></div><div class="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 mb-4"><label class="font-semibold text-sm">🔎 Search local documents</label><input id="document-query" class="input-field mt-2" placeholder="Search by word or related concept…"><div id="document-search-results" class="mt-3 space-y-2"></div></div><div class="flex items-center gap-2 mb-3"><h3 class="font-semibold">Your local documents</h3><span class="text-xs text-slate-400">${documents.length} saved</span></div><div id="document-list" class="space-y-2">${documents.length ? documents.sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt))).map((documentItem) => `<article class="p-3 rounded-xl border border-slate-200 dark:border-slate-700 flex gap-3"><div class="min-w-0 flex-1"><b class="text-sm">${esc(documentItem.name)}</b><p class="text-xs text-slate-400 mt-1">${esc(documentItem.kind || 'document')} · ${documentItem.wordCount || 0} words · imported ${shortDate(documentItem.importedAt)}</p><p class="text-xs text-slate-500 dark:text-slate-400 mt-1">${esc(documentItem.text || '').slice(0, 220)}</p></div><button data-delete-document="${esc(documentItem.id)}" class="text-slate-300 hover:text-rose-500 px-1" title="Remove">🗑</button></article>`).join('') : '<p class="text-center text-sm text-slate-400 py-8">No documents have been added yet.</p>'}</div>`;
    wireHubNav();
    byId('local-document-input').addEventListener('change', importDocuments);
    byId('document-query').addEventListener('input', (event) => searchDocuments(event.target.value));
    all('[data-delete-document]').forEach((button) => button.addEventListener('click', async () => {
      await dbDelete('documents', button.dataset.deleteDocument);
      renderDocumentsHub();
      notice('Document removed');
    }));
  }

  async function importDocuments(event) {
    const files = [...(event.target.files || [])];
    if (!files.length) return;
    const status = byId('document-import-status');
    let imported = 0;
    for (const file of files.slice(0, 10)) {
      status.textContent = `Parsing ${file.name}…`;
      try {
        const text = (await readLocalDocument(file)).slice(0, 2_000_000);
        if (!text.trim()) throw new Error('No selectable text was found');
        await dbPut('documents', {
          id: `document:${file.name}:${file.size}:${file.lastModified}`,
          type: 'document',
          name: file.name,
          title: file.name,
          kind: file.type || file.name.split('.').pop() || 'document',
          text,
          content: text,
          wordCount: text.split(/\s+/).filter(Boolean).length,
          importedAt: now(),
        });
        imported++;
      } catch (error) {
        notice(`⚠️ ${file.name}: ${error.message}`, 5000);
      }
    }
    status.textContent = imported ? `✅ Imported ${imported} local document${imported === 1 ? '' : 's'}` : 'No documents were imported.';
    setTimeout(renderDocumentsHub, 700);
  }

  async function searchDocuments(query) {
    const output = byId('document-search-results');
    const text = String(query || '').trim();
    if (text.length < 2) { output.innerHTML = ''; return; }
    const documents = await dbAll('documents').catch(() => []);
    const hits = documents.map((documentItem) => ({ documentItem, score: conceptScore(text, documentItem) }))
      .filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 15);
    output.innerHTML = hits.length ? hits.map(({ documentItem, score }) => `<article class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60"><b class="text-sm">${esc(documentItem.name)}</b><span class="ml-2 text-[10px] text-accent">relevance ${score}</span><p class="mt-1 text-xs text-slate-500 dark:text-slate-400">${esc(documentItem.text || '').slice(0, 400)}</p></article>`).join('') : '<p class="text-xs text-slate-400">No matching local document text.</p>';
  }

  /* ──────────────────────────────────────────────────────────────────────
   * OCR (self-hosted Tesseract) and native QR/barcode scanning.
   * ──────────────────────────────────────────────────────────────────── */
  function renderOcrHub() {
    showResearchModal('Image OCR', `${hubNav('ocr')}<div class="rounded-2xl border border-accent/20 bg-accent/5 p-4"><h3 class="font-semibold">🔤 Extract text from an image</h3><p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Tesseract runs on this Aura server with bundled English/Bengali models. The image is processed in memory and is not stored.</p><div class="flex flex-col sm:flex-row gap-3 mt-4"><label class="flex-1 cursor-pointer"><span class="block text-xs text-slate-500 mb-1">Image</span><span class="block input-field">Choose image…<input id="ocr-image" class="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></span></label><label class="sm:w-40 text-xs text-slate-500">Language<select id="ocr-language" class="input-field mt-1"><option value="eng">English</option><option value="ben">বাংলা</option></select></label><button id="run-ocr" class="btn-accent px-4 py-2 rounded-xl font-semibold text-sm self-end">Extract text</button></div><div id="ocr-file-name" class="text-[11px] text-slate-400 mt-2"></div></div><div class="mt-4"><div class="flex items-center gap-2"><h3 class="font-semibold text-sm">OCR result</h3><span id="ocr-confidence" class="text-[11px] text-slate-400"></span></div><pre id="ocr-output" class="mt-2 whitespace-pre-wrap min-h-36 max-h-80 overflow-y-auto p-4 rounded-2xl bg-slate-950 text-slate-100 text-sm font-sans"></pre><div id="ocr-actions" class="hidden mt-3 flex flex-wrap gap-2"><button data-ocr-action="copy" class="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-xs">⧉ Copy</button><button data-ocr-action="translate" class="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-xs">🌐 Translate</button><button data-ocr-action="ask" class="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-xs">✦ Ask Aura</button><button data-ocr-action="note" class="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-xs">📝 Save note</button></div></div>`);
    wireHubNav();
    byId('ocr-image').addEventListener('change', () => {
      const file = byId('ocr-image').files?.[0];
      byId('ocr-file-name').textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : '';
    });
    byId('run-ocr').addEventListener('click', runOcr);
    all('[data-ocr-action]').forEach((button) => button.addEventListener('click', () => {
      const text = byId('ocr-output').textContent.trim();
      if (!text) return;
      if (button.dataset.ocrAction === 'copy') copyText(text, 'OCR text copied');
      if (button.dataset.ocrAction === 'translate') openTranslation(text);
      if (button.dataset.ocrAction === 'ask') askAuraAbout(text);
      if (button.dataset.ocrAction === 'note') openNoteWorkspaceChooser(text);
    }));
  }

  async function runOcr() {
    const file = byId('ocr-image').files?.[0];
    if (!file) return notice('Choose an image first');
    if (file.size > 8 * 1024 * 1024) return notice('OCR images are limited to 8 MB');
    const output = byId('ocr-output');
    output.textContent = 'Preparing private OCR worker… this may take a moment on first use.';
    byId('ocr-actions').classList.add('hidden');
    const form = new FormData();
    form.append('image', file);
    form.append('language', byId('ocr-language').value);
    try {
      const data = await fetchJson('/api/ocr', { method: 'POST', body: form });
      output.textContent = data.text || '(No text detected. Try a clearer, higher-resolution image.)';
      byId('ocr-confidence').textContent = Number.isFinite(data.confidence) ? `${data.confidence}% confidence` : '';
      if (data.text) byId('ocr-actions').classList.remove('hidden');
    } catch (error) {
      output.textContent = `OCR unavailable: ${error.message}`;
    }
  }

  function scannerResult(codes) {
    const box = byId('scanner-result');
    if (!box || !codes?.length) return;
    const code = codes[0];
    const raw = String(code.rawValue || '');
    const safeUrl = /^https?:\/\//i.test(raw);
    box.innerHTML = `<div class="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"><b>✅ ${esc(code.format || 'Code')} detected</b><p class="mt-1 break-all text-sm">${esc(raw)}</p><div class="mt-2 flex gap-2"><button id="copy-scanned-code" class="px-2 py-1 rounded bg-white/80 dark:bg-slate-800 text-xs">⧉ Copy</button>${safeUrl ? `<a href="${esc(raw)}" target="_blank" rel="noopener noreferrer" class="px-2 py-1 rounded bg-white/80 dark:bg-slate-800 text-xs">Open ↗</a>` : ''}</div></div>`;
    byId('copy-scanned-code').addEventListener('click', () => copyText(raw, 'Scanned code copied'));
    stopScanner();
  }

  function renderScannerHub() {
    const supported = 'BarcodeDetector' in window;
    showResearchModal('QR & barcode scanner', `${hubNav('scanner')}<div class="rounded-2xl border border-accent/20 bg-accent/5 p-4"><h3 class="font-semibold">▦ Scan QR code or barcode</h3><p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Uses your browser’s native BarcodeDetector and camera. Camera access requires HTTPS and permission.</p>${supported ? `<div class="mt-4 flex flex-wrap gap-2"><label class="cursor-pointer px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-sm">Choose image<input id="scan-image" class="hidden" type="file" accept="image/*"></label><button id="start-camera-scan" class="btn-accent px-4 py-2 rounded-xl font-semibold text-sm">📷 Use camera</button><button id="stop-camera-scan" class="hidden px-3 py-2 rounded-xl bg-rose-100 dark:bg-rose-500/10 text-rose-600 text-sm">Stop camera</button></div><video id="scanner-video" class="hidden mt-4 w-full max-h-72 rounded-xl bg-black" playsinline muted></video><div id="scanner-result" class="mt-4"></div>` : '<p class="mt-4 text-sm text-amber-600 dark:text-amber-300">Your browser does not support BarcodeDetector yet. Try a current Chromium-based browser.</p>'}</div>`);
    wireHubNav();
    if (!supported) return;
    byId('scan-image').addEventListener('change', scanImageFile);
    byId('start-camera-scan').addEventListener('click', startCameraScanner);
    byId('stop-camera-scan').addEventListener('click', stopScanner);
  }

  function makeBarcodeDetector() {
    return new window.BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'data_matrix', 'pdf417'] });
  }

  async function scanImageFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const detector = makeBarcodeDetector();
      const image = await createImageBitmap(file);
      const codes = await detector.detect(image);
      image.close?.();
      if (codes.length) scannerResult(codes);
      else byId('scanner-result').innerHTML = '<p class="text-sm text-slate-400">No QR/barcode found in that image.</p>';
    } catch (error) { byId('scanner-result').innerHTML = `<p class="text-sm text-rose-500">Could not scan image: ${esc(error.message)}</p>`; }
  }

  async function startCameraScanner() {
    if (!navigator.mediaDevices?.getUserMedia) return notice('Camera scanning is unavailable in this browser');
    try {
      const detector = makeBarcodeDetector();
      scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      const video = byId('scanner-video');
      video.srcObject = scannerStream;
      video.classList.remove('hidden');
      await video.play();
      byId('start-camera-scan').classList.add('hidden');
      byId('stop-camera-scan').classList.remove('hidden');
      byId('scanner-result').innerHTML = '<p class="text-sm text-slate-400">Point the camera at a code…</p>';
      scannerTimer = setInterval(async () => {
        if (!scannerStream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) scannerResult(codes);
        } catch {
          // A single unsupported frame should not stop a running camera scan.
        }
      }, 400);
    } catch (error) { notice(`Camera unavailable: ${error.message}`, 5000); stopScanner(); }
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Page metadata/reading time, Wayback lookup, and URL safety explanation.
   * ──────────────────────────────────────────────────────────────────── */
  function openMetadata(result) {
    showResearchModal('Page metadata & reading time', '<p class="text-sm text-slate-400">📖 Fetching clean page metadata…</p>');
    fetchJson(`/api/fetch?url=${encodeURIComponent(result.url)}`).then((page) => {
      const body = byId('research-modal-body');
      if (!body) return;
      body.innerHTML = `<div class="flex flex-wrap gap-2 mb-4"><button id="metadata-reader" class="btn-accent px-3 py-1.5 rounded-lg text-sm">📖 Open reading mode</button><button id="metadata-archive" class="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-sm">🕰 Find archive</button></div><div class="grid sm:grid-cols-2 gap-3 text-sm"><div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60"><span class="block text-[11px] text-slate-400">Title</span><b>${esc(page.title || result.title)}</b></div><div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60"><span class="block text-[11px] text-slate-400">Reading time</span><b>${page.readingTimeMinutes ? `${page.readingTimeMinutes} min` : 'Unavailable'}${page.wordCount ? ` · ${page.wordCount.toLocaleString()} words` : ''}</b></div><div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60"><span class="block text-[11px] text-slate-400">Author / byline</span><b>${esc(page.byline || 'Not found')}</b></div><div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60"><span class="block text-[11px] text-slate-400">Published</span><b>${esc(page.published || 'Not found')}</b></div><div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 sm:col-span-2"><span class="block text-[11px] text-slate-400">Canonical URL</span><a href="${esc(page.canonicalUrl || result.url)}" target="_blank" rel="noopener noreferrer" class="text-accent break-all">${esc(page.canonicalUrl || result.url)}</a></div></div>${page.description ? `<p class="mt-4 text-sm text-slate-500 dark:text-slate-400">${esc(page.description)}</p>` : ''}`;
      byId('metadata-reader').addEventListener('click', () => {
        closeResearchModal();
        document.dispatchEvent(new CustomEvent('aura:open-reader', { detail: { url: result.url } }));
      });
      byId('metadata-archive').addEventListener('click', () => openArchive(result));
    }).catch((error) => {
      const body = byId('research-modal-body');
      if (body) body.innerHTML = `<p class="text-rose-500 text-sm">Could not fetch page metadata: ${esc(error.message)}</p>`;
    });
  }

  function openArchive(result) {
    showResearchModal('Wayback Machine archive', '<p class="text-sm text-slate-400">🕰 Looking for a public archived snapshot…</p>');
    fetchJson(`/api/archive?url=${encodeURIComponent(result.url)}`).then((archive) => {
      const body = byId('research-modal-body');
      if (!body) return;
      body.innerHTML = archive.available
        ? `<div class="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10"><h3 class="font-semibold">✅ Archived snapshot found</h3><p class="text-sm text-slate-500 dark:text-slate-400 mt-2">Snapshot timestamp: ${esc(archive.timestamp || 'unknown')} · HTTP ${esc(archive.status || '—')}</p><a href="${esc(archive.url)}" target="_blank" rel="noopener noreferrer" class="inline-block btn-accent px-4 py-2 rounded-xl font-semibold text-sm mt-4">Open archived page ↗</a></div>`
        : '<div class="p-4 rounded-2xl bg-slate-100 dark:bg-slate-800"><h3 class="font-semibold">No public snapshot found</h3><p class="text-sm text-slate-500 dark:text-slate-400 mt-2">The Wayback Machine did not return an available closest snapshot for this URL.</p></div>';
    }).catch((error) => {
      const body = byId('research-modal-body');
      if (body) body.innerHTML = `<p class="text-rose-500 text-sm">Archive lookup failed: ${esc(error.message)}</p>`;
    });
  }

  function openSafety(result) {
    const safety = result.safety || { score: 0, level: 'caution', signals: ['No local assessment available'], heuristic: true };
    const label = safety.level === 'low-risk' ? 'Low URL-level risk' : safety.level === 'high-risk' ? 'Caution recommended' : 'Review before opening';
    showResearchModal('Link safety & privacy signals', `<div class="rounded-2xl p-5 ${safety.level === 'low-risk' ? 'bg-emerald-50 dark:bg-emerald-500/10' : safety.level === 'high-risk' ? 'bg-rose-50 dark:bg-rose-500/10' : 'bg-amber-50 dark:bg-amber-500/10'}"><div class="flex items-baseline gap-3"><span class="text-4xl font-extrabold">${Number(safety.score || 0)}</span><div><h3 class="font-semibold">${esc(label)}</h3><p class="text-xs text-slate-500 dark:text-slate-400">Local heuristic — not a malware verdict</p></div></div><p class="mt-4 text-sm break-all">${esc(result.url)}</p><ul class="mt-4 space-y-2 text-sm">${(safety.signals || []).map((signal) => `<li class="flex gap-2"><span>•</span><span>${esc(signal)}</span></li>`).join('')}</ul><p class="mt-4 text-xs text-slate-500 dark:text-slate-400">This score is computed by Aura from the URL itself. No result link is sent to a third-party reputation service.</p></div>`);
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Accessibility + focus mode.
   * ──────────────────────────────────────────────────────────────────── */
  const ACCESSIBILITY_KEY = 'aura.research.accessibility';
  let accessibility = { fontScale: 100, highContrast: false, focusMode: false, reducedMotion: false, readableSpacing: false, ...local.get(ACCESSIBILITY_KEY, {}) };

  function applyAccessibility() {
    const root = document.documentElement;
    root.style.fontSize = `${Math.min(145, Math.max(85, Number(accessibility.fontScale) || 100))}%`;
    root.classList.toggle('aura-high-contrast', Boolean(accessibility.highContrast));
    root.classList.toggle('aura-focus-mode', Boolean(accessibility.focusMode));
    root.classList.toggle('aura-reduced-motion', Boolean(accessibility.reducedMotion));
    root.classList.toggle('aura-readable-spacing', Boolean(accessibility.readableSpacing));
    local.set(ACCESSIBILITY_KEY, accessibility);
  }

  function injectAccessibilityCss() {
    if (byId('aura-accessibility-css')) return;
    const style = document.createElement('style');
    style.id = 'aura-accessibility-css';
    style.textContent = `
      html.aura-high-contrast body { filter: contrast(1.2); }
      html.aura-high-contrast .result-card, html.aura-high-contrast [class*="border"] { border-width: 2px !important; }
      html.aura-focus-mode #trending-section, html.aura-focus-mode aside, html.aura-focus-mode footer, html.aura-focus-mode #aura-research-controls { display: none !important; }
      html.aura-focus-mode #hero { padding-top: 1.5rem !important; }
      html.aura-reduced-motion *, html.aura-reduced-motion *::before, html.aura-reduced-motion *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
      html.aura-readable-spacing .prose-reader, html.aura-readable-spacing .result-card p { letter-spacing: 0.025em; word-spacing: 0.08em; line-height: 1.95; }
      html.aura-readable-spacing body { font-family: ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif; }
    `;
    document.head.appendChild(style);
  }

  function renderAccessibilityHub() {
    showResearchModal('Accessibility & focus mode', `${hubNav('accessibility')}<div class="space-y-4 max-w-2xl"><div class="p-4 rounded-2xl border border-slate-200 dark:border-slate-700"><label class="font-semibold text-sm">Text size <span id="font-scale-output" class="text-accent">${accessibility.fontScale}%</span></label><input id="font-scale" type="range" min="85" max="145" step="5" value="${accessibility.fontScale}" class="block mt-3 w-full accent-violet-500"></div><div class="grid sm:grid-cols-2 gap-3"><label class="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center gap-3 cursor-pointer"><input id="access-high-contrast" type="checkbox" ${accessibility.highContrast ? 'checked' : ''}><span><b class="text-sm">High contrast</b><small class="block text-xs text-slate-400 mt-1">Strengthen visual separation.</small></span></label><label class="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center gap-3 cursor-pointer"><input id="access-focus-mode" type="checkbox" ${accessibility.focusMode ? 'checked' : ''}><span><b class="text-sm">Focus mode</b><small class="block text-xs text-slate-400 mt-1">Hide widgets and distractions.</small></span></label><label class="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center gap-3 cursor-pointer"><input id="access-reduced-motion" type="checkbox" ${accessibility.reducedMotion ? 'checked' : ''}><span><b class="text-sm">Reduced motion</b><small class="block text-xs text-slate-400 mt-1">Minimize animations.</small></span></label><label class="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center gap-3 cursor-pointer"><input id="access-readable-spacing" type="checkbox" ${accessibility.readableSpacing ? 'checked' : ''}><span><b class="text-sm">Readable spacing</b><small class="block text-xs text-slate-400 mt-1">Extra line/letter spacing.</small></span></label></div><button id="reset-accessibility" class="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-sm">Reset accessibility settings</button></div>`);
    wireHubNav();
    const sync = () => {
      accessibility = {
        fontScale: Number(byId('font-scale').value),
        highContrast: byId('access-high-contrast').checked,
        focusMode: byId('access-focus-mode').checked,
        reducedMotion: byId('access-reduced-motion').checked,
        readableSpacing: byId('access-readable-spacing').checked,
      };
      byId('font-scale-output').textContent = `${accessibility.fontScale}%`;
      applyAccessibility();
    };
    all('#font-scale, #access-high-contrast, #access-focus-mode, #access-reduced-motion, #access-readable-spacing').forEach((input) => input.addEventListener('input', sync));
    byId('reset-accessibility').addEventListener('click', () => {
      accessibility = { fontScale: 100, highContrast: false, focusMode: false, reducedMotion: false, readableSpacing: false };
      applyAccessibility();
      renderAccessibilityHub();
    });
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Quick privacy erase and service-worker offline shell registration.
   * ──────────────────────────────────────────────────────────────────── */
  async function panicErase() {
    const accepted = confirm('Erase ALL Aura data from this browser? This removes search history, bookmarks, workspaces, saved articles, local documents, preferences and cached offline files. This cannot be undone.');
    if (!accepted) return;
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('aura.')) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
      sessionStorage.clear();
      await clearResearchDatabase();
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.filter((name) => name.startsWith('aura-')).map((name) => caches.delete(name)));
      }
      latestResults = [];
      notice('🚨 Aura data erased. Reloading…', 1200);
      setTimeout(() => location.replace('/'), 900);
    } catch (error) {
      notice(`⚠️ Could not erase all local data: ${error.message}`, 5000);
    }
  }

  function registerOfflineShell() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline mode is optional; never block search if a browser disallows it.
    });
  }

  function initResearchTools() {
    ensureResearchUi();
    injectAccessibilityCss();
    applyAccessibility();
    renderFilterControls();
    initSelectionTools();
    initResultActions();
    initReaderLibraryAction();
    byId('open-research-hub').addEventListener('click', () => openResearchHub('library'));
    byId('open-compare').addEventListener('click', openCompare);
    registerOfflineShell();
  }

  document.addEventListener('DOMContentLoaded', initResearchTools);
})();
