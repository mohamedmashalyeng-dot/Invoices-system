// Database layer: schema, seed data and helpers (SQLite via better-sqlite3)
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'invoices.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,          -- EG / AE
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  company_en TEXT NOT NULL DEFAULT '',
  company_ar TEXT NOT NULL DEFAULT '',
  address_en TEXT NOT NULL DEFAULT '',
  address_ar TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  tax_number TEXT NOT NULL DEFAULT '', -- TRN (UAE) / Tax Reg. No (Egypt)
  currency TEXT NOT NULL,              -- EGP / AED
  vat_rate REAL NOT NULL DEFAULT 0,    -- percent
  invoice_prefix TEXT NOT NULL,
  receipt_prefix TEXT NOT NULL,
  logos TEXT NOT NULL DEFAULT '[]',    -- JSON array of image urls
  footer_en TEXT NOT NULL DEFAULT '',
  footer_ar TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','user')),
  branch_id INTEGER REFERENCES branches(id), -- NULL = all branches (admin)
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  tax_number TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  due_date TEXT,
  ticket TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL,
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL DEFAULT 0,
  vat_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  invoice_id INTEGER REFERENCES invoices(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  ticket TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',  -- cash / card / transfer / cheque
  non_refundable INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS counters (
  branch_id INTEGER NOT NULL,
  kind TEXT NOT NULL,      -- invoice / receipt
  year INTEGER NOT NULL,
  last INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (branch_id, kind, year)
);

CREATE INDEX IF NOT EXISTS idx_inv_branch_date ON invoices(branch_id, date);
CREATE INDEX IF NOT EXISTS idx_rcpt_branch_date ON receipts(branch_id, date);
CREATE INDEX IF NOT EXISTS idx_rcpt_invoice ON receipts(invoice_id);
`);

// ---------- password hashing (scrypt, no native deps) ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(pw), salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}

// ---------- seed ----------
function seed() {
  const count = db.prepare('SELECT COUNT(*) c FROM branches').get().c;
  if (count === 0) {
    const ins = db.prepare(`INSERT INTO branches
      (code,name_en,name_ar,company_en,company_ar,address_en,address_ar,phone,email,tax_number,currency,vat_rate,invoice_prefix,receipt_prefix,logos,footer_en,footer_ar)
      VALUES (@code,@name_en,@name_ar,@company_en,@company_ar,@address_en,@address_ar,@phone,@email,@tax_number,@currency,@vat_rate,@invoice_prefix,@receipt_prefix,@logos,@footer_en,@footer_ar)`);
    ins.run({
      code: 'EG', name_en: 'Egypt Branch', name_ar: 'فرع مصر',
      company_en: 'QuickPlus Business Consultants', company_ar: 'كويك بلس لاستشارات الأعمال',
      address_en: 'Egypt', address_ar: 'مصر', phone: '', email: '', tax_number: '',
      currency: 'EGP', vat_rate: 14, invoice_prefix: 'EG-INV', receipt_prefix: 'EG-RV',
      logos: JSON.stringify(['/img/quickplus.png']),
      footer_en: 'The Amount Non Refundable', footer_ar: 'المبلغ غير مسترد',
    });
    ins.run({
      code: 'AE', name_en: 'UAE Branch', name_ar: 'فرع الإمارات',
      company_en: 'QuickPlus Business Consultants', company_ar: 'كويك بلس لاستشارات الأعمال',
      address_en: 'Ajman Free Zone, UAE', address_ar: 'المنطقة الحرة بعجمان، الإمارات', phone: '', email: '', tax_number: '',
      currency: 'AED', vat_rate: 5, invoice_prefix: 'AE-INV', receipt_prefix: 'AE-RV',
      logos: JSON.stringify(['/img/ajman-free-zone.png', '/img/quickplus.png']),
      footer_en: 'The Amount Non Refundable', footer_ar: 'المبلغ غير مسترد',
    });
  }
  const users = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (users === 0) {
    const pw = process.env.ADMIN_PASSWORD || 'admin123';
    db.prepare(`INSERT INTO users (username,full_name,password_hash,role,branch_id) VALUES (?,?,?,?,NULL)`)
      .run('admin', 'Administrator', hashPassword(pw), 'admin');
    console.log(`Created default admin user: admin / ${pw}  (change it after first login)`);
  }
}
seed();

// ---------- numbering: PREFIX/YY/NNN per branch, per kind, per year ----------
function nextNumber(branch, kind, dateStr) {
  const year = Number(String(dateStr || '').slice(0, 4)) || new Date().getFullYear();
  db.prepare(`INSERT INTO counters (branch_id,kind,year,last) VALUES (?,?,?,0)
              ON CONFLICT(branch_id,kind,year) DO NOTHING`).run(branch.id, kind, year);
  db.prepare('UPDATE counters SET last = last + 1 WHERE branch_id=? AND kind=? AND year=?').run(branch.id, kind, year);
  const n = db.prepare('SELECT last FROM counters WHERE branch_id=? AND kind=? AND year=?').get(branch.id, kind, year).last;
  const prefix = kind === 'invoice' ? branch.invoice_prefix : branch.receipt_prefix;
  return `${prefix}/${String(year).slice(2)}/${String(n).padStart(3, '0')}`;
}

module.exports = { db, hashPassword, verifyPassword, nextNumber };
