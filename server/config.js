/**
 * Aura Browser 2.0 — central configuration loader.
 *
 * Reads process environment variables (optionally from a `.env` file via
 * dotenv) and exposes a single frozen, typed `config` object to the whole app.
 * All secrets stay in the environment — nothing is ever written to disk.
 */
'use strict';

const path = require('path');
const fs = require('fs');

// Load `.env` (if present) without overriding already-set env vars.
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  // Minimal inline .env parser (KEY=VALUE lines, # comments, quotes stripped).
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[key] === undefined) process.env[key] = value;
  }
} else {
  try {
    require('dotenv').config();
  } catch {
    /* dotenv is optional — the manual parser above already ran */
  }
}

const bool = (v, dflt) => {
  if (v === undefined || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

const num = (v, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

const config = {
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',

  server: {
    port: num(process.env.PORT, 3000),
    host: process.env.HOST || '0.0.0.0',
  },

  searxng: {
    url: (process.env.SEARXNG_URL || 'http://localhost:8080').replace(/\/+$/, ''),
    timeoutMs: num(process.env.SEARXNG_TIMEOUT_MS, 15000),
    engines: (process.env.SEARXNG_ENGINES || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  fallbackEngine: process.env.FALLBACK_ENGINE || 'ddg-html',

  llm: {
    provider: null, // resolved at runtime: groq | huggingface | extractive
    groqApiKey: process.env.GROQ_API_KEY || '',
    groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    hfToken: process.env.HF_TOKEN || '',
    hfModel: process.env.HF_MODEL || 'mistralai/Mistral-7B-Instruct-v0.3',
    timeoutMs: num(process.env.LLM_TIMEOUT_MS, 20000),
  },

  weather: {
    geocodingUrl:
      process.env.OPEN_METEO_GEOCODING_URL ||
      'https://geocoding-api.open-meteo.com/v1/search',
    forecastUrl:
      process.env.OPEN_METEO_FORECAST_URL || 'https://api.open-meteo.com/v1/forecast',
  },

  news: {
    rssUrl: process.env.NEWS_RSS_URL || 'https://news.google.com/rss',
  },

  favicon: {
    provider: process.env.FAVICON_PROVIDER || 'duckduckgo', // duckduckgo | google | none
  },

  reverseImage: {
    searxngUrl: process.env.REVERSE_IMAGE_SEARXNG_URL || '',
  },

  proxy: {
    // Static proxy from env (runtime panel config lives in memory in the app).
    protocol: process.env.PROXY_PROTOCOL || '',
    host: process.env.PROXY_HOST || '',
    port: process.env.PROXY_PORT || '',
    username: process.env.PROXY_USERNAME || '',
    password: process.env.PROXY_PASSWORD || '',
  },

  privacy: {
    enableRateLimit: bool(process.env.ENABLE_RATE_LIMIT, true),
    rateLimitPerMinute: num(process.env.RATE_LIMIT_PER_MINUTE, 120),
    blockPrivateUrls: bool(process.env.BLOCK_PRIVATE_URLS, true),
  },

  userAgent:
    process.env.USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 AuraBrowser/2.0',
};

module.exports = config;
