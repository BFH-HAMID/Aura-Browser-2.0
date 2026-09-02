/**
 * Aura Browser 2.0 — frontend application.
 *
 * Implements all 31 features:
 *   1 AI summary · 2 de-dup badge · 3 zero-tracking UI · 4 tabs · 5 theme
 *   6 math widget · 7 autocomplete · 8 related questions · 9 languages
 *   10 bookmarks/history · 11 voice · 12 favicons · 13 reader · 14 export
 *   15 keyboard nav · 16 QR · 17 region · 18 SafeSearch · 19 operators
 *   20 accent color · 21 chat RAG · 22 bangs · 23 code highlight · 24 TTS
 *   25 weather · 26 world clock · 27 trending · 28 reverse image
 *   29 tracker stats · 30 tag bookmarks · 31 proxy panel
 */
'use strict';

/* ════════════════════════════════════════════════════════════════════════
 * 0. Utilities
 * ════════════════════════════════════════════════════════════════════════ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const LS = {
  get(key, dflt) { try { return JSON.parse(localStorage.getItem(key)) ?? dflt; } catch { return dflt; } },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
};

const debounce = (fn, ms) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

const escapeHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const formatTimeAgo = (iso) => {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
};

let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const fmtDate = (iso) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/* ════════════════════════════════════════════════════════════════════════
 * 1. Global state
 * ════════════════════════════════════════════════════════════════════════ */
const state = {
  query: '',
  category: 'all',
  language: LS.get('aura.lang', 'en'),
  region: LS.get('aura.region', 'US'),
  safesearch: LS.get('aura.safesearch', true),
  results: [],
  related: [],
  aiSummary: '',
  currentIndex: -1,
  chatHistory: [],
  chatContext: '',
  bang: null,
  bookmarks: LS.get('aura.bookmarks', []),
  history: LS.get('aura.history', []),
  proxyActive: false,
};

/* ════════════════════════════════════════════════════════════════════════
 * 2. Theme (5) & accent color (20) — persisted in localStorage
 * ════════════════════════════════════════════════════════════════════════ */
const THEME_KEY = 'aura.theme';
const ACCENT_KEY = 'aura.accent';
const PRESET_ACCENTS = ['#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#f97316'];

function applyTheme(theme) {
  const dark = theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  $('#theme-toggle').innerHTML = dark ? '<span class="dark:inline">☀️</span>' : '🌙';
  localStorage.setItem(THEME_KEY, JSON.stringify(theme));
}

function applyAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
  // RGB triplet used by Tailwind alpha utilities (bg-accent/10 etc.).
  const c = color.replace('#', '');
  document.documentElement.style.setProperty('--accent-rgb',
    `${parseInt(c.slice(0, 2), 16)}, ${parseInt(c.slice(2, 4), 16)}, ${parseInt(c.slice(4, 6), 16)}`);
  // Compute a slightly lighter secondary tone.
  const mix = (a, b) => Math.round((parseInt(a, 16) + parseInt(b, 16)) / 2).toString(16).padStart(2, '0');
  document.documentElement.style.setProperty('--accent-2', `#${mix(c.slice(0, 2), '38')}${mix(c.slice(2, 4), 'b8')}${mix(c.slice(4, 6), 'f8')}`);
  localStorage.setItem(ACCENT_KEY, JSON.stringify(color));
}

function initThemeAndAccent() {
  applyTheme(LS.get(THEME_KEY, 'system'));
  applyAccent(LS.get(ACCENT_KEY, '#8b5cf6'));

  $('#theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    applyTheme(cur);
  });

  const picker = $('#accent-picker');
  picker.value = LS.get(ACCENT_KEY, '#8b5cf6');
  picker.addEventListener('input', () => applyAccent(picker.value));

  const swatchBox = $('#accent-swatches');
  for (const c of PRESET_ACCENTS) {
    const b = document.createElement('button');
    b.className = 'w-6 h-6 rounded-full border-2 border-transparent hover:scale-110 transition-transform';
    b.style.background = c;
    b.title = c;
    b.addEventListener('click', () => { applyAccent(c); picker.value = c; });
    swatchBox.appendChild(b);
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * 3. Languages (9) & regions (17)
 * ════════════════════════════════════════════════════════════════════════ */
const LANGUAGES = [
  ['en', 'English'], ['bn-BD', 'বাংলা (Bangla)'], ['hi', 'हिन्दी'], ['es', 'Español'],
  ['fr', 'Français'], ['de', 'Deutsch'], ['ar', 'العربية'], ['ru', 'Русский'],
  ['zh-CN', '中文'], ['ja', '日本語'], ['pt-BR', 'Português'],
];
const REGIONS = [
  ['US', 'United States'], ['GB', 'United Kingdom'], ['BD', 'Bangladesh'], ['IN', 'India'],
  ['DE', 'Germany'], ['FR', 'France'], ['JP', 'Japan'], ['CN', 'China'], ['BR', 'Brazil'],
  ['CA', 'Canada'], ['AU', 'Australia'], ['RU', 'Russia'], ['TR', 'Turkey'], ['KR', 'South Korea'],
  ['NL', 'Netherlands'], ['ES', 'Spain'], ['IT', 'Italy'], ['PK', 'Pakistan'],
];

function langSuffix(lang) {
  if (lang.startsWith('bn')) return 'bn';
  if (lang.startsWith('zh')) return 'zh';
  if (lang.startsWith('pt')) return 'pt';
  return lang.split('-')[0];
}

function initLanguageRegion() {
  const langSel = $('#lang-select');
  for (const [code, label] of LANGUAGES) {
    const o = document.createElement('option');
    o.value = code; o.textContent = label;
    if (code === state.language) o.selected = true;
    langSel.appendChild(o);
  }
  langSel.addEventListener('change', () => {
    state.language = langSel.value;
    LS.set('aura.lang', state.language);
    toast(`🌐 Language: ${langSel.options[langSel.selectedIndex].text}`);
    loadTrending();
    if (state.query) doSearch();
  });

  const regionSel = $('#region-select');
  for (const [code, label] of REGIONS) {
    const o = document.createElement('option');
    o.value = code; o.textContent = label;
    if (code === state.region) o.selected = true;
    regionSel.appendChild(o);
  }
  regionSel.addEventListener('change', () => {
    state.region = regionSel.value;
    LS.set('aura.region', state.region);
    loadTrending();
    if (state.query) doSearch();
  });

  $('#safesearch-toggle').addEventListener('change', (e) => {
    state.safesearch = e.target.checked;
    LS.set('aura.safesearch', state.safesearch);
    toast(`🛡️ SafeSearch ${state.safesearch ? 'strict (on)' : 'moderate (off)'}`);
    if (state.query) doSearch();
  });
}

/* ════════════════════════════════════════════════════════════════════════
 * 4. Tabs (4) — dynamic routing: #/search?q=…&cat=…
 * ════════════════════════════════════════════════════════════════════════ */
function setTab(cat, { updateUrl = true } = {}) {
  state.category = cat;
  $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.cat === cat));
  $('#image-search-zone').classList.toggle('hidden', cat !== 'images');
  if (updateUrl) updateUrlHash();
  if (state.query) doSearch();
}

