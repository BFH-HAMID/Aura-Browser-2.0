/**
 * Aura Browser 2.0 — in-memory OCR service.
 *
 * Tesseract.js runs inside a worker process. English and Bengali language data
 * are bundled with Aura during installation, so image contents and language
 * models are not sent to a third-party OCR API. Requests are serialized to
 * keep a small self-hosted instance responsive and avoid concurrent workers.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { createWorker } = require('tesseract.js');

const OCR_LANGUAGES = new Set(['eng', 'ben']);
const TESSDATA_DIR = path.join(__dirname, '..', '..', 'public', 'vendor', 'tessdata');

let worker = null;
let workerLanguage = '';
let ocrQueue = Promise.resolve();

function normalizeOcrLanguage(language) {
  const requested = String(language || 'eng').toLowerCase();
  return OCR_LANGUAGES.has(requested) ? requested : 'eng';
}

function assertLanguageData(language) {
  const dataFile = path.join(TESSDATA_DIR, `${language}.traineddata.gz`);
  if (!fs.existsSync(dataFile)) {
    throw new Error('OCR language data is missing. Run npm install or npm run vendor.');
  }
}

async function getWorker(language) {
  assertLanguageData(language);
  if (!worker) {
    worker = await createWorker(language, 1, {
      langPath: TESSDATA_DIR,
      // Keep Aura stateless: model data stays in the worker's memory only.
      cacheMethod: 'none',
    });
    workerLanguage = language;
  } else if (workerLanguage !== language) {
    await worker.reinitialize(language, 1);
    workerLanguage = language;
  }
  return worker;
}

async function runRecognition(buffer, language) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('An image file is required');
  const lang = normalizeOcrLanguage(language);
  const activeWorker = await getWorker(lang);
  const { data } = await activeWorker.recognize(buffer);
  return {
    text: String(data?.text || '').trim(),
    confidence: Math.round(Number(data?.confidence || 0)),
    language: lang,
  };
}

/** Queue OCR jobs so only one in-memory worker processes an image at a time. */
function recognizeImage(buffer, language = 'eng') {
  const job = ocrQueue.then(
    () => runRecognition(buffer, language),
    () => runRecognition(buffer, language)
  );
  // Keep the queue alive after individual request failures.
  ocrQueue = job.catch(() => undefined);
  return job;
}

async function closeOcrWorker() {
  if (worker) {
    const current = worker;
    worker = null;
    workerLanguage = '';
    await current.terminate().catch(() => {});
  }
}

module.exports = { recognizeImage, closeOcrWorker, normalizeOcrLanguage, OCR_LANGUAGES };
