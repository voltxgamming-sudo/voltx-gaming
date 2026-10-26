import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReference, validateRequest, buildRequestMessage, buildWhatsAppUrl, normalizePhone } from '../docs/js/order.js';
import { GAMES, SITE } from '../docs/js/catalog.js';

const mlbb = GAMES.find((g) => g.id === 'mobile-legends');
const pubg = GAMES.find((g) => g.id === 'pubg-mobile');

test('reference has the demo format and uses only unambiguous characters', () => {
  for (let i = 0; i < 200; i++) {
    const ref = generateReference();
    assert.match(ref, /^VX-DEMO-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  }
});

// Seeded PRNG (mulberry32). Deterministic: the same seed always produces the same sequence, so this test cannot flake.
function seededCrypto(seed) {
  let a = seed >>> 0;
  return {
    getRandomValues(arr) {
      for (let i = 0; i < arr.length; i++) {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        arr[i] = ((t ^ (t >>> 14)) >>> 0) & 0xff;
      }
      return arr;
    },
  };
}

test('seeded draws produce distinct references', () => {
  const rng = seededCrypto(12345);
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(generateReference(rng));
  assert.equal(seen.size, 1000);
});

test('phone normalisation strips spaces, dashes and brackets', () => {
  assert.equal(normalizePhone(' +20 (10) 1234-5678 '), '+201012345678');
});

test('valid request passes and returns the chosen package', () => {
  const r = validateRequest(pubg, 'uc-60', { playerId: '51234567', phone: '+20 10 1234 5678' });
  assert.equal(r.ok, true);
  assert.equal(r.value.pkg.label, '60 UC');
});

test('invalid player ID is rejected', () => {
  const r = validateRequest(pubg, 'uc-60', { playerId: 'abc', phone: '01012345678' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.playerId);
});

test('games with a zone ID require it', () => {
  const missing = validateRequest(mlbb, 'ml-86', { playerId: '123456', extraValue: '', phone: '01012345678' });
  assert.ok(missing.errors.extraValue);
  const bad = validateRequest(mlbb, 'ml-86', { playerId: '123456', extraValue: 'x', phone: '01012345678' });
  assert.ok(bad.errors.extraValue);
  const ok = validateRequest(mlbb, 'ml-86', { playerId: '123456', extraValue: '2034', phone: '01012345678' });
  assert.equal(ok.ok, true);
});

test('unknown package and bad phone are rejected', () => {
  const r = validateRequest(pubg, 'nope', { playerId: '51234567', phone: '12' });
  assert.ok(r.errors.package);
  assert.ok(r.errors.phone);
});

test('request message states it is only a request and never claims payment or delivery', () => {
  const v = validateRequest(pubg, 'uc-60', { playerId: '51234567', phone: '01012345678' }).value;
  const msg = buildRequestMessage({ reference: 'VX-DEMO-ABC123', game: pubg, value: v }, SITE);
  assert.match(msg, /VX-DEMO-ABC123/);
  assert.match(msg, /demo price/);
  assert.match(msg, /not a confirmed order/);
  assert.doesNotMatch(msg, /\b(has been paid|payment (received|completed)|has been delivered|is confirmed)\b/i);
});

test('WhatsApp URL is null until a number is configured, then encodes the text', () => {
  assert.equal(buildWhatsAppUrl('', 'hi'), null);
  assert.equal(buildWhatsAppUrl('+20 10 1234 5678', 'a b'), 'https://wa.me/201012345678?text=a%20b');
});
