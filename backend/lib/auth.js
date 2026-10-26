import crypto from 'node:crypto';

const SESSION_MS = 8 * 60 * 60 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1 };
export const COOKIE_NAME = 'vx_admin';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export function verifyPassword(password, stored) {
  const [alg, N, r, p, saltB64, keyB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length,
    { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(actual, expected);
}

// Used so that unknown emails take as long to reject as wrong passwords.
const DUMMY_HASH = hashPassword('not-a-real-password-used-for-timing');
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

export function login(db, email, password) {
  const row = db.prepare('SELECT id, password_hash FROM admins WHERE email = ?').get(email);
  const ok = verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) return null;
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), row.id, Date.now() + SESSION_MS);
  return token;
}

export function adminFromToken(db, token) {
  if (!token || token.length > 200) return null;
  const row = db.prepare(`SELECT a.id, a.email, s.expires_at FROM sessions s
    JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ?`).get(sha256(token));
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, email: row.email };
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function sessionCookie(token, secure) {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
}

export function clearCookie(secure) {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}
