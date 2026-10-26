const app = document.getElementById('app');
const state = { games: [], settings: {}, lastRef: '', lastContact: '' };
let draft = null;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => `EGP ${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (s) => (s ? new Date(s).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const isContact = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || /^\+?[0-9]{8,15}$/.test(v.replace(/[\s-]/g, ''));
const randomKey = () => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};

const HINTS = {
  pending: 'Your order was received and is being prepared.',
  awaiting_payment: 'Complete payment using the instructions below, then submit your payment reference.',
  payment_verification: 'We are checking your payment. This is a manual step and can take a while.',
  processing: 'Your payment has been verified and your top-up is being processed.',
  completed: 'Your top-up has been completed.',
  failed: 'This order could not be completed. Contact support with your reference.',
  refunded: 'This order was refunded.',
};

const FAQS = [
  ['Is this a real store?', 'Not yet. This is a demo storefront. Prices, packages and provider connections are sample data until an authorised supplier and payment provider are configured.'],
  ['Is VoltX Gaming affiliated with the game publishers?', 'No. VoltX Gaming is an independent store. Game names are used only to identify the products.'],
  ['Where do I find my player ID?', 'Each game shows its ID in the in-game profile. Check it carefully before placing an order, because a wrong ID may not be recoverable.'],
  ['How long does delivery take?', 'Timing depends on payment verification and supplier processing. Your order page shows every status change.'],
  ['Is my payment safe?', 'We never ask for card PINs, passwords or OTP codes. Only submit a payment reference after you have paid through the method you chose.'],
  ['What if my order fails?', 'Failed or refunded orders show their status on the order page. Contact support with your order reference.'],
];

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

// ---------- Home ----------

const gameCard = (g) => {
  const from = g.packages.length ? Math.min(...g.packages.map((p) => p.priceEgp)) : null;
  return `<a class="card" href="#/game/${esc(g.slug)}">
    ${g.isDemo ? '<span class="badge badge-demo">DEMO</span>' : ''}
    <span class="card-cat">${esc(g.category)}</span>
    <h3>${esc(g.name)}</h3>
    <p class="muted">Top up ${esc(g.currencyLabel)}</p>
    <p class="from">${from != null ? `From ${money(from)}` : 'Packages coming soon'}</p>
  </a>`;
};

function renderHome() {
  const cats = [...new Set(state.games.map((g) => g.category))].sort();
  app.innerHTML = `
    <section class="hero">
      <div class="hero-glow" aria-hidden="true"></div>
      <p class="eyebrow">Premium top-ups</p>
      <h1>LEVEL UP YOUR GAME</h1>
      <p class="hero-sub">Your Favorite Games. Simple Top-Ups.</p>
      <a class="btn btn-primary" href="#/games">Explore Games</a>
    </section>

    <section class="section">
      <div class="section-head"><h2>Featured</h2></div>
      <div class="grid featured">${state.games.filter((g) => g.featured).map(gameCard).join('') || '<p class="muted">No featured games yet.</p>'}</div>
    </section>

    <section class="section" id="catalog">
      <div class="section-head"><h2>All Games</h2></div>
      <div class="filters">
        <input id="search" type="search" placeholder="Search games" aria-label="Search games">
        <select id="category" aria-label="Filter by category">
          <option value="">All categories</option>
          ${cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
        </select>
      </div>
      <div id="catalogGrid" class="grid">${state.games.map(gameCard).join('') || '<p class="muted">No games are available yet.</p>'}</div>
    </section>

    <section class="section">
      <h2>How It Works</h2>
      <ol class="steps">
        <li><h3>Pick a game</h3><p class="muted">Choose a game and a package. Prices are shown in EGP.</p></li>
        <li><h3>Enter your details</h3><p class="muted">Provide the player ID the game requires and an email or phone for updates.</p></li>
        <li><h3>Confirm</h3><p class="muted">Review the summary and confirm. You then see the payment steps.</p></li>
        <li><h3>Pay and track</h3><p class="muted">Submit your payment reference and follow every status change on your order page.</p></li>
      </ol>
    </section>

    <section class="section">
      <h2>Questions?</h2>
      <p class="muted">Quick answers about how the store works, payments and order status.</p>
      <a class="btn btn-ghost" href="#/faq">Read FAQs</a>
    </section>`;
}

function applyFilter() {
  const grid = document.getElementById('catalogGrid');
  if (!grid) return;
  const q = (document.getElementById('search')?.value || '').trim().toLowerCase();
  const cat = document.getElementById('category')?.value || '';
  const list = state.games.filter((g) =>
    (!cat || g.category === cat) &&
    (!q || g.name.toLowerCase().includes(q) || g.category.toLowerCase().includes(q)));
  grid.innerHTML = list.length ? list.map(gameCard).join('') : '<p class="muted">No games match your search.</p>';
}

// ---------- Product ----------

async function renderGame(slug) {
  const g = await api(`/api/games/${encodeURIComponent(slug)}`);
  draft = { game: g, pkgId: null, step: 'form', idemKey: null, fields: null };
  app.innerHTML = `
    <a class="back" href="#/games">← All games</a>
    <div class="product-head">
      <div>
        <span class="card-cat">${esc(g.category)}</span>
        <h1>${esc(g.name)}</h1>
        <p class="muted">${esc(g.description)}</p>
      </div>
      ${g.isDemo ? '<span class="badge badge-demo badge-static">DEMO STORE</span>' : ''}
    </div>
    <p class="demo-note">Sample packages and prices. Replace them with supplier-confirmed data before going live. Nothing is delivered until a real supplier fulfils the order.</p>
    <div class="product-layout">
      <section class="panel">
        <h2>1. Choose a package</h2>
        <div id="pkgGrid" class="pkg-grid"></div>
      </section>
      <section class="panel" id="stepPanel" aria-live="polite"></section>
    </div>`;
  paintPackages();
  paintStep();
}

function paintPackages() {
  const el = document.getElementById('pkgGrid');
  if (!el || !draft) return;
  const pk = draft.game.packages;
  el.innerHTML = pk.length
    ? pk.map((p) => `<button type="button" class="pkg${draft.pkgId === p.id ? ' selected' : ''}" data-pkg="${p.id}" aria-pressed="${draft.pkgId === p.id}">
        <strong>${esc(p.label)}</strong><span class="pkg-price">${money(p.priceEgp)}</span></button>`).join('')
    : '<p class="muted">No packages are available right now.</p>';
}

function paintStep() {
  const el = document.getElementById('stepPanel');
  if (!el || !draft) return;
  const g = draft.game;
  const pkg = g.packages.find((p) => p.id === draft.pkgId);
  if (!pkg) {
    el.innerHTML = '<h2>2. Your details</h2><p class="muted">Select a package to continue.</p>';
    return;
  }
  if (draft.step === 'confirm') {
    const f = draft.fields;
    el.innerHTML = `
      <h2>2. Confirm your order</h2>
      <dl class="summary">
        <dt>Game</dt><dd>${esc(g.name)}</dd>
        <dt>Package</dt><dd>${esc(pkg.label)}</dd>
        <dt>Price</dt><dd>${money(pkg.priceEgp)}</dd>
        <dt>${esc(g.idLabel)}</dt><dd>${esc(f.playerId)}</dd>
        ${g.extraLabel ? `<dt>${esc(g.extraLabel)}</dt><dd>${esc(f.extraValue)}</dd>` : ''}
        <dt>Contact</dt><dd>${esc(f.contact)}</dd>
      </dl>
      <p class="notice">Check that the ${esc(g.idLabel)} is correct. No payment is taken automatically here. After you place the order, you will see the payment steps.</p>
      <p class="form-error" id="submitErr" role="alert"></p>
      <div class="btn-row">
        <button class="btn btn-ghost" type="button" data-action="edit">Edit details</button>
        <button class="btn btn-primary" type="button" data-action="submit">Confirm &amp; place order</button>
      </div>`;
    return;
  }
  const f = draft.fields || { playerId: '', extraValue: '', contact: '' };
  el.innerHTML = `
    <h2>2. Your details</h2>
    <form id="orderForm" class="form" novalidate>
      <label>${esc(g.idLabel)}
        <input name="playerId" required maxlength="40" autocomplete="off" value="${esc(f.playerId)}">
      </label>
      <p class="hint">Check this carefully. A wrong ID may not be recoverable.</p>
      ${g.extraLabel ? `<label>${esc(g.extraLabel)}
        <input name="extraValue" required maxlength="20" autocomplete="off" value="${esc(f.extraValue)}">
      </label>` : ''}
      <label>Email or phone for updates
        <input name="contact" required maxlength="120" autocomplete="email" value="${esc(f.contact)}">
      </label>
      <p class="form-error" id="formErr" role="alert"></p>
      <button class="btn btn-primary" type="submit">Review order</button>
    </form>`;
}

function reviewOrder(form) {
  const g = draft.game;
  const fd = new FormData(form);
  const errEl = document.getElementById('formErr');
  const playerId = String(fd.get('playerId') || '').trim();
  const extraValue = g.extraLabel ? String(fd.get('extraValue') || '').trim() : '';
  const contact = String(fd.get('contact') || '').trim();
  errEl.textContent = '';
  if (!new RegExp(g.idPattern).test(playerId)) return (errEl.textContent = `${g.idLabel} format looks invalid.`);
  if (g.extraLabel && !(g.extraPattern ? new RegExp(g.extraPattern).test(extraValue) : extraValue)) {
    return (errEl.textContent = `${g.extraLabel} format looks invalid.`);
  }
  if (!isContact(contact)) return (errEl.textContent = 'Enter a valid email address or phone number.');
  draft.fields = { playerId, extraValue, contact };
  draft.idemKey = randomKey();
  draft.step = 'confirm';
  paintStep();
}

async function submitOrder(btn) {
  if (!draft || draft.step !== 'confirm') return;
  const f = draft.fields;
  const errEl = document.getElementById('submitErr');
  btn.disabled = true;
  btn.textContent = 'Placing order…';
  errEl.textContent = '';
  try {
    const { order } = await api('/api/orders', {
      method: 'POST',
      body: {
        gameSlug: draft.game.slug,
        packageId: draft.pkgId,
        playerId: f.playerId,
        extraValue: f.extraValue,
        contact: f.contact,
        idempotencyKey: draft.idemKey,
      },
    });
    state.lastRef = order.reference;
    state.lastContact = f.contact;
    draft = null;
    location.hash = `#/order/${order.reference}`;
  } catch (err) {
    errEl.textContent = err.message;
    btn.disabled = false;
    btn.textContent = 'Confirm & place order';
  }
}