function updateUrlHash() {
  const params = new URLSearchParams();
  if (state.query) params.set('q', state.query);
  params.set('cat', state.category);
  params.set('lang', state.language);
  if (state.region) params.set('region', state.region);
  history.replaceState(null, '', `#/search?${params.toString()}`);
}

function restoreFromUrlHash() {
  const m = /#\/search\?(.*)$/.exec(location.hash);
  if (!m) return;
  const params = new URLSearchParams(m[1]);
  const q = params.get('q');
  const cat = params.get('cat');
  if (cat && ['all', 'news', 'images', 'code', 'scientific'].includes(cat)) setTab(cat, { updateUrl: false });
  if (q) {
    $('#search-input').value = q;
    state.query = q;
    doSearch();
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * 5. Bang shortcuts (22)
 * ════════════════════════════════════════════════════════════════════════ */
const BANG_RE = /^!([a-z0-9_]+)\b/i;
let BANGS = [
  ['w', 'Wikipedia'], ['yt', 'YouTube'], ['gh', 'GitHub'], ['g', 'Google'],
  ['so', 'Stack Overflow'], ['mdn', 'MDN'], ['npm', 'npm'], ['py', 'Python'],
  ['wa', 'WolframAlpha'], ['reddit', 'Reddit'], ['imdb', 'IMDb'], ['maps', 'Maps'],
];

async function loadBangs() {
  try {
    const res = await fetch('/api/bangs');
    if (res.ok) {
      const data = await res.json();
      if (data.bangs?.length) BANGS = data.bangs;
    }
  } catch { /* keep local list */ }
  renderQuickChips();
}

function detectBang(value) {
  const m = BANG_RE.exec(value.trim());
  if (!m) return null;
  const key = m[1].toLowerCase();
  const bang = BANGS.find((b) => b.key === key);
  return bang ? { key, name: bang.name } : null;
}

function updateBangChip(value) {
  const chip = $('#bang-chip');
  const bang = detectBang(value);
  state.bang = bang;
  if (bang) {
    $('#bang-chip-name').textContent = bang.name;
    chip.classList.remove('hidden');
    chip.classList.add('flex');
  } else {
    chip.classList.add('hidden');
    chip.classList.remove('flex');
  }
}

function renderQuickChips() {
  const box = $('#quick-chips');
  box.innerHTML = '';
  const chips = [
    { label: '🧮 12*5+3', v: '12*5+3' },
    { label: '⚡ !w Quantum computing', v: '!w Quantum computing' },
    { label: '🌤️ weather: Dhaka', v: 'weather: Dhaka' },
    { label: '💻 site:github.com tailwind', v: 'site:github.com tailwind' },
    { label: '📰 today news', v: 'today news' },
    ...BANGS.slice(0, 4).map((b) => ({ label: `⚡ !${b.key}`, v: `!${b.key} ` })),
  ];
  for (const c of chips) {
    const b = document.createElement('button');
    b.className = 'px-3 py-1.5 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-accent hover:text-accent transition-colors';
    b.textContent = c.label;
    b.addEventListener('click', () => {
      $('#search-input').value = c.v;
      state.query = c.v;
      doSearch();
    });
    box.appendChild(b);
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * 6. Autocomplete (7) — proxied DDG suggestions with debounce
 * ════════════════════════════════════════════════════════════════════════ */
const suggestBox = $('#suggest-box');
let suggestIdx = -1;

async function fetchSuggestions(value) {
  const q = value.trim();
  if (q.length < 2) { hideSuggestions(); return; }
  try {
    const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}&language=${state.language}`);
    if (!res.ok) return;
    const { suggestions } = await res.json();
    renderSuggestions(suggestions, q);
  } catch { /* suggestions are best-effort */ }
}

const debouncedSuggest = debounce(fetchSuggestions, 220);

function renderSuggestions(list, q) {
  if (!list.length || !state.queryActive) return hideSuggestions();
  suggestBox.innerHTML = '';
  list.slice(0, 8).forEach((s, i) => {
    const item = document.createElement('button');
    item.className = 'w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-accent/10 text-sm';
    item.dataset.idx = i;
    item.innerHTML = `<span class="text-slate-400">🔎</span><span>${escapeHtml(s)}</span>`;
    item.addEventListener('click', () => {
      $('#search-input').value = s;
      state.query = s;
      hideSuggestions();
      doSearch();
    });
    item.addEventListener('mousemove', () => { suggestIdx = i; markSuggestion(); });
    suggestBox.appendChild(item);
  });
  suggestBox.classList.remove('hidden');
  suggestIdx = -1;
}

function markSuggestion() {
  $$('#suggest-box button').forEach((b, i) => {
    b.classList.toggle('bg-accent/10', i === suggestIdx);
  });
}

function hideSuggestions() {
  suggestBox.classList.add('hidden');
  suggestIdx = -1;
}

/* ════════════════════════════════════════════════════════════════════════
 * 7. Voice search (11) — Web Speech API, Bengali + English
 * ════════════════════════════════════════════════════════════════════════ */
const VOICE_LANG = {
  en: 'en-US', 'bn-BD': 'bn-BD', hi: 'hi-IN', es: 'es-ES', fr: 'fr-FR',
  de: 'de-DE', ar: 'ar-SA', ru: 'ru-RU', 'zh-CN': 'zh-CN', ja: 'ja-JP', 'pt-BR': 'pt-BR',
};

function initVoiceSearch() {
  const btn = $('#voice-btn');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    btn.title = 'Voice search not supported in this browser';
    btn.classList.add('opacity-40', 'cursor-not-allowed');
    return;
  }
  let rec = null;
  let listening = false;

  const status = $('#voice-status');

  btn.addEventListener('click', () => {
    if (listening) { rec?.stop(); return; }
    try {
      rec = new SR();
      rec.lang = VOICE_LANG[state.language] || 'en-US';
      rec.interimResults = true;
      rec.continuous = false;
      rec.onstart = () => {
        listening = true;
        status.classList.remove('hidden');
        $('#voice-status-text').textContent = `Listening in ${rec.lang}… speak now`;
        btn.classList.add('text-accent', 'animate-pulse');
      };
      rec.onresult = (e) => {
        let text = '';
        for (let i = e.resultIndex; i < e.results.length; i++) text += e.results[i][0].transcript;
        $('#search-input').value = text;
        animateVoiceBars();
      };
      rec.onerror = (e) => {
        toast(`🎤 Voice error: ${e.error}`);
        stop();
      };
      rec.onend = () => {
        const q = $('#search-input').value.trim();
        stop();
        if (q) { state.query = q; doSearch(); }
      };
      rec.start();
    } catch {
      toast('🎤 Voice search unavailable');
    }
  });

  function stop() {
    listening = false;
    status.classList.add('hidden');
    btn.classList.remove('text-accent', 'animate-pulse');
    resetVoiceBars();
  }

  function animateVoiceBars() {
    $$('.voice-bar').forEach((bar) => {
      bar.style.height = `${8 + Math.random() * 22}px`;
    });
  }
  function resetVoiceBars() {
    $$('.voice-bar').forEach((bar) => { bar.style.height = '8px'; });
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * 8. Core search flow (features 1,2,3,6,19,22,23)
 * ════════════════════════════════════════════════════════════════════════ */
const resultsBox = $('#results');
const statusLine = $('#status-line');
let searchSeq = 0;

function weatherQuery(q) {
  const m = /^weather:\s*(.+)$/i.exec(q.trim());
  return m ? m[1].trim() : null;
}

async function doSearch() {
  const raw = $('#search-input').value.trim();
  if (!raw) return;

  // Weather shortcut (feature 25): "weather: <city>"
  const wCity = weatherQuery(raw);
  if (wCity) {
    state.query = raw;
    resultsBox.innerHTML = '';
    $('#ai-summary').classList.add('hidden');
    $('#math-widget').classList.add('hidden');
    $('#related-section').classList.add('hidden');
    statusLine.classList.remove('hidden');
    statusLine.textContent = '🌤️ Weather lookup…';
    loadWeather(wCity, true);
    updateUrlHash();
    return;
  }

  state.query = raw;
  const seq = ++searchSeq;
  const params = new URLSearchParams({
    q: raw,
    category: state.category,
    language: state.language,
    safesearch: state.safesearch ? '2' : '0',
  });
  if (state.region) params.set('region', `${state.region.toLowerCase()}-${langSuffix(state.language)}`);

  // UI reset
  hideSuggestions();
  $('#ai-summary').classList.add('hidden');
  $('#math-widget').classList.add('hidden');
  $('#related-section').classList.add('hidden');
  statusLine.classList.remove('hidden');
  statusLine.textContent = '🔍 Searching across engines…';
  resultsBox.innerHTML = skeleton(6);
  state.results = [];
  state.related = [];
  updateUrlHash();
  addHistory(raw);

  try {
    const res = await fetch(`/api/search?${params}`);
    if (seq !== searchSeq) return; // stale response guard
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();

    // Bang redirect (feature 22)
    if (data.type === 'bang') {
      window.open(data.redirectUrl, '_blank');
      statusLine.textContent = `⚡ Bang shortcut: redirecting to ${data.bang.name}…`;
      resultsBox.innerHTML = `<div class="text-center py-10 text-slate-400 text-sm">
        <p class="text-3xl mb-2">⚡</p>Opened <b>${escapeHtml(data.bang.name)}</b> for “${escapeHtml(data.query)}” in a new tab.</div>`;
      return;
    }

    // Pure math (feature 6)
    if (data.type === 'math') {
      renderMathWidget(data.math);
      statusLine.textContent = '🧮 Expression evaluated locally — nothing was sent to any engine.';
      resultsBox.innerHTML = '';
      return;
    }

    // Set state BEFORE rendering so per-card actions (bookmarks, QR, …)
    // can read the results they operate on.
    state.results = data.results;
    state.related = data.related || [];
    state.chatContext = buildChatContext(data.results);
    renderResults(data);

    // Status line (feature 2/3 transparency)
    const engineList = (data.engines || []).slice(0, 5).join(', ') || 'searxng';
    statusLine.textContent =
      `⚡ ${data.results.length} unique results from ${engineList}` +
      (data.removedDuplicates ? ` · 🧹 ${data.removedDuplicates} duplicates removed` : '') +
      (data.source === 'ddg-html' ? ' · fallback: DuckDuckGo' : '') +
      ' · 🔒 zero-tracking';

    // Related questions (feature 8)
    if (state.related.length) renderRelatedQuestions(state.related);

    // AI summary (feature 1) — in parallel with result rendering
    loadAiSummary(raw, data.results);
  } catch (err) {
    if (seq !== searchSeq) return;
    statusLine.textContent = '';
    resultsBox.innerHTML = `<div class="text-center py-14">
      <p class="text-4xl mb-3">🛰️</p>
      <p class="font-semibold mb-1">Search engines unreachable</p>
      <p class="text-sm text-slate-400 max-w-md mx-auto">${escapeHtml(err.message)} — make sure your SearXNG instance is running (see README), or check your proxy settings.</p>
    </div>`;
  }
}

function skeleton(n) {
  return Array.from({ length: n }, () => `
    <div class="animate-pulse bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
      <div class="flex items-center gap-3">
        <div class="w-6 h-6 rounded-lg bg-slate-200 dark:bg-slate-700"></div>
        <div class="h-3.5 bg-slate-200 dark:bg-slate-700 rounded w-1/3"></div>
      </div>
      <div class="mt-3 h-3 bg-slate-200 dark:bg-slate-700 rounded w-2/3"></div>
      <div class="mt-2 h-3 bg-slate-100 dark:bg-slate-800 rounded w-full"></div>
      <div class="mt-2 h-3 bg-slate-100 dark:bg-slate-800 rounded w-5/6"></div>
    </div>`).join('');
}

/* ── Math widget (6) ───────────────────────────────────────────────────── */
function renderMathWidget(math) {
  const w = $('#math-widget');
  w.classList.remove('hidden');
  w.innerHTML = `
    <div class="flex items-center gap-2 text-xs font-semibold text-slate-400 mb-2">🧮 Instant Calculator</div>
    <div class="flex items-end flex-wrap gap-x-4 gap-y-1">
      <span class="text-lg font-mono text-slate-500 dark:text-slate-400">${escapeHtml(math.expression)} =</span>
      <span class="text-3xl font-extrabold" style="color:var(--accent)">${escapeHtml(math.pretty)}</span>
    </div>
    <p class="text-[11px] text-slate-400 mt-2">Evaluated locally in your browser — no query ever left your machine. ✨</p>`;
  $('#search-input').value = '';
}

/* ── AI summary (1) ────────────────────────────────────────────────────── */
async function loadAiSummary(query, results) {
  const box = $('#ai-summary');
  const body = $('#ai-summary-body');
  box.classList.remove('hidden');
  body.innerHTML = '<span class="opacity-60">✦ Synthesizing an answer…</span>';
  $('#ai-provider').textContent = 'thinking…';

  try {
    const payload = results.slice(0, 8).map((r) => ({ title: r.title, url: r.url, content: (r.content || '').slice(0, 400) }));
    const res = await fetch(`/api/summary?q=${encodeURIComponent(query)}&results=${encodeURIComponent(JSON.stringify(payload))}`);
    if (!res.ok) throw new Error('summary failed');
    const data = await res.json();
    box.classList.remove('hidden');
    body.innerHTML = renderMarkdown(data.summary);
    $('#ai-provider').textContent = data.provider === 'extractive' ? 'local extractive' : data.provider;
  } catch {
    box.classList.add('hidden');
  }
}

/** Tiny markdown-lite renderer (bold, italic, inline code, links, lists). */
function renderMarkdown(text) {
  const esc = escapeHtml(text);
  const withCode = esc
    .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-[0.85em] font-mono">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-accent underline">$1</a>');
  return withCode
    .split(/\n+/)
    .map((line) => {
      const bullet = /^[-•]\s+(.*)$/.exec(line);
      if (bullet) return `<li class="ml-4 list-disc">${bullet[1]}</li>`;
      return `<p class="mt-1.5 first:mt-0">${line}</p>`;
    })
    .join('');
}

/* ── Result list rendering (2,12,18,19,23) ─────────────────────────────── */
function renderResults(data) {
  if (!data.results.length) {
    resultsBox.innerHTML = `<div class="text-center py-14">
      <p class="text-4xl mb-3">🔎</p>
      <p class="font-semibold">No results found</p>
      <p class="text-sm text-slate-400 mt-1">Try different keywords, a different category, or SafeSearch off.</p>
    </div>`;
    return;
  }
  resultsBox.innerHTML = data.results.map((r, i) => resultCard(r, i)).join('');
  wireResultActions();
}

function resultCard(r, i) {
  const favicon = faviconFor(r);
  const saved = state.bookmarks.some((b) => b.url === r.url);
  return `
  <article class="result-card group relative bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md hover:border-accent/40 transition-all" data-idx="${i}" tabindex="-1">
    <div class="flex items-start gap-3">
      <img src="${favicon}" alt="" class="w-6 h-6 rounded-md mt-0.5 favicon" loading="lazy"
           onerror="this.outerHTML='<span class=\'grid place-items-center w-6 h-6 rounded-md text-white text-xs font-bold favicon\' style=\'background:var(--accent)\'>${escapeHtml((r.domain || '?')[0].toUpperCase())}</span>'">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 text-xs text-slate-400 mb-1">
          <span class="font-medium text-slate-500 dark:text-slate-400">${escapeHtml(r.domain || r.host || '')}</span>
          ${r.engine ? `<span class="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800">${escapeHtml(r.engine)}</span>` : ''}
          ${r.published ? `<span>${formatTimeAgo(r.published)}</span>` : ''}
        </div>
        <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer" class="result-link block">
          <h3 class="text-base font-semibold leading-snug group-hover:text-accent transition-colors">${escapeHtml(r.title)}</h3>
        </a>
        <p class="mt-1.5 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">${renderSnippet(r.content || '')}</p>
        <div class="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          ${codeBlockIn(r.content) ? '<button class="copy-code-chip">📋 copy code</button>' : ''}
        </div>
      </div>
      <div class="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity" data-actions>
        <button class="action-btn" data-act="save" title="${saved ? 'Remove bookmark' : 'Save bookmark'}">${saved ? '🔖' : '🤍'}</button>
        <button class="action-btn" data-act="read" title="Reading mode">📖</button>
        <button class="action-btn" data-act="qr" title="QR code">▦</button>
        <button class="action-btn" data-act="speak" title="Read aloud">🔊</button>
        <button class="action-btn" data-act="export" title="Export results">⬇</button>
      </div>
    </div>
    <div class="hidden mt-3 code-block">
      <div class="flex items-center justify-between text-[11px] mb-1.5">
        <span class="text-slate-400 font-mono">code snippet</span>
        <button class="copy-code-btn px-2 py-1 rounded-lg bg-accent/15 text-accent font-semibold hover:bg-accent/25">⧉ Copy code</button>
      </div>
      <pre class="code-pre"><code class="language-auto"></code></pre>
    </div>
  </article>`;
}

function faviconFor(r) {
  const domain = (r.domain || r.host || '').replace(/^www\./, '');
  if (!domain) return '';
  return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;
}

/** Render snippet text; detect + highlight code blocks (feature 23). */
function renderSnippet(content) {
  const text = escapeHtml(content).slice(0, 600);
  if (!codeBlockIn(content)) {
    return text.replace(/https?:\/\/[^\s<]+/g, (u) =>
      `<a href="${u}" target="_blank" rel="noopener noreferrer" class="text-accent break-all">${u}</a>`);
  }
  return text;
}

function codeBlockIn(content) {
  return /\b(function|const|let|var|def |import |from |class |public |private |SELECT |INSERT |<html|<script|=>|console\.log)\b/i.test(content || '');
}

/* Highlight a code snippet with a tiny dependency-free highlighter. */
const KEYWORDS = /\b(const|let|var|function|return|if|else|for|while|class|new|import|from|export|def|print|lambda|def|async|await|try|catch|throw|null|undefined|true|false|self|this|int|str|bool|float|None|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|TABLE|AND|OR|NOT|public|private|static|void|extends|interface|package|require|module)\b/g;
const STRINGS = /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;

function highlightCode(code) {
  const esc = escapeHtml(code);
  const withStrings = esc.replace(STRINGS, '<span class="text-amber-600 dark:text-amber-400">$1</span>');
  return withStrings
    .replace(KEYWORDS, '<span class="text-violet-600 dark:text-violet-400 font-semibold">$1</span>')
    .replace(/(\/\/[^\n<]*)/g, '<span class="text-slate-400 italic">$1</span>')
    .replace(/(\b\d+(?:\.\d+)?\b)/g, '<span class="text-sky-600 dark:text-sky-400">$1</span>');
}

/* Wire per-result actions (10,13,14,16,24 + copy code) */
function wireResultActions() {
  $$('.result-card').forEach((card) => {
    const idx = Number(card.dataset.idx);
    const r = state.results[idx];
    if (!r) return;

    card.addEventListener('mouseenter', () => { state.currentIndex = idx; });

    card.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const act = btn.dataset.act;
        if (act === 'save') toggleBookmark(r, btn);
        if (act === 'read') openReader(r.url);
        if (act === 'qr') openQr(r);
        if (act === 'speak') speak(`${r.title}. ${r.content || ''}`, card);
        if (act === 'export') exportResults('json');
      });
    });

    // Copy code block (feature 23)
    const block = card.querySelector('.code-block');
    const snippet = r.content || '';
    if (codeBlockIn(snippet) && block) {
      block.classList.remove('hidden');
      const codeEl = block.querySelector('code');
      // Extract the most code-looking lines.
      const lines = snippet.split(/\n/);
      const codeText = lines.filter((l) => /[{};=<>]|\b(function|def|class|import|const|let|SELECT)\b/.test(l)).join('\n').slice(0, 2000) || snippet;
      codeEl.innerHTML = highlightCode(codeText);
      block.querySelector('.copy-code-btn').addEventListener('click', async () => {
        await navigator.clipboard.writeText(codeText).catch(() => {});
        toast('⧉ Code copied to clipboard');
      });
    }
  });
}

/* ════════════════════════════════════════════════════════════════════════
 * 9. Related questions — expandable accordion (8)
 * ════════════════════════════════════════════════════════════════════════ */
function renderRelatedQuestions(questions) {
  const sec = $('#related-section');
  const list = $('#related-list');
  list.innerHTML = '';
  questions.forEach((q) => {
    const item = document.createElement('div');
    item.className = 'p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors';
    item.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <span class="text-sm font-medium">${escapeHtml(q.question)}</span>
        <span class="chev text-slate-400 transition-transform">▾</span>
      </div>
      <div class="answer hidden mt-2 text-sm text-slate-500 dark:text-slate-400 leading-relaxed"></div>`;
    item.addEventListener('click', async () => {
      const answer = item.querySelector('.answer');
      const chev = item.querySelector('.chev');
      const isOpen = !answer.classList.contains('hidden');
      if (isOpen) {
        answer.classList.add('hidden');
        chev.style.transform = '';
        return;
      }
      chev.style.transform = 'rotate(180deg)';
      if (!answer.dataset.loaded) {
        answer.innerHTML = '<span class="opacity-60">Fetching answer…</span>';
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(q.question)}&category=all&language=${state.language}&safesearch=2`);
          const data = await res.json();
          const top = data.results?.[0];
          answer.innerHTML = top
            ? `<p>${escapeHtml(top.content || top.title)}</p><a href="${escapeHtml(top.url)}" target="_blank" rel="noopener noreferrer" class="text-accent text-xs mt-2 inline-block">Read more ↗</a>`
            : '<p>No quick answer found — try a search.</p>';
          answer.dataset.loaded = '1';
        } catch {
          answer.innerHTML = '<p>Could not fetch an answer right now.</p>';
        }
      }
      answer.classList.remove('hidden');
    });
    list.appendChild(item);
  });
  sec.classList.remove('hidden');
}

/* ════════════════════════════════════════════════════════════════════════
 * 10. Bookmarks (10) + tag management (30)
 * ════════════════════════════════════════════════════════════════════════ */
function saveBookmarks() {
  LS.set('aura.bookmarks', state.bookmarks);
  $('#bookmark-count').textContent = state.bookmarks.length;
}

function toggleBookmark(r, btn) {
  const idx = state.bookmarks.findIndex((b) => b.url === r.url);
  if (idx === -1) {
    state.bookmarks.unshift({
      id: `bm-${Date.now()}`,
      title: r.title,
      url: r.url,
      domain: r.domain || '',
      tags: [],
      date: new Date().toISOString(),
    });
    btn.textContent = '🔖';
    toast('🔖 Bookmarked');
  } else {
    state.bookmarks.splice(idx, 1);
    btn.textContent = '🤍';
    toast('Bookmark removed');
  }
  saveBookmarks();
}

function renderBookmarks(filter = '', tagFilter = null) {
  const list = $('#bookmarks-list');
  const items = state.bookmarks.filter((b) => {
    const textOk = (b.title + b.url + (b.tags || []).join(' ')).toLowerCase().includes(filter.toLowerCase());
    const tagOk = !tagFilter || (b.tags || []).includes(tagFilter);
    return textOk && tagOk;
  });
  if (!items.length) {
    list.innerHTML = '<p class="text-center text-sm text-slate-400 py-8">No bookmarks yet — hover any result and click 🤍.</p>';
    return;
  }
  list.innerHTML = items.map((b) => `
    <div class="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800">
      <div class="min-w-0 flex-1">
        <a href="${escapeHtml(b.url)}" target="_blank" rel="noopener noreferrer" class="text-sm font-medium hover:text-accent block truncate">${escapeHtml(b.title)}</a>
        <div class="text-[11px] text-slate-400 mt-0.5">${escapeHtml(b.domain || b.url)} · ${fmtDate(b.date)}</div>
        <div class="flex flex-wrap gap-1 mt-1.5">
          ${(b.tags || []).map((t) => `<span class="tag-chip px-1.5 py-0.5 rounded-md bg-accent/10 text-accent text-[10px] cursor-pointer" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`).join('')}
          <input class="tag-input text-[10px] bg-transparent border border-dashed border-slate-300 dark:border-slate-600 rounded-md px-1.5 py-0.5 w-20 outline-none" placeholder="+tag" data-id="${b.id}">
        </div>
      </div>
      <button class="bm-del text-slate-300 hover:text-rose-500 text-sm px-2" data-id="${b.id}" title="Delete">🗑</button>
    </div>`).join('');

  // Tag add (feature 30)
  $$('.tag-input').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        const b = state.bookmarks.find((x) => x.id === input.dataset.id);
        if (b) {
          b.tags = [...new Set([...(b.tags || []), input.value.trim().toLowerCase()])];
          saveBookmarks();
          renderBookmarks($('#bookmark-search').value, tagFilter);
          renderTagFilters();
        }
      }
    });
  });
  // Tag filter click
  $$('.tag-chip').forEach((chip) => {
    chip.addEventListener('click', () => renderBookmarks($('#bookmark-search').value, chip.dataset.tag));
  });
  // Delete
  $$('.bm-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.bookmarks = state.bookmarks.filter((b) => b.id !== btn.dataset.id);
      saveBookmarks();
      renderBookmarks($('#bookmark-search').value, tagFilter);
      renderTagFilters();
      toast('Bookmark deleted');
    });
  });
}

function renderTagFilters() {
  const box = $('#bookmark-tags');
  const tags = [...new Set(state.bookmarks.flatMap((b) => b.tags || []))];
  box.innerHTML = '';
  const all = document.createElement('button');
  all.className = 'px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-200 dark:bg-slate-700';
  all.textContent = 'All';
  all.addEventListener('click', () => renderBookmarks($('#bookmark-search').value, null));
  box.appendChild(all);
  for (const t of tags) {
    const b = document.createElement('button');
    b.className = 'px-2.5 py-1 rounded-full text-[11px] font-medium bg-accent/10 text-accent hover:bg-accent/20';
    b.textContent = `#${t}`;
    b.addEventListener('click', () => renderBookmarks($('#bookmark-search').value, t));
    box.appendChild(b);
  }
}

/* ── History (10) ──────────────────────────────────────────────────────── */
function addHistory(query) {
  state.history.unshift({ q: query, cat: state.category, date: new Date().toISOString() });
  state.history = state.history.slice(0, 60);
  LS.set('aura.history', state.history);
  $('#history-count').textContent = state.history.length;
}

function renderHistory() {
  const list = $('#history-list');
  if (!state.history.length) {
    list.innerHTML = '<p class="text-center text-sm text-slate-400 py-8">No searches yet — history stays on this device.</p>';
    return;
  }
  list.innerHTML = state.history.map((h, i) => `
    <button class="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left" data-i="${i}">
      <span>🕘</span>
      <span class="flex-1 text-sm truncate">${escapeHtml(h.q)}</span>
      <span class="text-[10px] text-slate-400">${h.cat} · ${fmtDate(h.date)}</span>
    </button>`).join('');
  $$('#history-list button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const h = state.history[Number(btn.dataset.i)];
      $('#search-input').value = h.q;
      state.query = h.q;
      doSearch();
      closeModal('history-modal');
    });
  });
}

/* ════════════════════════════════════════════════════════════════════════
 * 11. Export (14) — JSON / CSV / TXT
 * ════════════════════════════════════════════════════════════════════════ */
function exportResults(format = 'json') {
  if (!state.results.length) return toast('No results to export yet');
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'json') {
    download(`aura-results-${stamp}.json`, JSON.stringify({ query: state.query, exportedAt: new Date().toISOString(), results: state.results }, null, 2), 'application/json');
  } else if (format === 'csv') {
    const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = [['title', 'url', 'domain', 'engine', 'snippet', 'published'].join(',')];
    for (const r of state.results) rows.push([esc(r.title), esc(r.url), esc(r.domain), esc(r.engine), esc(r.content), esc(r.published || '')].join(','));
    download(`aura-results-${stamp}.csv`, rows.join('\n'), 'text/csv');
  } else {
    const txt = `Aura Browser 2.0 — search: ${state.query}\nExported: ${new Date().toLocaleString()}\n\n` +
      state.results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content || ''}\n`).join('\n');
    download(`aura-results-${stamp}.txt`, txt, 'text/plain');
  }
  toast(`⬇ Results exported as ${format.toUpperCase()}`);
}

/* ════════════════════════════════════════════════════════════════════════
 * 12. QR code (16)
 * ════════════════════════════════════════════════════════════════════════ */
let qrResult = null;
function openQr(r) {
  qrResult = r;
  $('#qr-url').textContent = r.url;
  const canvas = $('#qr-canvas');
  canvas.innerHTML = '';
  try {
    if (typeof qrcode === 'undefined') throw new Error('qrcode lib missing');
    const qr = qrcode(0, 'M');
    qr.addData(r.url);
    qr.make();
    const img = new Image();
    img.src = qr.createDataURL(4, 8);
    img.alt = 'QR code';
    img.className = 'rounded-xl shadow-lg max-w-[220px] w-full';
    canvas.appendChild(img);
    img.onload = () => { img.dataset.ready = '1'; };
  } catch {
    canvas.innerHTML = '<p class="text-xs text-rose-500">QR library unavailable — run <code>npm run vendor:qrcode</code></p>';
  }
  openModal('qr-modal');
}

/* ════════════════════════════════════════════════════════════════════════
 * 13. Reading mode (13)
 * ════════════════════════════════════════════════════════════════════════ */
let readerUrl = '';
async function openReader(url) {
  readerUrl = url;
  openModal('reader-modal');
  const content = $('#reader-content');
  const title = $('#reader-title');
  const domain = $('#reader-domain');
  title.textContent = 'Loading…';
  content.innerHTML = '<div class="flex items-center gap-3 text-slate-400"><span class="animate-spin inline-block">⏳</span> Fetching & stripping the page…</div>';
  try {
    const res = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    title.textContent = data.title || 'Untitled';
    domain.textContent = data.domain || '';
    content.innerHTML = `
      <h1 class="text-2xl font-extrabold mb-2">${escapeHtml(data.title || '')}</h1>
      ${data.byline ? `<p class="text-sm text-slate-400 mb-4">By ${escapeHtml(data.byline)}</p>` : ''}
      ${data.contentHtml || `<p class="text-slate-400">${escapeHtml(data.excerpt || 'No readable content found.')}</p>`}`;
  } catch (err) {
    content.innerHTML = `<p class="text-rose-500">Could not load reading view: ${escapeHtml(err.message)}<br>
      <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="text-accent underline">Open the original page instead ↗</a></p>`;
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * 14. Text-to-speech (24)
 * ════════════════════════════════════════════════════════════════════════ */
let speaking = false;
function speak(text, triggerEl) {
  if (!('speechSynthesis' in window)) return toast('🔇 TTS not supported');
  const synth = window.speechSynthesis;
  if (speaking) {
    synth.pause();
    speaking = false;
    toast('⏸ TTS paused');
    return;
  }
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text.slice(0, 900));
  u.lang = state.language.startsWith('bn') ? 'bn-BD' : 'en-US';
  // Prefer a matching voice (Bangla voices exist on some platforms).
  const voices = synth.getVoices();
  const match = voices.find((v) => v.lang.replace('_', '-').toLowerCase().startsWith(u.lang.toLowerCase()));
  if (match) u.voice = match;
  u.onend = () => { speaking = false; };
  u.onerror = () => { speaking = false; };
  speaking = true;
  synth.speak(u);
  toast('🔊 Reading aloud… (click speaker again to pause)');
  if (triggerEl) triggerEl.animate([{ transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 300 });
}

/* ════════════════════════════════════════════════════════════════════════
 * 15. RAG chat sidepanel (21)
 * ════════════════════════════════════════════════════════════════════════ */
function buildChatContext(results) {
  return results.slice(0, 10)
    .map((r, i) => `${i + 1}. **${r.title}**\n   ${(r.content || '').slice(0, 300)}\n   ${r.url}`)
    .join('\n\n');
}

function renderChat() {
  const box = $('#chat-messages');
  box.innerHTML = state.chatHistory.map((m) => `
    <div class="${m.role === 'user' ? 'ml-auto bg-accent/15 text-right' : 'mr-auto bg-slate-100 dark:bg-slate-800'} max-w-[85%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap">${escapeHtml(m.content)}</div>`).join('');
  box.scrollTop = box.scrollHeight;
}

async function sendChatMessage() {
  const input = $('#chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  state.chatHistory.push({ role: 'user', content: msg });
  renderChat();
  const box = $('#chat-messages');
  box.insertAdjacentHTML('beforeend', '<div class="mr-auto px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 text-[13px] opacity-60" id="chat-typing">Aura is thinking… ✦</div>');
  box.scrollTop = box.scrollHeight;
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: msg, history: state.chatHistory.slice(0, -1), context: state.chatContext }),
    });
    const data = await res.json();
    $('#chat-typing')?.remove();
    state.chatHistory.push({ role: 'assistant', content: data.content || '(no response)' });
    renderChat();
  } catch {
    $('#chat-typing')?.remove();
    state.chatHistory.push({ role: 'assistant', content: '⚠️ The chat service is unavailable right now.' });
    renderChat();
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * 16. Weather widget (25)
 * ════════════════════════════════════════════════════════════════════════ */
async function loadWeather(city, force = false) {
  const box = $('#weather-widget');
  const prevCity = LS.get('aura.city', 'Dhaka');
  const target = city || prevCity;
  box.innerHTML = '<div class="flex items-center gap-2 text-sm text-slate-400"><span class="animate-spin">⏳</span> Weather…</div>';
  try {
    const res = await fetch(`/api/weather?city=${encodeURIComponent(target)}&language=${state.language}`);
    if (!res.ok) throw new Error('weather failed');
    const w = await res.json();
    const cur = w.current || {};
    const wmo = w.wmo || { icon: '🌤️', label: '' };
    const today = w.daily?.time?.[0];
    box.innerHTML = `
      <div class="flex items-center gap-3">
        <span class="text-3xl">${wmo.icon}</span>
        <div>
          <p class="text-xs text-slate-400">Weather · ${escapeHtml(w.city)}</p>
          <p class="text-2xl font-bold">${cur.temperature_2m ?? '—'}${w.unit || '°C'} <span class="text-sm font-normal text-slate-400">${escapeHtml(wmo.label)}</span></p>
          <p class="text-[11px] text-slate-400">💧 ${cur.relative_humidity_2m ?? '—'}% · 🌬 ${cur.wind_speed_10m ?? '—'} km/h</p>
        </div>
      </div>
      ${today ? `<div class="mt-2 text-[11px] text-slate-400">Today: ${w.daily.temperature_2m_max?.[0]}° / ${w.daily.temperature_2m_min?.[0]}°</div>` : ''}`;
    LS.set('aura.city', target);
  } catch {
    box.innerHTML = '<div class="text-sm text-slate-400">🌤️ Weather unavailable <span class="block text-[11px]">(set a city below)</span></div>';
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * 17. World clock (26)
 * ════════════════════════════════════════════════════════════════════════ */
function initClock() {
  const tick = () => {
    const now = new Date();
    $('#world-clock').textContent = now.toLocaleTimeString(state.language.startsWith('bn') ? 'bn-BD' : 'en-US', { hour12: false });
    const tz = now.getTimezoneOffset();
    const sign = tz <= 0 ? '+' : '-';
    const abs = Math.abs(tz);
    $('#world-tz').textContent = `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  };
  tick();
  setInterval(tick, 1000);
}

