/**
 * Aura Browser 2.0 — local link privacy/safety heuristics.
 *
 * This is deliberately an explainable, offline score rather than a malware
 * verdict. It looks for URL properties commonly used by deceptive links and
 * privacy-hostile tracking. No URL is sent to a third-party reputation API.
 */
'use strict';

const net = require('node:net');

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'fbclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid',
  'ref', 'ref_src', 'source', 'spm', 'yclid', 'srsltid', 'si',
]);

const SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'buff.ly', 'ow.ly',
  'rebrand.ly', 'cutt.ly', 'shorturl.at', 'rb.gy', 'tiny.one', 'lnkd.in',
]);

const HIGH_RISK_TLDS = new Set([
  'zip', 'mov', 'top', 'click', 'country', 'gq', 'tk', 'work', 'support',
  'rest', 'fit', 'review', 'stream', 'download', 'xin', 'buzz',
]);

const SUSPICIOUS_WORDS = [
  'verify', 'verification', 'login', 'signin', 'account', 'wallet', 'bank',
  'password', 'secure', 'update', 'invoice', 'gift', 'crypto', 'airdrop',
  'recover', 'free-money',
];

function unique(list) {
  return [...new Set(list)];
}

/**
 * Return an explainable 0–100 heuristic score for an http(s) URL.
 * `level` means low-risk/caution/high-risk according to URL characteristics,
 * not a definitive claim that a site is safe or malicious.
 */
function assessLinkSafety(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || ''));
  } catch {
    return {
      score: 0,
      level: 'high-risk',
      signals: ['Invalid web address'],
      trackerParams: 0,
      https: false,
      heuristic: true,
    };
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return {
      score: 0,
      level: 'high-risk',
      signals: ['Non-web link protocol'],
      trackerParams: 0,
      https: false,
      heuristic: true,
    };
  }

  const signals = [];
  let score = 100;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const labels = host.split('.').filter(Boolean);

  if (url.protocol !== 'https:') {
    score -= 14;
    signals.push('Uses an unencrypted HTTP connection');
  }
  if (url.username || url.password) {
    score -= 35;
    signals.push('Contains a username/password segment before the destination host');
  }
  if (net.isIP(url.hostname)) {
    score -= 22;
    signals.push('Uses a numeric IP address instead of a domain name');
  }
  if (host.includes('xn--') || /[^\x00-\x7f]/.test(host)) {
    score -= 20;
    signals.push('Uses an internationalized/punycode domain');
  }
  if (labels.length >= 5) {
    score -= 8;
    signals.push('Has an unusually deep subdomain');
  }
  if (SHORTENERS.has(host)) {
    score -= 10;
    signals.push('Shortened link hides the final destination');
  }
  const tld = labels.at(-1) || '';
  if (HIGH_RISK_TLDS.has(tld)) {
    score -= 14;
    signals.push(`Uses .${tld}, a TLD often abused by deceptive links`);
  }
  if (url.href.length > 240) {
    score -= 6;
    signals.push('Unusually long URL');
  }

  const trackerParams = [...url.searchParams.keys()].filter((key) =>
    TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')
  ).length;
  if (trackerParams) {
    score -= Math.min(12, trackerParams * 3);
    signals.push(`${trackerParams} known tracking parameter${trackerParams === 1 ? '' : 's'} detected`);
  }

  const searchable = `${host}${url.pathname}`.toLowerCase();
  const suspiciousMatches = SUSPICIOUS_WORDS.filter((word) => searchable.includes(word));
  if (suspiciousMatches.length >= 2) {
    score -= Math.min(18, suspiciousMatches.length * 5);
    signals.push(`Contains multiple credential/financial lure terms (${suspiciousMatches.slice(0, 3).join(', ')})`);
  }

  score = Math.max(0, Math.min(100, score));
  const level = score >= 85 ? 'low-risk' : score >= 60 ? 'caution' : 'high-risk';
  if (!signals.length) signals.push('No common URL-level risk or tracking signals found');

  return {
    score,
    level,
    signals: unique(signals).slice(0, 5),
    trackerParams,
    https: url.protocol === 'https:',
    heuristic: true,
  };
}

module.exports = { assessLinkSafety, TRACKING_PARAMS };
