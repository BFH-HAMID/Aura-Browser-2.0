# ⚡ Aura Browser 2.0

**The 100% free, zero-tracking hybrid meta-search engine & privacy browser web app.**

Aura Browser 2.0 aggregates **SearXNG** (self-hosted, open-source) + **DuckDuckGo Instant Answers** + free endpoints behind a single privacy gateway: **no Aura account, no cookies, no logs, no tracking — ever.**

![stack](https://img.shields.io/badge/stack-Node.js%20%2B%20Express%20%2B%20Tailwind%20%2B%20SearXNG-8b5cf6) ![license](https://img.shields.io/badge/license-GPL--3.0-blue)

---

## ✨ Core Feature Matrix

| # | Feature | Where |
|---|---------|-------|
| 1 | **AI Summary Box** (Gemini / Hugging Face / offline extractive) | `server/services/llm.js`, `public/js/app.js` |
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

### Research, offline, privacy & accessibility toolkit

The **Filters & sources** and **Research tools** controls add the requested toolkit without introducing an installable PWA or a local LLM:

| Requested feature | Implementation |
|---|---|
| **2. Offline Saved Reading Library** | Clean reader copies live in browser **IndexedDB**; a same-origin service worker caches only the static app shell and never `/api/*` payloads. |
| **3. Quick Privacy Erase / Panic Button** | Settings includes a confirmed erase action for Aura localStorage, session data, IndexedDB research data, and Aura-named caches. |
| **4. Research Workspace** | Local-only workspaces collect sources and handwritten notes. |
| **5. Citation & Source Generator** | Result cards generate APA, MLA, or Chicago-style citation text locally. |
| **6. Advanced Filter Panel** | Domain, excluded-domain, file type, freshness, and SearXNG-engine selectors are forwarded with search requests. |
| **7. Search Engine Selector** | Choose configured/available SearXNG engine names or leave the selector empty for category defaults. |
| **8. Side-by-Side Compare Search** | Run two queries concurrently using the same private search settings. |
| **9. RSS / Atom Feed Reader** | Aura fetches and parses feeds server-side through its SSRF-safe outbound client; feeds are remembered only in this browser. |
| **10. Page / Selected Text Translation** | Use a self-hosted LibreTranslate instance when configured, otherwise the keyless MyMemory endpoint for short excerpts. |
| **11. Local Document Search** | TXT and PDF text is extracted in the browser with locally vendored PDF.js and searched entirely on-device. |
| **12. Image OCR** | English/Bengali images are processed in memory with locally vendored Tesseract language data; files are not persisted. |
| **13. QR / Barcode Scanner** | Uses the browser-native `BarcodeDetector` and camera/file picker on supporting browsers. |
| **15. Ask About Selected Text** | Selection/result/document text is sent to Aura's existing configured AI chat endpoint with a focused prompt. |
| **16. Semantic Bookmark & Note Search** | A small on-device concept/token ranking searches bookmarks, notes, saved pages, and document text. |
| **17. Accessibility / Focus Mode** | Text scaling, contrast, reduced motion, readable spacing, and focus mode persist locally. |
| **18. Result Reading-Time & Metadata Card** | Reader extraction estimates 220 words/minute and shows canonical URL, author, date, and description where available. |
| **19. Archived Page / Wayback Button** | A server-side Wayback availability lookup returns the closest public snapshot. |
| **20. Link Safety & Privacy Score** | An explainable local URL heuristic detects URL-level tracking/risk signals; it is not a malware verdict and sends no URL to a reputation service. |

> **Scope note:** the service worker is deliberately an offline app-shell/library aid only. There is **no web app manifest, install prompt, install button, PWA-install flow, or Ollama/local-AI feature** in this change.

---

## 📁 Project Structure

```
aura-browser-2.0/
├── server/                      # Node.js / Express backend
│   ├── index.js                 # app bootstrap, security headers, rate limiter
│   ├── config.js                # typed env configuration loader
│   ├── routes/
│   │   ├── api.js               # search, reader, feeds, translation, OCR, archive, safety
│   │   └── proxy.js             # proxy panel + reverse image upload
│   ├── services/
│   │   ├── searchService.js     # SearXNG + DDG fallback orchestration
│   │   ├── llm.js               # Gemini / HF / extractive AI (summary + RAG)
│   │   ├── freeTools.js         # RSS/Atom, translation, Wayback helpers
│   │   ├── ocr.js               # serialized in-memory Tesseract worker
│   │   ├── widgets.js           # weather, trending, favicons
│   │   └── fetcher.js           # reading-mode + metadata extraction
│   ├── utils/
│   │   ├── httpClient.js        # privacy-safe fetch, SSRF guard, proxy agents
│   │   ├── linkSafety.js        # local explainable URL heuristic
│   │   ├── normalize.js         # de-dup, bangs, operators, math parser
│   │   └── template.js          # tiny server-side template helper
│   └── tests/                   # node:test unit tests (npm test)
├── public/                      # frontend (served statically)
│   ├── index.html               # full app shell (modals, panels, widgets)
│   ├── css/
│   │   ├── input.css            # Tailwind source (+ component classes)
│   │   └── app.css              # compiled production CSS (committed)
│   ├── js/
│   │   ├── app.js               # core client logic
│   │   └── research-tools.js    # research, offline, scanner, accessibility UI
│   ├── sw.js                    # non-installable static offline shell
│   └── vendor/
│       ├── qrcode.min.js        # vendored QR generator (no CDN)
│       ├── pdfjs/               # local PDF text extractor
│       └── tessdata/            # English/Bengali OCR models
├── searxng/settings.yml         # privacy-hardened SearXNG config
├── scripts/
│   ├── vendor-qrcode.js         # copies QR lib on npm install
│   ├── vendor-free-tools.js     # copies PDF.js + Tesseract models
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
cp .env.example .env          # add GEMINI_API_KEY / HF_TOKEN for real AI answers

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

## 🛰️ Configuring AI (Features 1 & 21)

| Provider | Key | Model |
|----------|-----|-------|
| **Gemini** (recommended) | `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/apikey) | `GEMINI_MODEL=gemini-3.5-flash-lite` (fast & cheap) or `gemini-3.6-flash` (balanced) |
| **Hugging Face** | `HF_TOKEN` from [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) | `HF_MODEL=mistralai/Mistral-7B-Instruct-v0.3` |
| **None** | — | Built-in offline **extractive** summarizer (always works, zero keys) |

