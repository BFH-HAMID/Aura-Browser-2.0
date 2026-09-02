/**
 * Aura Browser 2.0 — mock SearXNG for offline development & demos.
 *
 * Speaks the SearXNG JSON API subset on port 8080 so you can exercise the
 * whole app without Docker or internet access:
 *
 *     node scripts/mock-searxng.js
 *     (in another terminal) node server/index.js
 *
 * It returns deterministic fake results (including duplicates, so you can
 * watch the de-duplication engine work).
 */
'use strict';

const http = require('http');

const QUERIES = {
  default: [
    { title: 'Quantum Computing — Wikipedia', url: 'https://en.wikipedia.org/wiki/Quantum_computing', content: 'Quantum computing is the use of quantum-mechanical phenomena such as superposition and entanglement to perform computation.', engine: 'wikipedia' },
    { title: 'What is Quantum Computing? | IBM', url: 'https://www.ibm.com/topics/quantum-computing', content: 'Quantum computing is a rapidly-emerging technology that harnesses the laws of quantum mechanics to solve problems too complex for classical computers.', engine: 'google' },
    { title: 'Quantum computing explained in 10 minutes', url: 'https://www.youtube.com/watch?v=JhHMJCUmq28', content: 'A gentle introduction to qubits, superposition, and quantum gates.', engine: 'youtube' },
    { title: 'Quantum Computing — Wikipedia (mirror)', url: 'https://en.wikipedia.org/wiki/Quantum_computing?from=searx', content: 'Quantum computing is the use of quantum-mechanical phenomena such as superposition and entanglement to perform computation.', engine: 'bing' },
  ],
  news: [
    { title: 'Global markets rally as tech earnings beat expectations', url: 'https://example.com/news/markets-rally', content: 'Markets rallied across the board today as major technology companies reported better-than-expected quarterly earnings.', engine: 'google news' },
    { title: 'Scientists discover new exoplanet with possible water', url: 'https://example.com/news/exoplanet', content: 'Astronomers announced the discovery of an Earth-sized exoplanet in the habitable zone of a nearby star.', engine: 'bing news' },
  ],
  code: [
    { title: 'Express.js middleware guide', url: 'https://expressjs.com/en/guide/using-middleware.html', content: 'const app = express(); app.use((req, res, next) => { console.log("Time:", Date.now()); next(); });', engine: 'stackoverflow' },
    { title: 'A curated list of Node.js best practices', url: 'https://github.com/goldbergyoni/nodebestpractices', content: 'const result = await db.query("SELECT * FROM users WHERE id = ?", [id]);', engine: 'github' },
  ],
  scientific: [
    { title: 'arXiv: Attention Is All You Need', url: 'https://arxiv.org/abs/1706.03762', content: 'We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.', engine: 'arxiv' },
  ],
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/search' && url.searchParams.get('format') === 'json') {
    const cat = url.searchParams.get('categories') || 'general';
    const query = url.searchParams.get('q') || '';
    const pool = cat.includes('news') ? QUERIES.news
      : cat.includes('it') ? QUERIES.code
      : cat.includes('science') ? QUERIES.scientific
      : QUERIES.default;
    // Include a duplicate only for the general category so the UI can show
    // "N duplicates removed".
    const results = cat.includes('general') && query ? [...pool, { ...pool[0], title: pool[0].title + ' (duplicate)' }] : pool;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ results, suggestions: [] }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<h1>Mock SearXNG</h1><p>Point SEARXNG_URL=http://localhost:8080 and search away.</p>');
});

server.listen(8080, '0.0.0.0', () => {
  console.log('🛰️  Mock SearXNG listening on http://0.0.0.0:8080 (JSON API subset)');
});
