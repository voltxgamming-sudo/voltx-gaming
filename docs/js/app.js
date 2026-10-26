import { SITE, GAMES } from './catalog.js';
import { generateReference, validateRequest, buildRequestMessage, buildWhatsAppUrl } from './order.js';

const app = document.getElementById('app');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const egp = (v) => `${Number(v).toLocaleString('en-US')} ${SITE.currency}`;

let draft = null; // { game, pkgId, fields, errors, step, prepared }
let filter = { q: '', category: '' };

// ---------- Views ----------

const card = (g) => `
  <a class="card" href="#/game/${esc(g.id)}">
    <span class="badge-demo">DEMO</span>
    <span class="cat">${esc(g.category)}</span>
    <h3>${esc(g.name)}</h3>
    <p class="muted">Top up ${esc(g.currencyLabel)}</p>
    <p class="from">From ${egp(Math.min(...g.packages.map((p) => p.priceEgp)))} <span class="small muted">(demo)</span></p>
  </a>`;

function renderHome() {
  const cats = [...new Set(GAMES.map((g) => g.category))].sort();
  app.innerHTML = `
    <section class="hero">
      <p class="eyebrow">${esc(SITE.name)}</p>
      <h1>LEVEL UP YOUR GAME</h1>
      <p class="hero-sub">${esc(SITE.subtitle)}</p>
      <a class="btn btn-primary" href="#/games">Explore Games</a>
    </section>

    <section class="section">
      <h2>Featured</h2>
      <div class="grid">${GAMES.filter((g) => g.featured).map(card).join('')}</div>
    </section>

    <section class="section" id="catalog">
      <h2>All games</h2>
      <div class="filters">
        <label class="sr-only" for="search">Search games</label>
        <input id="search" type="search" placeholder="Search games" value="${esc(filter.q)}" autocomplete="off">
        <label class="sr-only" for="category">Category</label>
        <select id="category">
          <option value="">All categories</option>
          ${cats.map((c) => `<option value="${esc(c)}"${filter.category === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
      </div>
      <div id="catalogGrid" class="grid">${GAMES.map(card).join('')}</div>
    </section>

    <section class="section">
      <h2>How it works</h2>
      <ol class="steps">
        <li>Pick a game and a package.</li>
        <li>Enter your game ID and a phone number.</li>
        <li>Review the summary and send the request on WhatsApp.</li>
        <li>The store replies with availability and next steps.</li>
      </ol>
      <a class="btn btn-ghost" href="#/how">Read more</a>
    </section>`;
  applyFilter();
}

function applyFilter() {
  const grid = document.getElementById('catalogGrid');
  if (!grid) return;
  const q = filter.q.trim().toLowerCase();
  const list = GAMES.filter((g) =>
    (!filter.category || g.category === filter.category) &&
    (!q || g.name.toLowerCase().includes(q) || g.category.toLowerCase().includes(q)));
  grid.innerHTML = list.length ? list.map(card).join('') : '<p class="muted">No games match your search.</p>';
}

function renderGame(id) {
  const game = GAMES.find((g) => g.id === id);
  if (!game) return renderNotFound();
  draft = { game, pkgId: null, fields: { playerId: '', extraValue: '', phone: '', name: '' }, errors: {}, step: 'form', prepared: null, ack: false };
  app.innerHTML = `
    <a class="back" href="#/games">← All games</a>
    <header class="product-head">
      <span class="cat">${esc(game.category)}</span>
      <h1>${esc(game.name)}</h1>
      <p class="muted">${esc(game.description)}</p>
      <span class="badge-demo badge-static">DEMO PRICES</span>
    </header>
    <p class="notice">Sample packages and prices for demonstration. Nothing is charged and no top-up is delivered from this page.</p>

    <section class="panel">
      <h2>1. Choose a package</h2>
      <div id="pkgGrid" class="pkg-grid" role="radiogroup" aria-label="Packages">
        ${game.packages.map((p) => `
          <button type="button" class="pkg" role="radio" aria-checked="false" data-pkg="${esc(p.id)}">
            <strong>${esc(p.label)}</strong>
            <span class="pkg-price">${egp(p.priceEgp)}</span>
            <span class="small muted">demo price</span>
          </button>`).join('')}
      </div>
    </section>

    <section class="panel" id="stepPanel" aria-live="polite"></section>`;
  paintStep();
}

function paintPackageSelection() {
  document.querySelectorAll('#pkgGrid [data-pkg]').forEach((b) => {
    const on = b.dataset.pkg === draft.pkgId;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-checked', String(on));
  });
}

function fieldError(key) {
  return draft.errors[key] ? `<p class="field-error" role="alert">${esc(draft.errors[key])}</p>` : '';
}

function paintStep() {
  const el = document.getElementById('stepPanel');
  if (!el || !draft) return;
  paintPackageSelection();
  const { game } = draft;
  if (!draft.pkgId) {
    el.innerHTML = '<h2>2. Your details</h2><p class="muted">Select a package to continue.</p>';
    return;
  }
  const pkg = game.packages.find((p) => p.id === draft.pkgId);

  if (draft.step === 'confirm') {
    const f = draft.fields;
    el.innerHTML = `
      <h2>2. Review your request</h2>
      <dl class="summary">
        <dt>Game</dt><dd>${esc(game.name)}</dd>
        <dt>Package</dt><dd>${esc(pkg.label)}</dd>
        <dt>Price</dt><dd>${egp(pkg.priceEgp)} <span class="small muted">(demo)</span></dd>
        <dt>${esc(game.idLabel)}</dt><dd>${esc(f.playerId)}</dd>
        ${game.extraLabel ? `<dt>${esc(game.extraLabel)}</dt><dd>${esc(f.extraValue)}</dd>` : ''}
        <dt>Phone</dt><dd>${esc(f.phone)}</dd>
        ${f.name ? `<dt>Name</dt><dd>${esc(f.name)}</dd>` : ''}
      </dl>
      <label class="check-row">
        <input type="checkbox" id="ack" ${draft.ack ? 'checked' : ''}>
        <span>I understand this is a demo. This page does not take payment and does not confirm or deliver any top-up.</span>
      </label>
      <p class="field-error" id="ackErr" role="alert">${draft.errors.ack ? esc(draft.errors.ack) : ''}</p>
      <div class="btn-row">
        <button class="btn btn-ghost" type="button" data-action="edit">Edit details</button>
        <button class="btn btn-primary" type="button" data-action="prepare">Prepare request</button>
      </div>
      ${draft.prepared ? preparedHtml(draft.prepared) : ''}`;
    return;
  }

  const f = draft.fields;
  el.innerHTML = `
    <h2>2. Your details</h2>
    <form id="orderForm" novalidate>
      <div class="field">
        <label for="playerId">${esc(game.idLabel)}</label>
        <input id="playerId" name="playerId" required maxlength="40" autocomplete="off" inputmode="${game.idPattern.startsWith('^[0-9]') ? 'numeric' : 'text'}" value="${esc(f.playerId)}">
        <p class="hint">Check it in your in-game profile. A wrong ID may not be recoverable.</p>
        ${fieldError('playerId')}
      </div>
      ${game.extraLabel ? `<div class="field">
        <label for="extraValue">${esc(game.extraLabel)}</label>
        <input id="extraValue" name="extraValue" required maxlength="20" autocomplete="off" inputmode="numeric" value="${esc(f.extraValue)}">
        ${fieldError('extraValue')}
      </div>` : ''}
      <div class="field">
        <label for="phone">WhatsApp / phone number</label>
        <input id="phone" name="phone" required maxlength="20" autocomplete="tel" inputmode="tel" placeholder="+20 10 1234 5678" value="${esc(f.phone)}">
        ${fieldError('phone')}
      </div>
      <div class="field">
        <label for="name">Name <span class="muted small">(optional)</span></label>
        <input id="name" name="name" maxlength="60" autocomplete="name" value="${esc(f.name)}">
        ${fieldError('name')}
      </div>
      ${fieldError('package')}
      <button class="btn btn-primary" type="submit">Review request</button>
    </form>`;
}

function preparedHtml(p) {
  const url = buildWhatsAppUrl(SITE.whatsappNumber, p.message);
  return `
    <section class="prepared" aria-label="Request ready">
      <h3>Request ready</h3>
      <p>Reference: <code class="ref">${esc(p.reference)}</code></p>
      <p class="notice">This is a request, not a confirmed order. Nothing is paid or delivered until the store replies on WhatsApp with availability and payment steps.</p>
      ${url
        ? `<a class="btn btn-wa" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Send request on WhatsApp</a>`
        : `<p class="notice">WhatsApp is not configured for this demo. Copy the text below and send it to the store yourself.</p>`}
      <label for="reqText" class="small muted">Request text</label>
      <textarea id="reqText" readonly rows="8">${esc(p.message)}</textarea>
      <div class="btn-row"><button class="btn btn-ghost" type="button" data-action="copy">Copy request text</button></div>
      <p class="small muted" id="copyStatus" role="status"></p>
    </section>`;
}

function renderNotFound() {
  app.innerHTML = '<h1>Game not found</h1><p><a href="#/games">Browse all games</a></p>';
}

function renderGames() {
  renderHome();
  document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' });
}

function renderStatic(title, body) {
  app.innerHTML = `<section class="section"><h1>${esc(title)}</h1>${body}</section>`;
}

const FAQS = [
  ['Is this a real store?', 'Not yet. This is a demo storefront. Prices and packages are sample data until an authorised supplier and payment method are set up by the store owner.'],
  ['Do I pay on this page?', 'No. This page does not take payment. It only prepares a request you can send on WhatsApp.'],
  ['Will my top-up be delivered after I send the request?', 'Not from this page. Delivery only happens after the store confirms availability and payment through its own process.'],
  ['Where do I find my player ID?', 'Check the in-game profile. A wrong ID may not be recoverable, so double-check it.'],
  ['Is VoltX Gaming affiliated with the game publishers?', 'No. It is an independent project. Game names identify the products only.'],
  ['Is my data stored?', 'This static page does not send your details anywhere. Your request text is only sent when you choose to send it on WhatsApp.'],
];

// ---------- Actions ----------

function onFormChange(form) {
  if (!form) return;
  const f = draft.fields;
  f.playerId = form.playerId?.value ?? f.playerId;
  if (form.extraValue) f.extraValue = form.extraValue.value;
  f.phone = form.phone?.value ?? f.phone;
  f.name = form.name?.value ?? f.name;
}

function reviewRequest(form) {
  onFormChange(form);
  const res = validateRequest(draft.game, draft.pkgId, draft.fields);
  draft.errors = res.errors;
  if (!res.ok) return paintStep();
  draft.errors = {};
  draft.step = 'confirm';
  draft.prepared = null;
  draft.ack = false;
  paintStep();
}

function prepareRequest() {
  const ack = document.getElementById('ack');
  draft.ack = !!ack?.checked;
  if (!draft.ack) {
    draft.errors = { ack: 'Please tick the box to confirm you understand this is a demo.' };
    return paintStep();
  }
  const res = validateRequest(draft.game, draft.pkgId, draft.fields);
  if (!res.ok) {
    draft.step = 'form';
    draft.errors = res.errors;
    return paintStep();
  }
  const reference = draft.prepared?.reference || generateReference();
  const message = buildRequestMessage({ reference, game: draft.game, value: res.value }, SITE);
  draft.errors = {};
  draft.prepared = { reference, message };
  paintStep();
  document.querySelector('.prepared')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.getElementById('reqText');
    if (!ta) return false;
    ta.select();
    return document.execCommand?.('copy') ?? false;
  }
}

// ---------- Routing and events ----------

function closeNav() {
  document.querySelector('.site-header')?.classList.remove('open');
  document.getElementById('navToggle')?.setAttribute('aria-expanded', 'false');
}

function route() {
  closeNav();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  let page = parts[0] || '';
  let arg = parts[1] ? decodeURIComponent(parts[1]) : '';
  try {
    if (page === 'game') renderGame(arg);
    else if (page === 'games') renderGames();
    else if (page === 'how') renderStatic('How it works', `
      <ol class="steps">
        <li><strong>Pick a game and package.</strong> Prices shown are demo prices.</li>
        <li><strong>Enter your game ID and phone number.</strong> Check the ID in your in-game profile.</li>
        <li><strong>Review and tick the demo acknowledgement.</strong></li>
        <li><strong>Send the request on WhatsApp.</strong> The message contains a unique demo reference.</li>
        <li><strong>Wait for the store.</strong> It replies with availability and payment steps. Only then is an order confirmed.</li>
      </ol>`);
    else if (page === 'faq') renderStatic('FAQ', FAQS.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join(''));
    else if (page === '' ) renderHome();
    else renderNotFound();
    if (page !== 'games') window.scrollTo(0, 0);
  } catch (e) {
    app.innerHTML = `<p class="field-error">Something went wrong: ${esc(e.message)}</p>`;
  }
}

document.getElementById('navToggle').addEventListener('click', () => {
  const open = document.querySelector('.site-header').classList.toggle('open');
  document.getElementById('navToggle').setAttribute('aria-expanded', String(open));
});

document.addEventListener('click', async (e) => {
  const pkg = e.target.closest('[data-pkg]');
  if (pkg && draft) {
    if (draft.step === 'form') onFormChange(document.getElementById('orderForm'));
    if (draft.pkgId !== pkg.dataset.pkg) draft.prepared = null;
    draft.pkgId = pkg.dataset.pkg;
    draft.errors = {};
    if (draft.step === 'confirm') draft.step = 'form';
    return paintStep();
  }
  const action = e.target.closest('[data-action]');
  if (!action || !draft) return;
  const kind = action.dataset.action;
  if (kind === 'edit') {
    draft.step = 'form';
    draft.prepared = null;
    draft.errors = {};
    paintStep();
  } else if (kind === 'prepare') {
    prepareRequest();
  } else if (kind === 'copy') {
    const ok = await copyText(draft.prepared?.message || '');
    const s = document.getElementById('copyStatus');
    if (s) s.textContent = ok ? 'Copied.' : 'Copy failed. Select the text above and copy it manually.';
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'orderForm' && draft) {
    e.preventDefault();
    reviewRequest(e.target);
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'ack' && draft) draft.ack = e.target.checked;
  if (e.target.id === 'category') {
    filter.category = e.target.value;
    applyFilter();
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'search') {
    filter.q = e.target.value;
    applyFilter();
  }
});

window.addEventListener('hashchange', route);
route();
