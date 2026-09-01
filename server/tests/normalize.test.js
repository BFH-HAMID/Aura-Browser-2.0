/**
 * Aura Browser 2.0 — unit tests for the normalizer utilities.
 * Run with: npm test
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  normalizeUrl,
  normalizeTitle,
  titleSimilarity,
  extractDomain,
  parseUrlParts,
  dedupeResults,
  parseBang,
  processOperators,
  detectMathExpression,
} = require('../utils/normalize');

test('normalizeUrl strips tracking params, fragments and trailing slashes', () => {
  const a = normalizeUrl('https://Example.com/path/?utm_source=x&b=2&a=1#frag');
  const b = normalizeUrl('https://example.com/path/?a=1&b=2');
  assert.strictEqual(a, b);
});

test('normalizeTitle collapses punctuation and case', () => {
  assert.strictEqual(normalizeTitle('Hello,  World!!'), 'hello world');
});

test('titleSimilarity detects near-identical titles', () => {
  assert.ok(titleSimilarity('The Fastest Way to Learn Python', 'the fastest way to learn python') >= 0.9);
  assert.ok(titleSimilarity('How to Bake Bread', 'Climate change report 2026') < 0.5);
});

test('extractDomain handles ccTLDs and www prefixes', () => {
  assert.strictEqual(extractDomain('www.bbc.co.uk'), 'bbc.co.uk');
  assert.strictEqual(extractDomain('en.wikipedia.org'), 'wikipedia.org');
  assert.strictEqual(extractDomain('https://news.ycombinator.com'), 'ycombinator.com');
});

test('dedupeResults removes URL + fuzzy duplicates and keeps the richest', () => {
  const { results, removed } = dedupeResults([
    { title: 'A', url: 'https://a.com/x?utm_source=1' },
    { title: 'A', url: 'https://a.com/x' }, // same normalized URL
    { title: 'The Same Article Title', url: 'https://b.com/p' },
    { title: 'the same article title!', url: 'https://b.com/q' }, // fuzzy dup → merges
    { title: 'Unique', url: 'https://c.com/u' },
  ]);
  // A2 removed as URL-dup; B2 dropped as exact-title dup (first wins); C unique.
  assert.strictEqual(results.length, 3);
  assert.strictEqual(removed, 2);
  assert.strictEqual(results[0].url, 'https://a.com/x?utm_source=1');
  assert.strictEqual(results[1].url, 'https://b.com/p');
  assert.strictEqual(results[2].url, 'https://c.com/u');
});

test('parseBang recognizes known bangs and leaves others alone', () => {
  assert.deepStrictEqual(parseBang('!w quantum computing').bang.key, 'w');
  assert.strictEqual(parseBang('!w quantum computing').query, 'quantum computing');
  assert.strictEqual(parseBang('!zzz nothing').bang, null);
  assert.strictEqual(parseBang('plain query').bang, null);
});

test('processOperators extracts filters and keeps native tokens', () => {
  const { query, filters } = processOperators('site:github.com filetype:pdf tailwind');
  assert.strictEqual(filters.site, 'github.com');
  assert.strictEqual(filters.filetype, 'pdf');
  assert.ok(query.includes('site:github.com'));
  assert.ok(query.includes('filetype:pdf'));
});

test('detectMathExpression evaluates arithmetic incl. Bengali digits', () => {
  assert.strictEqual(detectMathExpression('12*5+3').result, 63);
  assert.strictEqual(detectMathExpression('১২+৮').result, 20);
  assert.strictEqual(detectMathExpression('sqrt(16)').result, 4);
  assert.strictEqual(detectMathExpression('hello world'), null);
});
