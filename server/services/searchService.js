/**
 * Aura Browser 2.0 — search orchestration service.
 *
 * Feature 1 : AI summary box (delegates to services/llm.js)
 * Feature 2 : de-duplication (utils/normalize.js)
 * Feature 3 : zero-tracking — this module never logs queries or results
 * Feature 4 : categorized tabs → SearXNG `categories` param
 * Feature 7 : DuckDuckGo instant suggestions (separate route, see routes/)
 * Feature 8 : "People Also Ask" — derived from DDG related searches + local
 *             query-intent expansion
 * Feature 9 : multi-language — `language` param passed to SearXNG
 * Feature 17: region — `safesearch` + `region` params
 * Feature 18: SafeSearch — `safesearch` param (0/1/2)
 * Feature 19: advanced operators pre-processed before hitting SearXNG
 * Feature 22: bang shortcuts short-circuit to target engine URLs
 * Feature 28: reverse image search (image_url: / reverse_image: operators)
 */
'use strict';

const config = require('../config');
const { safeFetch } = require('../utils/httpClient');
const {
  dedupeResults,
  parseBang,
  processOperators,
  parseUrlParts,
  extractDomain,
  detectMathExpression,
  isValidHttpUrl,
} = require('../utils/normalize');
const { generateSummary } = require('./llm');

// ---------------------------------------------------------------------------
// Category → SearXNG categories / engines mapping (feature 4)
// ---------------------------------------------------------------------------
const CATEGORY_MAP = {
  all: { categories: 'general', engines: '' },
  news: { categories: 'news', engines: 'google news,bing news,duckduckgo news' },
  images: { categories: 'images', engines: 'google images,bing images,duckduckgo images' },
  code: { categories: 'it', engines: 'github,stackoverflow' },
  scientific: { categories: 'science', engines: 'arxiv,core,base' },
  videos: { categories: 'videos', engines: 'youtube,google videos' },
};

// ---------------------------------------------------------------------------
// Public SearXNG instances used ONLY when SEARXNG_URL is not configured.
// ---------------------------------------------------------------------------
const PUBLIC_SEARXNG = [
  'https://searx.be',
  'https://search.bus-hit.me',
  'https://paulgo.io',
  'https://searx.tiekoetter.com',
];

// ---------------------------------------------------------------------------
// 1. Direct SearXNG JSON API
// ---------------------------------------------------------------------------
async function searxngSearch({ query, category = 'all', language = 'en', region = '', safesearch = 1, page = 1 }) {
  const cat = CATEGORY_MAP[category] || CATEGORY_MAP.all;
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    categories: cat.categories,
    language,
    safesearch: String(safesearch),
    pageno: String(Math.max(1, Number(page) || 1)),
  });
  if (region) params.set('region', region);
  if (config.searxng.engines.length) params.set('engines', config.searxng.engines.join(','));
  else if (cat.engines) params.set('engines', cat.engines);

  const url = `${config.searxng.url}/search?${params.toString()}`;
  const response = await safeFetch(url, {
    timeoutMs: config.searxng.timeoutMs,
    headers: { accept: 'application/json' },
    allowPrivate: true, // the admin's own SearXNG instance (often localhost)
  });
  if (!response.ok) throw new Error(`SearXNG responded with HTTP ${response.status}`);
  const data = await response.json();
  return (data.results || []).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    content: r.content || r.publishedDate || '',
    engine: (r.engine || 'searxng').split(',')[0].trim(),
    category: r.category || category,
    score: Number(r.score || 0),
    published: r.publishedDate || null,
  }));
}