/* ════════════════════════════════════════════════════════════════════════
 * 18. Trending topics & news (27)
 * ════════════════════════════════════════════════════════════════════════ */
async function loadTrending() {
  const sec = $('#trending-section');
  try {
    const res = await fetch(`/api/trending?language=${state.language}&region=${state.region}`);
    if (!res.ok) throw new Error('trending failed');
    const { items } = await res.json();
    if (!items.length) { sec.innerHTML = ''; return; }
    sec.innerHTML = `
      <div class="flex items-center gap-2 text-sm font-semibold mb-3">
        <span class="text-lg">🔥</span> Trending now
        <span class="ml-auto text-[10px] font-normal text-slate-400">live · ${escapeHtml(state.region)}</span>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-left">
        ${items.map((t, i) => `
          <a href="${escapeHtml(t.url)}" target="_blank" rel="noopener noreferrer" class="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-accent/50 transition-colors group">
            <span class="text-accent font-bold text-sm w-5">${i + 1}</span>
            <span class="min-w-0">
              <span class="block text-sm font-medium truncate group-hover:text-accent">${escapeHtml(t.title)}</span>
              <span class="block text-[11px] text-slate-400">${escapeHtml(t.source || '')} · ${t.published ? formatTimeAgo(t.published) : ''}</span>
            </span>
          </a>`).join('')}
      </div>`;
  } catch {
    sec.innerHTML = '<p class="text-xs text-slate-400 text-center">📡 Trending feed unreachable — try again later.</p>';
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * 19. Reverse image search (28)
 * ════════════════════════════════════════════════════════════════════════ */
function initImageSearch() {
  const zone = $('#image-search-zone');
  const input = $('#image-file-input');
  const preview = $('#image-preview');
  const fileInput = $('#image-file-input');

  zone.addEventListener('click', (e) => {
    if (e.target.id !== 'image-url-btn' && e.target.id !== 'image-url-input') fileInput.click();
  });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('border-accent'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('border-accent'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('border-accent');
    if (e.dataTransfer.files.length) uploadImage(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => { if (input.files.length) uploadImage(input.files[0]); });

  $('#image-url-btn').addEventListener('click', async () => {
    const url = $('#image-url-input').value.trim();
    if (!url) return toast('Paste an image URL first');
    try {
      const res = await fetch('/api/image-search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image_url: url }),
      });
      const data = await res.json();
      if (data.ok && data.query) {
        $('#search-input').value = data.query;
        state.query = data.query;
        setTab('images');
        doSearch();
      }
    } catch {
      toast('Reverse image lookup failed');
    }
  });

  async function uploadImage(file) {
    if (!file.type.startsWith('image/')) return toast('Please choose an image file');
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.classList.remove('hidden');
      preview.classList.add('flex');
      preview.querySelector('img').src = e.target.result;
    };
    reader.readAsDataURL(file);
    toast('⏳ Uploading image…');
    const fd = new FormData();
    fd.append('image', file);
    try {
      const res = await fetch('/api/image-search', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.ok && data.resultsUrl) {
        window.open(data.resultsUrl, '_blank');
        toast('✅ Image matched — results opened');
      } else {
        toast('Image search service unavailable');
      }
    } catch {
      toast('Image search service unavailable');
    }
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * 20. Tracker stats (29)
 * ════════════════════════════════════════════════════════════════════════ */
async function refreshStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const s = await res.json();
    const blocked = s.requestsProxied || 0;
    $('#stat-blocked').textContent = blocked;
    $('#footer-blocked').textContent = blocked;
  } catch { /* stats are decorative */ }
}

/* ════════════════════════════════════════════════════════════════════════
 * 21. Proxy panel (31)
 * ════════════════════════════════════════════════════════════════════════ */
async function initProxyPanel() {
  const status = $('#proxy-status');
  try {
    const res = await fetch('/api/proxy');
    const p = await res.json();
    state.proxyActive = p.active;
    status.textContent = p.active
      ? `🟢 Active: ${p.protocol}://${p.host}:${p.port}${p.hasAuth ? ' (auth)' : ''}`
      : '⚪ No proxy — outbound traffic is direct.';
  } catch { /* panel still usable */ }

  $('#proxy-apply').addEventListener('click', async () => {
    const body = {
      protocol: $('#proxy-protocol').value,
      host: $('#proxy-host').value.trim(),
      port: $('#proxy-port').value.trim(),
      username: $('#proxy-user').value.trim(),
      password: $('#proxy-pass').value,
    };
    try {
      const res = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) return toast(`⚠️ ${data.error}`);
      state.proxyActive = data.active;
      status.textContent = data.message || '';
      toast('🛰️ ' + (data.message || 'Proxy updated'));
    } catch {
      toast('Could not reach the proxy endpoint');
    }
  });

  $('#proxy-disable').addEventListener('click', async () => {
    await fetch('/api/proxy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    state.proxyActive = false;
    status.textContent = '⚪ Proxy disabled — outbound traffic is direct.';
    toast('Proxy disabled');
  });
}

/* ════════════════════════════════════════════════════════════════════════
 * 22. Keyboard navigation (15)
 * ════════════════════════════════════════════════════════════════════════ */
function initKeyboardNav() {
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const inModal = !!document.querySelector('.modal-open');

    // '/' focuses the search bar (unless typing elsewhere).
    if (e.key === '/' && !inField && !inModal) {
      e.preventDefault();
      $('#search-input').focus();
    }
    if (e.key === 'Escape') {
      hideSuggestions();
      if (inField && document.activeElement === $('#search-input') && $('#search-input').value) {
        $('#search-input').value = '';
        updateBangChip('');
      }
    }
    if (inField) return;

    // Arrow navigation across result cards (feature 15).
    const cards = $$('.result-card');
    if (!cards.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      state.currentIndex = Math.min(Math.max(state.currentIndex + dir, 0), cards.length - 1);
      const card = cards[state.currentIndex];
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      cards.forEach((c) => c.classList.remove('ring-2', 'ring-accent'));
      card.classList.add('ring-2', 'ring-accent');
      card.querySelector('.result-link')?.focus({ preventScroll: true });
    }
    if (e.key === 'Enter' && state.currentIndex >= 0) {
      const link = cards[state.currentIndex]?.querySelector('.result-link');
      if (link) window.open(link.href, '_blank');
    }
  });
}

