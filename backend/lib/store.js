import crypto from 'node:crypto';
import { ApiError } from './errors.js';
import { validateSupplierResponse } from './suppliers.js';

export const STATUSES = ['pending', 'awaiting_payment', 'payment_verification', 'processing', 'completed', 'failed', 'refunded'];

export const STATUS_LABELS = {
  pending: 'Pending',
  awaiting_payment: 'Awaiting Payment',
  payment_verification: 'Payment Verification',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
  refunded: 'Refunded',
};

export const TRANSITIONS = {
  pending: ['awaiting_payment', 'failed'],
  awaiting_payment: ['payment_verification', 'failed'],
  payment_verification: ['processing', 'awaiting_payment', 'failed'],
  processing: ['completed', 'failed'],
  completed: ['refunded'],
  failed: ['refunded'],
  refunded: [],
};

const NOTE_REQUIRED = new Set(['completed', 'failed', 'refunded']);

export const PAYMENT_METHODS = {
  instapay: 'Instapay',
  vodafone_cash: 'Vodafone Cash',
  bank_transfer: 'Bank transfer',
  other: 'Other',
};

const SETTING_KEYS = ['store_name', 'support_email', 'support_phone', 'payment_note'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const nowIso = () => new Date().toISOString();
const fulfilling = new Set(); // order ids with a supplier call in progress (in-process lock)

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function text(value, { label, min = 1, max = 100, pattern } = {}) {
  const s = String(value ?? '').trim();
  if (s.length < min) throw new ApiError(400, `${label} is required.`);
  if (s.length > max) throw new ApiError(400, `${label} is too long.`);
  if (pattern && !pattern.test(s)) throw new ApiError(400, `${label} format is invalid.`);
  return s;
}

function regexText(value, label) {
  const s = text(value, { label, max: 120 });
  try {
    new RegExp(s);
  } catch {
    throw new ApiError(400, `${label} is not a valid pattern.`);
  }
  return s;
}

export function normalizeContact(raw) {
  const v = String(raw ?? '').trim();
  if (v.length > 120) throw new ApiError(400, 'Contact is too long.');
  if (EMAIL_RE.test(v)) return v.toLowerCase();
  const digits = v.replace(/[\s-]/g, '');
  if (/^\+?[0-9]{8,15}$/.test(digits)) return digits;
  throw new ApiError(400, 'Enter a valid email address or phone number.');
}

function makeReference() {
  return `VX-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function addEvent(db, orderId, status, note, actor) {
  db.prepare('INSERT INTO order_events (order_id, status, note, actor, at) VALUES (?, ?, ?, ?, ?)')
    .run(orderId, status, note ?? null, actor, nowIso());
}

const gamePublic = (g, packages) => ({
  id: g.id,
  slug: g.slug,
  name: g.name,
  category: g.category,
  currencyLabel: g.currency_label,
  description: g.description,
  idLabel: g.id_label,
  idPattern: g.id_pattern,
  extraLabel: g.extra_label,
  extraPattern: g.extra_pattern,
  featured: !!g.featured,
  isDemo: !!g.is_demo,
  packages: packages.map((p) => ({ id: p.id, label: p.label, amount: p.amount, priceEgp: p.price_piasters / 100, isDemo: !!p.is_demo })),
});

export function listPublicGames(db) {
  const games = db.prepare('SELECT * FROM games WHERE active = 1 ORDER BY sort, name').all();
  const pk = db.prepare('SELECT * FROM packages WHERE game_id = ? AND active = 1 ORDER BY sort, price_piasters');
  return games.map((g) => gamePublic(g, pk.all(g.id)));
}

export function getPublicGame(db, slug) {
  const g = db.prepare('SELECT * FROM games WHERE slug = ? AND active = 1').get(slug);
  if (!g) throw new ApiError(404, 'Game not found.');
  const pkgs = db.prepare('SELECT * FROM packages WHERE game_id = ? AND active = 1 ORDER BY sort, price_piasters').all(g.id);
  return gamePublic(g, pkgs);
}

function customerView(db, o) {
  const events = db.prepare('SELECT status, at FROM order_events WHERE order_id = ? ORDER BY id').all(o.id);
  return {
    reference: o.reference,
    status: o.status,
    statusLabel: STATUS_LABELS[o.status],
    gameName: o.game_name,
    packageLabel: o.package_label,
    amount: o.amount,
    priceEgp: o.price_piasters / 100,
    playerId: o.player_id,
    extraValue: o.extra_value,
    paymentMethod: o.payment_method ? PAYMENT_METHODS[o.payment_method] : null,
    paymentRef: o.payment_ref,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
    timeline: events.map((e) => ({ status: e.status, label: STATUS_LABELS[e.status], at: e.at })),
  };
}

export function createOrder(db, input) {
  const idempotencyKey = text(input.idempotencyKey, { label: 'Request key', min: 16, max: 64, pattern: /^[A-Za-z0-9-]+$/ });
  const existing = db.prepare('SELECT * FROM orders WHERE idempotency_key = ?').get(idempotencyKey);
  if (existing) return { created: false, order: customerView(db, existing) };

  const game = db.prepare('SELECT * FROM games WHERE slug = ? AND active = 1').get(String(input.gameSlug ?? ''));
  if (!game) throw new ApiError(404, 'Game not found.');
  const pkg = db.prepare('SELECT * FROM packages WHERE id = ? AND game_id = ? AND active = 1')
    .get(Number(input.packageId) || 0, game.id);
  if (!pkg) throw new ApiError(400, 'Selected package is not available.');

  const playerId = text(input.playerId, { label: game.id_label, max: 40, pattern: new RegExp(game.id_pattern) });
  const extraValue = game.extra_label
    ? text(input.extraValue, { label: game.extra_label, max: 20, pattern: game.extra_pattern ? new RegExp(game.extra_pattern) : undefined })
    : null;
  const contact = normalizeContact(input.contact);
  const ts = nowIso();
  const reference = makeReference();

  const id = tx(db, () => {
    const r = db.prepare(`INSERT INTO orders (reference, idempotency_key, game_id, package_id, game_name, package_label,
        amount, price_piasters, player_id, extra_value, contact, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
      .run(reference, idempotencyKey, game.id, pkg.id, game.name, pkg.label, pkg.amount, pkg.price_piasters,
        playerId, extraValue, contact, ts, ts);
    const orderId = Number(r.lastInsertRowid);
    addEvent(db, orderId, 'pending', 'Order received.', 'system');
    db.prepare("UPDATE orders SET status = 'awaiting_payment', updated_at = ? WHERE id = ?").run(nowIso(), orderId);
    addEvent(db, orderId, 'awaiting_payment', 'Awaiting payment.', 'system');
    return orderId;
  });
  console.log(`[order] created ${reference}`);
  return { created: true, order: customerView(db, db.prepare('SELECT * FROM orders WHERE id = ?').get(id)) };
}

