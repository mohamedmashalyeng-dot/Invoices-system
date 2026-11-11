/* QuickPlus Invoices – single page app (vanilla JS) */
(() => {
  const S = {
    user: null,
    branches: [],
    lang: localStorage.getItem('lang') || 'ar',
    branchFilter: localStorage.getItem('branchFilter') || '',
    printLang: localStorage.getItem('printLang') || 'both',
  };
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const t = (k) => (I18N[S.lang] && I18N[S.lang][k]) || I18N.en[k] || k;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const today = () => new Date().toISOString().slice(0, 10);
  const bName = (b) => (b ? (S.lang === 'ar' ? b.name_ar || b.name_en : b.name_en) : '');
  const branchById = (id) => S.branches.find((b) => b.id === Number(id));
  const isAdmin = () => S.user && S.user.role === 'admin';
  const flag = (code) => (code === 'EG' ? '🇪🇬' : code === 'AE' ? '🇦🇪' : '🏢');

  // ---------- API ----------
  async function api(url, opts = {}) {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.endsWith('/login')) { S.user = null; renderLogin(); throw new Error(data.error); }
    if (!res.ok) throw new Error(data.error || 'Error');
    return data;
  }
  const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();

  // ---------- UI helpers ----------
  function toast(msg, type = 'ok') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
  const fail = (e) => toast(e.message || String(e), 'err');

  function modal(title, bodyHtml, onSubmit, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<form class="modal ${opts.wide ? 'wide' : ''}">
        <div class="modal-head"><h3>${esc(title)}</h3><button type="button" class="icon-btn" data-close>✕</button></div>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-foot"><button type="submit" class="btn primary">${t('save')}</button>
          <button type="button" class="btn" data-close>${t('cancel')}</button></div>
      </form>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    $$('[data-close]', wrap).forEach((b) => (b.onclick = close));
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    const form = $('form', wrap);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      try { await onSubmit(Object.fromEntries(new FormData(form)), form); close(); } catch (err) { fail(err); } finally { btn.disabled = false; }
    };
    if (opts.onOpen) opts.onOpen(form);
    const first = $('input,select,textarea', form);
    if (first) first.focus();
    return form;
  }

  const field = (label, html, cls = '') => `<label class="field ${cls}"><span>${esc(label)}</span>${html}</label>`;
  const input = (name, value = '', attrs = '') => `<input name="${name}" value="${esc(value)}" ${attrs}>`;

  function branchSelect(name = 'branch_id', selected = '', withAll = false) {
    if (S.user.branch_id) return `<input type="hidden" name="${name}" value="${S.user.branch_id}">`;
    return `<select name="${name}" ${withAll ? '' : 'required'}>
      ${withAll ? `<option value="">${t('allBranches')}</option>` : ''}
      ${S.branches.map((b) => `<option value="${b.id}" ${String(selected) === String(b.id) ? 'selected' : ''}>${flag(b.code)} ${esc(bName(b))}</option>`).join('')}
    </select>`;
  }
  // Branch to use for creating documents
  const workingBranchId = () => S.user.branch_id || Number(S.branchFilter) || (S.branches[0] && S.branches[0].id);

  const statusBadge = (s) => `<span class="badge ${s}">${t({ paid: 'paidStatus', partial: 'partial', unpaid: 'unpaid', cancelled: 'cancelled', active: 'active' }[s] || s)}</span>`;

  // ---------- layout ----------
  function applyLang() {
    document.documentElement.lang = S.lang;
    document.documentElement.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
    document.title = t('appName');
  }

  function renderLogin() {
    applyLang();
    document.body.innerHTML = `
      <div class="login-page">
        <form class="login-card" id="loginForm">
          <img src="/img/quickplus.png" alt="" class="login-logo">
          <h1>${t('loginTitle')}</h1>
          <p class="muted">🇪🇬 ${t('egypt')} · 🇦🇪 ${t('uae')}</p>
          ${field(t('username'), input('username', '', 'required autocomplete="username"'))}
          ${field(t('password'), input('password', '', 'type="password" required autocomplete="current-password"'))}
          <button class="btn primary block">${t('login')}</button>
          <button type="button" class="btn link" id="langBtn">${t('language')}</button>
        </form>
      </div>`;
    $('#langBtn').onclick = () => { setLang(S.lang === 'ar' ? 'en' : 'ar'); renderLogin(); };
    $('#loginForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const d = Object.fromEntries(new FormData(e.target));
        const r = await api('/api/login', { method: 'POST', body: d });
        S.user = r.user;
        await boot();
      } catch (err) { fail(err); }
    };
  }

  function setLang(l) { S.lang = l; localStorage.setItem('lang', l); applyLang(); }

  function renderShell() {
    applyLang();
    const nav = [
      ['dashboard', '📊'], ['invoices', '🧾'], ['receipts', '💵'], ['customers', '👥'], ['services', '🏷️'],
      ...(isAdmin() ? [['users', '🔐'], ['settings', '⚙️']] : []), ['account', '👤'],
    ];
    document.body.innerHTML = `
      <div class="shell">
        <aside class="sidebar" id="sidebar">
          <div class="brand"><img src="/img/quickplus.png" alt=""></div>
          <nav>${nav.map(([k, i]) => `<a href="#/${k}" data-nav="${k}"><span>${i}</span>${t(k)}</a>`).join('')}</nav>
          <div class="side-foot muted">${esc(S.user.full_name)}<br><small>${S.user.branch_id ? esc(bName(branchById(S.user.branch_id))) : t('admin')}</small></div>
        </aside>
        <div class="main">
          <header class="topbar no-print">
            <button class="icon-btn menu-btn" id="menuBtn">☰</button>
            <div class="branch-switch">${S.user.branch_id
              ? `<span class="pill">${flag(branchById(S.user.branch_id)?.code)} ${esc(bName(branchById(S.user.branch_id)))}</span>`
              : `<select id="branchFilter"><option value="">🌐 ${t('allBranches')}</option>${S.branches.map((b) => `<option value="${b.id}" ${S.branchFilter == b.id ? 'selected' : ''}>${flag(b.code)} ${esc(bName(b))}</option>`).join('')}</select>`}
            </div>
            <div class="spacer"></div>
            <button class="btn small" id="langToggle">🌐 ${t('language')}</button>
            <button class="btn small" id="logoutBtn">${t('logout')}</button>
          </header>
          <main id="view"></main>
        </div>
      </div>`;
    $('#langToggle').onclick = () => { setLang(S.lang === 'ar' ? 'en' : 'ar'); renderShell(); route(); };
    $('#logoutBtn').onclick = async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); S.user = null; renderLogin(); };
    $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
    const bf = $('#branchFilter');
    if (bf) bf.onchange = () => { S.branchFilter = bf.value; localStorage.setItem('branchFilter', bf.value); route(); };
  }

  // ---------- router ----------
  async function route() {
    if (!S.user) return;
    const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
    const [pathPart, query] = hash.split('?');
    const parts = pathPart.split('/');
    const params = Object.fromEntries(new URLSearchParams(query || ''));
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === parts[0]));
    $('#sidebar')?.classList.remove('open');
    // Each navigation renders into a fresh container so slow, outdated pages can't overwrite the current one.
    const seq = (S.routeSeq = (S.routeSeq || 0) + 1);
    const view = document.createElement('div');
    view.innerHTML = '<div class="loading">…</div>';
    $('#view').replaceChildren(view);
    try {
      const [p, id, action] = parts;
      if (p === 'dashboard') await pageDashboard(view);
      else if (p === 'invoices' && id === 'new') await pageInvoiceForm(view, null, params);
      else if (p === 'invoices' && id && action === 'edit') await pageInvoiceForm(view, id);
      else if (p === 'invoices' && id) await pageInvoiceView(view, id);
      else if (p === 'invoices') await pageInvoices(view, params);
      else if (p === 'receipts' && id === 'new') await pageReceiptForm(view, params);
      else if (p === 'receipts' && id) await pageReceiptView(view, id);
      else if (p === 'receipts') await pageReceipts(view);
      else if (p === 'customers' && id) await pageStatement(view, id);
      else if (p === 'customers') await pageCustomers(view);
      else if (p === 'services') await pageServices(view);
      else if (p === 'users' && isAdmin()) await pageUsers(view);
      else if (p === 'settings' && isAdmin()) await pageSettings(view);
      else if (p === 'account') pageAccount(view);
      else location.hash = '#/dashboard';
    } catch (e) { if (seq === S.routeSeq) view.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
  }
  window.addEventListener('hashchange', route);

  // ---------- Dashboard ----------
  async function pageDashboard(view) {
    const data = await api(`/api/dashboard?${qs({ branch_id: S.branchFilter })}`);
    view.innerHTML = `
      <div class="page-head"><h2>${t('dashboard')}</h2>
        <div class="actions"><a class="btn primary" href="#/invoices/new">+ ${t('newInvoice')}</a><a class="btn accent" href="#/receipts/new">+ ${t('newReceipt')}</a></div></div>
      ${data.map((d) => {
        const max = Math.max(1, ...d.monthly.map((m) => m.total));
        return `
        <section class="card branch-card">
          <h3>${flag(d.branch.code)} ${esc(bName(d.branch))} <small class="muted">${esc(d.branch.currency)}</small></h3>
          <div class="stats">
            <div class="stat"><span>${t('collected')} – ${t('today')}</span><b>${money(d.receipts.today_total)}</b></div>
            <div class="stat"><span>${t('collected')} – ${t('thisMonth')}</span><b>${money(d.receipts.month_total)}</b><small>${d.receipts.month_count} ${t('receipts')}</small></div>
            <div class="stat"><span>${t('invoiced')} – ${t('thisMonth')}</span><b>${money(d.invoices.month_total)}</b><small>${d.invoices.month_count} ${t('invoices')}</small></div>
            <div class="stat warn"><span>${t('outstanding')}</span><b>${money(d.outstanding)}</b></div>
            <div class="stat"><span>${t('customersCount')}</span><b>${d.customers}</b></div>
          </div>
          <div class="grid2">
            <div><h4>${t('last6Months')}</h4>
              ${d.monthly.length ? `<div class="bars">${d.monthly.map((m) => `<div class="bar-row"><span>${m.m}</span><div class="bar"><i style="width:${(m.total / max) * 100}%"></i></div><b>${money(m.total)}</b></div>`).join('')}</div>` : `<p class="muted">${t('noData')}</p>`}
            </div>
            <div><h4>${t('recentReceipts')}</h4>
              ${d.recent.length ? `<table class="tbl compact"><tbody>${d.recent.map((r) => `<tr class="click" data-href="#/receipts/${r.id}"><td>${esc(r.number)}</td><td>${esc(r.customer_name)}</td><td class="num">${money(r.amount)}</td></tr>`).join('')}</tbody></table>` : `<p class="muted">${t('noData')}</p>`}
            </div>
          </div>
        </section>`;
      }).join('')}`;
    bindRowLinks(view);
  }

  const bindRowLinks = (root) => $$('[data-href]', root).forEach((tr) => (tr.onclick = (e) => { if (!e.target.closest('button,a')) location.hash = tr.dataset.href; }));

  function filterBar(id, extra = '') {
    return `<form class="filters card" id="${id}">
      <input name="q" placeholder="${t('search')}">
      ${field(t('from'), '<input type="date" name="from">', 'inline')}
      ${field(t('to'), '<input type="date" name="to">', 'inline')}
      ${extra}
      <button class="btn">${t('filter')}</button>
      <button type="button" class="btn" data-export>⬇ ${t('export')}</button>
    </form>`;
  }

  // ---------- Invoices ----------
  async function pageInvoices(view, params = {}) {
    view.innerHTML = `
      <div class="page-head"><h2>${t('invoices')}</h2><div class="actions"><a class="btn primary" href="#/invoices/new">+ ${t('newInvoice')}</a></div></div>
      ${filterBar('invFilter', `<select name="status"><option value="">${t('status')}: ${t('all')}</option>
        ${['unpaid', 'partial', 'paid', 'cancelled'].map((s) => `<option value="${s}" ${params.status === s ? 'selected' : ''}>${t(s === 'paid' ? 'paidStatus' : s)}</option>`).join('')}</select>`)}
      <div class="card"><div id="invList" class="table-wrap"></div></div>`;
    const form = $('#invFilter');
    const load = async () => {
      const f = Object.fromEntries(new FormData(form));
      const rows = await api(`/api/invoices?${qs({ ...f, branch_id: S.branchFilter })}`);
      const totals = {};
      rows.filter((r) => r.status === 'active').forEach((r) => {
        const x = (totals[r.currency] ||= { total: 0, paid: 0, balance: 0 });
        x.total += r.total; x.paid += r.paid; x.balance += r.balance;
      });
      $('#invList').innerHTML = rows.length ? `<table class="tbl">
        <thead><tr><th>${t('number')}</th><th>${t('branch')}</th><th>${t('date')}</th><th>${t('customer')}</th><th class="num">${t('total')}</th><th class="num">${t('paid')}</th><th class="num">${t('balance')}</th><th>${t('status')}</th></tr></thead>
        <tbody>${rows.map((r) => `<tr class="click" data-href="#/invoices/${r.id}"><td><b>${esc(r.number)}</b></td><td>${flag(r.branch_code)}</td><td>${esc(r.date)}</td>
          <td>${esc(r.customer_name)}<br><small class="muted">${esc(r.customer_phone)}</small></td>
          <td class="num">${money(r.total)} <small>${r.currency}</small></td><td class="num">${money(r.paid)}</td><td class="num">${money(r.balance)}</td><td>${statusBadge(r.payment_status)}</td></tr>`).join('')}</tbody>
        <tfoot>${Object.entries(totals).map(([c, x]) => `<tr><td colspan="4">${t('total')} (${c})</td><td class="num">${money(x.total)}</td><td class="num">${money(x.paid)}</td><td class="num">${money(x.balance)}</td><td></td></tr>`).join('')}</tfoot>
      </table>` : `<p class="muted empty">${t('noData')}</p>`;
      bindRowLinks($('#invList'));
    };
    form.onsubmit = (e) => { e.preventDefault(); load().catch(fail); };
    $('[data-export]', form).onclick = () => { const f = Object.fromEntries(new FormData(form)); location.href = `/api/export/invoices?${qs({ from: f.from, to: f.to, branch_id: S.branchFilter })}`; };
    await load();
  }

  async function quickCustomer(branchId) {
    return new Promise((resolve) => {
      modal(t('newCustomer'), customerFields({}, branchId), async (d) => {
        const c = await api('/api/customers', { method: 'POST', body: d });
        toast(t('saved'));
        resolve(c);
      });
    });
  }

  async function pageInvoiceForm(view, id, params = {}) {
    const inv = id ? await api(`/api/invoices/${id}`) : null;
    let branchId = inv ? inv.branch_id : Number(params.branch) || workingBranchId();
    view.innerHTML = `
      <div class="page-head"><h2>${inv ? `${t('edit')} ${esc(inv.number)}` : t('newInvoice')}</h2></div>
      <form id="invForm" class="card">
        <div class="form-grid">
          ${inv || S.user.branch_id ? `<input type="hidden" name="branch_id" value="${branchId}">${field(t('branch'), `<div class="pill">${flag(branchById(branchId)?.code)} ${esc(bName(branchById(branchId)))}</div>`)}` : field(t('branch'), branchSelect('branch_id', branchId))}
          ${field(t('customer'), `<div class="row"><select name="customer_id" required></select><button type="button" class="btn small" id="addCust">${t('newCustomerQuick')}</button></div>`, 'span2')}
          ${field(t('date'), input('date', inv ? inv.date : today(), 'type="date" required'))}
          ${field(t('dueDate'), input('due_date', inv?.due_date || '', 'type="date"'))}
          ${field(t('ticket'), input('ticket', inv?.ticket || ''))}
        </div>
        <h4>${t('items')}</h4>
        <div class="table-wrap"><table class="tbl items">
          <thead><tr><th style="width:45%">${t('description')}</th><th>${t('qty')}</th><th>${t('unitPrice')}</th><th class="num">${t('amount')}</th><th></th></tr></thead>
          <tbody id="items"></tbody></table></div>
        <div class="row"><button type="button" class="btn small" id="addItem">+ ${t('addItem')}</button><select id="svcPick" class="small"></select></div>
        <div class="totals-box">
          <div><span>${t('subtotal')}</span><b id="tSub">0.00</b></div>
          <div><span>${t('discount')}</span><input name="discount" type="number" step="0.01" min="0" value="${inv?.discount || 0}"></div>
          <div><span>${t('vatRate')}</span><input name="vat_rate" type="number" step="0.01" min="0" value="${inv ? inv.vat_rate : branchById(branchId)?.vat_rate ?? 0}"></div>
          <div><span>${t('vat')}</span><b id="tVat">0.00</b></div>
          <div class="grand"><span>${t('grandTotal')}</span><b id="tTot">0.00</b> <small id="tCur"></small></div>
        </div>
        ${field(t('notes'), `<textarea name="notes" rows="2">${esc(inv?.notes || '')}</textarea>`)}
        <div class="actions"><button class="btn primary">${t('save')}</button><a class="btn" href="${inv ? `#/invoices/${inv.id}` : '#/invoices'}">${t('cancel')}</a></div>
      </form>`;
    const form = $('#invForm');
    const tbody = $('#items');
    const addRow = (it = { description: '', qty: 1, unit_price: 0 }) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><input data-k="description" value="${esc(it.description)}" required></td>
        <td><input data-k="qty" type="number" step="0.01" min="0" value="${it.qty}"></td>
        <td><input data-k="unit_price" type="number" step="0.01" value="${it.unit_price}"></td>
        <td class="num" data-amount>0.00</td><td><button type="button" class="icon-btn" data-del>✕</button></td>`;
      $('[data-del]', tr).onclick = () => { tr.remove(); if (!tbody.children.length) addRow(); recalc(); };
      tbody.appendChild(tr);
      recalc();
    };
    const items = () => $$('tr', tbody).map((tr) => ({
      description: $('[data-k=description]', tr).value, qty: Number($('[data-k=qty]', tr).value) || 0, unit_price: Number($('[data-k=unit_price]', tr).value) || 0,
    }));
    const r2 = (n) => Math.round(n * 100) / 100;
    function recalc() {
      let sub = 0;
      $$('tr', tbody).forEach((tr, i) => { const it = items()[i]; const a = r2(it.qty * it.unit_price); sub += a; $('[data-amount]', tr).textContent = money(a); });
      sub = r2(sub);
      const disc = Math.min(Number(form.discount.value) || 0, sub);
      const vat = r2(((sub - disc) * (Number(form.vat_rate.value) || 0)) / 100);
      $('#tSub').textContent = money(sub); $('#tVat').textContent = money(vat); $('#tTot').textContent = money(sub - disc + vat);
      $('#tCur').textContent = branchById(form.branch_id.value)?.currency || '';
    }
    form.addEventListener('input', recalc);

    async function loadBranchData(selectedCustomer) {
      const bid = form.branch_id.value;
      const [customers, services] = await Promise.all([api(`/api/customers?branch_id=${bid}`), api(`/api/services?branch_id=${bid}`)]);
      form.customer_id.innerHTML = `<option value="">${t('chooseCustomer')}</option>` + customers.map((c) => `<option value="${c.id}" ${String(selectedCustomer) === String(c.id) ? 'selected' : ''}>${esc(c.name)}${c.phone ? ` – ${esc(c.phone)}` : ''}</option>`).join('');
      $('#svcPick').innerHTML = `<option value="">${t('chooseService')}</option>` + services.filter((s) => s.active).map((s) => `<option value="${s.id}" data-name="${esc(S.lang === 'ar' && s.name_ar ? s.name_ar : s.name_en)}" data-price="${s.price}">${esc(S.lang === 'ar' && s.name_ar ? s.name_ar : s.name_en)} (${money(s.price)})</option>`).join('');
      $('#svcPick').hidden = !services.length;
      recalc();
    }
    if (form.branch_id.tagName === 'SELECT') form.branch_id.onchange = () => { form.vat_rate.value = branchById(form.branch_id.value)?.vat_rate ?? 0; loadBranchData(); };
    $('#svcPick').onchange = (e) => {
      const o = e.target.selectedOptions[0];
      if (!o || !o.value) return;
      const rows = items();
      if (rows.length === 1 && !rows[0].description) tbody.innerHTML = '';
      addRow({ description: o.dataset.name, qty: 1, unit_price: Number(o.dataset.price) });
      e.target.value = '';
    };
    $('#addItem').onclick = () => addRow();
    $('#addCust').onclick = async () => { const c = await quickCustomer(form.branch_id.value); await loadBranchData(c.id); };

    (inv ? inv.items : [undefined]).forEach((it) => addRow(it));
    await loadBranchData(inv?.customer_id || params.customer);

    form.onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(form));
      d.items = items();
      try {
        const saved = await api(inv ? `/api/invoices/${inv.id}` : '/api/invoices', { method: inv ? 'PUT' : 'POST', body: d });
        toast(t('saved'));
        location.hash = `#/invoices/${saved.id}`;
      } catch (err) { fail(err); }
    };
  }

  // ---------- Receipts ----------
  async function pageReceipts(view) {
    view.innerHTML = `
      <div class="page-head"><h2>${t('receipts')}</h2><div class="actions"><a class="btn accent" href="#/receipts/new">+ ${t('newReceipt')}</a></div></div>
      ${filterBar('rcFilter')}
      <div class="card"><div id="rcList" class="table-wrap"></div></div>`;
    const form = $('#rcFilter');
    const load = async () => {
      const f = Object.fromEntries(new FormData(form));
      const rows = await api(`/api/receipts?${qs({ ...f, branch_id: S.branchFilter })}`);
      const totals = {};
      rows.filter((r) => r.status === 'active').forEach((r) => { totals[r.currency] = (totals[r.currency] || 0) + r.amount; });
      $('#rcList').innerHTML = rows.length ? `<table class="tbl">
        <thead><tr><th>${t('number')}</th><th>${t('branch')}</th><th>${t('date')}</th><th>${t('customer')}</th><th>${t('description')}</th><th>${t('invoice')}</th><th class="num">${t('amount')}</th><th>${t('user')}</th></tr></thead>
        <tbody>${rows.map((r) => `<tr class="click ${r.status === 'cancelled' ? 'strike' : ''}" data-href="#/receipts/${r.id}"><td><b>${esc(r.number)}</b></td><td>${flag(r.branch_code)}</td><td>${esc(r.date)}</td>
          <td>${esc(r.customer_name)}<br><small class="muted">${esc(r.customer_phone)}</small></td><td>${esc(r.description)}</td><td>${esc(r.invoice_number || '')}</td>
          <td class="num">${money(r.amount)} <small>${r.currency}</small></td><td>${esc(r.user_name)}</td></tr>`).join('')}</tbody>
        <tfoot>${Object.entries(totals).map(([c, x]) => `<tr><td colspan="6">${t('total')} (${c})</td><td class="num">${money(x)}</td><td></td></tr>`).join('')}</tfoot>
      </table>` : `<p class="muted empty">${t('noData')}</p>`;
      bindRowLinks($('#rcList'));
    };
    form.onsubmit = (e) => { e.preventDefault(); load().catch(fail); };
    $('[data-export]', form).onclick = () => { const f = Object.fromEntries(new FormData(form)); location.href = `/api/export/receipts?${qs({ from: f.from, to: f.to, branch_id: S.branchFilter })}`; };
    await load();
  }

  async function pageReceiptForm(view, params = {}) {
    let invoice = params.invoice ? await api(`/api/invoices/${params.invoice}`) : null;
    const branchId = invoice ? invoice.branch_id : workingBranchId();
    view.innerHTML = `
      <div class="page-head"><h2>${t('newReceipt')}</h2></div>
      <form id="rcForm" class="card">
        <div class="form-grid">
          ${invoice || S.user.branch_id ? `<input type="hidden" name="branch_id" value="${branchId}">${field(t('branch'), `<div class="pill">${flag(branchById(branchId)?.code)} ${esc(bName(branchById(branchId)))}</div>`)}` : field(t('branch'), branchSelect('branch_id', branchId))}
          ${field(t('customer'), `<div class="row"><select name="customer_id" required></select><button type="button" class="btn small" id="addCust">${t('newCustomerQuick')}</button></div>`, 'span2')}
          ${field(t('linkedInvoice'), '<select name="invoice_id"></select>', 'span2')}
          ${field(t('date'), input('date', today(), 'type="date" required'))}
          ${field(t('description'), input('description', '', 'required placeholder="e.g. Anc 1 visa PARTIAL PAYMENT"'), 'span2')}
          ${field(t('amount'), `<div class="row">${input('amount', '', 'type="number" step="0.01" min="0.01" required')}<b id="cur"></b></div>`)}
          ${field(t('method'), `<select name="method">${['cash', 'card', 'transfer', 'cheque'].map((m) => `<option value="${m}">${t(m)}</option>`).join('')}</select>`)}
          ${field(t('ticket'), input('ticket'))}
          <label class="field check"><input type="checkbox" name="non_refundable" checked> <span>${t('nonRefundable')}</span></label>
        </div>
        ${field(t('notes'), '<textarea name="notes" rows="2"></textarea>')}
        <p id="invHint" class="muted"></p>
        <div class="actions"><button class="btn accent">${t('save')}</button><a class="btn" href="#/receipts">${t('cancel')}</a></div>
      </form>`;
    const form = $('#rcForm');
    let openInvoices = [];
    async function loadCustomers(selected) {
      const bid = form.branch_id.value;
      $('#cur').textContent = branchById(bid)?.currency || '';
      const customers = await api(`/api/customers?branch_id=${bid}`);
      form.customer_id.innerHTML = `<option value="">${t('chooseCustomer')}</option>` + customers.map((c) => `<option value="${c.id}" ${String(selected) === String(c.id) ? 'selected' : ''}>${esc(c.name)}${c.phone ? ` – ${esc(c.phone)}` : ''}</option>`).join('');
      await loadInvoices();
    }
    async function loadInvoices() {
      const cid = form.customer_id.value;
      openInvoices = cid ? (await api(`/api/invoices?${qs({ branch_id: form.branch_id.value, customer_id: cid })}`)).filter((i) => i.status === 'active' && i.balance > 0) : [];
      form.invoice_id.innerHTML = `<option value="">${t('none')}</option>` + openInvoices.map((i) => `<option value="${i.id}" ${invoice && invoice.id === i.id ? 'selected' : ''}>${esc(i.number)} – ${t('balance')}: ${money(i.balance)}</option>`).join('');
      onInvoice();
    }
    function onInvoice() {
      const inv = openInvoices.find((i) => String(i.id) === form.invoice_id.value);
      $('#invHint').textContent = inv ? `${t('total')}: ${money(inv.total)} · ${t('paid')}: ${money(inv.paid)} · ${t('balance')}: ${money(inv.balance)} ${inv.currency}` : '';
      if (inv) {
        form.amount.max = inv.balance;
        if (!form.amount.value) form.amount.value = inv.balance;
        if (!form.description.value) form.description.value = `Payment for invoice ${inv.number}`;
      } else form.amount.removeAttribute('max');
    }
    if (form.branch_id.tagName === 'SELECT') form.branch_id.onchange = () => loadCustomers();
    form.customer_id.onchange = loadInvoices;
    form.invoice_id.onchange = onInvoice;
    $('#addCust').onclick = async () => { const c = await quickCustomer(form.branch_id.value); await loadCustomers(c.id); };
    await loadCustomers(invoice ? invoice.customer_id : params.customer);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(form));
      d.non_refundable = form.non_refundable.checked;
      try {
        const r = await api('/api/receipts', { method: 'POST', body: d });
        toast(t('saved'));
        location.hash = `#/receipts/${r.id}`;
      } catch (err) { fail(err); }
    };
  }

  // ---------- Printable documents ----------
  // L(en, ar) -> label according to chosen print language
  const L = (en, ar) => (S.printLang === 'en' ? esc(en) : S.printLang === 'ar' ? `<span dir="rtl">${esc(ar)}</span>` : `${esc(en)} <span class="ar" dir="rtl">${esc(ar)}</span>`);
  const LBL = {
    receipt: ['Payment Receipt', 'إيصال استلام نقدية'], invoice: ['Tax Invoice', 'فاتورة ضريبية'], invoiceNoVat: ['Invoice', 'فاتورة'],
    clientName: ['Client Name', 'اسم العميل'], clientPhone: ['Client Phone', 'هاتف العميل'], clientTax: ['Client TRN', 'الرقم الضريبي للعميل'],
    receiptNo: ['Receipt Number', 'رقم الإيصال'], invoiceNo: ['Invoice Number', 'رقم الفاتورة'],
    branch: ['Branch', 'الفرع'], ticket: ['Ticket', 'التذكرة'], user: ['User', 'المستخدم'], date: ['Date', 'التاريخ'], due: ['Due Date', 'الاستحقاق'],
    desc: ['Description', 'البيان'], amount: ['Amount', 'المبلغ'], qty: ['Qty', 'الكمية'], price: ['Unit Price', 'سعر الوحدة'],
    total: ['Total', 'الإجمالي'], subtotal: ['Subtotal', 'المجموع'], discount: ['Discount', 'الخصم'], vat: ['VAT', 'الضريبة'],
    paid: ['Paid', 'المدفوع'], balance: ['Balance Due', 'المتبقي'], method: ['Payment Method', 'طريقة الدفع'], invoiceRef: ['Invoice', 'الفاتورة'],
    signature: ['Signature', 'التوقيع'], approved: ['Approved By', 'اعتمده'], notes: ['Notes', 'ملاحظات'], trn: ['TRN', 'الرقم الضريبي'],
    cancelled: ['CANCELLED', 'ملغي'],
  };
  const methodLbl = { cash: ['Cash', 'نقدي'], card: ['Card', 'بطاقة'], transfer: ['Bank Transfer', 'تحويل بنكي'], cheque: ['Cheque', 'شيك'] };
  const docBranchName = (b) => (S.printLang === 'ar' ? b.name_ar : S.printLang === 'en' ? b.name_en : `${b.name_en} / ${b.name_ar}`);

  function docHeader(branch, title, number) {
    return `
      <div class="doc-barcode">${code128svg(number, 42, 1.3)}<div class="doc-title">${L(...title)}</div></div>
      <div class="doc-logos">${branch.logos.map((u) => `<img src="${esc(u)}" alt="">`).join('')}</div>
      <div class="doc-company">${esc(branch.company_en)}${branch.company_ar ? ` &nbsp;|&nbsp; <span dir="rtl">${esc(branch.company_ar)}</span>` : ''}
        ${branch.address_en || branch.phone ? `<br><small>${esc([branch.address_en, branch.phone, branch.email].filter(Boolean).join(' · '))}</small>` : ''}
        ${branch.tax_number ? `<br><small>${L(...LBL.trn)}: ${esc(branch.tax_number)}</small>` : ''}</div>`;
  }
  const kv = (lbl, val) => `<tr><th>${L(...lbl)}</th><td>:</td><td>${esc(val)}</td></tr>`;
  function docFooter() {
    return `<div class="doc-footer">
      <div class="sig-line"><span>${L(...LBL.signature)} :</span><span>${L(...LBL.approved)} :</span></div>
      <div class="page-no">Page 1 of 1</div></div>`;
  }
  function printToolbar(backHref, extra = '') {
    return `<div class="doc-toolbar no-print">
      <a class="btn" href="${backHref}">← ${t('back')}</a>
      <label class="inline-field">${t('printLang')}: <select id="printLang">
        <option value="both" ${S.printLang === 'both' ? 'selected' : ''}>${t('bilingual')}</option>
        <option value="ar" ${S.printLang === 'ar' ? 'selected' : ''}>${t('arabic')}</option>
        <option value="en" ${S.printLang === 'en' ? 'selected' : ''}>${t('english')}</option></select></label>
      <button class="btn primary" id="printBtn">🖨 ${t('print')}</button>${extra}</div>`;
  }
  function bindPrint(rerender) {
    $('#printBtn').onclick = () => window.print();
    $('#printLang').onchange = (e) => { S.printLang = e.target.value; localStorage.setItem('printLang', S.printLang); rerender(); };
  }

  async function pageReceiptView(view, id) {
    const r = await api(`/api/receipts/${id}`);
    const render = () => {
      const b = r.branch;
      view.innerHTML = `
        ${printToolbar('#/receipts', r.status === 'active' ? `<button class="btn danger" id="cancelBtn">${t('cancelDoc')}</button>` : '')}
        <div class="doc a4" dir="${S.printLang === 'ar' ? 'rtl' : 'ltr'}">
          ${r.status === 'cancelled' ? `<div class="stamp">${L(...LBL.cancelled)}</div>` : ''}
          ${docHeader(b, LBL.receipt, r.number)}
          <div class="doc-meta">
            <table class="kv">${kv(LBL.clientName, r.customer.name)}${kv(LBL.clientPhone, r.customer.phone)}${r.customer.tax_number ? kv(LBL.clientTax, r.customer.tax_number) : ''}</table>
            <div class="doc-number"><div>${L(...LBL.receiptNo)}</div><b>${esc(r.number)}</b></div>
            <table class="kv">${kv(LBL.branch, docBranchName(b))}${kv(LBL.ticket, r.ticket || '/')}${kv(LBL.user, r.user_name)}${kv(LBL.date, r.date)}</table>
          </div>
          <table class="doc-table">
            <thead><tr><th style="width:40px">#</th><th>${L(...LBL.desc)}</th><th style="width:150px">${L(...LBL.amount)}</th></tr></thead>
            <tbody><tr><td>1</td><td>${esc(r.description)}</td><td>${money(r.amount)}</td></tr></tbody>
            <tfoot><tr><td></td><td>${L(...LBL.total)}</td><td>${money(r.amount)} ${esc(r.currency)}</td></tr></tfoot>
          </table>
          <table class="kv small-kv">
            ${kv(LBL.method, S.printLang === 'ar' ? methodLbl[r.method][1] : S.printLang === 'en' ? methodLbl[r.method][0] : methodLbl[r.method].join(' / '))}
            ${r.invoice ? kv(LBL.invoiceRef, `${r.invoice.number} — ${LBL.total[0]}: ${money(r.invoice.total)} · ${LBL.balance[0]}: ${money(r.invoice.balance)}`) : ''}
            ${r.notes ? kv(LBL.notes, r.notes) : ''}
          </table>
          ${r.non_refundable ? `<div class="doc-note">${S.printLang !== 'ar' ? `<b>${esc(b.footer_en)}</b>` : ''}${S.printLang !== 'en' ? `<b dir="rtl">${esc(b.footer_ar)}</b>` : ''}</div>` : ''}
          ${docFooter()}
        </div>`;
      bindPrint(render);
      const cb = $('#cancelBtn');
      if (cb) cb.onclick = async () => { if (!confirm(t('confirmCancel'))) return; try { Object.assign(r, await api(`/api/receipts/${r.id}/cancel`, { method: 'POST' })); render(); } catch (e) { fail(e); } };
    };
    render();
  }

  async function pageInvoiceView(view, id) {
    const inv = await api(`/api/invoices/${id}`);
    const render = () => {
      const b = inv.branch;
      const active = inv.status === 'active';
      view.innerHTML = `
        ${printToolbar('#/invoices', `
          ${active && inv.balance > 0 ? `<a class="btn accent" href="#/receipts/new?invoice=${inv.id}">+ ${t('addPayment')}</a>` : ''}
          ${active ? `<a class="btn" href="#/invoices/${inv.id}/edit">${t('edit')}</a><button class="btn danger" id="cancelBtn">${t('cancelDoc')}</button>` : ''}`)}
        <div class="doc a4" dir="${S.printLang === 'ar' ? 'rtl' : 'ltr'}">
          ${!active ? `<div class="stamp">${L(...LBL.cancelled)}</div>` : ''}
          ${docHeader(b, inv.vat_rate > 0 ? LBL.invoice : LBL.invoiceNoVat, inv.number)}
          <div class="doc-meta">
            <table class="kv">${kv(LBL.clientName, inv.customer.name)}${kv(LBL.clientPhone, inv.customer.phone)}${inv.customer.tax_number ? kv(LBL.clientTax, inv.customer.tax_number) : ''}</table>
            <div class="doc-number"><div>${L(...LBL.invoiceNo)}</div><b>${esc(inv.number)}</b></div>
            <table class="kv">${kv(LBL.branch, docBranchName(b))}${kv(LBL.ticket, inv.ticket || '/')}${kv(LBL.user, inv.user_name)}${kv(LBL.date, inv.date)}${inv.due_date ? kv(LBL.due, inv.due_date) : ''}</table>
          </div>
          <table class="doc-table">
            <thead><tr><th style="width:40px">#</th><th>${L(...LBL.desc)}</th><th style="width:70px">${L(...LBL.qty)}</th><th style="width:110px">${L(...LBL.price)}</th><th style="width:130px">${L(...LBL.amount)}</th></tr></thead>
            <tbody>${inv.items.map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.description)}</td><td>${it.qty}</td><td>${money(it.unit_price)}</td><td>${money(it.amount)}</td></tr>`).join('')}</tbody>
          </table>
          <table class="doc-totals">
            <tr><th>${L(...LBL.subtotal)}</th><td>${money(inv.subtotal)}</td></tr>
            ${inv.discount ? `<tr><th>${L(...LBL.discount)}</th><td>- ${money(inv.discount)}</td></tr>` : ''}
            ${inv.vat_rate ? `<tr><th>${L(...LBL.vat)} (${inv.vat_rate}%)</th><td>${money(inv.vat_amount)}</td></tr>` : ''}
            <tr class="grand"><th>${L(...LBL.total)}</th><td>${money(inv.total)} ${esc(inv.currency)}</td></tr>
            <tr><th>${L(...LBL.paid)}</th><td>${money(inv.paid)}</td></tr>
            <tr class="grand"><th>${L(...LBL.balance)}</th><td>${money(inv.balance)} ${esc(inv.currency)}</td></tr>
          </table>
          ${inv.notes ? `<p class="doc-notes"><b>${L(...LBL.notes)}:</b> ${esc(inv.notes)}</p>` : ''}
          ${docFooter()}
        </div>
        <div class="card no-print"><h3>${t('payments')}</h3>
          ${inv.receipts.length ? `<table class="tbl"><thead><tr><th>${t('number')}</th><th>${t('date')}</th><th>${t('description')}</th><th class="num">${t('amount')}</th><th>${t('user')}</th></tr></thead>
          <tbody>${inv.receipts.map((r) => `<tr class="click ${r.status === 'cancelled' ? 'strike' : ''}" data-href="#/receipts/${r.id}"><td>${esc(r.number)}</td><td>${esc(r.date)}</td><td>${esc(r.description)}</td><td class="num">${money(r.amount)}</td><td>${esc(r.user_name)}</td></tr>`).join('')}</tbody></table>`
          : `<p class="muted">${t('noData')}</p>`}</div>`;
      bindPrint(render);
      bindRowLinks(view);
      const cb = $('#cancelBtn');
      if (cb) cb.onclick = async () => { if (!confirm(t('confirmCancel'))) return; try { Object.assign(inv, await api(`/api/invoices/${inv.id}/cancel`, { method: 'POST' })); render(); } catch (e) { fail(e); } };
    };
    render();
  }

  // ---------- Customers ----------
  function customerFields(c = {}, branchId) {
    return `<div class="form-grid">
      ${c.id ? '' : (S.user.branch_id || branchId ? `<input type="hidden" name="branch_id" value="${branchId || S.user.branch_id}">` : field(t('branch'), branchSelect('branch_id', workingBranchId())))}
      ${field(t('fullName'), input('name', c.name, 'required'), 'span2')}
      ${field(t('phone'), input('phone', c.phone))}
      ${field(t('email'), input('email', c.email, 'type="email"'))}
      ${field(t('taxNumber'), input('tax_number', c.tax_number))}
      ${field(t('address'), input('address', c.address), 'span2')}
      ${field(t('notes'), `<textarea name="notes" rows="2">${esc(c.notes || '')}</textarea>`, 'span2')}
    </div>`;
  }

  async function pageCustomers(view) {
    view.innerHTML = `
      <div class="page-head"><h2>${t('customers')}</h2><div class="actions"><button class="btn primary" id="newCust">+ ${t('newCustomer')}</button></div></div>
      <div class="card filters"><input id="custQ" placeholder="${t('search')}"></div>
      <div class="card"><div id="custList" class="table-wrap"></div></div>`;
    const load = async () => {
      const rows = await api(`/api/customers?${qs({ branch_id: S.branchFilter, q: $('#custQ').value })}`);
      $('#custList').innerHTML = rows.length ? `<table class="tbl">
        <thead><tr><th>${t('fullName')}</th><th>${t('branch')}</th><th>${t('phone')}</th><th>${t('email')}</th><th class="num">${t('invoiced')}</th><th class="num">${t('paid')}</th><th>${t('actions')}</th></tr></thead>
        <tbody>${rows.map((c) => `<tr class="click" data-href="#/customers/${c.id}"><td><b>${esc(c.name)}</b></td><td>${flag(c.branch_code)}</td><td>${esc(c.phone)}</td><td>${esc(c.email)}</td>
          <td class="num">${money(c.invoiced)}</td><td class="num">${money(c.paid)}</td>
          <td class="nowrap"><button class="btn small" data-edit="${c.id}">${t('edit')}</button> <button class="btn small danger" data-del="${c.id}">${t('delete')}</button></td></tr>`).join('')}</tbody></table>`
        : `<p class="muted empty">${t('noData')}</p>`;
      bindRowLinks($('#custList'));
      $$('[data-edit]').forEach((b) => (b.onclick = () => {
        const c = rows.find((x) => x.id === Number(b.dataset.edit));
        modal(t('edit'), customerFields(c), async (d) => { await api(`/api/customers/${c.id}`, { method: 'PUT', body: d }); toast(t('saved')); load(); });
      }));
      $$('[data-del]').forEach((b) => (b.onclick = async () => {
        if (!confirm(t('confirmDelete'))) return;
        try { await api(`/api/customers/${b.dataset.del}`, { method: 'DELETE' }); load(); } catch (e) { fail(e); }
      }));
    };
    let timer;
    $('#custQ').oninput = () => { clearTimeout(timer); timer = setTimeout(() => load().catch(fail), 250); };
    $('#newCust').onclick = () => modal(t('newCustomer'), customerFields({}), async (d) => { await api('/api/customers', { method: 'POST', body: d }); toast(t('saved')); load(); });
    await load();
  }

  async function pageStatement(view, id) {
    const all = await api(`/api/customers?${qs({ branch_id: S.branchFilter })}`);
    let c = all.find((x) => x.id === Number(id));
    if (!c) {
      // customer might be outside the current filter
      c = (await api('/api/customers')).find((x) => x.id === Number(id));
    }
    if (!c) throw new Error('Not found');
    const [invs, rcs] = await Promise.all([
      api(`/api/invoices?${qs({ branch_id: c.branch_id, customer_id: c.id })}`),
      api(`/api/receipts?${qs({ branch_id: c.branch_id })}`).then((r) => r.filter((x) => x.customer_id === c.id)),
    ]);
    const lines = [
      ...invs.filter((i) => i.status === 'active').map((i) => ({ date: i.date, ref: i.number, desc: t('invoice'), debit: i.total, credit: 0, href: `#/invoices/${i.id}` })),
      ...rcs.filter((r) => r.status === 'active').map((r) => ({ date: r.date.slice(0, 10), ref: r.number, desc: r.description, debit: 0, credit: r.amount, href: `#/receipts/${r.id}` })),
    ].sort((a, b) => a.date.localeCompare(b.date));
    let bal = 0;
    const cur = branchById(c.branch_id)?.currency || '';
    view.innerHTML = `
      <div class="page-head"><h2>${t('statement')}: ${esc(c.name)}</h2>
        <div class="actions"><a class="btn primary" href="#/invoices/new?customer=${c.id}&branch=${c.branch_id}">+ ${t('newInvoice')}</a><a class="btn accent" href="#/receipts/new?customer=${c.id}">+ ${t('newReceipt')}</a><button class="btn" onclick="window.print()">🖨 ${t('print')}</button></div></div>
      <div class="card"><p>${flag(c.branch_code)} ${esc(bName(branchById(c.branch_id)))} · ${esc(c.phone)} ${c.email ? `· ${esc(c.email)}` : ''}</p>
      <div class="table-wrap">${lines.length ? `<table class="tbl"><thead><tr><th>${t('date')}</th><th>${t('number')}</th><th>${t('description')}</th><th class="num">${t('invoiced')}</th><th class="num">${t('paid')}</th><th class="num">${t('balance')}</th></tr></thead>
        <tbody>${lines.map((l) => { bal += l.debit - l.credit; return `<tr class="click" data-href="${l.href}"><td>${l.date}</td><td>${esc(l.ref)}</td><td>${esc(l.desc)}</td><td class="num">${l.debit ? money(l.debit) : ''}</td><td class="num">${l.credit ? money(l.credit) : ''}</td><td class="num">${money(bal)}</td></tr>`; }).join('')}</tbody>
        <tfoot><tr><td colspan="5">${t('balance')} (${cur})</td><td class="num">${money(bal)}</td></tr></tfoot></table>` : `<p class="muted">${t('noData')}</p>`}</div></div>`;
    bindRowLinks(view);
  }

  // ---------- Services ----------
  async function pageServices(view) {
    view.innerHTML = `
      <div class="page-head"><h2>${t('services')}</h2><div class="actions"><button class="btn primary" id="newSvc">+ ${t('newService')}</button></div></div>
      <div class="card"><div id="svcList" class="table-wrap"></div></div>`;
    const fields = (s = {}) => `<div class="form-grid">
      ${s.id ? '' : field(t('branch'), branchSelect('branch_id', workingBranchId()))}
      ${field(t('nameEn'), input('name_en', s.name_en, 'required'), 'span2')}
      ${field(t('nameAr'), input('name_ar', s.name_ar, 'dir="rtl"'), 'span2')}
      ${field(t('price'), input('price', s.price ?? 0, 'type="number" step="0.01" min="0"'))}
      ${s.id ? `<label class="field check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> <span>${t('active')}</span></label>` : ''}
    </div>`;
    const load = async () => {
      const rows = await api(`/api/services?${qs({ branch_id: S.branchFilter })}`);
      $('#svcList').innerHTML = rows.length ? `<table class="tbl"><thead><tr><th>${t('nameEn')}</th><th>${t('nameAr')}</th><th>${t('branch')}</th><th class="num">${t('price')}</th><th>${t('status')}</th><th>${t('actions')}</th></tr></thead>
        <tbody>${rows.map((s) => `<tr><td>${esc(s.name_en)}</td><td dir="rtl">${esc(s.name_ar)}</td><td>${flag(branchById(s.branch_id)?.code)}</td><td class="num">${money(s.price)} <small>${branchById(s.branch_id)?.currency || ''}</small></td>
          <td>${statusBadge(s.active ? 'active' : 'cancelled')}</td><td class="nowrap"><button class="btn small" data-edit="${s.id}">${t('edit')}</button> <button class="btn small danger" data-del="${s.id}">${t('delete')}</button></td></tr>`).join('')}</tbody></table>`
        : `<p class="muted empty">${t('noData')}</p>`;
      $$('[data-edit]').forEach((b) => (b.onclick = () => {
        const s = rows.find((x) => x.id === Number(b.dataset.edit));
        modal(t('edit'), fields(s), async (d, form) => { d.active = form.active.checked; await api(`/api/services/${s.id}`, { method: 'PUT', body: d }); toast(t('saved')); load(); });
      }));
      $$('[data-del]').forEach((b) => (b.onclick = async () => { if (!confirm(t('confirmDelete'))) return; await api(`/api/services/${b.dataset.del}`, { method: 'DELETE' }).catch(fail); load(); }));
    };
    $('#newSvc').onclick = () => modal(t('newService'), fields(), async (d) => { await api('/api/services', { method: 'POST', body: d }); toast(t('saved')); load(); });
    await load();
  }

  // ---------- Users ----------
  async function pageUsers(view) {
    view.innerHTML = `
      <div class="page-head"><h2>${t('users')}</h2><div class="actions"><button class="btn primary" id="newUser">+ ${t('newUser')}</button></div></div>
      <div class="card"><div id="userList" class="table-wrap"></div></div>`;
    const fields = (u = {}) => `<div class="form-grid">
      ${u.id ? '' : field(t('username'), input('username', '', 'required autocomplete="off"'))}
      ${field(t('fullName'), input('full_name', u.full_name, 'required'))}
      ${field(t('role'), `<select name="role"><option value="user" ${u.role !== 'admin' ? 'selected' : ''}>${t('branchUser')}</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>${t('admin')}</option></select>`)}
      ${field(t('branch'), `<select name="branch_id"><option value="">${t('allBranches')}</option>${S.branches.map((b) => `<option value="${b.id}" ${u.branch_id === b.id ? 'selected' : ''}>${flag(b.code)} ${esc(bName(b))}</option>`).join('')}</select>`)}
      ${field(u.id ? t('newPassword') : t('password'), input('password', '', `type="password" autocomplete="new-password" ${u.id ? '' : 'required minlength="6"'}`))}
      ${u.id ? `<label class="field check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> <span>${t('active')}</span></label>` : ''}
    </div>`;
    const load = async () => {
      const rows = await api('/api/users');
      $('#userList').innerHTML = `<table class="tbl"><thead><tr><th>${t('username')}</th><th>${t('fullName')}</th><th>${t('role')}</th><th>${t('branch')}</th><th>${t('status')}</th><th></th></tr></thead>
        <tbody>${rows.map((u) => `<tr><td><b>${esc(u.username)}</b></td><td>${esc(u.full_name)}</td><td>${u.role === 'admin' ? t('admin') : t('branchUser')}</td>
          <td>${u.branch_id ? `${flag(branchById(u.branch_id)?.code)} ${esc(bName(branchById(u.branch_id)))}` : t('allBranches')}</td><td>${statusBadge(u.active ? 'active' : 'cancelled')}</td>
          <td><button class="btn small" data-edit="${u.id}">${t('edit')}</button></td></tr>`).join('')}</tbody></table>`;
      $$('[data-edit]').forEach((b) => (b.onclick = () => {
        const u = rows.find((x) => x.id === Number(b.dataset.edit));
        modal(t('edit'), fields(u), async (d, form) => { d.active = form.active.checked; await api(`/api/users/${u.id}`, { method: 'PUT', body: d }); toast(t('saved')); load(); });
      }));
    };
    $('#newUser').onclick = () => modal(t('newUser'), fields(), async (d) => { await api('/api/users', { method: 'POST', body: d }); toast(t('saved')); load(); });
    await load();
  }

  // ---------- Branch settings ----------
  async function pageSettings(view) {
    S.branches = await api('/api/branches');
    view.innerHTML = `<div class="page-head"><h2>${t('settings')}</h2></div><p class="muted">${t('perBranchNote')}</p>
      ${S.branches.map((b) => `
        <form class="card branch-form" data-id="${b.id}">
          <h3>${flag(b.code)} ${esc(bName(b))}</h3>
          <div class="form-grid">
            ${field(t('branchNameEn'), input('name_en', b.name_en, 'required'))}
            ${field(t('branchNameAr'), input('name_ar', b.name_ar, 'dir="rtl"'))}
            ${field(t('companyEn'), input('company_en', b.company_en))}
            ${field(t('companyAr'), input('company_ar', b.company_ar, 'dir="rtl"'))}
            ${field(t('addressEn'), input('address_en', b.address_en))}
            ${field(t('addressAr'), input('address_ar', b.address_ar, 'dir="rtl"'))}
            ${field(t('phone'), input('phone', b.phone))}
            ${field(t('email'), input('email', b.email))}
            ${field(t('taxNumber'), input('tax_number', b.tax_number))}
            ${field(t('currency'), input('currency', b.currency, 'required'))}
            ${field(t('vatRate'), input('vat_rate', b.vat_rate, 'type="number" step="0.01" min="0"'))}
            ${field(t('invoicePrefix'), input('invoice_prefix', b.invoice_prefix, 'required'))}
            ${field(t('receiptPrefix'), input('receipt_prefix', b.receipt_prefix, 'required'))}
            ${field(t('footerEn'), input('footer_en', b.footer_en))}
            ${field(t('footerAr'), input('footer_ar', b.footer_ar, 'dir="rtl"'))}
          </div>
          <h4>${t('logos')}</h4>
          <div class="logos" data-logos>${b.logos.map((u) => `<div class="logo-item" data-url="${esc(u)}"><img src="${esc(u)}"><button type="button" class="icon-btn" data-rm>✕</button></div>`).join('')}</div>
          <label class="btn small">${t('uploadLogo')}<input type="file" accept="image/*" hidden data-upload></label>
          <div class="actions"><button class="btn primary">${t('save')}</button></div>
        </form>`).join('')}`;
    $$('.branch-form').forEach((form) => {
      const logosEl = $('[data-logos]', form);
      const bindRm = () => $$('[data-rm]', logosEl).forEach((b) => (b.onclick = () => b.parentElement.remove()));
      bindRm();
      $('[data-upload]', form).onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const rd = new FileReader();
        rd.onload = async () => {
          try {
            const { url } = await api('/api/uploads', { method: 'POST', body: { dataUrl: rd.result } });
            logosEl.insertAdjacentHTML('beforeend', `<div class="logo-item" data-url="${esc(url)}"><img src="${esc(url)}"><button type="button" class="icon-btn" data-rm>✕</button></div>`);
            bindRm();
          } catch (err) { fail(err); }
        };
        rd.readAsDataURL(file);
        e.target.value = '';
      };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(form));
        d.logos = $$('.logo-item', logosEl).map((x) => x.dataset.url);
        try { await api(`/api/branches/${form.dataset.id}`, { method: 'PUT', body: d }); S.branches = await api('/api/branches'); toast(t('saved')); } catch (err) { fail(err); }
      };
    });
  }

  // ---------- Account ----------
  function pageAccount(view) {
    view.innerHTML = `<div class="page-head"><h2>${t('account')}</h2></div>
      <form class="card narrow" id="pwForm">
        <p><b>${esc(S.user.full_name)}</b> (${esc(S.user.username)})</p>
        ${field(t('currentPassword'), input('current', '', 'type="password" required'))}
        ${field(t('newPassword').split('(')[0], input('password', '', 'type="password" required minlength="6"'))}
        <button class="btn primary">${t('changePassword')}</button>
      </form>`;
    $('#pwForm').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/api/me/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast(t('saved')); e.target.reset(); } catch (err) { fail(err); }
    };
  }

  // ---------- boot ----------
  async function boot() {
    try {
      if (!S.user) S.user = (await api('/api/me')).user;
      S.branches = await api('/api/branches');
      if (S.branchFilter && !branchById(S.branchFilter)) S.branchFilter = '';
      renderShell();
      route();
    } catch { renderLogin(); }
  }
  boot();
})();
