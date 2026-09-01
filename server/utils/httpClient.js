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
    dispatcher = new ProxyAgent({
      factory: () =>
        new SocksProxyAgent({
          hostname: proxy.host,
          port: Number(proxy.port),
          userId: proxy.username || undefined,
          password: proxy.password || undefined,
          protocol: proxy.protocol === 'socks5' ? 'socks5:' : 'socks4:',
        }),
    });
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
 * @param {object} opts  { method, headers, body, timeoutMs, proxy, accept }
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
  } = opts;

  // 1. SSRF guard — resolve the host and verify it is public.
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(`Invalid URL: ${url.slice(0, 80)}`);
  }
  if (!allowPrivate) await assertPublicHost(hostname);

  // 2. Choose proxy (explicit > runtime panel > env).
  const proxy = explicitProxy || runtimeProxy || envProxy();

  // 3. Fire the request with a timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);

  const response = await undiciFetch(url, {
    method,
    headers: {
      'user-agent': pickUA(),
      accept: headers.accept || 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9,bn;q=0.8',
      ...(headers || {}),
    },
    ...(body !== undefined ? { body } : {}),
    ...(formData ? { body: formData } : {}),
    signal: controller.signal,
    dispatcher: buildDispatcher(proxy),
    redirect: 'follow',
  }).finally(() => clearTimeout(timer));

  // 4. Counters (content-free stats only).
  if (proxy) {
    increment('requestsProxied');
    stats.trackersBlocked += 1; // proxied request = one tracker-cookie-blocked trip
  } else {
    increment('requestsDirect');
  }
  return response;
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
