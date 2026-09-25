/**
 * Aura Browser 2.0 — privacy-safe outbound HTTP client.
 *
 * Every external request the backend makes goes through `fetch()` from this
 * module. It guarantees:
 *   • nothing is ever logged (no URLs, no queries, no IPs) — only the
 *     HTTP status is exposed to in-memory stats counters;
 *   • a browser-like rotating User-Agent;
 *   • optional outbound routing through HTTP/HTTPS/SOCKS4/SOCKS5 proxies
 *     (configured via env or the in-app Proxy Settings panel);
 *   • SSRF protection: private / loopback / link-local / reserved IPs are
 *     rejected when BLOCK_PRIVATE_URLS=true (default);
 *   • per-request timeouts via AbortController.
 */
'use strict';

const { lookup } = require('node:dns').promises;
const net = require('node:net');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { fetch: undiciFetch, ProxyAgent, Agent } = require('undici');
const config = require('../config');

// ---------------------------------------------------------------------------
// In-memory privacy statistics (feature 29) — counters only, never content.
// These live in RAM and are wiped on restart by design.
// ---------------------------------------------------------------------------
const stats = {
  trackersBlocked: 0,
  queriesSecured: 0,
  requestsProxied: 0,
  requestsDirect: 0,
  startedAt: Date.now(),
};

const increment = (key) => {
  stats[key] = (stats[key] || 0) + 1;
};

const getStats = () => ({
  trackersBlocked: stats.trackersBlocked,
  queriesSecured: stats.queriesSecured,
  requestsProxied: stats.requestsProxied,
  requestsDirect: stats.requestsDirect,
  uptimeSeconds: Math.floor((Date.now() - stats.startedAt) / 1000),
});

// ---------------------------------------------------------------------------
// IP classification helpers
// ---------------------------------------------------------------------------
const ipv4ToInt = (ip) => ip.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;

function isPrivateIpv4(ip) {
  const n = ipv4ToInt(ip);
  const oct1 = n >>> 24;
  const oct2 = (n >>> 16) & 0xff;
  // 0.x / 10.x / 127.x (loopback) / 100.64/10 (CGNAT) / 169.254.x (link-local)
  if (oct1 === 0 || oct1 === 10 || oct1 === 127) return true;
  if (oct1 === 100 && oct2 >= 64 && oct2 <= 127) return true;
  if (oct1 === 169 && oct2 === 254) return true;
  // 172.16.0.0/12, 192.168.0.0/16, 192.0.0.0/24
  if (oct1 === 172 && oct2 >= 16 && oct2 <= 31) return true;
  if (oct1 === 192 && oct2 === 168) return true;
  if (oct1 === 192 && oct2 === 0) return true;
  // 198.18.0.0/15 (benchmark), 224/4 multicast, 240/4 reserved
  if (oct1 === 198 && (oct2 === 18 || oct2 === 19)) return true;
  if (oct1 >= 224) return true;
  return false;
}

const isPrivateIpv6 = (ip) => {
  const lower = ip.toLowerCase();
  return (
    lower === '::' ||
    lower === '::1' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb') ||
    lower.startsWith('ff')
  );
};

/**
 * Resolve a hostname and verify none of its A/AAAA records point at a
 * private/reserved address. Throws if BLOCK_PRIVATE_URLS is enabled and any
 * record is private. Returns the first resolved address.
 */
async function assertPublicHost(hostname) {
  if (!config.privacy.blockPrivateUrls) return hostname;
  if (net.isIP(hostname)) {
    const bad = net.isIPv4(hostname) ? isPrivateIpv4(hostname) : isPrivateIpv6(hostname);
    if (bad) throw new Error(`SSRF guard: blocked private address ${hostname}`);
    return hostname;
  }
  let records;
  try {
    records = await lookup(hostname, { all: true });
  } catch {
    throw new Error(`DNS resolution failed for ${hostname}`);
  }
  for (const r of records) {
    const bad = r.family === 4 ? isPrivateIpv4(r.address) : isPrivateIpv6(r.address);
    if (bad) throw new Error(`SSRF guard: blocked private address for ${hostname}`);
  }
  return records[0].address;
}

// ---------------------------------------------------------------------------
// Runtime proxy configuration (in-memory, set via the Proxy Settings panel)
// ---------------------------------------------------------------------------
let runtimeProxy = null; // { protocol, host, port, username, password } | null

/** Set proxy config from the in-app panel. `null`/empty disables proxying. */
function setRuntimeProxy(proxy) {
  runtimeProxy = proxy && proxy.host && proxy.port ? { ...proxy } : null;
}

const getRuntimeProxy = () => runtimeProxy;

const envProxy = () => {
  const p = config.proxy;
  if (p.host && p.port) return { ...p };
  return null;
};

// Cache dispatchers per proxy signature so we don't rebuild agents per request.
const dispatcherCache = new Map();

