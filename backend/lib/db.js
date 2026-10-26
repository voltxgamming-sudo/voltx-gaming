import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  currency_label TEXT NOT NULL,
  id_label TEXT NOT NULL,
  id_pattern TEXT NOT NULL,
  extra_label TEXT,
  extra_pattern TEXT,
  description TEXT NOT NULL DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  is_demo INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  price_piasters INTEGER NOT NULL CHECK (price_piasters >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  is_demo INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  game_id INTEGER NOT NULL REFERENCES games(id),
  package_id INTEGER NOT NULL REFERENCES packages(id),
  game_name TEXT NOT NULL,
  package_label TEXT NOT NULL,
  amount INTEGER NOT NULL,
  price_piasters INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  extra_value TEXT,
  contact TEXT NOT NULL,
  status TEXT NOT NULL,
  payment_method TEXT,
  payment_ref TEXT,
  supplier TEXT,
  supplier_ref TEXT,
  fulfillment_attempts INTEGER NOT NULL DEFAULT 0,
  admin_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  actor TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// DEMO catalogue. Prices are placeholders in EGP, not supplier prices.
// Patterns are placeholders too: confirm them against the provider's rules.
const DEMO_CATALOG = [
  { slug: 'pubg-mobile', name: 'PUBG MOBILE', category: 'Battle Royale', currency: 'UC', idLabel: 'Player ID', idPattern: '^[0-9]{8,12}$', featured: 1, sort: 1,
    description: 'Top up Unknown Cash (UC) for PUBG MOBILE.',
    packages: [['60 UC', 60, 30], ['325 UC', 325, 150], ['660 UC', 660, 300], ['1800 UC', 1800, 750]] },
  { slug: 'free-fire', name: 'Free Fire', category: 'Battle Royale', currency: 'Diamonds', idLabel: 'Player ID', idPattern: '^[0-9]{6,12}$', featured: 1, sort: 2,
    description: 'Top up Diamonds for Free Fire.',
    packages: [['100 Diamonds', 100, 25], ['310 Diamonds', 310, 75], ['520 Diamonds', 520, 125], ['1060 Diamonds', 1060, 250]] },
  { slug: 'roblox', name: 'Roblox', category: 'Sandbox', currency: 'Robux', idLabel: 'Username', idPattern: '^[A-Za-z0-9_]{3,20}$', featured: 0, sort: 3,
    description: 'Top up Robux for Roblox.',
    packages: [['400 Robux', 400, 150], ['800 Robux', 800, 290], ['1700 Robux', 1700, 600]] },
  { slug: 'mobile-legends', name: 'Mobile Legends', category: 'MOBA', currency: 'Diamonds', idLabel: 'User ID', idPattern: '^[0-9]{6,12}$', extraLabel: 'Zone ID', extraPattern: '^[0-9]{3,6}$', featured: 0, sort: 4,
    description: 'Top up Diamonds for Mobile Legends.',
    packages: [['86 Diamonds', 86, 40], ['172 Diamonds', 172, 80], ['257 Diamonds', 257, 120], ['706 Diamonds', 706, 320]] },
];

const DEFAULT_SETTINGS = {
  store_name: 'VoltX Gaming',
  support_email: '',
  support_phone: '',
  payment_note: 'Payment provider integration is not configured yet. Pay using the instructions your administrator provides for the method you choose, then submit your payment reference here.',
};

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec(SCHEMA);
  return db;
}

export function seedIfEmpty(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM games').get().n > 0) return false;
  const insGame = db.prepare(`INSERT INTO games (slug, name, category, currency_label, id_label, id_pattern, extra_label, extra_pattern, description, featured, sort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insPkg = db.prepare('INSERT INTO packages (game_id, label, amount, price_piasters, sort) VALUES (?, ?, ?, ?, ?)');
  const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  db.exec('BEGIN');
  try {
    for (const g of DEMO_CATALOG) {
      const gameId = Number(insGame.run(g.slug, g.name, g.category, g.currency, g.idLabel, g.idPattern,
        g.extraLabel ?? null, g.extraPattern ?? null, g.description, g.featured, g.sort).lastInsertRowid);
      g.packages.forEach(([label, amount, egp], i) => insPkg.run(gameId, `DEMO · ${label}`, amount, egp * 100, i));
    }
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return true;
}
