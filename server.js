// QuickPlus Invoices System - Egypt & UAE branches - Arabic / English
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { db, hashPassword, verifyPassword, nextNumber } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_DAYS = 7;
const UPLOAD_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ---------------- helpers ----------------
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const nowLocal = () => {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const wrap = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    res.status(e.status || 500).json({ error: e.message || 'Server error' });
  }
};
const parseCookies = (h = '') => Object.fromEntries(h.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const getBranch = (id) => {
  const b = db.prepare('SELECT * FROM branches WHERE id=?').get(id);
  if (!b) throw new HttpError(404, 'Branch not found');
  b.logos = JSON.parse(b.logos || '[]');
  return b;
};

// ---------------- auth ----------------
function auth(req, res, next) {
  const token = parseCookies(req.headers.cookie).sid;
  if (token) {
    const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
                            WHERE s.token=? AND s.expires_at>? AND u.active=1`).get(token, Date.now());
    if (row) { req.user = row; return next(); }
  }
  res.status(401).json({ error: 'Unauthorized' });
}
const adminOnly = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only' }));

// Branch scoping: a branch user is always locked to their own branch.
function branchScope(req, requested) {
  if (req.user.branch_id) return req.user.branch_id;
  return requested ? Number(requested) : null; // null = all branches
}
function assertBranchAccess(req, branchId) {
  if (req.user.branch_id && req.user.branch_id !== Number(branchId)) throw new HttpError(403, 'No access to this branch');
}
const publicUser = (u) => ({ id: u.id, username: u.username, full_name: u.full_name, role: u.role, branch_id: u.branch_id, active: u.active });

app.post('/api/login', wrap((req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(username || '').trim());
  if (!u || !verifyPassword(password, u.password_hash)) throw new HttpError(401, 'Invalid username or password');
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
  db.prepare('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)').run(token, u.id, Date.now() + SESSION_DAYS * 864e5);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
  return { user: publicUser(u) };
}));

app.post('/api/logout', wrap((req, res) => {
  const token = parseCookies(req.headers.cookie).sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
  return { ok: true };
}));

app.use('/api', auth);

app.get('/api/me', wrap((req) => ({ user: publicUser(req.user) })));

app.post('/api/me/password', wrap((req) => {
  const { current, password } = req.body || {};
  if (!verifyPassword(current, req.user.password_hash)) throw new HttpError(400, 'Current password is wrong');
  if (!password || String(password).length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), req.user.id);
  return { ok: true };
}));

// ---------------- branches ----------------
app.get('/api/branches', wrap((req) => {
  const rows = db.prepare('SELECT * FROM branches ORDER BY id').all().map((b) => ({ ...b, logos: JSON.parse(b.logos || '[]') }));
  return req.user.branch_id ? rows.filter((b) => b.id === req.user.branch_id) : rows;
}));

app.put('/api/branches/:id', adminOnly, wrap((req) => {
  getBranch(req.params.id);
  const f = ['name_en', 'name_ar', 'company_en', 'company_ar', 'address_en', 'address_ar', 'phone', 'email', 'tax_number', 'currency', 'invoice_prefix', 'receipt_prefix', 'footer_en', 'footer_ar'];
  const b = req.body || {};
  const data = {};
  for (const k of f) data[k] = String(b[k] ?? '').trim();
  if (!data.name_en || !data.currency || !data.invoice_prefix || !data.receipt_prefix) throw new HttpError(400, 'Missing required fields');
  data.vat_rate = Number(b.vat_rate) || 0;
  data.logos = JSON.stringify(Array.isArray(b.logos) ? b.logos.filter(Boolean).slice(0, 4) : []);
  data.id = Number(req.params.id);
  db.prepare(`UPDATE branches SET ${[...f, 'vat_rate', 'logos'].map((k) => `${k}=@${k}`).join(',')} WHERE id=@id`).run(data);
  return getBranch(req.params.id);
}));

// image upload (data URL -> file)
app.post('/api/uploads', adminOnly, wrap((req) => {
  const m = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,(.+)$/.exec(String(req.body?.dataUrl || ''));
  if (!m) throw new HttpError(400, 'Invalid image');
  const ext = m[1] === 'svg+xml' ? 'svg' : m[1].replace('jpeg', 'jpg');
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(m[2], 'base64'));
  return { url: `/uploads/${name}` };
}));

// ---------------- users ----------------
app.get('/api/users', adminOnly, wrap(() => db.prepare('SELECT * FROM users ORDER BY id').all().map(publicUser)));

app.post('/api/users', adminOnly, wrap((req) => {
  const { username, full_name, password, role, branch_id } = req.body || {};
  if (!username || !full_name || !password) throw new HttpError(400, 'Missing required fields');
  if (String(password).length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
  const r = role === 'admin' ? 'admin' : 'user';
  const bid = branch_id ? Number(branch_id) : null;
  if (r === 'user' && !bid) throw new HttpError(400, 'Branch is required for branch users');
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username.trim())) throw new HttpError(400, 'Username already exists');
  const info = db.prepare('INSERT INTO users (username,full_name,password_hash,role,branch_id) VALUES (?,?,?,?,?)')
    .run(username.trim(), full_name.trim(), hashPassword(password), r, bid);
  return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid));
}));

app.put('/api/users/:id', adminOnly, wrap((req) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) throw new HttpError(404, 'User not found');
  const { full_name, password, role, branch_id, active } = req.body || {};
  const r = role === 'admin' ? 'admin' : 'user';
  const bid = branch_id ? Number(branch_id) : null;
  if (r === 'user' && !bid) throw new HttpError(400, 'Branch is required for branch users');
  if (u.id === req.user.id && (r !== 'admin' || !active)) throw new HttpError(400, 'You cannot demote or disable yourself');
  db.prepare('UPDATE users SET full_name=?, role=?, branch_id=?, active=? WHERE id=?')
    .run(String(full_name || u.full_name).trim(), r, bid, active ? 1 : 0, u.id);
  if (password) {
    if (String(password).length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), u.id);
  }
  if (!active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id));
}));

// ---------------- customers ----------------
app.get('/api/customers', wrap((req) => {
  const bid = branchScope(req, req.query.branch_id);
  const q = `%${String(req.query.q || '').trim()}%`;
  return db.prepare(`SELECT c.*, b.code branch_code,
      (SELECT IFNULL(SUM(total),0) FROM invoices i WHERE i.customer_id=c.id AND i.status='active') invoiced,
      (SELECT IFNULL(SUM(amount),0) FROM receipts r WHERE r.customer_id=c.id AND r.status='active') paid
    FROM customers c JOIN branches b ON b.id=c.branch_id
    WHERE (? IS NULL OR c.branch_id=?) AND (c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)
    ORDER BY c.name LIMIT 500`).all(bid, bid, q, q, q);
}));

function customerData(req) {
  const b = req.body || {};
  const data = {
    name: String(b.name || '').trim(), phone: String(b.phone || '').trim(), email: String(b.email || '').trim(),
    address: String(b.address || '').trim(), tax_number: String(b.tax_number || '').trim(), notes: String(b.notes || '').trim(),
  };
  if (!data.name) throw new HttpError(400, 'Customer name is required');
  return data;
}

app.post('/api/customers', wrap((req) => {
  const branch_id = branchScope(req, req.body?.branch_id);
  if (!branch_id) throw new HttpError(400, 'Branch is required');
  getBranch(branch_id);
  const d = customerData(req);
  const info = db.prepare(`INSERT INTO customers (branch_id,name,phone,email,address,tax_number,notes)
    VALUES (@branch_id,@name,@phone,@email,@address,@tax_number,@notes)`).run({ ...d, branch_id });
  return db.prepare('SELECT * FROM customers WHERE id=?').get(info.lastInsertRowid);
}));

app.put('/api/customers/:id', wrap((req) => {
  const c = db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);
  if (!c) throw new HttpError(404, 'Customer not found');
  assertBranchAccess(req, c.branch_id);
  db.prepare(`UPDATE customers SET name=@name,phone=@phone,email=@email,address=@address,tax_number=@tax_number,notes=@notes WHERE id=@id`)
    .run({ ...customerData(req), id: c.id });
  return db.prepare('SELECT * FROM customers WHERE id=?').get(c.id);
}));

app.delete('/api/customers/:id', wrap((req) => {
  const c = db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);
  if (!c) throw new HttpError(404, 'Customer not found');
  assertBranchAccess(req, c.branch_id);
  const used = db.prepare('SELECT (SELECT COUNT(*) FROM invoices WHERE customer_id=?)+(SELECT COUNT(*) FROM receipts WHERE customer_id=?) n').get(c.id, c.id).n;
  if (used) throw new HttpError(400, 'Customer has invoices or receipts and cannot be deleted');
  db.prepare('DELETE FROM customers WHERE id=?').run(c.id);
  return { ok: true };
}));

// ---------------- services (price list) ----------------
app.get('/api/services', wrap((req) => {
  const bid = branchScope(req, req.query.branch_id);
  return db.prepare('SELECT * FROM services WHERE (? IS NULL OR branch_id=?) ORDER BY name_en').all(bid, bid);
}));
app.post('/api/services', wrap((req) => {
  const branch_id = branchScope(req, req.body?.branch_id);
  if (!branch_id) throw new HttpError(400, 'Branch is required');
  const { name_en, name_ar, price } = req.body || {};
  if (!name_en) throw new HttpError(400, 'Service name is required');
  const info = db.prepare('INSERT INTO services (branch_id,name_en,name_ar,price) VALUES (?,?,?,?)').run(branch_id, String(name_en).trim(), String(name_ar || '').trim(), r2(price));
  return db.prepare('SELECT * FROM services WHERE id=?').get(info.lastInsertRowid);
}));
app.put('/api/services/:id', wrap((req) => {
  const s = db.prepare('SELECT * FROM services WHERE id=?').get(req.params.id);
  if (!s) throw new HttpError(404, 'Not found');
  assertBranchAccess(req, s.branch_id);
  const { name_en, name_ar, price, active } = req.body || {};
  if (!name_en) throw new HttpError(400, 'Service name is required');
  db.prepare('UPDATE services SET name_en=?, name_ar=?, price=?, active=? WHERE id=?').run(String(name_en).trim(), String(name_ar || '').trim(), r2(price), active === false ? 0 : 1, s.id);
  return db.prepare('SELECT * FROM services WHERE id=?').get(s.id);
}));
app.delete('/api/services/:id', wrap((req) => {
  const s = db.prepare('SELECT * FROM services WHERE id=?').get(req.params.id);
  if (!s) throw new HttpError(404, 'Not found');
  assertBranchAccess(req, s.branch_id);
  db.prepare('DELETE FROM services WHERE id=?').run(s.id);
  return { ok: true };
}));

// ---------------- invoices ----------------
const INVOICE_SELECT = `SELECT i.*, c.name customer_name, c.phone customer_phone, u.full_name user_name, b.code branch_code,
    (SELECT IFNULL(SUM(amount),0) FROM receipts r WHERE r.invoice_id=i.id AND r.status='active') paid
  FROM invoices i JOIN customers c ON c.id=i.customer_id JOIN users u ON u.id=i.user_id JOIN branches b ON b.id=i.branch_id`;

function withPayment(inv) {
  inv.paid = r2(inv.paid);
  inv.balance = r2(inv.total - inv.paid);
  inv.payment_status = inv.status === 'cancelled' ? 'cancelled' : inv.balance <= 0.004 ? 'paid' : inv.paid > 0 ? 'partial' : 'unpaid';
  return inv;
}

app.get('/api/invoices', wrap((req) => {
  const bid = branchScope(req, req.query.branch_id);
  const q = `%${String(req.query.q || '').trim()}%`;
  const rows = db.prepare(`${INVOICE_SELECT}
    WHERE (? IS NULL OR i.branch_id=?) AND (? = '' OR i.date>=?) AND (? = '' OR i.date<=?)
      AND (i.number LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)
      AND (? = '' OR i.customer_id = ?)
    ORDER BY i.date DESC, i.id DESC LIMIT 1000`).all(
    bid, bid, req.query.from || '', req.query.from || '', req.query.to || '', req.query.to || '', q, q, q,
    req.query.customer_id || '', Number(req.query.customer_id) || 0,
  ).map(withPayment);
  const st = req.query.status;
  return st ? rows.filter((r) => r.payment_status === st) : rows;
}));

function loadInvoice(req, id) {
  const inv = db.prepare(`${INVOICE_SELECT} WHERE i.id=?`).get(id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  assertBranchAccess(req, inv.branch_id);
  withPayment(inv);
  inv.items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id').all(inv.id);
  inv.receipts = db.prepare(`SELECT r.*, u.full_name user_name FROM receipts r JOIN users u ON u.id=r.user_id WHERE r.invoice_id=? ORDER BY r.date, r.id`).all(inv.id);
  inv.customer = db.prepare('SELECT * FROM customers WHERE id=?').get(inv.customer_id);
  inv.branch = getBranch(inv.branch_id);
  return inv;
}

function invoicePayload(req, branch) {
  const b = req.body || {};
  const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(b.customer_id);
  if (!customer || customer.branch_id !== branch.id) throw new HttpError(400, 'Please choose a customer from this branch');
  const items = (Array.isArray(b.items) ? b.items : [])
    .map((it) => ({ description: String(it.description || '').trim(), qty: Number(it.qty) || 0, unit_price: r2(it.unit_price) }))
    .filter((it) => it.description && it.qty > 0);
  if (!items.length) throw new HttpError(400, 'Add at least one item');
  items.forEach((it) => { it.amount = r2(it.qty * it.unit_price); });
  const subtotal = r2(items.reduce((s, it) => s + it.amount, 0));
  const discount = Math.min(Math.max(r2(b.discount), 0), subtotal);
  const vat_rate = b.vat_rate === undefined || b.vat_rate === '' ? branch.vat_rate : Math.max(Number(b.vat_rate) || 0, 0);
  const vat_amount = r2(((subtotal - discount) * vat_rate) / 100);
  const total = r2(subtotal - discount + vat_amount);
  return {
    head: {
      customer_id: customer.id, date: String(b.date || today()).slice(0, 10), due_date: b.due_date ? String(b.due_date).slice(0, 10) : null,
      ticket: String(b.ticket || '').trim(), subtotal, discount, vat_rate, vat_amount, total, notes: String(b.notes || '').trim(),
    },
    items,
  };
}

const insertItems = (invoiceId, items) => {
  const st = db.prepare('INSERT INTO invoice_items (invoice_id,description,qty,unit_price,amount) VALUES (?,?,?,?,?)');
  items.forEach((it) => st.run(invoiceId, it.description, it.qty, it.unit_price, it.amount));
};

app.post('/api/invoices', wrap((req) => {
  const branch_id = branchScope(req, req.body?.branch_id);
  if (!branch_id) throw new HttpError(400, 'Branch is required');
  const branch = getBranch(branch_id);
  const { head, items } = invoicePayload(req, branch);
  const id = db.transaction(() => {
    const number = nextNumber(branch, 'invoice', head.date);
    const info = db.prepare(`INSERT INTO invoices (branch_id,number,customer_id,user_id,date,due_date,ticket,currency,subtotal,discount,vat_rate,vat_amount,total,notes)
      VALUES (@branch_id,@number,@customer_id,@user_id,@date,@due_date,@ticket,@currency,@subtotal,@discount,@vat_rate,@vat_amount,@total,@notes)`)
      .run({ ...head, branch_id, number, user_id: req.user.id, currency: branch.currency });
    insertItems(info.lastInsertRowid, items);
    return info.lastInsertRowid;
  })();
  return loadInvoice(req, id);
}));

app.put('/api/invoices/:id', wrap((req) => {
  const inv = loadInvoice(req, req.params.id);
  if (inv.status === 'cancelled') throw new HttpError(400, 'Cancelled invoices cannot be edited');
  const { head, items } = invoicePayload(req, inv.branch);
  if (head.total + 0.004 < inv.paid) throw new HttpError(400, 'New total is less than the amount already paid');
  db.transaction(() => {
    db.prepare(`UPDATE invoices SET customer_id=@customer_id,date=@date,due_date=@due_date,ticket=@ticket,subtotal=@subtotal,discount=@discount,
      vat_rate=@vat_rate,vat_amount=@vat_amount,total=@total,notes=@notes WHERE id=@id`).run({ ...head, id: inv.id });
    db.prepare('DELETE FROM invoice_items WHERE invoice_id=?').run(inv.id);
    insertItems(inv.id, items);
    db.prepare('UPDATE receipts SET customer_id=? WHERE invoice_id=?').run(head.customer_id, inv.id);
  })();
  return loadInvoice(req, inv.id);
}));

app.post('/api/invoices/:id/cancel', wrap((req) => {
  const inv = loadInvoice(req, req.params.id);
  if (inv.receipts.some((r) => r.status === 'active')) throw new HttpError(400, 'Cancel the receipts of this invoice first');
  db.prepare("UPDATE invoices SET status='cancelled' WHERE id=?").run(inv.id);
  return loadInvoice(req, inv.id);
}));

app.get('/api/invoices/:id', wrap((req) => loadInvoice(req, req.params.id)));

// ---------------- receipts ----------------
const RECEIPT_SELECT = `SELECT r.*, c.name customer_name, c.phone customer_phone, u.full_name user_name, b.code branch_code, i.number invoice_number
  FROM receipts r JOIN customers c ON c.id=r.customer_id JOIN users u ON u.id=r.user_id JOIN branches b ON b.id=r.branch_id
  LEFT JOIN invoices i ON i.id=r.invoice_id`;

app.get('/api/receipts', wrap((req) => {
  const bid = branchScope(req, req.query.branch_id);
  const q = `%${String(req.query.q || '').trim()}%`;
  return db.prepare(`${RECEIPT_SELECT}
    WHERE (? IS NULL OR r.branch_id=?) AND (? = '' OR substr(r.date,1,10)>=?) AND (? = '' OR substr(r.date,1,10)<=?)
      AND (r.number LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR r.description LIKE ?)
    ORDER BY r.date DESC, r.id DESC LIMIT 1000`).all(
    bid, bid, req.query.from || '', req.query.from || '', req.query.to || '', req.query.to || '', q, q, q, q,
  );
}));

function loadReceipt(req, id) {
  const r = db.prepare(`${RECEIPT_SELECT} WHERE r.id=?`).get(id);
  if (!r) throw new HttpError(404, 'Receipt not found');
  assertBranchAccess(req, r.branch_id);
  r.customer = db.prepare('SELECT * FROM customers WHERE id=?').get(r.customer_id);
  r.branch = getBranch(r.branch_id);
  if (r.invoice_id) r.invoice = withPayment(db.prepare(`${INVOICE_SELECT} WHERE i.id=?`).get(r.invoice_id));
  return r;
}

app.post('/api/receipts', wrap((req) => {
  const b = req.body || {};
  const branch_id = branchScope(req, b.branch_id);
  if (!branch_id) throw new HttpError(400, 'Branch is required');
  const branch = getBranch(branch_id);
  const amount = r2(b.amount);
  if (amount <= 0) throw new HttpError(400, 'Amount must be greater than zero');
  let customer_id = Number(b.customer_id);
  let invoice = null;
  if (b.invoice_id) {
    invoice = withPayment(db.prepare(`${INVOICE_SELECT} WHERE i.id=?`).get(b.invoice_id) || {});
    if (!invoice.id || invoice.branch_id !== branch.id) throw new HttpError(400, 'Invoice not found in this branch');
    if (invoice.status === 'cancelled') throw new HttpError(400, 'Invoice is cancelled');
    if (amount > invoice.balance + 0.004) throw new HttpError(400, `Amount exceeds invoice balance (${invoice.balance})`);
    customer_id = invoice.customer_id;
  }
  const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(customer_id);
  if (!customer || customer.branch_id !== branch.id) throw new HttpError(400, 'Please choose a customer from this branch');
  const description = String(b.description || '').trim() || (invoice ? `Payment for invoice ${invoice.number}` : '');
  if (!description) throw new HttpError(400, 'Description is required');
  const date = b.date ? `${String(b.date).slice(0, 10)} ${nowLocal().slice(11)}` : nowLocal();
  const id = db.transaction(() => {
    const number = nextNumber(branch, 'receipt', date);
    return db.prepare(`INSERT INTO receipts (branch_id,number,customer_id,invoice_id,user_id,date,ticket,description,amount,currency,method,non_refundable,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      branch.id, number, customer.id, invoice ? invoice.id : null, req.user.id, date, String(b.ticket || '').trim(), description, amount,
      branch.currency, ['cash', 'card', 'transfer', 'cheque'].includes(b.method) ? b.method : 'cash', b.non_refundable === false ? 0 : 1, String(b.notes || '').trim(),
    ).lastInsertRowid;
  })();
  return loadReceipt(req, id);
}));

