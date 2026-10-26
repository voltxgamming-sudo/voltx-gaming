// Pure helpers: no DOM, no network. Covered by tests/order.test.js.

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid misreading
const PHONE_RE = /^\+?[0-9]{8,15}$/;

// Unique, human-readable demo reference such as VX-DEMO-K7QM2P.
// 6 chars from 32 symbols = ~1e9 combinations, drawn from the Web Crypto RNG.
export function generateReference(cryptoObj = globalThis.crypto) {
  const bytes = new Uint8Array(6);
  cryptoObj.getRandomValues(bytes);
  let code = '';
  for (const b of bytes) code += REF_ALPHABET[b % REF_ALPHABET.length];
  return `VX-DEMO-${code}`;
}

export function normalizePhone(raw) {
  return String(raw ?? '').trim().replace(/[\s().-]/g, '');
}

export function validateRequest(game, pkgId, input) {
  const errors = {};
  const pkg = game.packages.find((p) => p.id === pkgId);
  if (!pkg) errors.package = 'Choose a package.';

  const playerId = String(input.playerId ?? '').trim();
  if (playerId.length > 40 || !new RegExp(game.idPattern).test(playerId)) {
    errors.playerId = `${game.idLabel} format looks invalid. Check it in the game profile.`;
  }

  let extraValue = '';
  if (game.extraLabel) {
    extraValue = String(input.extraValue ?? '').trim();
    const ok = game.extraPattern ? new RegExp(game.extraPattern).test(extraValue) : extraValue.length > 0;
    if (!ok) errors.extraValue = `${game.extraLabel} format looks invalid.`;
  }

  const phone = normalizePhone(input.phone);
  if (!PHONE_RE.test(phone)) errors.phone = 'Enter a valid phone number, for example +20 10 1234 5678.';

  const name = String(input.name ?? '').trim();
  if (name.length > 60) errors.name = 'Name is too long (60 characters maximum).';

  return { ok: Object.keys(errors).length === 0, errors, value: { pkg, playerId, extraValue, phone, name } };
}

export function buildRequestMessage({ reference, game, value }, site) {
  const lines = [
    `VoltX Gaming · Top-up request (DEMO) · ${reference}`,
    `Game: ${game.name}`,
    `Package: ${value.pkg.label} (demo price ${value.pkg.priceEgp} ${site.currency})`,
    `${game.idLabel}: ${value.playerId}`,
  ];
  if (game.extraLabel) lines.push(`${game.extraLabel}: ${value.extraValue}`);
  if (value.name) lines.push(`Name: ${value.name}`);
  lines.push(`Contact: ${value.phone}`);
  lines.push('', 'Please reply with availability and next steps. This message is a request only, not a confirmed order.');
  return lines.join('\n');
}

export function buildWhatsAppUrl(number, message) {
  const digits = String(number ?? '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
