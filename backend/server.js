import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './lib/config.js';
import { openDb, seedIfEmpty } from './lib/db.js';
import * as store from './lib/store.js';
import * as auth from './lib/auth.js';
import { RateLimiter } from './lib/ratelimit.js';
import { getSupplier } from './lib/suppliers.js';
import { ApiError } from './lib/errors.js';

const db = openDb(config.dbFile);
seedIfEmpty(db);
const supplier = getSupplier(config.supplierAdapter); // fails fast on unknown adapter
const limiter = new RateLimiter();
const PUBLIC_DIR = path.join(config.root, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const PAGE_ALIASES = { '/': 'index.html', '/admin': 'admin.html', '/admin/': 'admin.html' };
const MIN = 60_000;

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

function sendText(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const type = (req.headers['content-type'] || '').split(';')[0].trim();
    if (type !== 'application/json') return reject(new ApiError(415, 'Send JSON.'));
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new ApiError(413, 'Request too large.'));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => {
      try {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('bad');
        resolve(body);
      } catch {
        reject(new ApiError(400, 'Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  if (config.trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function getCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

// Blocks cross-site form posts and requests that lack the custom header a plain HTML form cannot send.
function requireCsrf(req) {
  if (req.headers['x-requested-with'] !== 'fetch') throw new ApiError(403, 'Missing request header.');
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      throw new ApiError(403, 'Cross-site request blocked.');
    }
    if (host !== req.headers.host) throw new ApiError(403, 'Cross-site request blocked.');
  }
}

async function handleAdmin(req, res, url, ip) {
  const p = url.pathname;
  const m = req.method;
  let x;

  if (m === 'POST' && p === '/api/admin/login') {
    const b = await readJson(req);
    const email = String(b.email ?? '').trim().toLowerCase().slice(0, 200);
    const password = String(b.password ?? '').slice(0, 300);
    if (!limiter.hit(`login:${ip}`, 10, 15 * MIN) || !limiter.hit(`login-email:${email}`, 5, 15 * MIN)) {
      throw new ApiError(429, 'Too many login attempts. Try again in 15 minutes.');
    }
    const token = auth.login(db, email, password);
    if (!token) throw new ApiError(401, 'Invalid email or password.');
    return json(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(token, config.secureCookies) });
  }

  const token = getCookie(req, auth.COOKIE_NAME);
  if (m === 'POST' && p === '/api/admin/logout') {
    requireCsrf(req);
    auth.destroySession(db, token);
    return json(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie(config.secureCookies) });
  }

  const admin = auth.adminFromToken(db, token);
  if (!admin) throw new ApiError(401, 'Admin login required.');
  const actor = `admin#${admin.id}`;
  if (m !== 'GET') {
    requireCsrf(req);
    console.log(`[admin] ${actor} ${m} ${p}`);
  }

  if (m === 'GET' && p === '/api/admin/me') return json(res, 200, { admin: { email: admin.email } });
  if (m === 'GET' && p === '/api/admin/summary') return json(res, 200, store.summary(db));
  if (m === 'GET' && p === '/api/admin/orders') {
    return json(res, 200, {
      orders: store.adminListOrders(db, { status: url.searchParams.get('status') || '', q: url.searchParams.get('q') || '' }),
    });
  }
  if (m === 'GET' && p === '/api/admin/orders.csv') {
    res.setHeader('Content-Disposition', 'attachment; filename="voltx-orders.csv"');
    return sendText(res, 200, store.ordersCsv(db), 'text/csv; charset=utf-8');
  }
  if (m === 'GET' && (x = p.match(/^\/api\/admin\/orders\/(\d+)$/))) {
    return json(res, 200, store.adminOrderDetail(db, Number(x[1])));
  }
  if (m === 'POST' && (x = p.match(/^\/api\/admin\/orders\/(\d+)\/status$/))) {
    const b = await readJson(req);
    const id = Number(x[1]);
    store.adminSetStatus(db, id, String(b.status ?? ''), String(b.note ?? '').trim().slice(0, 500), actor);
    return json(res, 200, store.adminOrderDetail(db, id));
  }
  if (m === 'POST' && (x = p.match(/^\/api\/admin\/orders\/(\d+)\/fulfill$/))) {
    const id = Number(x[1]);
    await store.adminFulfill(db, id, actor, supplier);
    return json(res, 200, store.adminOrderDetail(db, id));
  }
  if (m === 'GET' && p === '/api/admin/catalog') return json(res, 200, { games: store.adminCatalog(db) });
  if (m === 'POST' && p === '/api/admin/games') return json(res, 201, store.createGame(db, await readJson(req), actor));
  if (m === 'PATCH' && (x = p.match(/^\/api\/admin\/games\/(\d+)$/))) {
    return json(res, 200, store.updateGame(db, Number(x[1]), await readJson(req), actor));
  }
  if (m === 'POST' && (x = p.match(/^\/api\/admin\/games\/(\d+)\/packages$/))) {
    return json(res, 201, store.createPackage(db, Number(x[1]), await readJson(req), actor));
  }
  if (m === 'PATCH' && (x = p.match(/^\/api\/admin\/packages\/(\d+)$/))) {
    return json(res, 200, store.updatePackage(db, Number(x[1]), await readJson(req), actor));
  }
  if (m === 'GET' && p === '/api/admin/settings') return json(res, 200, store.adminSettings(db));
  if (m === 'PUT' && p === '/api/admin/settings') return json(res, 200, store.updateSettings(db, await readJson(req), actor));
  throw new ApiError(404, 'Not found.');
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  const ip = clientIp(req);
  let x;

  if (p.startsWith('/api/admin/')) return handleAdmin(req, res, url, ip);

  if (m === 'GET' && p === '/api/settings') return json(res, 200, store.publicSettings(db));
  if (m === 'GET' && p === '/api/games') return json(res, 200, store.listPublicGames(db));
  if (m === 'GET' && (x = p.match(/^\/api\/games\/([a-z0-9-]{1,60})$/))) {
    return json(res, 200, store.getPublicGame(db, x[1]));
  }

  if (m === 'POST' && p === '/api/orders') {
    if (!limiter.hit(`order:${ip}`, 10, 10 * MIN)) throw new ApiError(429, 'Too many order attempts. Please wait a few minutes.');
    const b = await readJson(req);
    const r = store.createOrder(db, {
      gameSlug: b.gameSlug, packageId: b.packageId, playerId: b.playerId,
      extraValue: b.extraValue, contact: b.contact, idempotencyKey: b.idempotencyKey,
    });
    return json(res, r.created ? 201 : 200, { order: r.order, duplicate: !r.created });
  }
  if (m === 'POST' && p === '/api/orders/lookup') {
    if (!limiter.hit(`lookup:${ip}`, 20, 10 * MIN)) throw new ApiError(429, 'Too many requests. Please wait a few minutes.');
    const b = await readJson(req);
    return json(res, 200, { order: store.lookupOrder(db, b.reference, b.contact) });
  }
  if (m === 'POST' && (x = p.match(/^\/api\/orders\/(VX-[A-Z0-9]+-[A-F0-9]{6})\/payment$/))) {
    if (!limiter.hit(`lookup:${ip}`, 20, 10 * MIN)) throw new ApiError(429, 'Too many requests. Please wait a few minutes.');
    const b = await readJson(req);
    return json(res, 200, { order: store.submitPayment(db, x[1], b.contact, b.paymentMethod, b.paymentRef) });
  }
  throw new ApiError(404, 'Not found.');
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed', 'text/plain');
  let decoded;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return sendText(res, 400, 'Bad request', 'text/plain');
  }
  const rel = PAGE_ALIASES[decoded] ?? decoded.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  const ext = path.extname(file).toLowerCase();
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !MIME[ext]) return sendText(res, 404, 'Not found', 'text/plain');
  try {
    const data = await fs.promises.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    sendText(res, 404, 'Not found', 'text/plain');
  }
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const url = new URL(req.url, 'http://localhost');
  res.on('finish', () => {
    if (url.pathname.startsWith('/api/')) console.log(`${req.method} ${url.pathname} ${res.statusCode}`);
  });
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await serveStatic(req, res, url);
  } catch (err) {
    if (err instanceof ApiError) {
      json(res, err.status, { error: err.message });
    } else {
      console.error('[error]', err);
      json(res, 500, { error: 'Something went wrong. Please try again.' });
    }
  }
});

server.listen(config.port, () => {
  console.log(`VoltX Gaming listening on http://localhost:${config.port}`);
});
