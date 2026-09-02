/**
 * Aura Browser 2.0 — free LLM integration.
 *
 * Feature 1 : AI Summary Box (synthesized answer card above results).
 * Feature 21: RAG chatbot sidepanel (search results injected as context).
 *
 * Provider priority (all free):
 *   1. Groq — blazing fast, generous free tier (llama-3.x). Needs GROQ_API_KEY.
 *   2. Hugging Face Inference API — free token required (HF_TOKEN).
 *   3. Extractive summarizer — 100% offline fallback, zero keys: extracts the
 *      most informative sentences from result snippets. Always works.
 *
 * This module performs NO logging of prompts or responses.
 */
'use strict';

const config = require('../config');
const { safeFetch } = require('../utils/httpClient');

const SYSTEM_BASE =
  'You are Aura, a helpful assistant inside Aura Browser 2.0, a privacy-first meta-search engine. ' +
  'Be concise, factual and neutral. Use markdown sparingly (bold, short lists). ' +
  'If the provided context does not answer the question, say so honestly. ';

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------
function resolveProvider() {
  if (config.llm.groqApiKey) return 'groq';
  if (config.llm.hfToken) return 'huggingface';
  return 'extractive';
}

// ---------------------------------------------------------------------------
// Groq (OpenAI-compatible chat completions)
// ---------------------------------------------------------------------------
async function groqComplete(messages, { maxTokens = 500, temperature = 0.4 } = {}) {
  const response = await safeFetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    timeoutMs: config.llm.timeoutMs,
    headers: {
      authorization: `Bearer ${config.llm.groqApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.llm.groqModel,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  });
  if (!response.ok) {
    throw new Error(`Groq API error ${response.status}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ---------------------------------------------------------------------------
// Hugging Face Inference API (text-generation)
// ---------------------------------------------------------------------------
async function huggingfaceComplete(messages) {
  const last = messages[messages.length - 1]?.content || '';
  const prompt = [
    messages[0]?.role === 'system' ? messages[0].content : SYSTEM_BASE,
    ...messages.slice(1).map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`),
    'Assistant:',
  ].join('\n\n');

  const response = await safeFetch(
    `https://api-inference.huggingface.co/models/${encodeURIComponent(config.llm.hfModel)}`,
    {
      method: 'POST',
      timeoutMs: config.llm.timeoutMs,
      headers: {
        authorization: `Bearer ${config.llm.hfToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 500, temperature: 0.4 } }),
    }
  );
  if (!response.ok) throw new Error(`Hugging Face API error ${response.status}`);
  const data = await response.json();
  const text = Array.isArray(data) ? data[0]?.generated_text : data.generated_text;
  if (!text) throw new Error('Empty Hugging Face response');
  // Strip the echoed prompt.
  return text.slice(text.lastIndexOf('Assistant:') + 'Assistant:'.length).trim() || text.trim();
}

// ---------------------------------------------------------------------------
// Offline extractive fallback — sentence salience scoring
// ---------------------------------------------------------------------------
function extractiveSummarize(results, query) {
  const queryTerms = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const sentences = [];
  for (const r of results.slice(0, 8)) {
    const text = `${r.title}. ${r.content || ''}`;
    text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 40 && s.length < 300)
      .forEach((s) => {
        const lower = s.toLowerCase();
        let score = 0;
        for (const t of queryTerms) if (lower.includes(t)) score += 2;
        score += Math.min(s.length / 100, 2);
        if (/how|what|why|is|are|the|of|in|to/i.test(lower)) score += 0.5;
        sentences.push({ s, score });
      });
  }
  sentences.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const { s } of sentences) {
    if (picked.join(' ').length > 600) break;
    if (!picked.some((p) => p.includes(s.slice(0, 40)))) picked.push(s);
  }
  if (!picked.length) {
    const first = results[0];
    if (!first) return 'No results were returned, so there is nothing to summarize yet.';
    return `${first.title}. ${(first.content || 'No snippet available.').slice(0, 220)}`;
  }
  return picked.join(' ');
}

/**
 * Local RAG: score the user's question against context sentences and return
 * the most relevant passages verbatim (works offline, no keys).
 */
function extractiveAnswer(question, context) {
  const terms = String(question || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const chunks = String(context || '')
    .split(/\n{2,}/)
    .map((c) => c.trim().replace(/^\d+\.\s*/, '')) // strip "1. " numbering
    .filter((c) => c.length > 20);
  const scored = chunks
    .map((c) => {
      const lower = c.toLowerCase();
      const score = terms.reduce((acc, t) => acc + (lower.includes(t) ? 2 : 0), 0);
      return { c, score };
    })
    .sort((a, b) => b.score - a.score);
  const top = scored.filter((s) => s.score > 0).slice(0, 3).map((s) => s.c);
  if (!top.length) {
    return 'I could not find a clear answer in the current search results. Try a more specific query, or ask me something else about these results.';
  }
  return 'Based on the current search results:\n\n• ' + top.join('\n\n• ');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate an AI summary for a query + result set.
 * @returns {Promise<{provider: string, summary: string}>}
 */
async function generateSummary(query, results) {
  const provider = resolveProvider();
  const context = results
    .slice(0, 8)
    .map((r, i) => `${i + 1}. ${r.title}\n   ${(r.content || '').slice(0, 400)}`)
    .join('\n');

  if (provider === 'extractive') {
    return { provider: 'extractive', summary: extractiveSummarize(results, query) };
  }

  const messages = [
    {
      role: 'system',
      content:
        SYSTEM_BASE +
        'Summarize the user\'s question into a short, direct answer (max 120 words) ' +
        'synthesized ONLY from the provided search snippets. Cite sources inline like [1], [2].',
    },
    { role: 'user', content: `QUESTION: ${query}\n\nSEARCH SNIPPETS:\n${context}` },
  ];

  try {
    const summary =
      provider === 'groq'
        ? await groqComplete(messages)
        : await huggingfaceComplete(messages);
    return { provider, summary };
  } catch {
    // Graceful degradation: never fail the whole search because of the LLM.
    return { provider: 'extractive', summary: extractiveSummarize(results, query) };
  }
}

/**
 * RAG chat turn (feature 21). `history` = [{role:'user'|'assistant', content}],
 * `context` = markdown of current search results.
 */
async function chatTurn(history, context) {
  const provider = resolveProvider();
  const system = {
    role: 'system',
    content:
      SYSTEM_BASE +
      'Answer using the SEARCH CONTEXT below when relevant.\n\n' +
      `SEARCH CONTEXT:\n${context || '(no active search — answer generally)'}`,
  };
  const messages = [system, ...history.slice(-10)];

  if (provider === 'extractive') {
    const q = history.filter((m) => m.role === 'user').pop()?.content || '';
    return { provider: 'extractive', content: extractiveAnswer(q, context) };
  }

  try {
    const content =
      provider === 'groq'
        ? await groqComplete(messages, { maxTokens: 600, temperature: 0.7 })
        : await huggingfaceComplete(messages);
    return { provider, content };
  } catch {
    const q = history.filter((m) => m.role === 'user').pop()?.content || '';
    return { provider: 'extractive', content: extractiveAnswer(q, context) };
  }
}

module.exports = { generateSummary, chatTurn, resolveProvider, extractiveSummarize };