Aura selects Gemini first when `GEMINI_API_KEY` is set, then Hugging Face, then the local extractive fallback. Gemini uses the current Interactions API with `store: false`, so Aura does not create retained Gemini Interaction records. Aura itself never logs prompts or responses; a selected cloud provider still processes requests under its own terms.

## 🧰 Research-tool service options

- **Translation:** set `LIBRETRANSLATE_URL` (and optionally `LIBRETRANSLATE_API_KEY`) to a self-hosted LibreTranslate `/translate` service. Without it, Aura uses the public, keyless MyMemory endpoint for excerpts up to **3,000 characters**. The selected text therefore leaves Aura for the translation provider; use self-hosting when that is not acceptable.
- **RSS/Atom and Wayback:** `MYMEMORY_TRANSLATE_URL` and `WAYBACK_AVAILABLE_URL` allow alternate compatible endpoints. Feed and archive requests go through Aura's backend/SSRF guard; feed subscriptions themselves are saved in browser localStorage.
- **OCR:** the server uses the vendored English and Bengali Tesseract model files. Uploads have an **8 MB** memory-only limit and are discarded after recognition. First OCR use initializes the in-memory worker.
- **Scanner:** camera scanning requires a secure context (HTTPS, except localhost), the browser's `BarcodeDetector` implementation, and a camera permission. The response sends `Permissions-Policy: camera=(self)`.

## 🛰️ Proxy & Tunneling (Feature 31)

Two ways:

1. **In-app panel** — `⚙️ Settings → Custom proxy / tunneling`. HTTP, HTTPS, SOCKS4 or SOCKS5 with optional auth. Stored **in memory only** (never on disk), applied to *all* outbound requests (SearXNG, DDG, weather, reader, LLM).
2. **Static env config** — `PROXY_PROTOCOL`, `PROXY_HOST`, `PROXY_PORT`, `PROXY_USERNAME`, `PROXY_PASSWORD` in `.env`.

You can also configure SearXNG's own outbound proxy in `searxng/settings.yml` → `outgoing.proxies`.

## 🔒 Privacy Model

- **Stateless backend** — no DB, no log files, no cookies, no sessions.
- Request **content is never logged** by Aura; only anonymous in-memory counters feed the tracker widget (reset on restart). Cloud AI is optional; Gemini calls explicitly use `store: false`.
- **SSRF guard** blocks fetches to private/loopback/link-local IPs (protects the reading-mode proxy).
- Rate limiter is a pure in-memory counter (configurable via `ENABLE_RATE_LIMIT`).
- Frontend state (theme, accent, bookmarks, history, language, region, workspaces, feeds, accessibility) lives **only in your browser's localStorage**; larger saved reader copies and local-document text use **IndexedDB**.
- The optional offline service worker caches static same-origin shell assets only. It intentionally **does not cache `/api/*`**, search data, translations, OCR payloads/results, feeds, or reader fetches, and it does not offer an installable PWA.
- Translation, optional cloud AI, and opening result links have their own external-provider/site privacy implications. Link Safety is an offline URL heuristic, not a remote reputation lookup or security guarantee.

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
| **Filters & sources** | Set freshness/domain/file filters and choose SearXNG engines before searching. |
| **Research tools** | Open local library, workspaces, RSS, PDF/TXT search, OCR, scanner, and accessibility options. |
| Result tool row | Save offline, add to workspace, cite, translate, ask about context, inspect metadata, find archive, or view local URL signals. |
| Select reader/result/document text | Use the floating Translate / Ask Aura / Copy actions. |

## 🧪 Tests

```bash
npm test        # node:test — LLM, feeds, translation helpers, safety, de-dup, bangs, math, SSRF guard
# Optional browser-DOM smoke check:
npm install --no-save --package-lock=false jsdom
node scripts/dom-smoke.js
```

## 🛠 Development

```bash
npm run dev                 # auto-restart on file changes
npm run build:css           # rebuild Tailwind CSS
npm run build:css:watch     # watch mode
npm run vendor              # re-vendor QR, PDF.js, and OCR language data
npm run vendor:qrcode       # re-vendor only the QR library
npm run vendor:free-tools   # re-vendor PDF.js + Tesseract language data
```

## 📜 License

**GPL-3.0** — free forever. SearXNG is AGPL-3.0; this project is not affiliated with SearXNG or DuckDuckGo. DuckDuckGo instant suggestions are used via their public endpoint; Open-Meteo and Google News RSS are used for widgets.