function findForContact(db, reference, contactRaw) {
  let contact;
  try {
    contact = normalizeContact(contactRaw);
  } catch {
    throw new ApiError(404, 'No matching order found.');
  }
  const o = db.prepare('SELECT * FROM orders WHERE reference = ?').get(String(reference ?? '').trim().toUpperCase());
  if (!o || o.contact !== contact) throw new ApiError(404, 'No matching order found.');
  return o;
}

export function lookupOrder(db, reference, contact) {
  return customerView(db, findForContact(db, reference, contact));
}

export function submitPayment(db, reference, contact, method, paymentRef) {
  const o = findForContact(db, reference, contact);
  if (o.status !== 'awaiting_payment') {
    throw new ApiError(409, 'Payment can only be submitted while the order is awaiting payment.');
  }
  if (!Object.hasOwn(PAYMENT_METHODS, method)) throw new ApiError(400, 'Choose a valid payment method.');
  const ref = text(paymentRef, { label: 'Payment reference', min: 4, max: 64, pattern: /^[A-Za-z0-9 _./-]+$/ });
  tx(db, () => {
    db.prepare(`UPDATE orders SET status = 'payment_verification', payment_method = ?, payment_ref = ?, updated_at = ?
      WHERE id = ? AND status = 'awaiting_payment'`).run(method, ref, nowIso(), o.id);
    addEvent(db, o.id, 'payment_verification', 'Customer submitted a payment reference.', 'customer');
  });
  return customerView(db, db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id));
}