// ---------------------------------------------------------------------------
// 2. DuckDuckGo HTML fallback (no key required) — used when SearXNG is down.
// ---------------------------------------------------------------------------
async function ddgHtmlSearch({ query, category = 'all', language = 'en', region = '', safesearch = 1 }) {
  const params = new URLSearchParams({
    q: query,
    kl: region || (language.startsWith('bn') ? 'bn-bd' : 'us-en'),
    kp: safesearch === 2 ? '1' : '-1',
    ia: category === 'images' ? 'images' : 'web',
  });
  const response = await safeFetch(`https://html.duckduckgo.com/html/?${params}`, {
    timeoutMs: 15000,
    headers: { accept: 'text/html' },
  });
  if (!response.ok) throw new Error(`DuckDuckGo responded with HTTP ${response.status}`);
  const html = await response.text();

  // Lightweight regex extraction of DDG HTML result rows (best-effort).
  const results = [];
  const rowRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null && results.length < 20) {
    const rawUrl = m[1]
      .replace(/&amp;/g, '&')
      .replace(/uddg=([^&]+)/, (_f, enc) => {
        try { return decodeURIComponent(enc); } catch { return enc; }
      });
    const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    const strip = (s) =>
      String(s || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .trim();
    results.push({
      title: strip(m[2]),
      url,
      content: strip(m[3]).slice(0, 400),
      engine: 'duckduckgo',
      category,
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// 3. Related questions / "People Also Ask" (feature 8)
// ---------------------------------------------------------------------------
const QUESTION_PATTERNS = [
  (q) => `What is ${q}?`,
  (q) => `How does ${q} work?`,
  (q) => `Why is ${q} important?`,
  (q) => `${q} examples`,
  (q) => `${q} vs alternatives`,
  (q) => `Best resources for ${q}`,
];

async function fetchDdgRelated(query, language = 'en') {
  const params = new URLSearchParams({
    q: query,
    kl: language.startsWith('bn') ? 'bn-bd' : 'us-en',
  });
  const response = await safeFetch(`https://duckduckgo.com/html/?${params}`, {
    timeoutMs: 12000,
    headers: { accept: 'text/html' },
  });
  if (!response.ok) throw new Error(`DDG related: HTTP ${response.status}`);
  const html = await response.text();

  const related = [];
  // DDG renders related searches as links in the footer ("Related searches").
  const re = /class="result-link"[^>]*href="([^"]*)"[^>]*>([^<]+)</g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = String(m[2]).trim();
    if (text.length > 4 && text.length < 120) related.push(text);
    if (related.length >= 6) break;
  }
  return related;
}

/** Merge DDG related searches with local question patterns, de-duplicated. */
async function buildRelatedQuestions(query, language) {
  const questions = new Set();
  for (const p of QUESTION_PATTERNS) {
    questions.add(p(query));
  }
  try {
    const related = await fetchDdgRelated(query, language);
    for (const r of related.slice(0, 4)) questions.add(r.endsWith('?') ? r : `What about "${r}"?`);
  } catch {
    /* local patterns are enough when DDG is unreachable */
  }
  return [...questions].slice(0, 6).map((question, i) => ({
    id: `q-${i}-${Date.now()}`,
    question,
    answer: null, // resolved lazily by the frontend (accordion expansion)
  }));
}

// ---------------------------------------------------------------------------
// 4. Search orchestration — the single endpoint used by /api/search
// ---------------------------------------------------------------------------
async function runSearch(rawQuery, opts = {}) {
  const {
    category = 'all',
    language = 'en',
    region = '',
    safesearch = 1,
    page = 1,
    engines = '',
  } = opts;

  const { bang, query } = parseBang(rawQuery);
  const trimmed = query || '';

  // Bang shortcut (feature 22): return the redirect target immediately.
  if (bang) {
    return {
      type: 'bang',
      bang,
      query: trimmed,
      redirectUrl: bang.url + encodeURIComponent(trimmed),
      results: [],
      engines: [],
      math: null,
    };
  }

  // Math widget (feature 6): evaluate client-intended expressions.
  const math = detectMathExpression(trimmed);
  if (math && !/[a-z]/i.test(trimmed.replace(/sqrt|pi|PI/g, ''))) {
    // Pure arithmetic → skip engine round-trip.
    return { type: 'math', query: trimmed, math, results: [], engines: [], related: [] };
  }

  // Advanced operators (feature 19). The processed query keeps native
  // SearXNG tokens (`site:`, `filetype:`, `intitle:` …).
  const { query: processedQuery } = processOperators(trimmed);
  const finalQuery = processedQuery;

  const engineCandidates = engines
    ? engines.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  let rawResults = [];
  let enginesUsed = [];
  let source = 'searxng';
  const errors = [];

  // Primary: SearXNG.
  try {
    rawResults = await searxngSearch({
      query: finalQuery,
      category,
      language,
      region,
      safesearch,
      page,
    });
    enginesUsed = [...new Set(rawResults.map((r) => r.engine))];
  } catch (err) {
    errors.push(`searxng: ${err.message}`);
  }

  // Fallback 1: public SearXNG instances (only when the user opted in).
  if (!rawResults.length && process.env.SEARXNG_PUBLIC_FALLBACK === 'true') {
    for (const instance of PUBLIC_SEARXNG) {
      try {
        const params = new URLSearchParams({
          q: finalQuery,
          format: 'json',
          categories: (CATEGORY_MAP[category] || CATEGORY_MAP.all).categories,
          language,
          safesearch: String(safesearch),
        });
        const response = await safeFetch(`${instance}/search?${params}`, {
          timeoutMs: 9000,
          headers: { accept: 'application/json' },
          allowPrivate: true,
        });
        if (response.ok) {
          const data = await response.json();
          rawResults = (data.results || []).map((r) => ({
            title: r.title || '',
            url: r.url || '',
            content: r.content || '',
            engine: (r.engine || 'searxng-public').split(',')[0].trim(),
            category,
          }));
          enginesUsed = [...new Set(rawResults.map((r) => r.engine))];
          source = 'searxng-public';
          break;
        }
      } catch {
        /* try next instance */
      }
    }
  }

  // Fallback 2: DuckDuckGo HTML.
  if (!rawResults.length && config.fallbackEngine === 'ddg-html') {
    try {
      rawResults = await ddgHtmlSearch({ query: finalQuery, category, language, region, safesearch });
      enginesUsed = ['duckduckgo'];
      source = 'ddg-html';
    } catch (err) {
      errors.push(`ddg-html: ${err.message}`);
    }
  }

  // Reverse-image / visual operators (feature 28) route to a dedicated engine.
  const isVisual = /^(image_url|reverse_image):\s*\S+/i.test(finalQuery);
  if (isVisual && !rawResults.length && config.reverseImage.searxngUrl) {
    try {
      rawResults = await searxngSearch({
        query: finalQuery,
        category: 'images',
        language,
        region,
        safesearch,
        page,
      });
      enginesUsed = [...new Set(rawResults.map((r) => r.engine))];
      source = 'searxng-visual';
    } catch (err) {
      errors.push(`searxng-visual: ${err.message}`);
    }
  }

  // De-duplication (feature 2).
  const { results, removed } = dedupeResults(rawResults.slice(0, 40));

  // Enrich with domain/favicon metadata.
  const enriched = results.map((r) => {
    const { host } = parseUrlParts(r.url);
    return { ...r, domain: extractDomain(host), host };
  });

  // Related questions (feature 8) — only for text categories.
  let related = [];
  if (['all', 'news', 'code', 'scientific'].includes(category) && trimmed) {
    try {
      related = await buildRelatedQuestions(trimmed, language);
    } catch {
      related = [];
    }
  }

  return {
    type: 'search',
    query: trimmed,
    processedQuery: finalQuery,
    category,
    source,
    engines: enginesUsed,
    results: enriched,
    removedDuplicates: removed,
    related,
    math: math || null,
    errors: config.isProd ? [] : errors,
  };
}

// ---------------------------------------------------------------------------
// 5. AI summary (feature 1) — separate so the UI can stream results first.
// ---------------------------------------------------------------------------
async function summarize(query, results) {
  return generateSummary(query, results);
}

module.exports = { runSearch, summarize, CATEGORY_MAP, searxngSearch, ddgHtmlSearch };
