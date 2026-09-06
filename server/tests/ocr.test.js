/**
 * Aura Browser 2.0 — OCR service input normalization tests.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { normalizeOcrLanguage } = require('../services/ocr');

test('OCR accepts bundled English and Bengali data and safely defaults unknown language', () => {
  assert.strictEqual(normalizeOcrLanguage('eng'), 'eng');
  assert.strictEqual(normalizeOcrLanguage('BEN'), 'ben');
  assert.strictEqual(normalizeOcrLanguage('fra'), 'eng');
});
