import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  root: ROOT,
  port: Number(process.env.PORT || 3000),
  dbFile: process.env.DATABASE_FILE || path.join(ROOT, 'data', 'voltx.sqlite'),
  secureCookies: process.env.SECURE_COOKIES === '1',
  trustProxy: process.env.TRUST_PROXY === '1',
  supplierAdapter: process.env.SUPPLIER_ADAPTER || 'none',
};
