/**
 * Aura Browser 2.0 — keyless research-tool services.
 *
 * RSS/Atom parsing, translation, and archive lookup all run through Aura's
 * privacy-safe outbound client. No request payload is written to disk.
 */
'use strict';

const { XMLParser } = require('fast-xml-parser');
const config = require('../config');
const { safeFetch } = require('../utils/httpClient');
const { isValidHttpUrl } = require('../utils/normalize');

const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_TRANSLATION_CHARS = 3000;
const SUPPORTED_LANGUAGES = new Set(['en', 'bn', 'hi', 'es', 'fr', 'de', 'ar', 'pt', 'ru', 'ja', 'zh', 'it', 'tr']);

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

const asArray = (value) => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

function textValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textValue).join(' ');
  if (typeof value === 'object') {
    if (value['#text'] !== undefined) return textValue(value['#text']);
    if (value.__cdata !== undefined) return textValue(value.__cdata);
    return Object.entries(value)
      .filter(([key]) => !key.startsWith('@_'))
      .map(([, child]) => textValue(child))
      .join(' ');
  }
  return '';
}

async function readTextLimit(response, maxBytes, label = 'Response') {
  const advertisedLength = Number(response.headers?.get?.('content-length') || 0);
  if (Number.isFinite(advertisedLength) && advertisedLength > maxBytes) {
    throw new Error(`${label} is too large (limit: ${Math.floor(maxBytes / 1024 / 1024)} MB)`);
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new Error(`${label} is too large`);
    return text;
  }

  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new Error(`${label} is too large (limit: ${Math.floor(maxBytes / 1024 / 1024)} MB)`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks).toString('utf8');
}

function cleanText(value, max = 500) {
  return textValue(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function linkValue(value) {
  const candidates = asArray(value).slice().sort((a, b) => {
    const rank = (candidate) => {
      if (!candidate || typeof candidate !== 'object') return 1;
      const rel = String(candidate['@_rel'] || candidate.rel || '').toLowerCase();
      return rel === 'alternate' ? 0 : rel ? 2 : 1;
    };
    return rank(a) - rank(b);
  });
  for (const candidate of candidates) {
    if (typeof candidate === 'string') return candidate.trim();
    if (candidate && typeof candidate === 'object') {
      const href = candidate['@_href'] || candidate.href || candidate.url;
      if (href) return String(href).trim();
      const text = textValue(candidate).trim();
      if (isValidHttpUrl(text)) return text;
    }
  }
  return '';
}

/** Parse RSS 2.0, RDF-ish, or Atom XML into a uniform, safe feed shape. */
function parseFeed(xml, feedUrl = '') {
  let parsed;
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      cdataPropName: '__cdata',
      trimValues: true,
    }).parse(xml);
  } catch {
    throw new Error('The feed is not valid XML');
  }

  const rssChannel = parsed?.rss?.channel || parsed?.RDF?.channel || parsed?.['rdf:RDF']?.channel;
  if (rssChannel) {
    const items = asArray(rssChannel.item)
      .map((item) => ({
        title: cleanText(item.title, 240) || 'Untitled item',
        url: linkValue(item.link) || linkValue(item.guid),
        summary: cleanText(item.description || item['content:encoded'] || item.summary, 420),
        published: cleanText(item.pubDate || item.date || item['dc:date'], 80),
        author: cleanText(item.author || item['dc:creator'], 120),
      }))
      .filter((item) => item.url && isValidHttpUrl(item.url))
      .slice(0, 30);
    return {
      type: 'rss',
      title: cleanText(rssChannel.title, 180) || new URL(feedUrl).hostname,
      siteUrl: linkValue(rssChannel.link),
      description: cleanText(rssChannel.description, 360),
      items,
    };
  }

  const atom = parsed?.feed;
  if (atom) {
    const items = asArray(atom.entry)
      .map((entry) => ({
        title: cleanText(entry.title, 240) || 'Untitled item',
        url: linkValue(entry.link) || linkValue(entry.id),
        summary: cleanText(entry.summary || entry.content, 420),
        published: cleanText(entry.published || entry.updated, 80),
        author: cleanText(entry.author?.name || entry.author, 120),
      }))
      .filter((item) => item.url && isValidHttpUrl(item.url))
      .slice(0, 30);
    return {
      type: 'atom',
      title: cleanText(atom.title, 180) || new URL(feedUrl).hostname,
      siteUrl: linkValue(atom.link),
      description: cleanText(atom.subtitle, 360),
      items,
    };
  }

  throw new Error('No RSS or Atom feed was found in this XML');
}

