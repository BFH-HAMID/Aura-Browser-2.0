/**
 * Aura Browser 2.0 — vendor free client/tool assets.
 *
 * Keeps PDF parsing and OCR language data self-hosted with the app instead of
 * relying on a runtime CDN. The browser uses the PDF.js modules; Tesseract's
 * Node worker reads the bundled traineddata files from public/vendor/tessdata.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const entries = [
  {
    source: path.join(root, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.min.mjs'),
    destination: path.join(root, 'public', 'vendor', 'pdfjs', 'pdf.min.mjs'),
  },
  {
    source: path.join(root, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.min.mjs'),
    destination: path.join(root, 'public', 'vendor', 'pdfjs', 'pdf.worker.min.mjs'),
  },
  {
    source: path.join(root, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'),
    destination: path.join(root, 'public', 'vendor', 'tessdata', 'eng.traineddata.gz'),
  },
  {
    source: path.join(root, 'node_modules', '@tesseract.js-data', 'ben', '4.0.0_best_int', 'ben.traineddata.gz'),
    destination: path.join(root, 'public', 'vendor', 'tessdata', 'ben.traineddata.gz'),
  },
];

try {
  for (const { source, destination } of entries) {
    if (!fs.existsSync(source)) {
      throw new Error(`missing dependency asset: ${path.relative(root, source)}`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    console.log(`[vendor] ${path.relative(root, source)} → ${path.relative(root, destination)} (${fs.statSync(destination).size} bytes)`);
  }
} catch (err) {
  console.error('[vendor] failed to copy free tool assets:', err.message);
  process.exit(1);
}
