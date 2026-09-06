/**
 * Aura Browser 2.0 — frontend DOM smoke test (dev tool, not part of npm test).
 *
 * Loads the real index.html + app.js into jsdom, simulates a search,
 * and verifies the UI responds (results render, math widget works,
 * bookmarks persist). Useful for catching runtime JS errors in CI.
 *
 * Run:  node scripts/dom-smoke.js   (requires: npm i --no-save jsdom)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
const researchToolsJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'research-tools.js'), 'utf8');

const dom = new JSDOM(html, {
  url: 'http://localhost:3000/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;

// --- minimal browser API shims -------------------------------------------
let lastSearchRequest = '';
window.fetch = async (url) => {
  // Real browsers resolve relative URLs before fetch; jsdom passes them raw.
  const u = String(new URL(String(url), window.location.href));
  if (u.includes('/api/bangs')) {
    return json({ bangs: [{ key: 'w', name: 'Wikipedia' }] });
  }
  if (u.includes('/api/stats')) return json({ requestsProxied: 3 });
  if (u.includes('/api/trending')) return json({ items: [] });
  if (u.includes('/api/weather')) return json({ city: 'Test', unit: '°C', current: { temperature_2m: 21 }, wmo: { icon: '☀️', label: 'Sunny' } });
  if (u.includes('/api/suggest')) return json({ suggestions: ['quantum computing'] });
  if (u.includes('/api/chat')) return json({ content: 'Selected-text explanation' });
  if (u.includes('/api/search')) {
    lastSearchRequest = u;
    let params;
    try { params = new URLSearchParams(new URL(u).search); } catch (e) { throw new Error('mock URL parse: ' + e.message + ' :: ' + u); }
    const q = params.get('q') || '';
    if (/^[\d\s+\-*/().%^]+$/.test(q) && /[+\-*/%^]/.test(q.replace(/^\s*-\s*/, ''))) {
      return json({ type: 'math', query: q, math: { expression: q, result: 63, pretty: '63' }, results: [], engines: [], related: [] });
    }
    return json({
      type: 'search',
      query: q,
      results: [
        { title: 'Quantum Computing — Wikipedia', url: 'https://en.wikipedia.org/wiki/Quantum_computing', content: 'Quantum computing uses qubits and superposition. function test() { return 42; }', engine: 'wikipedia', domain: 'wikipedia.org' },
        { title: 'Duplicate Title', url: 'https://a.com/1', content: 'dup', engine: 'google', domain: 'a.com' },
      ],
      engines: ['wikipedia', 'google'],
      removedDuplicates: 2,
      related: [{ id: 'q1', question: 'What is quantum?', answer: null }],
    });
  }
  if (u.includes('/api/summary')) {
    return json({ provider: 'extractive', summary: '**Quantum computing** uses qubits. See [wikipedia](https://en.wikipedia.org).' });
  }
  if (u.includes('/api/proxy')) return json({ active: false });
  if (u.includes('/api/config')) return json({});
  throw new Error(`unexpected fetch: ${u}`);
};
function json(body) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body });
}

// LocalStorage + SpeechSynthesis + clipboard shims.
const store = new Map();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  },
});
window.SpeechSynthesisUtterance = class {};
window.speechSynthesis = { speak() {}, cancel() {}, pause() {} };
window.matchMedia = () => ({ matches: false });
window.HTMLElement.prototype.scrollIntoView = () => {};
window.navigator.clipboard = { writeText: async () => {} };

const errors = [];
window.addEventListener('error', (e) => errors.push('window:' + e.message));
window.addEventListener('unhandledrejection', (e) => errors.push('promise:' + (e.reason?.message || e.reason)));
window.console.error = (...a) => errors.push('console:' + a.map(String).join(' '));

// --- execute app -----------------------------------------------------------
try {
  window.eval(appJs);
  window.eval(researchToolsJs);
} catch (err) {
  console.error('✗ frontend script threw during evaluation:', err.message);
  process.exit(1);
}

if (errors.length) {
  console.log('⚠ early errors:\n  ' + errors.join('\n  '));
}

