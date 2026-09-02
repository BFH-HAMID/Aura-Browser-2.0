/**
 * Aura Browser 2.0 — search result normalizers.
 *
 * Feature 2  : Smart result de-duplication (URL normalization + title
 *              similarity scoring + domain collapse).
 * Feature 19 : Advanced search operator pre-processor (`site:`, `filetype:`,
 *              `intitle:`, `inurl:`, `-`, `"..."`, `|`, etc.) re-formatted
 *              into SearXNG-compatible syntax.
 * Feature 22 : DuckDuckGo-style "bang" shortcuts (`!w`, `!yt`, `!gh` …).
 */
'use strict';

// ---------------------------------------------------------------------------
// 1. URL normalization for de-duplication
// ---------------------------------------------------------------------------

/** Strip tracking params, fragments, and canonicalize scheme/host. */
function normalizeUrl(rawUrl) {
  if (!rawUrl) return '';
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return rawUrl.trim().toLowerCase();
  }

  const TRACKING = new Set([
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'gclid', 'fbclid', 'mc_cid', 'mc_eid', 'igshid', 'dclid', 'msclkid',
    'ref', 'ref_src', 'ref_url', 'source', 'spm', 'yclid', 'wickedid',
    'srsltid', 'si',
  ]);
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING.has(key.toLowerCase())) u.searchParams.delete(key);
  }
  u.hash = '';
  u.searchParams.sort();
  return u.href.replace(/\/+$/, '').toLowerCase();
}

/** Best-effort title normalization for fuzzy matching. */
function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0980-\u09ff\u0400-\u04ff\u4e00-\u9fff]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Dice coefficient on word bigrams — decent fuzzy title similarity. */
function titleSimilarity(a, b) {
  const wa = normalizeTitle(a).split(' ');
  const wb = normalizeTitle(b).split(' ');
  if (!wa.length || !wb.length) return 0;
  const bigrams = (words) => {
    const set = new Set();
    for (let i = 0; i < words.length - 1; i++) set.add(`${words[i]} ${words[i + 1]}`);
    if (words.length === 1) set.add(words[0]);
    return set;
  };
  const ba = bigrams(wa);
  const bb = bigrams(wb);
  let overlap = 0;
  for (const b of bb) if (ba.has(b)) overlap++;
  return (2 * overlap) / (ba.size + bb.size || 1);
}

/** Parse a human URL (possibly missing scheme) to { host, domain, path }. */
function parseUrlParts(raw) {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return { host: u.hostname.toLowerCase(), path: u.pathname };
  } catch {
    return { host: '', path: '' };
  }
}

/** Extract the registrable-ish domain (last two labels, handles co.uk etc.). */
function extractDomain(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  const parts = host.split('.').filter(Boolean);
  const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'ne', 'or', 'mil', 'blog']);
  if (parts.length > 2 && SECOND_LEVEL.has(parts[parts.length - 2])) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

// ---------------------------------------------------------------------------
// 2. De-duplication engine
// ---------------------------------------------------------------------------

/**
 * De-duplicate an array of raw engine results.
 *  - exact normalized-URL match → drop (keeps the richest result)
 *  - same domain + near-identical title → drop
 *  - identical titles from the same domain → drop
 *  - otherwise keep, tagging `duplicateOf: false`
 * Returns { results, removed } so tests/UI can show how many were filtered.
 */
