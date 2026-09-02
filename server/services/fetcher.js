/**
 * Aura Browser 2.0 — reading-mode fetcher.
 *
 * Feature 13: Instant Page Preview — fetches a target URL server-side,
 * strips navigation/ads/scripts, and returns a clean, text-first article
 * (title, byline, main content) for the in-app reader modal.
 *
 * Privacy: the URL is fetched through the proxy stack (if configured) and is
 * never logged. The response is sanitized on the server; the client renders
 * it inside a sandboxed iframe (sandbox attr) so no scripts can run.
 */
'use strict';

const config = require('../config');
const { safeFetch, assertPublicHost } = require('../utils/httpClient');
const { extractDomain } = require('../utils/normalize');

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB cap

// Content blobs that are definitely not worth reading.
const JUNK_SELECTORS = [
  'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe',
  'nav', 'header', 'footer', 'aside', 'form', 'button', 'input', 'select',
  '[class*="advert"]', '[id*="advert"]', '[class*="cookie"]', '[id*="cookie"]',
  '[class*="modal"]', '[class*="popup"]', '[class*="share"]', '[class*="menu"]',
  '[class*="sidebar"]', '[class*="comment"]', '[class*="related"]', '[class*="footer"]',
];

/**
 * Fetch + extract readable content.
 * @param {string} url target URL
 * @returns {Promise<{title, byline, domain, content, excerpt, url}>}
 */
async function fetchReadable(url) {
  // SSRF guard + URL sanity.
  await assertPublicHost(new URL(url).hostname);
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs are supported');

  const res = await safeFetch(url, {
    timeoutMs: 12000,
    headers: { accept: 'text/html,application/xhtml+xml' },
  });
  if (!res.ok) throw new Error(`Target responded with HTTP ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    throw new Error('Target is not an HTML page — preview unavailable');
  }

  const html = (await res.text()).slice(0, MAX_BYTES);
  const { parseDocument } = require('cheerio');
  const $ = parseDocument(html);

  // Remove junk first.
  $(JUNK_SELECTORS.join(',')).remove();

  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('h1').first().text() ||
    $('title').first().text() ||
    '';
  const byline =
    $('meta[name="author"]').attr('content') ||
    $('meta[property="article:author"]').attr('content') ||
    $('a[rel="author"]').first().text() ||
    '';
  const description =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    '';

  // Choose the best content container.
  const candidates = $('article, main, [role="main"], .post, .entry-content, .article, .content')
    .toArray()
    .map((el) => {
      const $el = $(el);
      const text = $el.text().replace(/\s+/g, ' ').trim();
      return { el, text, len: text.length };
    })
    .filter((c) => c.len > 200)
    .sort((a, b) => b.len - a.len);

  let $content;
  if (candidates.length) {
    $content = $(candidates[0].el);
  } else {
    // Fallback: pick the largest <p> cluster under <body>.
    const body = $('body').first();
    const paras = body.find('p').toArray().map((p) => $(p).text().replace(/\s+/g, ' ').trim());
    $content = $('<div></div>');
    for (const p of paras) {
      if (p.length > 40) $content.append(`<p>${escapeHtml(p.slice(0, 2000))}</p>`);
    }
  }

  // Keep only meaningful block elements, flatten the rest.
  $content.find('h1,h2,h3,h4,blockquote,li').each((_, el) => {
    $(el).find('a').each((_, a) => $(a).replaceWith($(a).text()));
  });
  $content.find('a').replaceWith(function () { return $(this).text(); });
  $content.find('img').remove();
  $content.find('br,hr,div').each((_, el) => {
    const $el = $(el);
    if ($el.is('div') && $el.text().trim().length < 2) $el.remove();
  });

  const contentHtml = $content.html() || '';
  const excerpt = ($content.text() || '').replace(/\s+/g, ' ').trim().slice(0, 320);

  let domain;
  try {
    domain = extractDomain(new URL(url).hostname);
  } catch {
    domain = url;
  }

  return {
    title: String(title).trim().slice(0, 300),
    byline: String(byline).trim().slice(0, 120),
    description: String(description).trim().slice(0, 400),
    domain,
    url,
    contentHtml: contentHtml.slice(0, 500_000),
    excerpt,
    wordCount: excerpt ? excerpt.split(/\s+/).length : 0,
  };
}

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

module.exports = { fetchReadable };
