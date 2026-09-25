# Vercel e Aura Browser 2.0 Deploy Guide (Bangla)

Aura Browser 2.0 muloto Docker + Node.js er jonno banano. Kintu Vercel e deploy korte chaile kichu extra kaj korte hobe, karon:

1. **SearXNG Vercel e cholbe na** — SearXNG holo Python app, Vercel sudhu Node.js serverless function support kore.
2. **Vercel serverless** — 10s timeout (Hobby), 4.5MB payload limit, 250MB bundle size.
3. **Tesseract OCR** — onek heavy, Vercel e memory/timeout khete pare.

Ei jonno ami already 2ta file add korechi:

- `api/index.js` — Vercel er entry point
- `vercel.json` — routing config
- `server/index.js` — ekhon `module.exports = app` kore, jate Vercel import korte pare

---

## 1. SearXNG er jonno ki korba? (MUST)

Vercel e SearXNG run kora jabe na. 3ta option:

### Option A — Public SearXNG use koro (easiest, free)
Vercel Environment Variables e set koro:
```
SEARXNG_URL=https://searx.be
SEARXNG_PUBLIC_FALLBACK=true
FALLBACK_ENGINE=ddg-html
SEARXNG_TIMEOUT_MS=8000
```
Public instance list: `searx.be`, `search.bus-hit.me`, `paulgo.io` — code e already fallback ache.

**Problem:** Public instance majhe majhe rate-limit / block kore.

### Option B — SearXNG alada host koro (Recommended)
- Fly.io / Railway / Render / DigitalOcean e SearXNG deploy koro
- Docker command:
```bash
docker run -d -p 8080:8080 -v ./searxng/settings.yml:/etc/searxng/settings.yml:ro searxng/searxng:latest
```
- Tar URL ta Vercel e `SEARXNG_URL=https://your-searxng.fly.dev` hisebe set koro.

### Option C — Sudhu DuckDuckGo fallback e cholo (No SearXNG)
```
SEARXNG_URL=https://searx.be
FALLBACK_ENGINE=ddg-html
SEARXNG_PUBLIC_FALLBACK=true
```
SearXNG fail korle auto DDG HTML scrape korbe (best-effort).

---

## 2. Vercel Environment Variables (Dashboard > Settings > Environment Variables)

**Required:**
```
NODE_ENV=production
SEARXNG_URL=https://searx.be  (ba tomar nijer SearXNG URL)
FALLBACK_ENGINE=ddg-html
SEARXNG_PUBLIC_FALLBACK=true
SEARXNG_TIMEOUT_MS=8000
LLM_TIMEOUT_MS=8000
BLOCK_PRIVATE_URLS=true
ENABLE_RATE_LIMIT=true
RATE_LIMIT_PER_MINUTE=60
```

**Optional AI (na dile extractive offline summarizer cholbe):**
```
GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-3.5-flash-lite
# Alternative: GEMINI_MODEL=gemini-3.6-flash (higher quality, balanced)
HF_TOKEN=hf_...
HF_MODEL=mistralai/Mistral-7B-Instruct-v0.3
```

**Optional Widgets (na dileo cholbe, default ache):**
```
OPEN_METEO_GEOCODING_URL=https://geocoding-api.open-meteo.com/v1/search
OPEN_METEO_FORECAST_URL=https://api.open-meteo.com/v1/forecast
NEWS_RSS_URL=https://news.google.com/rss
MYMEMORY_TRANSLATE_URL=https://api.mymemory.translated.net/get
WAYBACK_AVAILABLE_URL=https://archive.org/wayback/available
FAVICON_PROVIDER=duckduckgo
```

**OCR / Upload limit (Vercel e 4.5MB max):**
Vercel e 8MB upload fail korbe. Code e already 8MB, Vercel er limit 4.5MB. Tai OCR image 4MB er niche rakho, ba `server/routes/api.js` e limit komao.

---

## 3. Deploy Steps

### GitHub theke (Recommended)
1. Repo ta GitHub e push koro
2. https://vercel.com/new e giye GitHub repo import koro
3. Framework Preset: **Other**
4. Build Command: `npm run vendor` (qr + pdfjs + tessdata copy korbe) — Vercel auto `npm install` korbe, tar `postinstall` e vendor run hobe, tai blank o rakhte paro
5. Output Directory: `public` na, blank rakho (vercel.json handle korbe)
6. Environment Variables add koro (uporer list)
7. Deploy

### Vercel CLI diye
```bash
npm i -g vercel
vercel login
vercel --prod
# env vars set:
vercel env add SEARXNG_URL
vercel env add GEMINI_API_KEY
```

---

## 4. Ki ki lagbe na / ki disable korte hobe?

- **SearXNG Docker** — Vercel e lagbe na
- **Proxy panel** — kaj korbe, kintu SOCKS proxy Vercel e test kora hoyni, HTTP proxy thik ache
- **OCR** — Vercel Hobby te 1GB memory, Tesseract first run e 2-3s lage, majhe majhe timeout khete pare. Chaile `server/routes/api.js` e `/api/ocr` route comment kore disable korte paro.
- **Service Worker** — Vercel HTTPS e cholbe, kintu `/api/*` cache kore na (thik ache)

---

## 5. Vercel.json explain

```json
{
  "routes": [
    { "src": "/api/(.*)", "dest": "api/index.js" },
    { "src": "/(.*)", "dest": "api/index.js" }
  ]
}
```
Sob request `api/index.js` (Express app) e jabe, Express er vitore `express.static(public)` diye frontend serve korbe.

---

## 6. Common Error & Fix

| Error | Fix |
|-------|-----|
| `SearXNG responded with HTTP 502` | `SEARXNG_URL` vul, ba public instance down. `SEARXNG_PUBLIC_FALLBACK=true` koro |
| `Function timeout` | `SEARXNG_TIMEOUT_MS=8000`, `LLM_TIMEOUT_MS=8000` komao, Gemini na thakle extractive use hobe |
| `Payload too large` | Vercel 4.5MB limit, 8MB image upload koro na |
| `Cannot find module 'tesseract.js'` | `npm install` hoy nai, Vercel build log check koro, `npm run vendor` run hocche kina |
| `QR library unavailable` | `public/vendor/qrcode.min.js` missing — `npm run vendor:qrcode` |

---

## 7. Production checklist

- [ ] `SEARXNG_URL` public / tomar hosted URL
- [ ] `GEMINI_API_KEY` set (na hole offline summary)
- [ ] `vercel.json` ache
- [ ] `api/index.js` ache
- [ ] `npm test` local e pass
- [ ] Vercel env vars set
- [ ] Deploy er por `/api/config` hit kore dekho `llmProvider` ki dekhay
- [ ] `/api/search?q=test` kaj kore kina check

Ekbar deploy hoye gele `https://your-project.vercel.app` e live hobe, SearXNG alada host e thakbe.

Chaile ami tomar jonno Railway/Fly.io te SearXNG deploy er guide o baniye dite pari.
