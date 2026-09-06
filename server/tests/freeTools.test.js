/**
 * Aura Browser 2.0 — tests for free research-tool parsing helpers.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseFeed, readTextLimit, splitTranslationText, normalizeLanguage, translateText, fetchFeed, findArchive } = require('../services/freeTools');

test('parseFeed normalizes RSS items', () => {
  const feed = parseFeed(`<?xml version="1.0"?>
    <rss version="2.0"><channel><title>Aura News</title><link>https://example.com</link>
      <description>Research updates</description><item><title>First story</title><link>https://example.com/one</link>
      <description><![CDATA[<b>Useful</b> summary]]></description><pubDate>2026-09-06</pubDate></item>
    </channel></rss>`, 'https://example.com/feed.xml');

  assert.strictEqual(feed.type, 'rss');
  assert.strictEqual(feed.title, 'Aura News');
  assert.strictEqual(feed.items.length, 1);
  assert.strictEqual(feed.items[0].url, 'https://example.com/one');
  assert.strictEqual(feed.items[0].summary, 'Useful summary');
});

test('parseFeed normalizes Atom entries and alternate links', () => {
  const feed = parseFeed(`<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom"><title>Atom feed</title>
      <entry><title>Atom entry</title><link href="https://example.org/atom.xml" rel="self"/>
      <link href="https://example.org/post" rel="alternate"/>
      <summary>Atom summary</summary><updated>2026-09-06</updated></entry>
    </feed>`, 'https://example.org/atom.xml');

  assert.strictEqual(feed.type, 'atom');
  assert.strictEqual(feed.items[0].title, 'Atom entry');
  assert.strictEqual(feed.items[0].url, 'https://example.org/post');
});

test('feed response reader enforces the byte cap before parsing', async () => {
  const shortResponse = new Response('small RSS body');
  assert.strictEqual(await readTextLimit(shortResponse, 64, 'Feed'), 'small RSS body');

  const largeResponse = new Response('x'.repeat(128));
  await assert.rejects(() => readTextLimit(largeResponse, 64, 'Feed'), /Feed is too large/);
});

test('translation helpers constrain chunks and language values', () => {
  const text = `${'word '.repeat(250)}.`;
  const chunks = splitTranslationText(text, 100);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 101));
  assert.strictEqual(normalizeLanguage('bn-BD'), 'bn');
  assert.strictEqual(normalizeLanguage('not-a-language'), 'en');
});

test('invalid research-tool inputs are explicit client errors before any outbound call', async () => {
  await assert.rejects(() => translateText('', 'en', 'bn'), (error) => error.status === 400);
  await assert.rejects(() => fetchFeed('ftp://example.org/feed.xml'), (error) => error.status === 400);
  await assert.rejects(() => findArchive('javascript:alert(1)'), (error) => error.status === 400);
});
