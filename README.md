# ⚡ Aura Browser 2.0

**The 100% free, zero-tracking hybrid meta-search engine & privacy browser web app.**

Aura Browser 2.0 aggregates **SearXNG** (self-hosted, open-source) + **DuckDuckGo Instant Answers** + free endpoints behind a single privacy gateway: **no accounts, no cookies, no logs, no tracking — ever.**

![stack](https://img.shields.io/badge/stack-Node.js%20%2B%20Express%20%2B%20Tailwind%20%2B%20SearXNG-8b5cf6) ![license](https://img.shields.io/badge/license-GPL--3.0-blue)

---

## ✨ Feature Matrix — all 31 features

| # | Feature | Where |
|---|---------|-------|
| 1 | **AI Summary Box** (Groq / Hugging Face / offline extractive) | `server/services/llm.js`, `public/js/app.js` |
| 2 | **Smart Result De-duplication** (URL normalization + fuzzy title matching) | `server/utils/normalize.js` |
| 3 | **Zero-Tracking Privacy Mode** (stateless backend, nothing logged) | `server/index.js`, `server/utils/httpClient.js` |
| 4 | **Categorized Tabs** (All / News / Images / Code / Scientific) | `server/services/searchService.js` |
| 5 | **Dark/Light Theme** (Tailwind dark mode + localStorage) | `public/js/app.js` |
| 6 | **Instant Utility Calculator** (safe math parser, Bengali digits too) | `server/utils/normalize.js` |
| 7 | **Auto-complete Suggestions** (DDG `/ac/` proxy + debounce) | `server/routes/api.js` |
| 8 | **Related Questions / “People Also Ask”** (accordion) | `server/services/searchService.js` |
| 9 | **Multi-language** (English, বাংলা, हिन्दी, Español …) | UI selector → SearXNG `language` |
| 10 | **Local Bookmarks & History** (localStorage only) | `public/js/app.js` |
| 11 | **Voice Search** (Web Speech API, `bn-BD` + `en-US`) | `public/js/app.js` |
| 12 | **Dynamic Site Favicons** (DDG/Google favicon proxy) | `server/services/widgets.js` |
| 13 | **Instant Page Preview / Reading Mode** (server-side reader) | `server/services/fetcher.js` |
| 14 | **Result Export** (JSON / CSV / TXT) | `public/js/app.js` |
| 15 | **Smart Keyboard Navigation** (`/` focus, ↑/↓/Enter results) | `public/js/app.js` |
| 16 | **QR Code Generator** (client-side, no CDN) | `public/vendor/qrcode.min.js` |
| 17 | **Region/Country Switcher** (geo-targeted queries) | UI selector → SearXNG `region` |
| 18 | **SafeSearch Toggle** (strict/moderate) | UI toggle → SearXNG `safesearch` |
| 19 | **Advanced Search Operators** (`site:`, `filetype:`, `intitle:` …) | `server/utils/normalize.js` |
| 20 | **Custom Accent Color Picker** (persisted locally) | `public/js/app.js` |
| 21 | **AI Chatbot Sidepanel (RAG)** with search context | `server/services/llm.js`, `server/routes/api.js` |
| 22 | **Bang Shortcuts** (`!w`, `!yt`, `!gh` … 30+ bangs) | `server/utils/normalize.js` |
| 23 | **Code Snippet Highlighting + Copy Code** | `public/js/app.js` |
| 24 | **Text-to-Speech** (SpeechSynthesis, play/pause) | `public/js/app.js` |
| 25 | **Real-Time Weather Widget** (Open-Meteo, keyless) | `server/services/widgets.js` |
| 26 | **World Clock Widget** (live UTC offset) | `public/js/app.js` |
| 27 | **Trending Topics & News Feed** (Google News RSS, keyless) | `server/services/widgets.js` |
| 28 | **Reverse Image Search** (drag & drop / URL upload) | `server/routes/proxy.js` |
| 29 | **Tracker Statistics Counter** (live, in-memory) | `server/utils/httpClient.js` |
| 30 | **Tag-based Bookmark Management** | `public/js/app.js` |
| 31 | **Custom Proxy Configuration** (HTTP/HTTPS/SOCKS4/SOCKS5 tunneling) | `server/routes/proxy.js` |

---

## 📁 Project Structure

```
aura-browser-2.0/
├── server/                      # Node.js / Express backend
│   ├── index.js                 # app bootstrap, security headers, rate limiter
│   ├── config.js                # typed env configuration loader
│   ├── routes/
│   │   ├── api.js               # search, summary, chat, suggest, weather,
│   │   │                        # trending, fetch, stats, bangs, config
│   │   └── proxy.js             # proxy panel + reverse image upload
│   ├── services/
│   │   ├── searchService.js     # SearXNG + DDG fallback orchestration
│   │   ├── llm.js               # Groq / HF / extractive AI (summary + RAG)
│   │   ├── widgets.js           # weather, trending, favicons
│   │   └── fetcher.js           # reading-mode extraction
│   ├── utils/
│   │   ├── httpClient.js        # privacy-safe fetch, SSRF guard, proxy agents
│   │   ├── normalize.js         # de-dup, bangs, operators, math parser
│   │   └── template.js          # tiny server-side template helper
│   └── tests/                   # node:test unit tests (npm test)
├── public/                      # frontend (served statically)
│   ├── index.html               # full app shell (modals, panels, widgets)
│   ├── css/
│   │   ├── input.css            # Tailwind source (+ component classes)
│   │   └── app.css              # compiled production CSS (committed)
│   ├── js/app.js                # all 31 features' client logic
│   └── vendor/qrcode.min.js     # vendored QR generator (no CDN)
├── searxng/settings.yml         # privacy-hardened SearXNG config
├── scripts/
│   ├── vendor-qrcode.js         # copies qrcode lib on npm install
│   └── mock-searxng.js          # offline SearXNG simulator for dev/demo
├── docker-compose.yml           # SearXNG + Aura in one command
├── Dockerfile                   # multi-stage production image
├── .env.example                 # every supported setting, documented
├── tailwind.config.js
└── package.json
```

---

## 🚀 Quick Start (5 minutes)

### Option A — Docker Compose (recommended, SearXNG included)

```bash
# 1. Clone & enter
git clone https://github.com/BFH-HAMID/Aura-Browser-2.0.git
cd Aura-Browser-2.0

# 2. Configure (optional)
cp .env.example .env          # add GROQ_API_KEY / HF_TOKEN for real AI answers

# 3. Build & launch SearXNG + Aura Browser
docker compose up -d --build

# 4. Open
#    Aura Browser  → http://localhost:3000
#    SearXNG       → http://localhost:8080
```

> First launch pulls the SearXNG image (~500 MB) and takes a minute or two.

### Option B — Run SearXNG via Docker, Aura natively (Node)

```bash
# 1. SearXNG with the bundled hardened config
docker run -d --name aura-searxng \
  -p 8080:8080 \
  -v "$PWD/searxng/settings.yml:/etc/searxng/settings.yml:ro" \
  -e SEARXNG_BASE_URL=http://localhost:8080 \
  searxng/searxng:latest

# 2. Aura Browser
cp .env.example .env          # SEARXNG_URL defaults to http://localhost:8080
npm install
npm start                     # → http://localhost:3000

# verify SearXNG JSON API:
curl "http://localhost:8080/search?q=test&format=json" | head
```

### Option C — Fully offline demo (no Docker, no internet)

```bash
npm install
node scripts/mock-searxng.js   # terminal 1 — fake SearXNG on :8080
SEARXNG_URL=http://localhost:8080 npm start   # terminal 2 — Aura on :3000
```

---

## 🛰️ Configuring the free AI (Features 1 & 21)

| Provider | Key | Model |
|----------|-----|-------|
| **Groq** (recommended — fast, generous free tier) | `GROQ_API_KEY` from [console.groq.com](https://console.groq.com) | `GROQ_MODEL=llama-3.3-70b-versatile` |
| **Hugging Face** | `HF_TOKEN` from [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) | `HF_MODEL=mistralai/Mistral-7B-Instruct-v0.3` |
| **None** | — | Built-in offline **extractive** summarizer (always works, zero keys) |

Aura automatically picks the best configured provider and **degrades gracefully** — if the LLM is down, you still get an extractive summary. **No prompt/query data is ever logged.**

## 🛰️ Proxy & Tunneling (Feature 31)

Two ways:

1. **In-app panel** — `⚙️ Settings → Custom proxy / tunneling`. HTTP, HTTPS, SOCKS4 or SOCKS5 with optional auth. Stored **in memory only** (never on disk), applied to *all* outbound requests (SearXNG, DDG, weather, reader, LLM).
2. **Static env config** — `PROXY_PROTOCOL`, `PROXY_HOST`, `PROXY_PORT`, `PROXY_USERNAME`, `PROXY_PASSWORD` in `.env`.

You can also configure SearXNG's own outbound proxy in `searxng/settings.yml` → `outgoing.proxies`.

## 🔒 Privacy Model

- **Stateless backend** — no DB, no log files, no cookies, no sessions.
- Request **content is never logged**; only anonymous in-memory counters feed the tracker widget (reset on restart).
- **SSRF guard** blocks fetches to private/loopback/link-local IPs (protects the reading-mode proxy).
- Rate limiter is a pure in-memory counter (configurable via `ENABLE_RATE_LIMIT`).
- Frontend state (theme, accent, bookmarks, history, language, region) lives **only in your browser's localStorage**.

## ⌨️ Handy usage

| Type | What happens |
|------|--------------|
| `12*5+3` · `sqrt(144)` · `১২+৮` | Instant calculator widget |
| `!w quantum computing` · `!yt music` · `!gh express` | Bang redirect (30+ sites) |
| `site:github.com tailwind` · `filetype:pdf report` | Advanced operators |
| `weather: Dhaka` · `weather: 23.8,90.4` | Weather widget |
| `/` | Focus search bar |
| `↑` `↓` `Enter` | Navigate results with keyboard |
| Search-card hover → 🤍 📖 ▦ 🔊 ⬇ | Bookmark · Reading mode · QR · Read aloud · Export |

## 🧪 Tests

```bash
npm test        # node:test — de-dup, bangs, operators, math, SSRF guard
```

## 🛠 Development

```bash
npm run dev                 # auto-restart on file changes
npm run build:css           # rebuild Tailwind CSS
npm run build:css:watch     # watch mode
npm run vendor:qrcode       # re-vendor the QR library
```

## 📜 License

**GPL-3.0** — free forever. SearXNG is AGPL-3.0; this project is not affiliated with SearXNG or DuckDuckGo. DuckDuckGo instant suggestions are used via their public endpoint; Open-Meteo and Google News RSS are used for widgets.
