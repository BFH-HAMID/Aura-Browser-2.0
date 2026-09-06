/**
 * Aura Browser 2.0 — tests for the local URL safety/privacy heuristic.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { assessLinkSafety } = require('../utils/linkSafety');

test('ordinary HTTPS URLs receive a low-risk URL-level assessment', () => {
  const assessment = assessLinkSafety('https://www.example.org/articles/privacy');
  assert.strictEqual(assessment.level, 'low-risk');
  assert.strictEqual(assessment.https, true);
  assert.ok(assessment.score >= 85);
});

test('tracking parameters and deceptive URL traits lower the score', () => {
  const assessment = assessLinkSafety('http://paypal.verify-login.xn--bad-9ta.zip@192.0.2.1/login?utm_source=mail&fbclid=abc');
  assert.strictEqual(assessment.level, 'high-risk');
  assert.ok(assessment.trackerParams >= 2);
  assert.ok(assessment.signals.length >= 3);
  assert.ok(assessment.score < 60);
});

test('invalid links are clearly marked instead of throwing', () => {
  const assessment = assessLinkSafety('not a valid URL');
  assert.strictEqual(assessment.score, 0);
  assert.strictEqual(assessment.level, 'high-risk');
});
