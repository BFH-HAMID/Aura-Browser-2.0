/**
 * Aura Browser 2.0 — unit tests for Gemini request/response shaping.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildGeminiRequest, extractGeminiText } = require('../services/llm');

test('buildGeminiRequest sends a stateless Interactions API conversation', () => {
  const request = buildGeminiRequest(
    [
      { role: 'system', content: 'Answer concisely.' },
      { role: 'user', content: 'What is Aura?' },
      { role: 'assistant', content: 'Aura is a privacy-first search app.' },
      { role: 'user', content: 'Which AI provider does it use?' },
    ],
    { maxTokens: 600, temperature: 0.7 }
  );

  assert.strictEqual(request.store, false);
  assert.strictEqual(request.system_instruction, 'Answer concisely.');
  assert.deepStrictEqual(request.generation_config, { max_output_tokens: 600, temperature: 0.7 });
  assert.deepStrictEqual(request.input, [
    { type: 'user_input', content: [{ type: 'text', text: 'What is Aura?' }] },
    { type: 'model_output', content: [{ type: 'text', text: 'Aura is a privacy-first search app.' }] },
    { type: 'user_input', content: [{ type: 'text', text: 'Which AI provider does it use?' }] },
  ]);
});

test('extractGeminiText supports the convenience field and raw model output steps', () => {
  assert.strictEqual(extractGeminiText({ output_text: '  Gemini answer  ' }), 'Gemini answer');
  assert.strictEqual(
    extractGeminiText({
      steps: [
        { type: 'model_output', content: [{ type: 'text', text: 'First ' }, { type: 'text', text: 'second' }] },
      ],
    }),
    'First second'
  );
});

test('buildGeminiRequest rejects a conversation without usable content', () => {
  assert.throws(() => buildGeminiRequest([{ role: 'system', content: 'Only instruction.' }]), /at least one/i);
});
