// Usage: ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='at-least-12-chars' npm run create-admin
// Passwords come from the environment only and are stored as scrypt hashes.
import { openDb } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';
import { config } from '../lib/config.js';

const email = String(process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
const password = String(process.env.ADMIN_PASSWORD ?? '');

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Set ADMIN_EMAIL to a valid email address.');
  process.exit(1);
}
if (password.length < 12) {
  console.error('ADMIN_PASSWORD must be at least 12 characters.');
  process.exit(1);
}

const db = openDb(config.dbFile);
const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(email);
if (existing) {
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(password), existing.id);
  console.log('Existing admin password updated.');
} else {
  db.prepare('INSERT INTO admins (email, password_hash, created_at) VALUES (?, ?, ?)')
    .run(email, hashPassword(password), new Date().toISOString());
  console.log('Admin account created.');
}