app.get('/api/receipts/:id', wrap((req) => loadReceipt(req, req.params.id)));

app.post('/api/receipts/:id/cancel', wrap((req) => {
  const r = loadReceipt(req, req.params.id);
  db.prepare("UPDATE receipts SET status='cancelled' WHERE id=?").run(r.id);
  return loadReceipt(req, r.id);
}));

// ---------------- dashboard ----------------
app.get('/api/dashboard', wrap((req) => {
  const bid = branchScope(req, req.query.branch_id);
  const branches = db.prepare('SELECT * FROM branches WHERE (? IS NULL OR id=?) ORDER BY id').all(bid, bid);
  const month = today().slice(0, 7);
  return branches.map((b) => {
    const inv = db.prepare(`SELECT COUNT(*) n, IFNULL(SUM(total),0) total FROM invoices WHERE branch_id=? AND status='active'`).get(b.id);
    const invM = db.prepare(`SELECT COUNT(*) n, IFNULL(SUM(total),0) total FROM invoices WHERE branch_id=? AND status='active' AND substr(date,1,7)=?`).get(b.id, month);
    const rc = db.prepare(`SELECT COUNT(*) n, IFNULL(SUM(amount),0) total FROM receipts WHERE branch_id=? AND status='active'`).get(b.id);
    const rcM = db.prepare(`SELECT COUNT(*) n, IFNULL(SUM(amount),0) total FROM receipts WHERE branch_id=? AND status='active' AND substr(date,1,7)=?`).get(b.id, month);
    const rcT = db.prepare(`SELECT IFNULL(SUM(amount),0) total FROM receipts WHERE branch_id=? AND status='active' AND substr(date,1,10)=?`).get(b.id, today());
    const linkedPaid = db.prepare(`SELECT IFNULL(SUM(r.amount),0) s FROM receipts r JOIN invoices i ON i.id=r.invoice_id WHERE r.branch_id=? AND r.status='active' AND i.status='active'`).get(b.id).s;
    const customers = db.prepare('SELECT COUNT(*) n FROM customers WHERE branch_id=?').get(b.id).n;
    const monthly = db.prepare(`SELECT substr(date,1,7) m, SUM(amount) total FROM receipts WHERE branch_id=? AND status='active'
      AND date >= date('now','start of month','-5 months') GROUP BY m ORDER BY m`).all(b.id);
    const recent = db.prepare(`${RECEIPT_SELECT} WHERE r.branch_id=? ORDER BY r.id DESC LIMIT 5`).all(b.id);
    return {
      branch: { id: b.id, code: b.code, name_en: b.name_en, name_ar: b.name_ar, currency: b.currency },
      invoices: { count: inv.n, total: r2(inv.total), month_count: invM.n, month_total: r2(invM.total) },
      receipts: { count: rc.n, total: r2(rc.total), month_count: rcM.n, month_total: r2(rcM.total), today_total: r2(rcT.total) },
      outstanding: r2(inv.total - linkedPaid),
      customers, monthly, recent,
    };
  });
}));

