const root = document.getElementById('admin');
const navEl = document.getElementById('adminNav');
const STATUS_LABELS = {
  pending: 'Pending', awaiting_payment: 'Awaiting Payment', payment_verification: 'Payment Verification',
  processing: 'Processing', completed: 'Completed', failed: 'Failed', refunded: 'Refunded',
};
const TABS = [['overview', 'Overview'], ['orders', 'Orders'], ['catalog', 'Games & Prices'], ['settings', 'Settings']];
let current = 'overview';
let adminEmail = '';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => `EGP ${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (s) => (s ? new Date(s).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'fetch', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/admin/login') {
    showLogin();
    throw new Error('Please sign in.');
  }
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function showLogin(msg = '') {
  navEl.innerHTML = '';
  root.innerHTML = `
    <section class="panel narrow">
      <h1>Administrator sign-in</h1>
      <form data-form="login" class="form">
        <label>Email<input name="email" type="email" required autocomplete="username"></label>
        <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
        <p class="form-error" data-err role="alert">${esc(msg)}</p>
        <button class="btn btn-primary" type="submit">Sign in</button>
      </form>
    </section>`;
}

function showShell() {
  navEl.innerHTML = TABS.map(([k, l]) => `<button class="nav-tab${k === current ? ' active' : ''}" type="button" data-tab="${k}">${l}</button>`).join('') +
    '<button class="nav-tab" type="button" data-action="logout">Sign out</button>';
  root.innerHTML = `<div class="admin-meta">Signed in as ${esc(adminEmail)}</div><div id="content"></div>`;
  renderTab();
}

const content = () => document.getElementById('content');

async function renderTab() {
  const c = content();
  if (!c) return;
  c.innerHTML = '<p class="loading">Loading…</p>';
  const views = { overview: viewOverview, orders: viewOrders, catalog: viewCatalog, settings: viewSettings };
  try {
    await views[current](c);
  } catch (e) {
    if (e.message !== 'Please sign in.') c.innerHTML = `<p class="form-error">${esc(e.message)}</p>`;
  }
}

async function viewOverview(c) {
  const s = await api('/api/admin/summary');
  c.innerHTML = `
    <div class="stats">
      <div class="stat"><span>Total orders</span><strong>${s.totalOrders}</strong></div>
      <div class="stat"><span>Needs action</span><strong>${s.needsActionCount}</strong></div>
      <div class="stat"><span>Revenue (completed)</span><strong>${money(s.revenueEgp)}</strong></div>
    </div>
    <p class="muted small">"Needs action" counts Pending, Payment Verification and Processing orders.</p>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Status</th><th>Orders</th><th>Value</th></tr></thead>
      <tbody>${Object.entries(s.byStatus).map(([k, v]) => `<tr><td>${STATUS_LABELS[k]}</td><td>${v.count}</td><td>${money(v.totalEgp)}</td></tr>`).join('')}</tbody>
    </table></div>
    <p><a class="btn btn-ghost" href="/api/admin/orders.csv">Download CSV export</a></p>`;
}

async function viewOrders(c) {
  c.innerHTML = `
    <div class="toolbar">
      <select id="fStatus" aria-label="Status filter">
        <option value="">All statuses</option>
        ${Object.entries(STATUS_LABELS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
      </select>
      <input id="fQ" type="search" placeholder="Reference, contact or player ID" aria-label="Search orders">
      <button class="btn btn-primary btn-sm" type="button" data-action="filter">Search</button>
    </div>
    <div class="split">
      <div id="orderList" class="list"></div>
      <aside id="orderDetail" class="panel detail">Select an order to view details.</aside>
    </div>`;
  await loadOrders();
}

async function loadOrders() {
  const status = document.getElementById('fStatus')?.value || '';
  const q = document.getElementById('fQ')?.value.trim() || '';
  const { orders } = await api(`/api/admin/orders?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`);
  document.getElementById('orderList').innerHTML = orders.length
    ? `<div class="table-wrap"><table class="table"><thead><tr><th>Reference</th><th>Game</th><th>Status</th><th>Amount</th><th>Placed</th></tr></thead><tbody>
        ${orders.map((o) => `<tr class="row-link" data-order="${o.id}">
          <td>${esc(o.reference)}</td><td>${esc(o.gameName)}</td><td>${esc(o.statusLabel)}</td><td>${money(o.priceEgp)}</td><td>${when(o.createdAt)}</td></tr>`).join('')}
        </tbody></table></div>`
    : '<p class="muted">No orders match.</p>';
}

async function openOrder(id) {
  const { order, events } = await api(`/api/admin/orders/${id}`);
  const el = document.getElementById('orderDetail');
  const next = order.allowedNext.map((s) => `<option value="${s}">${STATUS_LABELS[s]}</option>`).join('');
  el.innerHTML = `
    <h3>${esc(order.reference)}</h3>
    <span class="badge status-${esc(order.status)}">${esc(order.statusLabel)}</span>
    <dl class="summary">
      <dt>Game</dt><dd>${esc(order.gameName)} · ${esc(order.packageLabel)}</dd>
      <dt>Amount</dt><dd>${money(order.priceEgp)}</dd>
      <dt>Player ID</dt><dd>${esc(order.playerId)}${order.extraValue ? ` / ${esc(order.extraValue)}` : ''}</dd>
      <dt>Contact</dt><dd>${esc(order.contact)}</dd>
      <dt>Payment</dt><dd>${esc(order.paymentMethodLabel || '—')} · ${esc(order.paymentRef || '—')}</dd>
      <dt>Supplier</dt><dd>${esc(order.supplier || 'none')}${order.supplierRef ? ` · ref ${esc(order.supplierRef)}` : ''}</dd>
      <dt>Placed</dt><dd>${when(order.createdAt)}</dd>
    </dl>
    <h4>History</h4>
    <ol class="timeline">${events.map((e) => `<li><strong>${esc(e.statusLabel)}</strong> <span class="muted">${when(e.at)} · ${esc(e.actor)}</span>${e.note ? `<br>${esc(e.note)}` : ''}</li>`).join('')}</ol>
    ${next ? `<form data-form="status" data-id="${order.id}" class="form">
        <label>Move to<select name="status">${next}</select></label>
        <label>Note <span class="muted small">(required for Completed, Failed, Refunded)</span>
          <textarea name="note" rows="3" maxlength="500"></textarea></label>
        <p class="form-error" data-err role="alert"></p>
        <button class="btn btn-primary" type="submit">Apply status</button>
      </form>` : '<p class="muted">No further status changes are allowed.</p>'}
    ${order.status === 'processing' ? `<div class="btn-row">
        <button class="btn btn-ghost" type="button" data-action="fulfill" data-id="${order.id}">Send to supplier</button>
      </div>
      <p class="muted small">Requires a configured supplier adapter. Without one, fulfil manually and mark Completed with a note.</p>` : ''}
    <p class="form-error" id="detailErr" role="alert"></p>`;
}

async function submitStatus(form) {
  const id = form.dataset.id;
  const fd = new FormData(form);
  const err = form.querySelector('[data-err]');
  err.textContent = '';
  try {
    await api(`/api/admin/orders/${id}/status`, { method: 'POST', body: { status: fd.get('status'), note: String(fd.get('note') || '') } });
    await loadOrders();
    await openOrder(id);
  } catch (e) {
    err.textContent = e.message;
  }
}

async function fulfill(id) {
  const errEl = document.getElementById('detailErr');
  errEl.textContent = '';
  try {
    await api(`/api/admin/orders/${id}/fulfill`, { method: 'POST' });
    await openOrder(id);
  } catch (e) {
    errEl.textContent = e.message;
  }
}

function readFields(scope) {
  const out = {};
  scope.querySelectorAll('[data-field]').forEach((el) => {
    out[el.dataset.field] = el.type === 'checkbox' ? el.checked : el.value;
  });
  return out;
}

async function viewCatalog(c) {
  const { games } = await api('/api/admin/catalog');
  c.innerHTML = `
    <p class="notice">Prices are stored in EGP. Each order snapshots its price when placed, so changing a price never alters existing orders. Demo rows are labelled DEMO; replace them with supplier-confirmed prices.</p>
    ${games.map((g) => `
      <section class="panel game-admin">
        <div class="game-admin-head">
          <h3>${esc(g.name)} <span class="muted small">${esc(g.slug)}</span></h3>
          <div class="game-admin-head" data-scope="game" data-id="${g.id}">
            <label class="check"><input type="checkbox" data-field="active" ${g.active ? 'checked' : ''}> Active</label>
            <label class="check"><input type="checkbox" data-field="featured" ${g.featured ? 'checked' : ''}> Featured</label>
            <label class="check"><input type="checkbox" data-field="isDemo" ${g.isDemo ? 'checked' : ''}> Demo</label>
            <button class="btn btn-ghost btn-sm" type="button" data-action="save-game" data-id="${g.id}">Save game</button>
          </div>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Label</th><th>Amount</th><th>Price (EGP)</th><th>Active</th><th></th></tr></thead>
          <tbody>${g.packages.map((p) => `<tr>
            <td><input data-field="label" value="${esc(p.label)}" maxlength="60"></td>
            <td><input data-field="amount" type="number" min="1" value="${p.amount}"></td>
            <td><input data-field="priceEgp" type="number" min="0" step="0.01" value="${p.priceEgp}"></td>
            <td><input data-field="active" type="checkbox" ${p.active ? 'checked' : ''}></td>
            <td><button class="btn btn-ghost btn-sm" type="button" data-action="save-pkg" data-id="${p.id}">Save</button></td>
          </tr>`).join('')}</tbody>
        </table></div>
        <form data-form="add-pkg" data-id="${g.id}" class="inline-form">
          <input name="label" placeholder="Label" required maxlength="60" aria-label="Package label">
          <input name="amount" type="number" min="1" placeholder="Amount" required aria-label="Amount">
          <input name="priceEgp" type="number" min="0" step="0.01" placeholder="Price EGP" required aria-label="Price in EGP">
          <button class="btn btn-sm btn-primary" type="submit">Add package</button>
          <p class="form-error" data-err role="alert"></p>
        </form>
      </section>`).join('')}
    <section class="panel">
      <h3>Add game</h3>
      <form data-form="add-game" class="grid-form">
        <label>Slug<input name="slug" required pattern="[a-z0-9-]{2,60}"></label>
        <label>Name<input name="name" required maxlength="60"></label>
        <label>Category<input name="category" required maxlength="40"></label>
        <label>Currency label<input name="currencyLabel" required maxlength="30"></label>
        <label>ID label<input name="idLabel" required maxlength="30"></label>
        <label>ID pattern (regex)<input name="idPattern" required value="^[0-9]{6,12}$"></label>
        <label>Extra field label (optional)<input name="extraLabel" maxlength="30"></label>
        <label>Extra pattern (regex)<input name="extraPattern"></label>
        <label>Description<input name="description" maxlength="300"></label>
        <button class="btn btn-primary" type="submit">Create game</button>
        <p class="form-error" data-err role="alert"></p>
      </form>
    </section>`;
}

async function viewSettings(c) {
  const s = await api('/api/admin/settings');
  c.innerHTML = `
    <section class="panel narrow flush">
      <h3>Store settings</h3>
      <form data-form="settings" class="form">
        <label>Store name<input name="store_name" value="${esc(s.store_name || '')}" maxlength="60"></label>
        <label>Support email<input name="support_email" type="email" value="${esc(s.support_email || '')}" maxlength="120"></label>
        <label>Support phone<input name="support_phone" value="${esc(s.support_phone || '')}" maxlength="30"></label>
        <label>Payment instructions shown to customers
          <textarea name="payment_note" rows="5" maxlength="500">${esc(s.payment_note || '')}</textarea>
        </label>
        <p class="form-error" data-err role="alert"></p>
        <p class="form-ok" data-ok role="status"></p>
        <button class="btn btn-primary" type="submit">Save settings</button>
      </form>
    </section>`;
}

async function saveRow(scopeEl, path, method = 'PATCH') {
  const body = readFields(scopeEl);
  await api(path, { method, body });
}

document.addEventListener('click', async (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    current = tab.dataset.tab;
    navEl.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === current));
    renderTab();
    return;
  }
  const row = e.target.closest('[data-order]');
  if (row && !e.target.closest('button,input,select,textarea,a')) {
    openOrder(row.dataset.order).catch((err) => { document.getElementById('orderDetail').textContent = err.message; });
    return;
  }
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  try {
    if (action === 'logout') {
      await api('/api/admin/logout', { method: 'POST' });
      adminEmail = '';
      showLogin();
    } else if (action === 'filter') {
      await loadOrders();
    } else if (action === 'fulfill') {
      await fulfill(btn.dataset.id);
    } else if (action === 'save-game') {
      await saveRow(btn.closest('[data-scope="game"]'), `/api/admin/games/${btn.dataset.id}`);
      flash(btn, 'Saved');
    } else if (action === 'save-pkg') {
      await saveRow(btn.closest('tr'), `/api/admin/packages/${btn.dataset.id}`);
      flash(btn, 'Saved');
    }
  } catch (err) {
    if (err.message !== 'Please sign in.') flash(btn, err.message, true);
  }
});

function flash(btn, text, isError = false) {
  const old = btn.textContent;
  btn.textContent = text;
  btn.style.color = isError ? 'var(--danger)' : 'var(--ok)';
  setTimeout(() => { btn.textContent = old; btn.style.color = ''; }, 1800);
}

document.addEventListener('submit', async (e) => {
  const form = e.target;
  const kind = form.dataset.form;
  if (!kind) return;
  e.preventDefault();
  const fd = new FormData(form);
  const err = form.querySelector('[data-err]');
  if (err) err.textContent = '';
  try {
    if (kind === 'login') {
      const errLogin = form.querySelector('[data-err]');
      try {
        await api('/api/admin/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
      } catch (x) {
        errLogin.textContent = x.message;
        return;
      }
      const { admin } = await api('/api/admin/me');
      adminEmail = admin.email;
      showShell();
    } else if (kind === 'status') {
      await submitStatus(form);
    } else if (kind === 'add-pkg') {
      await api(`/api/admin/games/${form.dataset.id}/packages`, {
        method: 'POST',
        body: { label: fd.get('label'), amount: fd.get('amount'), priceEgp: fd.get('priceEgp') },
      });
      await renderTab();
    } else if (kind === 'add-game') {
      await api('/api/admin/games', { method: 'POST', body: Object.fromEntries(fd) });
      await renderTab();
    } else if (kind === 'settings') {
      const body = Object.fromEntries(fd);
      await api('/api/admin/settings', { method: 'PUT', body });
      const ok = form.querySelector('[data-ok]');
      if (ok) ok.textContent = 'Settings saved.';
    }
  } catch (x) {
    if (x.message !== 'Please sign in.' && err) err.textContent = x.message;
  }
});

async function init() {
  try {
    const { admin } = await api('/api/admin/me');
    adminEmail = admin.email;
    showShell();
  } catch (e) {
    if (e.message !== 'Please sign in.') showLogin();
  }
}

init();
