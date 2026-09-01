/**
 * Aura Browser 2.0 — proxy & tunneling routes.
 *
 * Feature 31: Custom Proxy Configuration — the in-app Proxy Settings panel
 *             writes to this endpoint; the config lives in memory only
 *             (never on disk) and routes ALL outbound backend requests.
 * Feature 28: Reverse image search — upload proxy + Google Lens routing.
 */
'use strict';

const express = require('express');
const multer = require('multer');
const { setRuntimeProxy, safeFetch, getRuntimeProxy } = require('../utils/httpClient');

const router = express.Router();

const PROTOCOLS = ['http', 'https', 'socks4', 'socks5'];

// ---------------------------------------------------------------------------
// GET /api/proxy — current in-memory proxy config (masked)
// ---------------------------------------------------------------------------
router.get('/proxy', (_req, res) => {
  const p = getRuntimeProxy();
  res.json({
    active: Boolean(p),
    protocol: p?.protocol || '',
    host: p?.host || '',
    port: p?.port || '',
    hasAuth: Boolean(p?.username),
  });
});

// ---------------------------------------------------------------------------
// POST /api/proxy — set proxy config (feature 31)
// Body: { protocol, host, port, username?, password? }
// Sending an empty body / all-empty fields disables proxying.
// ---------------------------------------------------------------------------
router.post('/proxy', express.json({ limit: '16kb' }), (req, res) => {
  const { protocol, host, port, username = '', password = '' } = req.body || {};
  const proto = String(protocol || '').toLowerCase();

  // Disable case.
  if (!host || !port) {
    setRuntimeProxy(null);
    return res.json({ ok: true, active: false, message: 'Proxy disabled — outbound traffic is now direct.' });
  }

  if (!PROTOCOLS.includes(proto)) {
    return res.status(400).json({ error: `protocol must be one of: ${PROTOCOLS.join(', ')}` });
  }
  const portNum = Number(port);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return res.status(400).json({ error: 'Invalid port (1–65535)' });
  }
  if (!/^[a-zA-Z0-9.\-_]+$/.test(String(host))) {
    return res.status(400).json({ error: 'Invalid host (use an IP or hostname)' });
  }

  // In-memory only — never persisted.
  setRuntimeProxy({ protocol: proto, host: String(host), port: portNum, username: String(username), password: String(password) });
  res.json({
    ok: true,
    active: true,
    protocol: proto,
    host: String(host),
    port: portNum,
    hasAuth: Boolean(username),
    message: `Proxy enabled — all outbound requests now route through ${proto}://${host}:${portNum}`,
  });
});

// ---------------------------------------------------------------------------
// POST /api/image-search — reverse image search (feature 28)
// Accepts multipart/form-data with an image file, or JSON {image_url}.
// ---------------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

router.post('/image-search', upload.single('image'), async (req, res) => {
  try {
    const { image_url: imageUrl } = req.body || {};

    // Mode A: remote image URL → SearXNG `image_url:` operator if configured.
    if (imageUrl) {
      if (!/^https?:\/\//i.test(String(imageUrl))) {
        return res.status(400).json({ error: 'Invalid image_url' });
      }
      return res.json({
        ok: true,
        mode: 'image_url',
        // Frontend performs the actual search with this query.
        query: `image_url:${String(imageUrl)}`,
      });
    }

    // Mode B: file upload → Google's public reverse-image endpoint.
    if (!req.file) {
      return res.status(400).json({ error: 'No image file or image_url provided' });
    }
    const form = new FormData();
    form.append('encoded_image', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
    form.append('image_content', '');
    form.append('filename', req.file.originalname);
    form.append('hl', 'en');

    const response = await safeFetch('https://www.google.com/searchbyimage/upload', {
      method: 'POST',
      timeoutMs: 20000,
      formData: form,
      headers: { accept: 'text/html' },
    });
    if (!response.ok && response.status !== 302) {
      throw new Error(`Reverse image service HTTP ${response.status}`);
    }
    const finalUrl = response.url; // undici follows redirects
    res.json({ ok: true, mode: 'upload', resultsUrl: finalUrl });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