// ---------- Order tracking ----------

function paintLookup(ref = '', message = '') {
  app.innerHTML = `
    <a class="back" href="#/">← Back to store</a>
    <section class="panel narrow">
      <h1>Track your order</h1>
      <p class="muted">Enter your order reference and the email or phone you used at checkout.</p>
      <form data-form="lookup" class="form">
        <label>Order reference
          <input name="reference" required value="${esc(ref)}" placeholder="VX-XXXXX-XXXXXX" maxlength="40" autocomplete="off">
        </label>
        <label>Email or phone
          <input name="contact" required maxlength="120" autocomplete="email">
        </label>
        <p class="form-error" data-err role="alert">${esc(message)}</p>
        <button class="btn btn-primary" type="submit">Find order</button>
      </form>
    </section>`;
}

function paintOrder(order, message = '') {
  const methods = state.settings.paymentMethods || [];
  const payForm = order.status === 'awaiting_payment' ? `
    <section class="panel">
      <h2>Next step: payment</h2>
      <p>${esc(state.settings.paymentNote || 'Payment instructions will be provided by our team.')}</p>
      <form data-form="payment" class="form">
        <label>Payment method
          <select name="paymentMethod" required>${methods.map((m) => `<option value="${esc(m.key)}">${esc(m.label)}</option>`).join('')}</select>
        </label>
        <label>Payment reference / transaction ID
          <input name="paymentRef" required minlength="4" maxlength="64" autocomplete="off">
        </label>
        <p class="hint">Enter only the transaction reference. Never enter card numbers, PINs, passwords or OTP codes.</p>
        <p class="form-error" data-err role="alert"></p>
        <button class="btn btn-primary" type="submit">I have paid · submit reference</button>
      </form>
    </section>` : '';
  app.innerHTML = `
    <a class="back" href="#/">← Back to store</a>
    <section class="panel order-head">
      <div><p class="muted small">Order reference</p><p class="ref">${esc(order.reference)}</p></div>
      <span class="badge status-${esc(order.status)}">${esc(order.statusLabel)}</span>
    </section>
    ${message ? `<p class="notice">${esc(message)}</p>` : ''}
    <p class="lead">${esc(HINTS[order.status] || '')}</p>
    <div class="product-layout">
      <section class="panel">
        <h2>Details</h2>
        <dl class="summary">
          <dt>Game</dt><dd>${esc(order.gameName)}</dd>
          <dt>Package</dt><dd>${esc(order.packageLabel)}</dd>
          <dt>Price</dt><dd>${money(order.priceEgp)}</dd>
          <dt>Player ID</dt><dd>${esc(order.playerId)}${order.extraValue ? ` / ${esc(order.extraValue)}` : ''}</dd>
          <dt>Payment</dt><dd>${esc(order.paymentMethod || '—')}${order.paymentRef ? ` · ${esc(order.paymentRef)}` : ''}</dd>
          <dt>Placed</dt><dd>${when(order.createdAt)}</dd>
          <dt>Last update</dt><dd>${when(order.updatedAt)}</dd>
        </dl>
      </section>
      <section class="panel">
        <h2>Progress</h2>
        <ol class="timeline">${order.timeline.map((t) => `<li><strong>${esc(t.label)}</strong> <span class="muted small">${when(t.at)}</span></li>`).join('')}</ol>
      </section>
    </div>
    ${payForm}`;
}