function dedupeResults(results) {
  const seenUrls = new Map(); // normalizedUrl -> kept result
  const seenTitleKeys = new Map(); // `${domain}::${title}` -> kept result
  const seenDomains = new Set();
  const kept = [];
  let removed = 0;

  const score = (r) => (r.title ? r.title.length : 0) + (r.content ? r.content.length : 0);

  for (const result of results) {
    const normUrl = normalizeUrl(result.url || '');
    const { host } = parseUrlParts(result.url || '');
    const domain = extractDomain(host);
    const titleKey = `${domain}::${normalizeTitle(result.title)}`;

    let duplicate = false;

    // (a) Exact normalized URL already seen.
    if (normUrl && seenUrls.has(normUrl)) duplicate = true;

    // (b) Same domain + identical normalized title.
    if (!duplicate && titleKey && seenTitleKeys.has(titleKey)) duplicate = true;

    // (c) Same domain + fuzzy-similar title → merge into the richer result.
    if (!duplicate && host) {
      for (const [key, prev] of seenTitleKeys) {
        if (key.startsWith(`${domain}::`)) {
          const prevTitle = key.slice(domain.length + 2);
          if (titleSimilarity(prevTitle, normalizeTitle(result.title)) >= 0.85) {
            duplicate = true;
            if (score(result) > score(prev)) {
              // Replace the weaker result with this richer one.
              kept.splice(kept.indexOf(prev), 1, { ...result, duplicateOf: false });
              seenTitleKeys.set(key, result);
            }
            break;
          }
        }
      }
    }

    // (d) The very same URL appearing multiple times (http/https variants).
    if (!duplicate && normUrl && seenDomains.has(normUrl.replace(/^https?:\/\//, ''))) {
      duplicate = true;
    }

    if (duplicate) {
      removed++;
      continue;
    }

    const clean = { ...result, duplicateOf: false };
    if (normUrl) seenUrls.set(normUrl, clean);
    if (titleKey) seenTitleKeys.set(titleKey, clean);
    if (normUrl) seenDomains.add(normUrl.replace(/^https?:\/\//, ''));
    kept.push(clean);
  }

  return { results: kept, removed };
}

// ---------------------------------------------------------------------------
// 3. Bang shortcuts (feature 22)
// ---------------------------------------------------------------------------
const BANGS = {
  w: { name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=' },
  wiki: { name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=' },
  yt: { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=' },
  gh: { name: 'GitHub', url: 'https://github.com/search?q=' },
  gi: { name: 'GitHub', url: 'https://github.com/search?q=' },
  g: { name: 'Google', url: 'https://www.google.com/search?q=' },
  ddg: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  b: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  so: { name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q=' },
  mdn: { name: 'MDN Docs', url: 'https://developer.mozilla.org/search?q=' },
  npm: { name: 'npm', url: 'https://www.npmjs.com/search?q=' },
  py: { name: 'Python Docs', url: 'https://docs.python.org/3/search.html?q=' },
  wa: { name: 'WolframAlpha', url: 'https://www.wolframalpha.com/input?i=' },
  imdb: { name: 'IMDb', url: 'https://www.imdb.com/find/?q=' },
  reddit: { name: 'Reddit', url: 'https://www.reddit.com/search/?q=' },
  r: { name: 'Reddit', url: 'https://www.reddit.com/search/?q=' },
  x: { name: 'X / Twitter', url: 'https://twitter.com/search?q=' },
  t: { name: 'Twitter', url: 'https://twitter.com/search?q=' },
  maps: { name: 'Google Maps', url: 'https://www.google.com/maps/search/' },
  translate: { name: 'Google Translate', url: 'https://translate.google.com/?sl=auto&text=' },
  torrent: { name: 'Torrents', url: 'https://www.torrentz2.eu/search?f=' },
  scholar: { name: 'Google Scholar', url: 'https://scholar.google.com/scholar?q=' },
  wiki_bn: { name: 'Wikipedia (বাংলা)', url: 'https://bn.wikipedia.org/w/index.php?search=' },
  news: { name: 'News', url: 'https://news.google.com/search?q=' },
  amazon: { name: 'Amazon', url: 'https://www.amazon.com/s?k=' },
  ebay: { name: 'eBay', url: 'https://www.ebay.com/sch/i.html?_nkw=' },
  arxiv: { name: 'arXiv', url: 'https://arxiv.org/list?search_query=all:' },
  hn: { name: 'Hacker News', url: 'https://hn.algolia.com/?q=' },
  dictionary: { name: 'Dictionary', url: 'https://www.dictionary.com/browse/' },
};

/**
 * Detect a leading bang token. Returns
 * { bang: {key,name,url}, query } or { bang: null, query }.
 */
function parseBang(query) {
  const match = /^!([a-z0-9_]+)\s*(.*)$/i.exec(String(query || '').trim());
  if (!match) return { bang: null, query: String(query || '').trim() };
  const key = match[1].toLowerCase();
  if (BANGS[key]) {
    return {
      bang: { key, ...BANGS[key] },
      query: match[2].trim(),
    };
  }
  return { bang: null, query: String(query || '').trim() };
}

/** List of supported bang keys (for the UI hint chip). */
const bangList = () => Object.entries(BANGS).map(([key, v]) => ({ key, name: v.name }));

// ---------------------------------------------------------------------------
// 4. Advanced operators (feature 19)
// ---------------------------------------------------------------------------
const OPERATOR_RE =
  /(site|domain|filetype|ext|intitle|inurl|inanchor|intext|lang|language|after|before|author|url):\s*([^\s]+)/gi;

/**
 * Recognize search operators and convert them to SearXNG-native filters.
 * Returns { query, filters } where filters are key/value pairs appended as
 * SearXNG query params (`site:` stays a plain query token — SearXNG supports
 * it natively; filetype: is translated to `filetype:` too but kept visible).
 */
function processOperators(query) {
  let q = String(query || '').trim();
  const filters = {};
  const seen = new Set();

  q = q.replace(OPERATOR_RE, (full, key, value) => {
    const k = key.toLowerCase();
    const v = value.trim();
    if (seen.has(k)) return full; // keep first occurrence only
    seen.add(k);
    switch (k) {
      case 'site':
      case 'domain':
        filters.site = v.replace(/^www\./, '');
        return `site:${v}`; // SearXNG understands `site:` natively
      case 'filetype':
      case 'ext':
        filters.filetype = v.replace(/^\./, '');
        return `filetype:${v.replace(/^\./, '')}`;
      case 'intitle':
        return `intitle:${v}`;
      case 'inurl':
        return `inurl:${v}`;
      case 'inanchor':
        return `inanchor:${v}`;
      case 'intext':
        return `intext:${v}`;
      case 'lang':
      case 'language':
        filters.language = v;
        return '';
      case 'after':
        filters.time_range = ''; // SearXNG handles `after:` via raw query
        return `after:${v}`;
      case 'before':
        return `before:${v}`;
      case 'author':
        return `author:${v}`;
      default:
        return full;
    }
  });

  return { query: q.replace(/\s+/g, ' ').trim(), filters };
}

// ---------------------------------------------------------------------------
// 5. Math expression detection (feature 6)
// ---------------------------------------------------------------------------

/**
 * Detect & safely evaluate arithmetic expressions (incl. Bengali digits).
 * Returns null when the query is not a pure math expression.
 */
function detectMathExpression(query) {
  const q = String(query || '').trim();
  if (!q) return null;

  // Bengali numerals → ASCII (feature 9 friendly).
  const BN = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9', '৳': '' };
  let ascii = q.replace(/[০-৯৳]/g, (c) => BN[c]);

  // Normalize tokens: ×→*, ÷→/, −→-, √→sqrt(), ^→**
  ascii = ascii
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−|–/g, '-')
    .replace(/\^/g, '**')
    .replace(/√(\d+(?:\.\d+)?)/g, 'sqrt($1)')
    .replace(/pi/gi, 'PI');

  // A pure expression: digits/operators/parens/functions only.
  if (!/^[\d\s+\-*/().,%^sqrtPIE!]+$/.test(ascii)) return null;
  if (!/[\d]/.test(ascii)) return null;
  // Needs at least one operator OR a unary function (sqrt, !, leading -).
  const noLeadMinus = ascii.replace(/^\s*-\s*/, '');
  if (!/[+\-*/%^]/.test(noLeadMinus) && !/sqrt|!/.test(noLeadMinus)) return null;

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      'PI',
      `"use strict"; return (${ascii
        .replace(/\bsqrt\s*\(/g, 'Math.sqrt(')
        .replace(/\bPI\b/g, 'Math.PI')
        .replace(/\%/g, '/100')});`
    );
    const value = fn(Math.PI);
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return {
      expression: q,
      result: value,
      pretty:
        Math.abs(value) >= 1e15 || (Math.abs(value) < 1e-6 && value !== 0)
          ? value.toExponential(10)
          : String(Math.round(value * 1e10) / 1e10),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 6. Misc helpers shared by routes
// ---------------------------------------------------------------------------
const isValidHttpUrl = (s) => {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

module.exports = {
  normalizeUrl,
  normalizeTitle,
  titleSimilarity,
  extractDomain,
  parseUrlParts,
  dedupeResults,
  parseBang,
  bangList,
  processOperators,
  detectMathExpression,
  isValidHttpUrl,
};
