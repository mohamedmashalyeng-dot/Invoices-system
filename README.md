# نظام الفواتير – QuickPlus Invoices System

نظام فواتير وإيصالات استلام نقدية لفرعين: **فرع مصر 🇪🇬** و **فرع الإمارات 🇦🇪**، بواجهة **عربي / إنجليزي**.

An invoices & payment-receipts system for two branches, **Egypt** and **UAE**, with an **Arabic / English** interface.

---

## المميزات | Features

| عربي | English |
|---|---|
| فرعين مستقلين، لكل فرع عملته (EGP / AED) ونسبة ضريبته (14% / 5%) وترقيمه وشعاراته | Two branches, each with its own currency, VAT rate, numbering and logos |
| فواتير ضريبية متعددة البنود مع خصم وضريبة | Multi-line tax invoices with discount & VAT |
| إيصالات استلام نقدية (دفعات جزئية) مربوطة بالفاتورة أو مستقلة | Payment receipts (partial payments), linked to an invoice or standalone |
| حالة الفاتورة تلقائياً: غير مدفوعة / جزئياً / مدفوعة / ملغاة | Automatic status: unpaid / partial / paid / cancelled |
| طباعة A4 / PDF بنفس شكل الإيصال (باركود، شعارات، توقيع، "المبلغ غير مسترد") | A4 print / PDF in the same layout as the original receipt (barcode, logos, signatures, "non-refundable") |
| لغة الطباعة: عربي + إنجليزي، أو عربي فقط، أو إنجليزي فقط | Print language: bilingual, Arabic only or English only |
| العملاء وكشف حساب العميل | Customers & customer statement |
| قائمة الخدمات وأسعارها لكل فرع | Per-branch services / price list |
| لوحة تحكم: المحصّل اليوم والشهر والمستحق لكل فرع | Dashboard: today's/monthly collections and outstanding per branch |
| تصدير الفواتير والإيصالات إلى Excel (CSV) | Export invoices & receipts to Excel (CSV) |
| مستخدمين وصلاحيات: مدير يرى كل الفروع، ومستخدم فرع يرى فرعه فقط | Users: admins see all branches, branch users see only their own branch |

ترقيم المستندات تلقائي لكل فرع ولكل سنة | Automatic numbering per branch and year:
`EG-INV/26/001`, `EG-RV/26/001`, `AE-INV/26/001`, `AE-RV/26/001` (البادئات قابلة للتعديل | prefixes are editable).

## التشغيل | Getting started

Requirements: Node.js 18 or later.

```bash
npm install
npm start
# open http://localhost:3000
```

أول دخول | First login: **admin / admin123** — غيّر كلمة المرور من "حسابي" | change it from "My Account".

Environment variables:

| Variable | Default | |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Where the SQLite database and uploaded logos are stored |
| `ADMIN_PASSWORD` | `admin123` | Password of the first admin (only used when the database is created) |

> **نسخ احتياطي | Backup:** all data lives in `data/` (`invoices.db` and `uploads/`). Copy this folder to back up.

## الإعداد | Setup

1. ادخل **إعدادات الفروع** وعدّل بيانات كل فرع: اسم الشركة، العنوان، التليفون، الرقم الضريبي (TRN)، العملة، نسبة الضريبة، بادئات الترقيم، والشعارات.
   Open **Branch Settings** and fill in each branch's company details, TRN, currency, VAT, prefixes and logos.
2. من **المستخدمين** أضف موظفين لكل فرع (مستخدم فرع) | Add staff users per branch from **Users**.
3. أضف الخدمات (اختياري) ثم ابدأ بإصدار الفواتير والإيصالات | Optionally add services, then start issuing invoices and receipts.

## Tech

Node.js + Express + SQLite (better-sqlite3), vanilla JS single-page front end (no build step).

```
server.js        REST API (auth, branches, users, customers, services, invoices, receipts, dashboard, CSV export)
db.js            SQLite schema, seed data, password hashing, document numbering
public/          Front end (index.html, css/, js/app.js, js/i18n.js, js/barcode.js, img/)
```
