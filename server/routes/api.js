/**
 * Aura Browser 2.0 — API routes.
 *
 * /api/search            → core meta-search (features 1,2,4,8,9,17,18,19,22)
 * /api/summary           → AI summary box (feature 1)
 * /api/chat              → RAG chatbot sidepanel (feature 21)
 * /api/suggest           → DDG autocomplete proxy (feature 7)
 * /api/weather           → real-time weather widget (feature 25)
 * /api/trending          → trending topics & news (feature 27)
 * /api/fetch             → reading-mode preview (feature 13)
 * /api/stats             → tracker counter (feature 29)
 * /api/bangs             → bang shortcut registry (feature 22)
 *
 * Zero-tracking (feature 3): no request body/query/IP is ever persisted.
 */
'use strict';

const express = require('express');
const config = require('../config');
const { runSearch, summarize } = require('../services/searchService');
const { chatTurn } = require('../services/llm');
const { getWeather, getTrending } = require('../services/widgets');
const { fetchReadable } = require('../services/fetcher');
const { getStats } = require('../utils/httpClient');
const { bangList } = require('../utils/normalize');
const { safeFetch } = require('../utils/httpClient');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/search — core search endpoint
// ---------------------------------------------------------------------------
router.get('/search', async (req, res) => {
  const { q, category, language, region, safesearch, page, engines } = req.query;
  if (!q || !String(q).trim()) {
    return res.status(400).json({ error: 'Missing query parameter "q"' });
  }
  try {
    const data = await runSearch(String(q), {
      category: String(category || 'all'),
      language: String(language || 'en'),
      region: String(region || ''),
      safesearch: Number(safesearch) || 1,
      page: Number(page) || 1,
      engines: String(engines || ''),
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/summary — AI summary box (feature 1)
// ---------------------------------------------------------------------------
router.get('/summary', async (req, res) => {
  const { q, results } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing query' });
  let parsedResults = [];
  if (results) {
    try {
      parsedResults = JSON.parse(String(results));
    } catch {
      parsedResults = [];
    }
  }
  try {
    const data = await summarize(String(q), parsedResults);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/chat — RAG chatbot sidepanel (feature 21)
// ---------------------------------------------------------------------------
router.post('/chat', express.json({ limit: '512kb' }), async (req, res) => {
  const { message, history = [], context = '' } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: 'Missing message' });
  }
  try {
    const data = await chatTurn(
      [...(Array.isArray(history) ? history : []), { role: 'user', content: String(message).slice(0, 4000) }],
      String(context || '').slice(0, 30_000)
    );
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/suggest — DuckDuckGo autocomplete proxy (feature 7)
// ---------------------------------------------------------------------------
router.get('/suggest', async (req, res) => {
  const { q, language } = req.query;
  if (!q) return res.json({ suggestions: [] });
  const kl = String(language || 'en').startsWith('bn') ? 'bn-bd' : 'us-en';
  try {
    const response = await safeFetch(
      `https://duckduckgo.com/ac/?q=${encodeURIComponent(String(q))}&kl=${kl}&type=list`,
      { timeoutMs: 8000, headers: { accept: 'application/json' } }
    );
    if (!response.ok) throw new Error(`DDG suggest HTTP ${response.status}`);
    const data = await response.json();
    // DDG returns [{phrase, ...}] (type=list) or plain string arrays.
    const suggestions = Array.isArray(data)
      ? data.map((item) => (typeof item === 'string' ? item : item.phrase)).filter(Boolean)
      : [];
    res.json({ suggestions });
  } catch {
    res.json({ suggestions: [] }); // silent failure — suggestions are optional
  }
});

// ---------------------------------------------------------------------------
// GET /api/weather — weather widget (feature 25)
// ---------------------------------------------------------------------------
router.get('/weather', async (req, res) => {
  const { city, language } = req.query;
  if (!city) return res.status(400).json({ error: 'Missing "city" parameter' });
  try {
    res.json(await getWeather(String(city), String(language || 'en')));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/trending — trending topics & news feed (feature 27)
// ---------------------------------------------------------------------------
router.get('/trending', async (req, res) => {
  const { language, region } = req.query;
  try {
    res.json({ items: await getTrending(String(language || 'en'), String(region || 'US')) });
  } catch (err) {
    res.status(502).json({ error: err.message, items: [] });
  }
});

// ---------------------------------------------------------------------------
// GET /api/fetch — reading-mode preview (feature 13)
// ---------------------------------------------------------------------------
router.get('/fetch', async (req, res) => {
  const { url } = req.query;
  if (!url || !/^https?:\/\//i.test(String(url))) {
    return res.status(400).json({ error: 'A valid http(s) url is required' });
  }
  try {
    res.json(await fetchReadable(String(url)));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/stats — live privacy counter (feature 29)
// ---------------------------------------------------------------------------
router.get('/stats', (_req, res) => {
  res.json(getStats());
});

// ---------------------------------------------------------------------------
// GET /api/bangs — bang shortcut registry (feature 22)
// ---------------------------------------------------------------------------
router.get('/bangs', (_req, res) => {
  res.json({ bangs: bangList() });
});

// ---------------------------------------------------------------------------
// GET /api/config — non-secret runtime flags for the UI
// ---------------------------------------------------------------------------
router.get('/config', (_req, res) => {
  res.json({
    llmProvider: config.llm.groqApiKey ? 'groq' : config.llm.hfToken ? 'huggingface' : 'extractive',
    searxngConfigured: Boolean(process.env.SEARXNG_URL),
    fallbackEngine: config.fallbackEngine,
    faviconProvider: config.favicon.provider,
  });
});

module.exports = router;