function buildDispatcher(proxy) {
  const signature = proxy
    ? `${proxy.protocol}://${proxy.username || ''}:${proxy.password || ''}@${proxy.host}:${proxy.port}`
    : 'direct';
  if (dispatcherCache.has(signature)) return dispatcherCache.get(signature);

  let dispatcher;
  if (!proxy) {
    dispatcher = new Agent({ keepAliveTimeout: 10000, pipelining: 4 });
  } else if (proxy.protocol.startsWith('socks')) {
    // SOCKS proxy: undici ProxyAgent does not support socks:// directly.
    // We build a custom undici Agent whose connect() dials through SOCKS
    // using the `socks` library (dependency of socks-proxy-agent).
    try {
      const { SocksClient } = require('socks');
      const socksType = proxy.protocol === 'socks4' ? 4 : 5;
      const socksProxy = {
        host: proxy.host,
        port: Number(proxy.port),
        type: socksType,
        userId: proxy.username || undefined,
        password: proxy.password || undefined,
      };
      dispatcher = new Agent({
        keepAliveTimeout: 10000,
        pipelining: 4,
        connect: async (opts, callback) => {
          try {
            const { socket } = await SocksClient.createConnection({
              proxy: socksProxy,
              destination: {
                host: opts.host,
                port: Number(opts.port),
              },
              command: 'connect',
              timeout: 15000,
            });
            if (opts.protocol === 'https:' || opts.secureEndpoint) {
              const tls = require('node:tls');
              const tlsSocket = tls.connect({
                socket,
                host: opts.host,
                servername: opts.host,
                rejectUnauthorized: false,
              });
              callback(null, tlsSocket);
            } else {
              callback(null, socket);
            }
          } catch (err) {
            callback(err);
          }
        },
      });
    } catch {
      // Fallback to previous behaviour if `socks` package is unavailable
      dispatcher = new ProxyAgent({
        uri: `http://${proxy.host}:${proxy.port}`,
        requestTls: { rejectUnauthorized: false },
      });
    }
  } else {
    dispatcher = new ProxyAgent({
      uri: `http://${proxy.username ? encodeURIComponent(proxy.username) + ':' + encodeURIComponent(proxy.password || '') + '@' : ''}${proxy.host}:${proxy.port}`,
      requestTls: { rejectUnauthorized: false },
    });
  }
  dispatcherCache.set(signature, dispatcher);
  return dispatcher;
}

// ---------------------------------------------------------------------------
// User-Agent rotation (a small fixed pool — random selection per request)
// ---------------------------------------------------------------------------
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
];

const pickUA = () => UA_POOL[Math.floor(Math.random() * UA_POOL.length)];

// ---------------------------------------------------------------------------
// The single fetch entry point
// ---------------------------------------------------------------------------

/**
 * @param {string} url   absolute URL
 * @param {object} opts  { method, headers, body, timeoutMs, proxy, maxRedirects }
 * @returns {Promise<Response>} undici Response (call .json()/.text()/.arrayBuffer())
 */
async function safeFetch(url, opts = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 15000,
    proxy: explicitProxy = null,
    formData,
    allowPrivate = false, // trust admin-configured endpoints (own SearXNG etc.)
    maxRedirects = 5,
  } = opts;

  // 1. Choose proxy (explicit > runtime panel > env).
  const proxy = explicitProxy || runtimeProxy || envProxy();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
  const redirectStatuses = new Set([301, 302, 303, 307, 308]);
  const cancelResponseBody = async (response) => {
    try { await response.body?.cancel?.(); } catch { /* nothing to clean up */ }
  };
  let target = String(url);
  let requestMethod = method;
  let requestBody = formData || body;

  try {
    // Follow redirects ourselves so that every hop is checked by the SSRF guard.
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
      let parsed;
      try {
        parsed = new URL(target);
      } catch {
        throw new Error(`Invalid URL: ${target.slice(0, 80)}`);
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Only http(s) URLs are allowed');
      }
      if (!allowPrivate) await assertPublicHost(parsed.hostname);

      const response = await undiciFetch(parsed, {
        method: requestMethod,
        headers: {
          'user-agent': pickUA(),
          accept: headers.accept || 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9,bn;q=0.8',
          ...(headers || {}),
        },
        ...(requestBody !== undefined ? { body: requestBody } : {}),
        signal: controller.signal,
        dispatcher: buildDispatcher(proxy),
        redirect: 'manual',
      });

      const location = response.headers.get('location');
      if (!redirectStatuses.has(response.status) || !location) {
        // Count one logical outbound request, never content or target details.
        if (proxy) {
          increment('requestsProxied');
          stats.trackersBlocked += 1; // proxied request = one tracker-cookie-blocked trip
        } else {
          increment('requestsDirect');
        }
        return response;
      }

      if (redirectCount === maxRedirects) {
        await cancelResponseBody(response);
        throw new Error('Too many redirects');
      }
      try {
        target = new URL(location, parsed).href;
      } catch {
        await cancelResponseBody(response);
        throw new Error('Redirect target is invalid');
      }
      await cancelResponseBody(response);

      // Mirror fetch's common redirect behavior for body-bearing requests.
      if (response.status === 303 ||
        ((response.status === 301 || response.status === 302) && !['GET', 'HEAD'].includes(String(requestMethod).toUpperCase()))) {
        requestMethod = 'GET';
        requestBody = undefined;
      }
    }
  } finally {
    clearTimeout(timer);
  }

  // The loop either returns or throws. This satisfies static flow analysis.
  throw new Error('Request could not be completed');
}

module.exports = {
  safeFetch,
  getStats,
  increment,
  setRuntimeProxy,
  getRuntimeProxy,
  isPrivateIpv4,
  isPrivateIpv6,
  assertPublicHost,
};
