/**
 * Aura Browser 2.0 — vendor script.
 *
 * Copies the `qrcode-generator` browser bundle into `public/vendor/` so the
 * frontend can generate QR codes 100% client-side (feature 16) with zero CDN
 * dependencies. Runs automatically on `npm install`.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(
  __dirname,
  '..',
  'node_modules',
  'qrcode-generator',
  'qrcode.js'
);
const DEST_DIR = path.join(__dirname, '..', 'public', 'vendor');
const DEST = path.join(DEST_DIR, 'qrcode.min.js');

try {
  if (!fs.existsSync(SRC)) {
    console.warn('[vendor] qrcode-generator not found — skipping (run: npm install)');
    process.exit(0);
  }
  fs.mkdirSync(DEST_DIR, { recursive: true });
  fs.copyFileSync(SRC, DEST);
  console.log(`[vendor] qrcode bundle → public/vendor/qrcode.min.js (${fs.statSync(DEST).size} bytes)`);
} catch (err) {
  console.error('[vendor] failed to copy qrcode bundle:', err.message);
  process.exit(1);
}