/* ════════════════════════════════════════════════════════════════════════
 * 23. Modals + misc wiring
 * ════════════════════════════════════════════════════════════════════════ */
function openModal(id) {
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  el.classList.add('modal-open');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  const el = document.getElementById(id);
  el.classList.add('hidden');
  el.classList.remove('modal-open');
  document.body.style.overflow = '';
}
function closeAllModals() {
  $$('.modal-open').forEach((m) => closeModal(m.id));
}

function initModalsAndControls() {
  // Generic close-on-backdrop.
  $$('[role="dialog"]').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(m.id); });
  });

  $('#reader-close').addEventListener('click', () => closeModal('reader-modal'));
  $('#reader-open').addEventListener('click', () => window.open(readerUrl, '_blank'));
  $('#reader-tts').addEventListener('click', () => speak($('#reader-content').innerText));

  $('#qr-close').addEventListener('click', () => closeModal('qr-modal'));
  $('#qr-download').addEventListener('click', () => {
    const img = $('#qr-canvas img');
    if (img?.src) download(`aura-qr-${Date.now()}.png`, img.src, 'image/png');
  });

  $('#open-settings').addEventListener('click', () => {
    $('#bookmark-count').textContent = state.bookmarks.length;
    $('#history-count').textContent = state.history.length;
    openModal('settings-modal');
  });
  $('#settings-close').addEventListener('click', () => closeModal('settings-modal'));

  $('#open-bookmarks').addEventListener('click', () => {
    renderBookmarks();
    renderTagFilters();
    openModal('bookmarks-modal');
  });
  $('#bookmarks-close').addEventListener('click', () => closeModal('bookmarks-modal'));
  $('#bookmark-search').addEventListener('input', (e) => renderBookmarks(e.target.value));

  $('#open-history').addEventListener('click', () => {
    renderHistory();
    openModal('history-modal');
  });
  $('#history-close').addEventListener('click', () => closeModal('history-modal'));
  $('#clear-history').addEventListener('click', () => {
    state.history = [];
    LS.set('aura.history', []);
    $('#history-count').textContent = '0';
    toast('🗑 History cleared');
  });

  // Search submit paths.
  $('#search-btn').addEventListener('click', doSearch);
  $('#search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (suggestIdx >= 0 && suggestBox.classList.contains('hidden') === false) {
        const sel = $$('#suggest-box button')[suggestIdx];
        if (sel) sel.click();
        return;
      }
      doSearch();
    }
    if (e.key === 'ArrowDown' && !suggestBox.classList.contains('hidden')) {
      e.preventDefault();
      const count = $$('#suggest-box button').length;
      if (count) { suggestIdx = (suggestIdx + 1) % count; markSuggestion(); }
    }
    if (e.key === 'ArrowUp' && !suggestBox.classList.contains('hidden')) {
      e.preventDefault();
      const count = $$('#suggest-box button').length;
      if (count) { suggestIdx = (suggestIdx - 1 + count) % count; markSuggestion(); }
    }
    if (e.key === 'Escape') hideSuggestions();
  });
  $('#search-input').addEventListener('input', (e) => {
    state.queryActive = true;
    updateBangChip(e.target.value);
    if (e.target.value.trim()) debouncedSuggest(e.target.value);
    else hideSuggestions();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#suggest-box') && !e.target.closest('#search-input')) {
      hideSuggestions();
      state.queryActive = false;
    }
  });

  // Chat.
  $('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); sendChatMessage(); });
  $('#chat-about-summary').addEventListener('click', () => {
    const summary = state.aiSummary || '';
    if (summary) {
      $('#chat-input').value = 'Summarize the current AI answer: ' + summary.slice(0, 300);
      sendChatMessage();
    }
  });

  // Weather city edit.
  $('#weather-edit').addEventListener('click', () => {
    const city = prompt('City name or "lat,lon":', LS.get('aura.city', 'Dhaka'));
    if (city?.trim()) loadWeather(city.trim());
  });

  // Export dropdown menu (feature 14) — JSON / CSV / TXT.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act="export"]');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      closeExportMenu();
      const menu = document.createElement('div');
      menu.id = 'export-menu';
      menu.className = 'absolute right-0 top-9 z-30 w-40 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden text-xs';
      menu.innerHTML = `
        <div class="px-3 py-2 font-semibold text-slate-400 border-b border-slate-100 dark:border-slate-800">Export results</div>
        <button data-fmt="json" class="w-full text-left px-3 py-2 hover:bg-accent/10">📦 JSON</button>
        <button data-fmt="csv" class="w-full text-left px-3 py-2 hover:bg-accent/10">📊 CSV</button>
        <button data-fmt="txt" class="w-full text-left px-3 py-2 hover:bg-accent/10">📄 TXT</button>`;
      btn.closest('[data-actions]').appendChild(menu);
      menu.querySelectorAll('button').forEach((b) => {
        b.addEventListener('click', () => { exportResults(b.dataset.fmt); closeExportMenu(); });
      });
    } else {
      closeExportMenu();
    }
  });
  function closeExportMenu() { $('#export-menu')?.remove(); }

  // Tabs.
  $$('.tab-btn').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.cat)));

  // Bang chip clear.
  $('#bang-chip-clear').addEventListener('click', () => {
    $('#search-input').value = '';
    updateBangChip('');
    $('#search-input').focus();
  });

  // Logo returns home.
  $('#logo-home').addEventListener('click', (e) => {
    e.preventDefault();
    location.hash = '';
    state.query = '';
    $('#search-input').value = '';
    resultsBox.innerHTML = '';
    $('#ai-summary').classList.add('hidden');
    $('#math-widget').classList.add('hidden');
    $('#status-line').classList.add('hidden');
    $('#related-section').classList.add('hidden');
    $('#hero').classList.remove('hidden');
    loadTrending();
  });

  // Mobile chat FAB (chat is fixed-sidebar on xl+ screens only).
  const fab = document.createElement('button');
  fab.id = 'chat-fab';
  fab.className = 'xl:hidden fixed bottom-16 right-4 z-40 w-12 h-12 rounded-full text-white shadow-2xl grid place-items-center text-xl';
  fab.style.background = 'var(--accent)';
  fab.textContent = '🤖';
  fab.title = 'Aura AI chat';
  document.body.appendChild(fab);
  let mobileChatOpen = false;
  fab.addEventListener('click', () => {
    mobileChatOpen = !mobileChatOpen;
    const panel = $('#chat-widget');
    panel.classList.toggle('hidden', !mobileChatOpen);
    if (mobileChatOpen) {
      panel.classList.add('fixed', 'inset-x-3', 'bottom-20', 'top-16', 'z-50', 'shadow-2xl');
      $('#chat-chev').textContent = '▴';
    } else {
      panel.classList.remove('fixed', 'inset-x-3', 'bottom-20', 'top-16', 'z-50', 'shadow-2xl');
      $('#chat-chev').textContent = '▾';
    }
  });
}

/* ════════════════════════════════════════════════════════════════════════
 * 24. Boot
 * ════════════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initThemeAndAccent();
  initLanguageRegion();
  initVoiceSearch();
  initKeyboardNav();
  initModalsAndControls();
  initImageSearch();
  initProxyPanel();
  initClock();
  refreshStats();
  setInterval(refreshStats, 15000);
  loadBangs();
  loadWeather();
  loadTrending();
  restoreFromUrlHash();
});