async function renderOrder(ref) {
  if (!ref) return paintLookup();
  if (state.lastRef === ref && state.lastContact) {
    try {
      const { order } = await api('/api/orders/lookup', { method: 'POST', body: { reference: ref, contact: state.lastContact } });
      return paintOrder(order);
    } catch {
      /* fall through to the lookup form */
    }
  }
  paintLookup(ref);
}

async function doLookup(form) {
  const fd = new FormData(form);
  const reference = String(fd.get('reference') || '').trim().toUpperCase();
  const contact = String(fd.get('contact') || '').trim();
  const err = form.querySelector('[data-err]');
  err.textContent = '';
  if (!isContact(contact)) {
    err.textContent = 'Enter the email or phone used at checkout.';
    return;
  }
  try {
    const { order } = await api('/api/orders/lookup', { method: 'POST', body: { reference, contact } });
    state.lastRef = order.reference;
    state.lastContact = contact;
    paintOrder(order);
    history.replaceState(null, '', `#/order/${order.reference}`);
  } catch (e) {
    err.textContent = e.message;
  }
}

async function doPayment(form) {
  const fd = new FormData(form);
  const err = form.querySelector('[data-err]');
  err.textContent = '';
  try {
    const { order } = await api(`/api/orders/${encodeURIComponent(state.lastRef)}/payment`, {
      method: 'POST',
      body: {
        contact: state.lastContact,
        paymentMethod: fd.get('paymentMethod'),
        paymentRef: String(fd.get('paymentRef') || '').trim(),
      },
    });
    paintOrder(order, 'Payment reference received. Our team will verify it before processing your top-up.');
  } catch (e) {
    err.textContent = e.message;
  }
}

