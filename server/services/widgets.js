/**
 * Aura Browser 2.0 — widget services.
 *
 * Feature 25: Real-time weather widget — Open-Meteo (free, keyless).
 * Feature 27: Trending topics & news aggregator — Google News RSS (free).
 * Feature 12: Dynamic site favicons — DuckDuckGo / Google favicon proxies.
 *
 * All calls go through the privacy-safe client (never logged).
 */
'use strict';

const { XMLParser } = require('fast-xml-parser');
const config = require('../config');
const { safeFetch } = require('../utils/httpClient');
const { extractDomain } = require('../utils/normalize');

// ---------------------------------------------------------------------------
// Weather (feature 25)
// ---------------------------------------------------------------------------

/**
 * @param {string} city  city name or "lat,lon" coordinates
 * @param {string} language e.g. en / bn
 */
async function getWeather(city, language = 'en') {
  let lat;
  let lon;
  let resolvedCity = city;

  if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(city)) {
    [lat, lon] = city.split(',').map((s) => parseFloat(s.trim()));
  } else {
    const geoParams = new URLSearchParams({
      name: city,
      count: '1',
      language,
      format: 'json',
    });
    const geoRes = await safeFetch(`${config.weather.geocodingUrl}?${geoParams}`, {
      timeoutMs: 10000,
      headers: { accept: 'application/json' },
    });
    if (!geoRes.ok) throw new Error(`Geocoding HTTP ${geoRes.status}`);
    const geo = await geoRes.json();
    const hit = geo.results?.[0];
    if (!hit) throw new Error(`City not found: ${city}`);
    lat = hit.latitude;
    lon = hit.longitude;
    resolvedCity = hit.name || city;
  }

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current:
      'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    forecast_days: '4',
  });
  const res = await safeFetch(`${config.weather.forecastUrl}?${params}`, {
    timeoutMs: 10000,
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Forecast HTTP ${res.status}`);
  const data = await res.json();

  return {
    city: resolvedCity,
    lat,
    lon,
    unit: '°C',
    current: data.current || {},
    daily: data.daily || {},
    timezone: data.timezone || '',
    wmo: WMO_CODES[data.current?.weather_code] || { label: 'Unknown', icon: '❓' },
  };
}

const WMO_CODES = {
  0: { label: 'Clear sky', icon: '☀️' },
  1: { label: 'Mainly clear', icon: '🌤️' },
  2: { label: 'Partly cloudy', icon: '⛅' },
  3: { label: 'Overcast', icon: '☁️' },
  45: { label: 'Fog', icon: '🌫️' },
  48: { label: 'Rime fog', icon: '🌫️' },
  51: { label: 'Light drizzle', icon: '🌦️' },
  53: { label: 'Drizzle', icon: '🌦️' },
  55: { label: 'Heavy drizzle', icon: '🌧️' },
  61: { label: 'Light rain', icon: '🌦️' },
  63: { label: 'Rain', icon: '🌧️' },
  65: { label: 'Heavy rain', icon: '🌧️' },
  71: { label: 'Light snow', icon: '🌨️' },
  73: { label: 'Snow', icon: '🌨️' },
  75: { label: 'Heavy snow', icon: '❄️' },
  80: { label: 'Rain showers', icon: '🌧️' },
  81: { label: 'Rain showers', icon: '🌧️' },
  82: { label: 'Violent showers', icon: '⛈️' },
  95: { label: 'Thunderstorm', icon: '⛈️' },
  96: { label: 'Thunderstorm + hail', icon: '⛈️' },
  99: { label: 'Thunderstorm + hail', icon: '⛈️' },
};

// ---------------------------------------------------------------------------
// Trending topics & news (feature 27)
// ---------------------------------------------------------------------------

/** Fetch global trending + news items from Google News RSS (free, keyless). */
async function getTrending(language = 'en', region = 'US') {
  const langTag = language.startsWith('bn') ? 'bn-BD' : 'en-US';
  const url = `${config.news.rssUrl}?hl=${langTag}&gl=${region}&ceid=${region}:${language.startsWith('bn') ? 'bn' : 'en'}`;
  const res = await safeFetch(url, {
    timeoutMs: 15000,
    headers: { accept: 'application/rss+xml, application/xml, text/xml' },
  });
  if (!res.ok) throw new Error(`News RSS HTTP ${res.status}`);
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false });
  const feed = parser.parse(xml);
  const items = feed?.rss?.channel?.item || [];

  return items.slice(0, 12).map((item) => ({
    title: String(item.title || '').replace(/\s*-\s*[^-]+$/, '').trim(),
    source: extractSource(item.source || item.title),
    url: item.link || '',
    published: item.pubDate || '',
  }));
}

function extractSource(sourceOrTitle) {
  if (typeof sourceOrTitle === 'object' && sourceOrTitle['#text']) {
    return sourceOrTitle['#text'];
  }
  const m = /-\s*([^-]+)$/.exec(String(sourceOrTitle || ''));
  return m ? m[1].trim() : 'News';
}

// ---------------------------------------------------------------------------
// Favicons (feature 12)
// ---------------------------------------------------------------------------

/** Resolve the favicon provider URL for a domain. */
function faviconUrl(domainOrUrl) {
  const domain = domainOrUrl.includes('://')
    ? extractDomain(new URL(domainOrUrl).hostname)
    : domainOrUrl.replace(/^www\./, '');
  switch (config.favicon.provider) {
    case 'google':
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    case 'none':
      return '';
    case 'duckduckgo':
    default:
      return `https://icons.duckduckgo.com/ip3/${domain}.ico`;
  }
}

module.exports = { getWeather, getTrending, faviconUrl, WMO_CODES };
