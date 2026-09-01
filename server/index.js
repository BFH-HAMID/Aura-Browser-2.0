/**
 * Aura Browser 2.0 — HTTP server entry point.
 *
 * Express + static frontend + JSON API. Designed around the zero-tracking
 * principle (feature 3): no middleware persists request data; rate limiting
 * is a purely in-memory counter that resets on restart.
 */
'use strict';

const path = require('path');
const express = require('express');
const config = require('./config');
const apiRoutes = require('./routes/api');
const proxyRoutes = require('./routes/proxy');
const { render } = require('./utils/template');

const app = express();
app.disable('x-powered-by');

// ---------------------------------------------------------------------------
// Zero-tracking security headers (feature 3)
// ---------------------------------------------------------------------------
app.use((_req, res, next) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'geolocation=(self), microphone=(self)');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
});

// ---------------------------------------------------------------------------
// In-memory rate limiter (never touches disk; wiped on restart)
// ---------------------------------------------------------------------------
const hits = new Map();
function rateLimiter(req, res, next) {
  if (!config.privacy.enableRateLimit) return next();
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const bucket = hits.get(ip) || { count: 0, resetAt: now + 60_000 };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + 60_000;
  }
  bucket.count += 1;
  hits.set(ip, bucket);
  if (bucket.count > config.privacy.rateLimitPerMinute) {
    return res.status(429).json({ error: 'Rate limit reached — slow down a little.' });
  }
  next();
}
app.use('/api', rateLimiter);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api', apiRoutes);
app.use('/api', proxyRoutes);

// ---------------------------------------------------------------------------
// Static frontend
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

// Settings / about page (server-rendered shell, feature-free static info).
app.get('/settings', (_req, res) => {
  res.send(
    render(SETTINGS_SHELL, {
      llmProvider: config.llm.groqApiKey ? 'Groq (configured)' : config.llm.hfToken ? 'Hugging Face (configured)' : 'Extractive (offline, no key)',
      searxngUrl: config.searxng.url,
      fallback: config.fallbackEngine,
      proxy: config.proxy.host ? `${config.proxy.protocol}://${config.proxy.host}:${config.proxy.port}` : 'None (direct)',
    })
  );
});

// ---------------------------------------------------------------------------
// Error handling (no stack traces in production)
// ---------------------------------------------------------------------------
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  res.status(500).json({ error: config.isProd ? 'Internal error' : err.message });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const server = app.listen(config.server.port, config.server.host, () => {
  const addr = server.address();
  console.log('┌──────────────────────────────────────────────────────────┐');
  console.log('│  Aura Browser 2.0 — privacy meta-search engine           │');
  console.log('└──────────────────────────────────────────────────────────┘');
  console.log(`  →  http://${addr.address}:${addr.port}`);
  console.log(`  →  SearXNG:      ${config.searxng.url}`);
  console.log(`  →  LLM provider: ${config.llm.groqApiKey ? 'groq' : config.llm.hfToken ? 'huggingface' : 'extractive (offline)'}`);
  console.log(`  →  Outbound:     ${config.proxy.host ? `proxied via ${config.proxy.protocol}://${config.proxy.host}:${config.proxy.port}` : 'direct (no static proxy)'}`);
  console.log('  Zero-tracking mode: ON — nothing is stored or logged.\n');
});

// Graceful shutdown.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}

// ---------------------------------------------------------------------------
const SETTINGS_SHELL = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Aura Browser 2.0 — Settings & Status</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0b1020;color:#e5e7eb;max-width:760px;margin:0 auto;padding:32px 20px}
  h1{color:#8b5cf6} code{background:#1f2937;padding:2px 8px;border-radius:6px}
  .card{background:#111a2e;border:1px solid #26324d;border-radius:14px;padding:18px 22px;margin:14px 0}
  .row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px dashed #26324d}
  .row:last-child{border-bottom:none} .muted{color:#9ca3af}
</style>
</head>
<body>
<h1>⚡ Aura Browser 2.0</h1>
<p class="muted">Server-side status. All values are read from your environment at boot — nothing here is written back.</p>
<div class="card">
  <div class="row"><span>LLM provider</span><code>{{llmProvider}}</code></div>
  <div class="row"><span>SearXNG endpoint</span><code>{{searxngUrl}}</code></div>
  <div class="row"><span>Fallback engine</span><code>{{fallback}}</code></div>
  <div class="row"><span>Outbound proxy (env)</span><code>{{proxy}}</code></div>
</div>
<p><a href="/" style="color:#8b5cf6">← Back to Aura</a></p>
</body>
</html>`;