async function fetchFeed(feedUrl) {
  if (!isValidHttpUrl(feedUrl)) throw badRequest('A valid http(s) feed URL is required');
  const response = await safeFetch(feedUrl, {
    timeoutMs: 15_000,
    headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/plain;q=0.8' },
  });
  if (!response.ok) throw new Error(`Feed responded with HTTP ${response.status}`);
  const xml = await readTextLimit(response, MAX_FEED_BYTES, 'Feed');
  const feed = parseFeed(xml, feedUrl);
  return { ...feed, feedUrl };
}

function normalizeLanguage(language, fallback = 'en') {
  const value = String(language || fallback).toLowerCase().split('-')[0];
  return SUPPORTED_LANGUAGES.has(value) ? value : fallback;
}

function splitTranslationText(text, maxLength = 450) {
  const chunks = [];
  let remaining = String(text || '').trim();
  while (remaining.length > maxLength) {
    let at = Math.max(
      remaining.lastIndexOf('. ', maxLength),
      remaining.lastIndexOf('! ', maxLength),
      remaining.lastIndexOf('? ', maxLength),
      remaining.lastIndexOf(' ', maxLength)
    );
    if (at < Math.floor(maxLength * 0.45)) at = maxLength;
    chunks.push(remaining.slice(0, at + (at < maxLength ? 1 : 0)).trim());
    remaining = remaining.slice(at + (at < maxLength ? 1 : 0)).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function translateWithLibreTranslate(text, source, target) {
  const base = config.translation.libreTranslateUrl.replace(/\/+$/, '');
  const endpoint = /\/translate$/i.test(base) ? base : `${base}/translate`;
  const body = { q: text, source, target, format: 'text' };
  if (config.translation.libreTranslateApiKey) body.api_key = config.translation.libreTranslateApiKey;
  const response = await safeFetch(endpoint, {
    method: 'POST',
    timeoutMs: 20_000,
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
    // The administrator may run LibreTranslate on the local network.
    allowPrivate: true,
  });
  if (!response.ok) throw new Error(`Translation service responded with HTTP ${response.status}`);
  const data = await response.json();
  const translatedText = String(data.translatedText || '').trim();
  if (!translatedText) throw new Error('Translation service returned no text');
  return { translatedText, provider: 'libretranslate' };
}

async function translateWithMyMemory(text, source, target) {
  const chunks = splitTranslationText(text);
  const translated = [];
  for (const chunk of chunks) {
    const params = new URLSearchParams({ q: chunk, langpair: `${source}|${target}` });
    const response = await safeFetch(`${config.translation.myMemoryUrl}?${params.toString()}`, {
      timeoutMs: 15_000,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Translation service responded with HTTP ${response.status}`);
    const data = await response.json();
    const textPart = String(data?.responseData?.translatedText || '').trim();
    if (!textPart) throw new Error('Translation service returned no text');
    translated.push(textPart);
  }
  return { translatedText: translated.join(' '), provider: 'mymemory' };
}

/**
 * Translate a short selected/page excerpt with a self-hosted LibreTranslate
 * instance when configured; otherwise use MyMemory's keyless public endpoint.
 */
async function translateText(text, source, target) {
  const input = String(text || '').trim();
  if (!input) throw badRequest('Text to translate is required');
  if (input.length > MAX_TRANSLATION_CHARS) {
    throw badRequest(`Text is limited to ${MAX_TRANSLATION_CHARS.toLocaleString()} characters`);
  }
  const from = normalizeLanguage(source);
  const to = normalizeLanguage(target, 'bn');
  if (from === to) return { translatedText: input, provider: 'local', source: from, target: to };

  const result = config.translation.libreTranslateUrl
    ? await translateWithLibreTranslate(input, from, to)
    : await translateWithMyMemory(input, from, to);
  return { ...result, source: from, target: to };
}

/** Find the closest publicly archived Wayback Machine snapshot, if any. */
async function findArchive(url) {
  if (!isValidHttpUrl(url)) throw badRequest('A valid http(s) URL is required');
  const params = new URLSearchParams({ url });
  const response = await safeFetch(`${config.archive.waybackUrl}?${params.toString()}`, {
    timeoutMs: 15_000,
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Archive service responded with HTTP ${response.status}`);
  const data = await response.json();
  const snapshot = data?.archived_snapshots?.closest;
  const snapshotUrl = snapshot?.url && isValidHttpUrl(snapshot.url) ? snapshot.url : '';
  return {
    available: Boolean(snapshotUrl && snapshot.available),
    url: snapshotUrl,
    timestamp: String(snapshot?.timestamp || ''),
    status: String(snapshot?.status || ''),
  };
}

module.exports = {
  fetchFeed,
  parseFeed,
  translateText,
  findArchive,
  readTextLimit,
  splitTranslationText,
  normalizeLanguage,
  MAX_TRANSLATION_CHARS,
};
