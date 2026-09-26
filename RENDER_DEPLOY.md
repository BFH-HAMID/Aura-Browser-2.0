# Render.com e Aura Browser 2.0 Deploy — Sudhu Render.com e Full Stack

Vercel er moto na, **Render.com e full Aura Browser 2.0 deploy kora jabe ekai** — karon Render Docker + long-running Node.js support kore.

Tumi sudhu Render.com e deploy korle ki hobe?

### ✅ Ki hobe (bhalo dik):
- **SearXNG + Aura Browser ek sathe cholbe** — kono external SearXNG lagbe na
- **Private networking** — `aura-browser` -> `aura-searxng` internal HTTP e kotha bolbe, fast + free, public internet e expose hobe na
- **OCR, QR, PDF, Tesseract** — sob kaj korbe (Vercel e timeout kheto, Render e 512MB RAM e cholbe, first OCR e 3-5s lagte pare)
- **File upload 8MB** — Render e 4.5MB limit nai
- **No cold start issue** — free tier e 15 min inactive hole sleep hoy, abar request e wake up hoy (30s lagte pare)
- **Zero extra cost** — 2ta free web service

### ❌ Ki hobe na / kharap dik:
- Free tier e **sleep** — 15 min keu visit na korle service sleep, porer visitor er 30s wait
- Free tier e **750 hours/month** — 2ta service 24/7 cholle ~ 1440 hours, tai ekta service sleep korbei (Render free limit). Starter plan ($7/mo) nile no sleep.
- Build time ektu beshi — `tessdata` ~4MB + `pdfjs` ~1.8MB download hoy

---

## 1. Files ami add korechi

- `render.yaml` — Blueprint, 2ta service define kore
- `Dockerfile.searxng` — Official SearXNG image + tomar `searxng/settings.yml` (privacy-hardened)

---

## 2. Deploy Steps (Blueprint — 1 click)

### Option A — Blueprint (Recommended)
1. GitHub e push koro
2. Render Dashboard > **New +** > **Blueprint** > Connect repo `BFH-HAMID/Aura-Browser-2.0`
3. Render `render.yaml` detect korbe, 2ta service dekhabe:
   - `aura-searxng` (Docker)
   - `aura-browser` (Node)
4. **Environment Variables** add koro (niche list)
5. **Apply** > Deploy start hobe (5-7 min)

### Option B — Manual (2ta service alada)
**SearXNG service:**
- New > Web Service > Connect repo > Runtime: **Docker** > Dockerfile Path: `./Dockerfile.searxng`
- Name: `aura-searxng`
- Plan: Free
- Health Check: `/healthz`
- Env: `SEARXNG_BASE_URL=https://aura-searxng.onrender.com`, `PORT=8080`

**Aura Browser service:**
- New > Web Service > Runtime: **Node**
- Build Command: `npm install --include=dev && npm run build:css && npm run vendor`
- Start Command: `npm start`
- Health Check: `/api/config`
- Env Vars (niche)

---

## 3. Environment Variables (Render Dashboard > Service > Environment)

**aura-browser er jonno:**

```
NODE_ENV=production
HOST=0.0.0.0
# PORT Render auto set kore, set kora lagbe na

# SearXNG — private network use korle:
SEARXNG_URL=http://aura-searxng:8080
# Jodi private network kaj na kore (free tier e majhe majhe), tahole public URL:
# SEARXNG_URL=https://aura-searxng.onrender.com

SEARXNG_TIMEOUT_MS=15000
FALLBACK_ENGINE=ddg-html
SEARXNG_PUBLIC_FALLBACK=false
LLM_TIMEOUT_MS=20000
ENABLE_RATE_LIMIT=true
RATE_LIMIT_PER_MINUTE=120
BLOCK_PRIVATE_URLS=true
FAVICON_PROVIDER=duckduckgo

# Optional AI — na dile offline extractive summarizer cholbe:
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-3.5-flash-lite
# Alternative: GEMINI_MODEL=gemini-3.6-flash (higher quality, balanced)
HF_TOKEN=hf_...
```

**aura-searxng er jonno:**
```
PORT=8080
SEARXNG_BASE_URL=https://aura-searxng.onrender.com
```

---

## 4. Code e ki change lagche?

**Kichui na!** Ami already fix korechi:
- `server/index.js` exports app + listens only when main — Render + Vercel both e cholbe
- `server/config.js` PORT/HOST env theke ney — Render auto PORT set kore
- `server/services/searchService.js` e `allowPrivate: true` for SearXNG — tai `http://aura-searxng:8080` (private IP) block hobe na

Tumi chaile single Dockerfile diyeo deploy korte paro (docker-compose er moto):
- Render e ekta Docker Web Service baniye `Dockerfile` use koro, kintu tokhon SearXNG thakbe na — tokhon `SEARXNG_URL=https://searx.be` + `SEARXNG_PUBLIC_FALLBACK=true` set korte hobe.

---

## 5. Deploy er por test

1. `https://aura-browser.onrender.com` open koro
2. `/api/config` — `{"llmProvider":"extractive","searxngConfigured":true,...}` dekhabe
3. `/api/search?q=test` — result asbe
4. `/settings` — SearXNG URL `http://aura-searxng:8080` dekhabe
5. Search bar e `weather: Dhaka` likhe weather widget test
6. Ekta result e 📖 Reading mode, 📥 Save offline test

---

## 6. Vercel vs Render — konta better?

| Feature | Vercel | Render.com |
|---------|--------|------------|
| SearXNG self-host | ❌ Impossible | ✅ 2nd service hisebe |
| Node long-running | ❌ Serverless 10s | ✅ Always on (free te sleep) |
| OCR / Tesseract | ❌ Timeout | ✅ Works |
| File upload 8MB | ❌ 4.5MB limit | ✅ No limit |
| Setup | Easy but SearXNG external lagbe | 1 Blueprint e full stack |
| Cost free | 100GB bandwidth | 750h/month free |

**Tomar jonno Render.com best** — karon tumi full privacy meta-search chao, SearXNG chara Aura incomplete.

---

## 7. Production tips

- Free tier e sleep avoid korte UptimeRobot diye 14 min por por `/api/config` ping koro
- Custom domain add korte paro Render Dashboard > Settings > Custom Domain
- Logs: Render Dashboard > Logs e live logs dekhba
- Auto deploy off korechi `render.yaml` e — chaile `autoDeploy: true` koro

Deploy hoye gele URL ta amake dio, ami check kore dibo.