// ---------- Static pages ----------

function renderHow() {
  app.innerHTML = `
    <section class="section">
      <h1>How It Works</h1>
      <ol class="steps">
        <li><h3>Pick a game</h3><p class="muted">Choose a game and a top-up package. Prices are shown in EGP.</p></li>
        <li><h3>Enter your details</h3><p class="muted">Provide the player ID the game requires and an email or phone for updates.</p></li>
        <li><h3>Confirm</h3><p class="muted">Review the summary and confirm. Nothing is charged automatically in this demo store.</p></li>
        <li><h3>Pay and verify</h3><p class="muted">Pay using the instructions shown, then submit your payment reference. We verify payments before fulfilment.</p></li>
        <li><h3>Track</h3><p class="muted">Follow each status change on your order page with your reference and contact.</p></li>
      </ol>
      <p class="btn-row"><a class="btn btn-primary" href="#/games">Explore Games</a></p>
    </section>`;
}

function renderFaq() {
  app.innerHTML = `
    <section class="section faq">
      <h1>FAQ</h1>
      ${FAQS.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
    </section>`;
}

function renderContact() {
  const s = state.settings;
  app.innerHTML = `
    <section class="section">
      <h1>Contact</h1>
      <div class="panel narrow flush">
        <p class="muted">Include your order reference in every message so we can find your order quickly.</p>
        <dl class="summary">
          <dt>Email</dt><dd>${s.supportEmail ? esc(s.supportEmail) : '<span class="muted">Not configured yet</span>'}</dd>
          <dt>Phone</dt><dd>${s.supportPhone ? esc(s.supportPhone) : '<span class="muted">Not configured yet</span>'}</dd>
        </dl>
        <a class="btn btn-ghost" href="#/order">Track an order</a>
      </div>
    </section>`;
}

