/**
 * Aura Browser 2.0 — tests for the privacy-safe HTTP client.
 * Run with: npm test
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isPrivateIpv4, isPrivateIpv6, assertPublicHost } = require('../utils/httpClient');

test('isPrivateIpv4 classifies private/reserved ranges', () => {
  assert.strictEqual(isPrivateIpv4('127.0.0.1'), true);
  assert.strictEqual(isPrivateIpv4('10.0.0.5'), true);
  assert.strictEqual(isPrivateIpv4('192.168.1.1'), true);
  assert.strictEqual(isPrivateIpv4('172.16.4.4'), true);
  assert.strictEqual(isPrivateIpv4('169.254.10.10'), true);
  assert.strictEqual(isPrivateIpv4('100.64.0.1'), true);
  assert.strictEqual(isPrivateIpv4('224.0.0.1'), true);
  assert.strictEqual(isPrivateIpv4('8.8.8.8'), false);
  assert.strictEqual(isPrivateIpv4('1.1.1.1'), false);
  assert.strictEqual(isPrivateIpv4('172.32.0.1'), false);
});

test('isPrivateIpv6 classifies loopback/link-local/ULA', () => {
  assert.strictEqual(isPrivateIpv6('::1'), true);
  assert.strictEqual(isPrivateIpv6('fe80::1'), true);
  assert.strictEqual(isPrivateIpv6('fd00::1'), true);
  assert.strictEqual(isPrivateIpv6('2606:4700:4700::1111'), false);
});

test('assertPublicHost rejects private IPs and allows public ones', async () => {
  await assert.rejects(() => assertPublicHost('127.0.0.1'), /blocked private/i);
  await assert.rejects(() => assertPublicHost('10.1.2.3'), /blocked private/i);
  // Public literal IPs pass the guard without DNS.
  assert.strictEqual(await assertPublicHost('8.8.8.8'), '8.8.8.8');
});