// ---------- Admin ----------

function adminOrder(o) {
  return {
    id: o.id,
    reference: o.reference,
    status: o.status,
    statusLabel: STATUS_LABELS[o.status],
    allowedNext: TRANSITIONS[o.status],
    gameName: o.game_name,
    packageLabel: o.package_label,
    amount: o.amount,
    priceEgp: o.price_piasters / 100,
    playerId: o.player_id,
    extraValue: o.extra_value,
    contact: o.contact,
    paymentMethod: o.payment_method,
    paymentMethodLabel: o.payment_method ? PAYMENT_METHODS[o.payment_method] : null,
    paymentRef: o.payment_ref,
    supplier: o.supplier,
    supplierRef: o.supplier_ref,
    attempts: o.fulfillment_attempts,
    adminNote: o.admin_note,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  };
}

export function adminListOrders(db, { status = '', q = '' } = {}) {
  const where = [];
  const params = [];
  if (status && STATUSES.includes(status)) {
    where.push('status = ?');
    params.push(status);
  }
  const term = q.trim().slice(0, 80);
  if (term) {
    const like = `%${term}%`;
    where.push('(reference LIKE ? OR contact LIKE ? OR player_id LIKE ?)');
    params.push(like, like, like);
  }
  const sql = `SELECT * FROM orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 200`;
  return db.prepare(sql).all(...params).map(adminOrder);
}

export function adminOrderDetail(db, id) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) throw new ApiError(404, 'Order not found.');
  const events = db.prepare('SELECT status, note, actor, at FROM order_events WHERE order_id = ? ORDER BY id').all(id)
    .map((e) => ({ status: e.status, statusLabel: STATUS_LABELS[e.status], note: e.note, actor: e.actor, at: e.at }));
  return { order: adminOrder(o), events };
}

export function adminSetStatus(db, id, to, note, actor) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) throw new ApiError(404, 'Order not found.');
  if (!STATUSES.includes(to)) throw new ApiError(400, 'Unknown status.');
  if (!(TRANSITIONS[o.status] || []).includes(to)) {
    throw new ApiError(409, `Cannot move an order from ${STATUS_LABELS[o.status]} to ${STATUS_LABELS[to]}.`);
  }
  if (NOTE_REQUIRED.has(to) && !note) {
    throw new ApiError(400, 'Add a note explaining this change, for example how payment or delivery was verified.');
  }
  tx(db, () => {
    db.prepare(`UPDATE orders SET status = ?, admin_note = COALESCE(NULLIF(?, ''), admin_note), updated_at = ? WHERE id = ?`)
      .run(to, note, nowIso(), id);
    addEvent(db, id, to, note || null, actor);
  });
  console.log(`[order] ${o.reference} ${o.status} -> ${to} by ${actor}`);
  return true;
}