// ---------------- CSV export ----------------
app.get('/api/export/:type', wrap((req, res) => {
  const bid = branchScope(req, req.query.branch_id);
  const from = req.query.from || '0000-00-00';
  const to = req.query.to || '9999-12-31';
  let rows;
  if (req.params.type === 'invoices') {
    rows = db.prepare(`${INVOICE_SELECT} WHERE (? IS NULL OR i.branch_id=?) AND i.date BETWEEN ? AND ? ORDER BY i.date, i.id`).all(bid, bid, from, to)
      .map(withPayment)
      .map((r) => ({ Branch: r.branch_code, Number: r.number, Date: r.date, Customer: r.customer_name, Phone: r.customer_phone, Subtotal: r.subtotal, Discount: r.discount, VAT: r.vat_amount, Total: r.total, Paid: r.paid, Balance: r.balance, Currency: r.currency, Status: r.payment_status, User: r.user_name }));
  } else if (req.params.type === 'receipts') {
    rows = db.prepare(`${RECEIPT_SELECT} WHERE (? IS NULL OR r.branch_id=?) AND substr(r.date,1,10) BETWEEN ? AND ? ORDER BY r.date, r.id`).all(bid, bid, from, to)
      .map((r) => ({ Branch: r.branch_code, Number: r.number, Date: r.date, Customer: r.customer_name, Phone: r.customer_phone, Description: r.description, Invoice: r.invoice_number || '', Method: r.method, Amount: r.amount, Currency: r.currency, Status: r.status, User: r.user_name }));
  } else throw new HttpError(404, 'Unknown export');
  const cols = rows.length ? Object.keys(rows[0]) : ['No data'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [cols.map(esc).join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-${from}-${to}.csv"`);
  res.send(csv);
}));

// SPA fallback
app.get(/^\/(?!api|uploads).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

if (require.main === module) {
  app.listen(PORT, () => console.log(`Invoices system running on http://localhost:${PORT}`));
}
module.exports = app;
