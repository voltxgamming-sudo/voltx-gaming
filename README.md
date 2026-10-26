# VoltX Gaming · Demo top-up storefront (GitHub Pages)

A lightweight, zero-dependency storefront made of plain HTML, CSS and vanilla JavaScript. It runs entirely in the visitor's browser and is designed for mobile users with limited data (no frameworks, no external fonts, no images, under about 60 KB total).

## What it does

- Game catalogue with search and category filter
- Game pages with package selection (demo prices, clearly labelled)
- Input validation: game ID formats, optional zone ID, phone number, optional name
- Order summary and an acknowledgement step before a request is prepared
- Unique demo request references such as `VX-DEMO-K7QM2P`
- WhatsApp request links with a prefilled message (or a copy-text fallback if no number is set)

## What it deliberately does not do

- It does **not** take payments or simulate payment success.
- It does **not** mark anything as paid, confirmed, completed or delivered.
- It does **not** store orders or send your details anywhere. Your request leaves the page only when you press the WhatsApp button yourself.
- It is **not** a live store until a real supplier and payment process exist. Every price is a sample.

The request reference is only an identifier for the conversation. A top-up is not confirmed until the store replies on WhatsApp.

## Project layout

```
docs/                 ← the site GitHub Pages publishes
  index.html          single page shell with a Content-Security-Policy
  styles.css          mobile-first styles
  404.html            fallback page
  .nojekyll           tells Pages to skip Jekyll processing
  js/catalog.js       ★ games, packages, demo prices, WhatsApp number (edit this)
  js/order.js         validation, references, message and WhatsApp URL helpers
  js/app.js           routing and rendering
  assets/favicon.svg
tests/order.test.js   unit tests for the pure helpers (run with npm test)
backend/              OPTIONAL Node.js + SQLite backend, needs a separate server host
package.json          test script only (no dependencies)
```

## Deploy to GitHub Pages (step by step)

Pages serves the `docs/` folder of a branch. Nothing outside `docs/` is published.

### 1. Put the project in a GitHub repository

Option A, using the command line (install Git first):

```bash
cd voltx-gaming
git init
git add .
git commit -m "VoltX Gaming demo storefront"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/voltx-gaming.git
git push -u origin main
```

Create the empty repository `voltx-gaming` on github.com first, without a README, licence or .gitignore, so the push does not conflict.

Option B, without Git: on github.com create the repository, click **Add file → Upload files**, drag in the whole project folder contents (including `docs/`), and commit to `main`.

### 2. Turn on Pages

1. Open the repository on github.com.
2. Click **Settings** (top bar).
3. In the left sidebar click **Pages** (under "Code and automation").
4. Under **Build and deployment → Source**, choose **Deploy from a branch**.
5. Under **Branch**, choose **main** and set the folder to **/docs**. Click **Save**.
6. Wait 1 to 3 minutes. Refresh the Pages settings page; a green message shows the live address.

Your site is at:

```
https://YOUR-USERNAME.github.io/voltx-gaming/
```

Pages on a private repository requires a paid GitHub plan. A public repository works on the free plan.

### 3. Add your WhatsApp number

1. Open `docs/js/catalog.js`.
2. Set `whatsappNumber` to your number in international format, digits only, for example `'201012345678'`.
3. Commit and push. The site updates within a few minutes.

Until you set a number, the request page shows a copy-text fallback instead of a WhatsApp button.

### 4. Make changes later

Edit files, then commit and push to `main`:

```bash
git add .
git commit -m "Update catalogue"
git push
```

Pages rebuilds automatically on each push.

### 5. Optional: custom domain

1. Buy a domain and point a `CNAME` record at `YOUR-USERNAME.github.io`.
2. In **Settings → Pages → Custom domain**, enter your domain and save.
3. Create a file named `CNAME` inside `docs/` containing just your domain (one line), commit and push.
4. Tick **Enforce HTTPS** once the certificate is issued.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Page shows 404 | Confirm **Settings → Pages** is set to branch `main`, folder `/docs`. Confirm `docs/index.html` exists in the repo. |
| Page loads but looks unstyled | Make sure `docs/styles.css` was committed. Paths are relative, so keep the folder structure. |
| Old version still showing | Hard-refresh the page or wait a few minutes for the CDN cache to refresh. |
| Pages settings say "build failed" | Make sure `docs/.nojekyll` exists (it is required for plain static files). |
| Nothing updates after a push | Check the **Actions** tab for a Pages build error. |

## Before going live

- Replace every demo price and package with figures confirmed by an authorised supplier.
- Confirm each game's ID format with the provider and update `idPattern`.
- Make sure you have the right to sell top-ups for each game and to use its name and logos. The footer disclaimer does not replace that permission.
- Confirm payment methods and terms, and have a privacy notice if you collect contact details.
- Keep the demo banner until real pricing is in place.

## Optional backend

`backend/` contains a Node.js + SQLite version with an admin dashboard and order workflow. It requires a server that can run Node.js and is not part of the GitHub Pages deployment. See `backend/README.md`.
