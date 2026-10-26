# VoltX Gaming · OPTIONAL backend

This folder holds an optional Node.js + SQLite backend (admin dashboard, order records, server-side status workflow, supplier adapter layer).

**It is not used by the GitHub Pages storefront in `/docs`.** That site works on its own.

## Requirements

- Node.js 22.5 or newer (uses the built-in `node:sqlite` module). No npm packages are needed.
- A server host that can run Node.js and keep a writable disk for the SQLite file (for example a VPS, Render, Railway or Fly.io). **GitHub Pages cannot run this code.**

## Run locally

```bash
cd backend
cp .env.example .env          # edit values; never commit .env
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='use-a-long-password' npm run create-admin
npm start                     # http://localhost:3000
```

## Notes

- Supplier fulfilment is off (`SUPPLIER_ADAPTER=none`). Orders stay in manual review until you add an authorised adapter in `lib/suppliers.js`.
- Payments are not integrated. Payment verification is a manual admin step.
- Set `SECURE_COOKIES=1` when served over HTTPS.
- Demo catalogue and prices are placeholders; replace them before any real use.