// Give the boot handlers a tick.
setTimeout(() => {
  let failed = 0;
  const check = (name, cond) => {
    console.log(`${cond ? '✓' : '✗'} ${name}`);
    if (!cond) failed++;
  };

  // 1. Theme + research controls initialize.
  check('theme toggle wired', document.getElementById('theme-toggle') !== null);
  check('research controls initialize', document.getElementById('aura-research-controls') !== null);
  check('research search hook is available', typeof window.AuraResearch?.getSearchOptions === 'function');

  // 2. Typing a query shows suggestions + bang chip.
  const input = document.getElementById('search-input');
  input.value = '!w quantum';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  setTimeout(() => {
    check('bang chip appears', !document.getElementById('bang-chip').classList.contains('hidden'));

    // 3. Search renders results.
    input.value = 'quantum computing';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    setTimeout(() => {
      const cards = document.querySelectorAll('.result-card');
      check('results rendered', cards.length === 2);
      check('de-dup status shown', document.getElementById('status-line').textContent.includes('duplicates removed'));
      check('AI summary box visible', !document.getElementById('ai-summary').classList.contains('hidden'));
      check('code block rendered', !!document.querySelector('.code-block'));

      // 4. Related questions accordion.
      check('related questions rendered', document.querySelectorAll('#related-list > div').length === 1);

      // 5. Bookmarks (feature 10/30).
      const saveBtn = cards[0]?.querySelector('[data-act="save"]');
      saveBtn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      const bookmarks = JSON.parse(window.localStorage.getItem('aura.bookmarks') || '[]');
      check('bookmark saved to localStorage', bookmarks.length === 1);
      check('bookmark counter updated', document.getElementById('bookmark-count').textContent === '1');

      // 6. Research result tools render and open a citation without a remote call.
      const citationButton = cards[0]?.querySelector('[data-research-act="cite"]');
      check('research actions added to result cards', !!citationButton);
      citationButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      check('citation tool opens', document.getElementById('research-modal-title').textContent.includes('Citation'));
      document.getElementById('research-modal-close')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      document.dispatchEvent(new window.CustomEvent('aura:ask-text', { detail: { text: 'A focused research excerpt.' } }));
      check('selected-text hook starts Aura chat', document.getElementById('chat-messages').textContent.includes('focused research excerpt'));
      document.dispatchEvent(new window.CustomEvent('aura:reader', { detail: { url: 'https://example.org/article', title: 'Example article' } }));
      check('reader offers offline library save', !!document.getElementById('reader-save-offline'));
      const readerTranslate = document.getElementById('reader-translate-full');
      check('reader offers page-excerpt translation', !!readerTranslate);
      readerTranslate?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      check('reader translation tool opens', document.getElementById('research-modal-title').textContent.includes('Translate'));
      document.getElementById('research-modal-close')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      document.getElementById('open-research-hub')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      check('research hub opens', document.getElementById('research-modal-title').textContent.includes('Offline library'));
      check('research hub offers offline library', !!document.querySelector('[data-hub="library"]'));
      document.getElementById('research-modal-close')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

      // 7. Advanced filters request the primary search through the public event.
      document.getElementById('toggle-advanced-filters')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      const domainFilter = document.getElementById('filter-domain');
      const timeFilter = document.getElementById('filter-time-range');
      domainFilter.value = 'example.org';
      domainFilter.dispatchEvent(new window.Event('change', { bubbles: true }));
      timeFilter.value = 'week';
      timeFilter.dispatchEvent(new window.Event('change', { bubbles: true }));
      document.getElementById('apply-advanced-filters')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      setTimeout(() => {
        const filteredParams = new URL(lastSearchRequest).searchParams;
        check('advanced domain filter is forwarded', filteredParams.get('q').includes('site:example.org'));
        check('advanced freshness filter is forwarded', filteredParams.get('time_range') === 'week');
        document.getElementById('clear-advanced-filters')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

        // 8. Math widget (feature 6).
        input.value = '12*5+3';
        input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        setTimeout(() => {
          check('math widget visible', !document.getElementById('math-widget').classList.contains('hidden'));
          check('math result correct', document.getElementById('math-widget').textContent.includes('63'));

          // 9. History recorded.
          const history = JSON.parse(window.localStorage.getItem('aura.history') || '[]');
          check('history recorded', history.length >= 3);
          check('no runtime JS errors', errors.length === 0);

          console.log(failed === 0 ? '\n✅ ALL DOM SMOKE CHECKS PASSED' : `\n❌ ${failed} CHECK(S) FAILED`);
          process.exit(failed === 0 ? 0 : 1);
        }, 80);
      }, 120);
    }, 120);
  }, 60);
}, 80);