export async function adminFulfill(db, id, actor, supplier) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) throw new ApiError(404, 'Order not found.');
  if (o.status !== 'processing') throw new ApiError(409, 'Only orders in Processing can be sent to a supplier.');
  if (o.supplier_ref) throw new ApiError(409, 'This order was already sent to a supplier. Duplicate fulfilment blocked.');
  if (fulfilling.has(id)) throw new ApiError(409, 'A supplier request for this order is already in progress.');
  if (!supplier.isConfigured()) {
    throw new ApiError(409, 'No supplier is configured. Fulfil manually, then mark the order Completed with a note explaining how it was verified.');
  }
  fulfilling.add(id);
  try {
    db.prepare('UPDATE orders SET fulfillment_attempts = fulfillment_attempts + 1, supplier = ?, updated_at = ? WHERE id = ?')
      .run(supplier.name, nowIso(), id);
    let result;
    try {
      const raw = await supplier.fulfill({ reference: o.reference, amount: o.amount, playerId: o.player_id, extraValue: o.extra_value });
      result = validateSupplierResponse(raw);
    } catch (err) {
      addEvent(db, id, 'processing', `Supplier attempt failed: ${String(err.message).slice(0, 160)}`, actor);
      console.log(`[supplier] ${o.reference} attempt failed`);
      throw new ApiError(502, 'The supplier request failed. The order stays in Processing and can be retried.');
    }
    db.prepare('UPDATE orders SET supplier_ref = ?, updated_at = ? WHERE id = ?').run(result.supplierRef, nowIso(), id);
    addEvent(db, id, 'processing', 'Submitted to supplier. Completed only after supplier confirmation.', actor);
    console.log(`[supplier] ${o.reference} accepted`);
    return true;
  } finally {
    fulfilling.delete(id);
  }
}

export function summary(db) {
  const rows = db.prepare('SELECT status, COUNT(*) AS n, COALESCE(SUM(price_piasters), 0) AS total FROM orders GROUP BY status').all();
  const byStatus = {};
  for (const s of STATUSES) byStatus[s] = { count: 0, totalEgp: 0 };
  for (const r of rows) byStatus[r.status] = { count: Number(r.n), totalEgp: Number(r.total) / 100 };
  const totalOrders = Number(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n);
  return {
    totalOrders,
    revenueEgp: byStatus.completed.totalEgp,
    needsActionCount: byStatus.pending.count + byStatus.payment_verification.count + byStatus.processing.count,
    byStatus,
  };
}

