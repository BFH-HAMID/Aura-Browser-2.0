/**
 * Aura Browser 2.0 — SearXNG research filter forwarding tests.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildSearxngParams } = require('../services/searchService');

test('selected engines and a valid freshness range are forwarded to SearXNG', () => {
  const params = buildSearxngParams({
    query: 'privacy site:example.org filetype:pdf',
    category: 'scientific',
    language: 'en',
    region: 'bd-en',
    safesearch: 2,
    page: 3,
    engines: ['arxiv', 'google', 'arxiv'],
    timeRange: 'month',
  });

  assert.strictEqual(params.get('q'), 'privacy site:example.org filetype:pdf');
  assert.strictEqual(params.get('categories'), 'science');
  assert.strictEqual(params.get('region'), 'bd-en');
  assert.strictEqual(params.get('pageno'), '3');
  assert.strictEqual(params.get('time_range'), 'month');
  assert.strictEqual(params.get('engines'), 'arxiv,google');
});

test('invalid freshness is omitted and category defaults remain available', () => {
  const params = buildSearxngParams({
    query: 'latest programming',
    category: 'code',
    timeRange: 'forever',
  });

  assert.strictEqual(params.get('time_range'), null);
  assert.strictEqual(params.get('engines'), 'github,stackoverflow');
});