// ---------- Router ----------

function closeNav() {
  document.querySelector('.nav')?.classList.remove('open');
  document.getElementById('navToggle')?.setAttribute('aria-expanded', 'false');
}

async function route() {
  closeNav();
  let parts = [];
  try {
    parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    parts = [];
  }
  const [page, arg] = parts;
  try {
    if (page === 'game' && arg) await renderGame(arg);
    else if (page === 'order') await renderOrder(arg || '');
    else if (page === 'how') renderHow();
    else if (page === 'faq') renderFaq();
    else if (page === 'contact') renderContact();
    else renderHome();

    if (page === 'games') document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' });
    else window.scrollTo(0, 0);
  } catch (e) {
    app.innerHTML = `<p class="form-error">${esc(e.message)}</p><p><a href="#/">Back to store</a></p>`;
  }
}

// ---------- Events ----------

document.getElementById('navToggle').addEventListener('click', () => {
  const nav = document.querySelector('.nav');
  const open = nav.classList.toggle('open');
  document.getElementById('navToggle').setAttribute('aria-expanded', String(open));
});

document.addEventListener('click', (e) => {
  const pkgBtn = e.target.closest('[data-pkg]');
  if (pkgBtn && draft) {
    draft.pkgId = Number(pkgBtn.dataset.pkg);
    if (draft.step === 'confirm') draft.step = 'form';
    draft.idemKey = null;
    paintPackages();
    paintStep();
    return;
  }
  const actionBtn = e.target.closest('[data-action]');
  if (!actionBtn || !draft) return;
  if (actionBtn.dataset.action === 'edit') {
    draft.step = 'form';
    paintStep();
  } else if (actionBtn.dataset.action === 'submit') {
    submitOrder(actionBtn);
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form.id === 'orderForm') {
    e.preventDefault();
    if (draft) reviewOrder(form);
  } else if (form.dataset.form === 'lookup') {
    e.preventDefault();
    doLookup(form);
  } else if (form.dataset.form === 'payment') {
    e.preventDefault();
    doPayment(form);
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'search' || e.target.id === 'category') applyFilter();
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'category') applyFilter();
});

// ---------- Boot ----------

async function boot() {
  try {
    const [games, settings] = await Promise.all([api('/api/games'), api('/api/settings')]);
    state.games = games;
    state.settings = settings;
    const footer = document.getElementById('footerSupport');
    if (footer) {
      footer.textContent = [settings.supportEmail, settings.supportPhone].filter(Boolean).join(' · ') ||
        'Support contact details are configured by the store owner.';
    }
  } catch {
    app.innerHTML = '<p class="form-error">Could not load the store. Please refresh the page.</p>';
    return;
  }
  window.addEventListener('hashchange', route);
  route();
}

boot();