export function ordersCsv(db) {
  const rows = db.prepare('SELECT * FROM orders ORDER BY id').all();
  const cols = ['reference', 'created_at', 'status', 'game_name', 'package_label', 'price_egp', 'player_id',
    'extra_value', 'contact', 'payment_method', 'payment_ref', 'supplier_ref', 'updated_at'];
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [cols.join(',')];
  for (const r of rows) {
    lines.push(cols.map((c) => cell(c === 'price_egp' ? r.price_piasters / 100 : r[c])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

const gameRow = (g) => ({
  id: g.id, slug: g.slug, name: g.name, category: g.category, currencyLabel: g.currency_label,
  idLabel: g.id_label, idPattern: g.id_pattern, extraLabel: g.extra_label, extraPattern: g.extra_pattern,
  description: g.description, featured: !!g.featured, active: !!g.active, isDemo: !!g.is_demo, sort: g.sort,
});
const pkgRow = (p) => ({
  id: p.id, label: p.label, amount: p.amount, priceEgp: p.price_piasters / 100,
  active: !!p.active, isDemo: !!p.is_demo, sort: p.sort,
});

export function adminCatalog(db) {
  const games = db.prepare('SELECT * FROM games ORDER BY sort, name').all();
  const pk = db.prepare('SELECT * FROM packages WHERE game_id = ? ORDER BY sort, price_piasters');
  return games.map((g) => ({ ...gameRow(g), packages: pk.all(g.id).map(pkgRow) }));
}

function insertRow(db, table, fields) {
  const cols = Object.keys(fields);
  const r = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...Object.values(fields));
  return Number(r.lastInsertRowid);
}

function updateRow(db, table, id, fields) {
  const cols = Object.keys(fields);
  if (!cols.length) throw new ApiError(400, 'Nothing to update.');
  const r = db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...Object.values(fields), id);
  if (!r.changes) throw new ApiError(404, 'Not found.');
}

function cleanGame(b, creating) {
  const out = {};
  const has = (k) => Object.hasOwn(b, k);
  if (creating || has('slug')) out.slug = text(b.slug, { label: 'Slug', max: 60, pattern: /^[a-z0-9-]{2,60}$/ });
  if (creating || has('name')) out.name = text(b.name, { label: 'Name', max: 60 });
  if (creating || has('category')) out.category = text(b.category, { label: 'Category', max: 40 });
  if (creating || has('currencyLabel')) out.currency_label = text(b.currencyLabel, { label: 'Currency label', max: 30 });
  if (creating || has('idLabel')) out.id_label = text(b.idLabel, { label: 'ID label', max: 30 });
  if (creating || has('idPattern')) out.id_pattern = regexText(b.idPattern, 'ID pattern');
  if (has('extraLabel')) out.extra_label = String(b.extraLabel ?? '').trim().slice(0, 30) || null;
  if (has('extraPattern')) out.extra_pattern = b.extraPattern ? regexText(b.extraPattern, 'Extra pattern') : null;
  if (has('description')) out.description = String(b.description ?? '').trim().slice(0, 300);
  if (has('featured')) out.featured = b.featured ? 1 : 0;
  if (has('active')) out.active = b.active ? 1 : 0;
  if (has('isDemo')) out.is_demo = b.isDemo ? 1 : 0;
  if (has('sort')) out.sort = Math.trunc(Number(b.sort) || 0);
  return out;
}

export function createGame(db, body, actor) {
  try {
    const id = insertRow(db, 'games', cleanGame(body, true));
    console.log(`[catalog] game ${id} created by ${actor}`);
    return { id };
  } catch (err) {
    if (/UNIQUE/.test(err.message)) throw new ApiError(409, 'A game with this slug already exists.');
    throw err;
  }
}

export function updateGame(db, id, body, actor) {
  updateRow(db, 'games', id, cleanGame(body, false));
  console.log(`[catalog] game ${id} updated by ${actor}`);
  return { ok: true };
}

function cleanPackage(b, creating) {
  const out = {};
  const has = (k) => Object.hasOwn(b, k);
  if (creating || has('label')) out.label = text(b.label, { label: 'Label', max: 60 });
  if (creating || has('amount')) {
    const n = Math.trunc(Number(b.amount));
    if (!(n > 0 && n <= 10_000_000)) throw new ApiError(400, 'Amount must be a positive whole number.');
    out.amount = n;
  }
  if (creating || has('priceEgp')) {
    const p = Number(b.priceEgp);
    if (!Number.isFinite(p) || p < 0 || p > 100000) throw new ApiError(400, 'Price must be between 0 and 100000 EGP.');
    out.price_piasters = Math.round(p * 100);
  }
  if (has('active')) out.active = b.active ? 1 : 0;
  if (has('isDemo')) out.is_demo = b.isDemo ? 1 : 0;
  if (has('sort')) out.sort = Math.trunc(Number(b.sort) || 0);
  return out;
}

export function createPackage(db, gameId, body, actor) {
  if (!db.prepare('SELECT id FROM games WHERE id = ?').get(gameId)) throw new ApiError(404, 'Game not found.');
  const id = insertRow(db, 'packages', { ...cleanPackage(body, true), game_id: gameId });
  console.log(`[catalog] package ${id} created by ${actor}`);
  return { id };
}

export function updatePackage(db, id, body, actor) {
  updateRow(db, 'packages', id, cleanPackage(body, false));
  console.log(`[catalog] package ${id} updated by ${actor}`);
  return { ok: true };
}

function readSettings(db) {
  return Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
}

export function publicSettings(db) {
  const s = readSettings(db);
  return {
    storeName: s.store_name,
    supportEmail: s.support_email,
    supportPhone: s.support_phone,
    paymentNote: s.payment_note,
    paymentMethods: Object.entries(PAYMENT_METHODS).map(([key, label]) => ({ key, label })),
  };
}

export function adminSettings(db) {
  return readSettings(db);
}

export function updateSettings(db, body, actor) {
  tx(db, () => {
    for (const key of SETTING_KEYS) {
      if (!Object.hasOwn(body, key)) continue;
      const value = String(body[key] ?? '').trim().slice(0, 500);
      if (key === 'support_email' && value && !EMAIL_RE.test(value)) throw new ApiError(400, 'Support email is invalid.');
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(key, value);
    }
  });
  console.log(`[settings] updated by ${actor}`);
  return adminSettings(db);
}
