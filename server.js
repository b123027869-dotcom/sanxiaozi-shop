// server.js
console.log('🔥 SANXIAOZI ADMIN SERVER STARTED');

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const app = express();

/* =========================================================
 * Security: CSP (fix admin + supabase + API fetch)
 * ========================================================= */
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self' http://localhost:3000 https://*.supabase.co",
      "font-src 'self' data:",
    ].join("; ")
  );
  next();
});



/* =========================================================
 * Basic Middlewares
 * ========================================================= */

// ✅ 允許的前端來源（依你的實際網域調整）
const ALLOW_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'https://sanxiaozi-shop.onrender.com'
]);

app.use(cors({
  origin: (origin, cb) => {
    // 無 origin：curl / server-to-server / 同源情況
    if (!origin) return cb(null, true);
    if (ALLOW_ORIGINS.has(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true, // ✅ Cookie 模式需要
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-requested-with', 'x-pay-secret']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* =========================================================
 * SQLite: products
 * ========================================================= */
const db = new sqlite3.Database(path.join(__dirname, 'sanxiaozi.db'));

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT,
      name TEXT NOT NULL,
      price INTEGER DEFAULT 0,
      stock INTEGER DEFAULT 0,
      category TEXT,
      status TEXT DEFAULT 'on',
      tag TEXT,
      imageUrl TEXT,
      description TEXT,
      variantsJson TEXT,
      detailImagesJson TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT DEFAULT 'new',
      createdAt TEXT,
      totalAmount INTEGER DEFAULT 0,
      customerJson TEXT,
      itemsJson TEXT,
      paymentMethod TEXT,
      paymentStatus TEXT,
      paymentRef TEXT,
      paidAt TEXT
    )
  `);

  // 舊 DB 升級：補欄位（重複欄位會報錯，這裡忽略）
  const addCol = (sql) => {
    db.run(sql, (err) => {
      if (err) {
        const msg = String(err.message || "");
        if (!msg.includes("duplicate column name")) {
          console.error("DB migration error:", err);
        }
      }
    });
  };

  // products migration
  addCol(`ALTER TABLE products ADD COLUMN tag TEXT`);

  // orders migration
  addCol(`ALTER TABLE orders ADD COLUMN paymentMethod TEXT`);
  addCol(`ALTER TABLE orders ADD COLUMN paymentStatus TEXT`);
  addCol(`ALTER TABLE orders ADD COLUMN paymentRef TEXT`);
  addCol(`ALTER TABLE orders ADD COLUMN paidAt TEXT`);
});

/* =========================================================
 * Orders JSON File (admin order list)
 * ========================================================= */
const DATA_FILE = path.join(__dirname, 'orders.json');

function readOrders() {
  try {
    const text = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    console.error('readOrders error:', err);
    return [];
  }
}

function saveOrders(orders) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2), 'utf8');
  } catch (err) {
    console.error('saveOrders error:', err);
  }
}

// ND + YYYYMMDD + 4 digits
function generateOrderId(allOrders) {
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const datePrefix = `${y}${m}${d}`;

  const todayOrders = allOrders.filter(o => (o.id || '').startsWith('ND' + datePrefix));
  const nextIndex = todayOrders.length + 1;
  return `ND${datePrefix}${String(nextIndex).padStart(4, '0')}`;
}

/* =========================================================
 * Admin Auth (最安全版：HttpOnly Cookie session)
 * ========================================================= */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'a1216321';

// ✅ 這個保留給「未來金流 webhook」用（瀏覽器永遠不會拿到）
const PAY_MARK_SECRET = process.env.PAY_MARK_SECRET || '';

/* =========================================================
 * Email (Resend): admin notify + customer confirmation
 * Env:
 *  - RESEND_API_KEY
 *  - RESEND_FROM (verified sender or onboarding@resend.dev)
 *  - ORDER_NOTIFY_EMAIL (store owner inbox)
 * ========================================================= */
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM = process.env.RESEND_FROM || '';
const ORDER_NOTIFY_EMAIL = process.env.ORDER_NOTIFY_EMAIL || '';

async function sendEmailViaResend({ to, subject, html }) {
  if (!RESEND_API_KEY || !RESEND_FROM || !to) return { ok: false, skipped: true };
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: RESEND_FROM, to, subject, html })
    });
    const text = await resp.text();
    if (!resp.ok) {
      console.error('❌ Resend send failed', resp.status, text);
      return { ok: false, status: resp.status };
    }
    return { ok: true };
  } catch (e) {
    console.error('❌ Resend error', e);
    return { ok: false, error: String(e) };
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function orderItemsToHtml(items) {
  const rows = (items || []).map(it => {
    const name = escapeHtml(it.name || '');
    const spec = escapeHtml(it.specLabel || it.specKey || '');
    const qty = Number(it.qty || 0) || 0;
    const price = Number(it.price || 0) || 0;
    const line = price * qty;
    return `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${name}${spec ? ` <span style="color:#888">(${spec})</span>` : ''}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${qty}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">NT$ ${price}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">NT$ ${line}</td>
    </tr>`;
  }).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;">
    <thead>
      <tr>
        <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #ddd;">商品</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #ddd;">數量</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #ddd;">單價</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #ddd;">小計</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function buildCustomerMail({ orderId, customer, items, totalAmount, shippingFee }) {
  const cname = escapeHtml(customer?.name || '');
  const cphone = escapeHtml(customer?.phone || '');
  const cship = escapeHtml(customer?.ship || customer?.shipType || customer?.shipping || customer?.delivery || '');
  const caddr = escapeHtml(customer?.address || customer?.store || customer?.storeName || customer?.storeId || '');
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;line-height:1.7;color:#333;">
      <h2 style="margin:0 0 10px;">📦 訂單成立通知</h2>
      <p style="margin:0 0 12px;">親愛的 <strong>${cname}</strong> 您好，已收到您的訂單，我們會依序為您準備出貨 🤍</p>
      <div style="padding:12px 14px;border:1px solid #eee;border-radius:12px;background:#fafafa;margin-bottom:12px;">
        <div><strong>訂單編號：</strong>${escapeHtml(orderId)}</div>
        <div><strong>聯絡電話：</strong>${cphone}</div>
        ${cship ? `<div><strong>取貨方式：</strong>${cship}</div>` : ''}
        ${caddr ? `<div><strong>收件資訊：</strong>${caddr}</div>` : ''}
      </div>
      ${orderItemsToHtml(items)}
      <div style="margin-top:12px;text-align:right;font-size:14px;">
        <div>運費：NT$ ${Number(shippingFee||0)||0}</div>
        <div style="font-size:16px;"><strong>總金額：NT$ ${Number(totalAmount||0)||0}</strong></div>
      </div>
      <p style="margin-top:14px;color:#666;">若有任何問題，歡迎直接回覆此信。</p>
      <p style="margin:0;">— 三小隻日常百貨 ☀</p>
    </div>
  `;
}

function buildAdminMail({ orderId, customer, items, totalAmount, shippingFee, fulfillType }) {
  const cname = escapeHtml(customer?.name || '');
  const cemail = escapeHtml(customer?.email || '');
  const cphone = escapeHtml(customer?.phone || '');
  const cship = escapeHtml(customer?.ship || customer?.shipType || customer?.shipping || customer?.delivery || '');
  const caddr = escapeHtml(customer?.address || customer?.store || customer?.storeName || customer?.storeId || '');
  const ft = fulfillType ? `（${escapeHtml(fulfillType)}）` : '';
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;line-height:1.7;color:#333;">
      <h2 style="margin:0 0 10px;">🔔 新訂單通知 ${ft}</h2>
      <div style="padding:12px 14px;border:1px solid #eee;border-radius:12px;background:#fafafa;margin-bottom:12px;">
        <div><strong>訂單編號：</strong>${escapeHtml(orderId)}</div>
        <div><strong>客戶：</strong>${cname}</div>
        <div><strong>Email：</strong>${cemail}</div>
        <div><strong>電話：</strong>${cphone}</div>
        ${cship ? `<div><strong>取貨方式：</strong>${cship}</div>` : ''}
        ${caddr ? `<div><strong>收件資訊：</strong>${caddr}</div>` : ''}
      </div>
      ${orderItemsToHtml(items)}
      <div style="margin-top:12px;text-align:right;font-size:14px;">
        <div>運費：NT$ ${Number(shippingFee||0)||0}</div>
        <div style="font-size:16px;"><strong>總金額：NT$ ${Number(totalAmount||0)||0}</strong></div>
      </div>
    </div>
  `;
}

const adminTokens = new Set();
const ADMIN_COOKIE_NAME = 'admin_session';

function createAdminToken() {
  return crypto.randomBytes(24).toString('hex');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(part => {
    const [k, ...v] = part.trim().split('=');
    if (!k) return;
    out[k] = decodeURIComponent(v.join('=') || '');
  });
  return out;
}

// ✅ 防 CSRF：要求 AJAX header（跨站表單打不出來）
function requireAjaxHeader(req, res, next) {
  const v = String(req.headers['x-requested-with'] || '');
  if (v !== 'XMLHttpRequest') {
    return res.status(403).json({ ok: false, message: 'forbidden' });
  }
  next();
}

function authAdmin(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies[ADMIN_COOKIE_NAME];

  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ ok: false, message: '未登入或權限不足' });
  }
  next();
}

function requirePaySecret(req, res, next) {
  const got = String(req.headers['x-pay-secret'] || '');
  if (!PAY_MARK_SECRET) {
    return res.status(500).json({ ok: false, message: 'PAY_MARK_SECRET not set' });
  }
  if (!got || got !== PAY_MARK_SECRET) {
    return res.status(401).json({ ok: false, message: 'unauthorized' });
  }
  next();
}

// ✅ 登入：寫 HttpOnly Cookie（不回傳 token）
app.post('/api/admin/login', requireAjaxHeader, (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ ok: false, message: '請輸入密碼' });
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, message: '密碼錯誤' });

  const token = createAdminToken();
  adminTokens.add(token);

  const isProd = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 24 * 7}${isProd ? '; Secure' : ''}`
  ]);

  res.json({ ok: true });
});

// ✅ 登出：清 cookie + 清 session
app.post('/api/admin/logout', authAdmin, requireAjaxHeader, (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[ADMIN_COOKIE_NAME];
  if (token) adminTokens.delete(token);

  const isProd = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', [
    `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isProd ? '; Secure' : ''}`
  ]);

  res.json({ ok: true });
});

/* =========================================================
 * Helpers: safe JSON parse
 * ========================================================= */
function safeJsonParse(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

/* =========================================================
 * Helpers: compute total stock from variants
 * ========================================================= */
function computeTotalStock(variants) {
  try {
    if (!Array.isArray(variants) || variants.length === 0) return null; // null means "no variants"
    return variants.reduce((sum, v) => sum + (Number(v?.stock || 0) || 0), 0);
  } catch {
    return null;
  }
}

/* =========================================================
 * Front: products list (only status=on)
 * ========================================================= */
app.get('/api/products', (req, res) => {
  const sql = `
    SELECT
      id, code, name, price, stock, category, status, tag,
      imageUrl, description, variantsJson, detailImagesJson
    FROM products
    WHERE status = 'on'
    ORDER BY id DESC
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('查詢 products 失敗', err);
      return res.status(500).json({ success: false, message: '查詢商品失敗' });
    }

    const products = (rows || []).map(row => {
      const variants = safeJsonParse(row.variantsJson, []);
const detailImages = safeJsonParse(row.detailImagesJson, []);

      const categories = row.category
        ? row.category.split(/[,\s]+/).filter(Boolean)
        : [];

      const commonThumbs = detailImages.length
        ? detailImages
        : (row.imageUrl ? [row.imageUrl] : []);

      const vTotal = computeTotalStock(variants);
      const computedStock = (vTotal == null) ? row.stock : vTotal;

      let specs;
      if (variants.length > 0) {
        specs = variants.map((v, idx) => {
          const vStock = Number(v.stock || 0) || 0;
          const mainImg = v.imageUrl || row.imageUrl || '';
          const thumbs = mainImg
            ? [mainImg, ...commonThumbs.filter(u => u !== mainImg)]
            : commonThumbs;

          return {
            key: v.name || `v${idx + 1}`,
            label: v.name || `款式 ${idx + 1}`,
            stock: vStock,
            mainImg,
            thumbs
          };
        });
      } else {
        specs = [{
          key: 'default',
          label: '預設款',
          stock: row.stock != null ? row.stock : null,
          mainImg: row.imageUrl || '',
          thumbs: commonThumbs
        }];
      }

      return {
        id: row.id,
        code: row.code,
        name: row.name,
        price: row.price,
        stock: computedStock,
        categories,
        tag: row.tag || '',
        subtitle: '',
        priceNote: '',
        shortDesc: row.description
          ? row.description.slice(0, 40) + (row.description.length > 40 ? '…' : '')
          : '',
        imageUrl: row.imageUrl,
        detailHtml: row.description || '',
        specs
      };
    });

    res.json({ success: true, products });
  });
});

/* =========================================================
 * Front: create order (check stock -> deduct -> write orders.json)
 * ========================================================= */
app.post('/api/orders', (req, res) => {
  try {
    const { customer, items } = req.body || {};

    if (!customer || !customer.name || !customer.phone || !customer.email) {
      return res.status(400).json({ ok: false, message: '缺少必要的顧客資料' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, message: '購物車是空的' });
    }

    // Shipping rules
    const FREE_SHIP_THRESHOLD = 699;
    const SHIPPING_FEE = 100;
    const SHIP_METHODS_WITH_FEE = new Set(['711', 'family', 'hilife', 'ok', 'home']);

    const subtotal = items.reduce((sum, it) => {
      return sum + (Number(it.price || 0) * Number(it.qty || 0));
    }, 0);

    // Read shipType from possible fields
    let shipType =
      customer.ship ||
      customer.shipType ||
      customer.shipping ||
      customer.ship_method ||
      customer.delivery ||
      '';

    shipType = String(shipType || '');

    // Normalize
    if (shipType.includes('7-11') || shipType.includes('711')) shipType = '711';
    else if (shipType.includes('全家') || shipType.toLowerCase().includes('family')) shipType = 'family';
    else if (shipType.includes('萊爾富') || shipType.toLowerCase().includes('hilife')) shipType = 'hilife';
    else if (shipType.includes('ok') || shipType.includes('OK')) shipType = 'ok';
    else if (shipType.includes('宅配') || shipType.toLowerCase().includes('home')) shipType = 'home';

    let shippingFee = 0;
    if (SHIP_METHODS_WITH_FEE.has(shipType)) {
      shippingFee = subtotal >= FREE_SHIP_THRESHOLD ? 0 : SHIPPING_FEE;
    } else {
      shippingFee = subtotal >= FREE_SHIP_THRESHOLD ? 0 : SHIPPING_FEE;
      shipType = shipType || 'unknown';
    }

    const totalAmount = subtotal + shippingFee;

    const allOrders = readOrders();
    const id = generateOrderId(allOrders);
    const now = new Date().toISOString();

    // ✅ 後台用 new/completed/cancelled 篩選，所以新訂單用 new
    // ✅ 同步 shipType 到 customer.ship
    const fixedCustomer = { ...customer, ship: shipType };

    const payMethod = String(customer.pay || "shopee").toLowerCase();
    let payStatus = "unpaid";
    if (["linepay", "ecpay", "card"].includes(payMethod)) payStatus = "pending";

    const newOrder = {
      id,
      createdAt: now,
      updatedAt: now,
      status: 'new',

      shipType,
      subtotal,
      shippingFee,
      totalAmount,

      paymentMethod: payMethod,
      paymentStatus: payStatus,
      paymentRef: "",
      paidAt: "",

      items,
      customer: fixedCustomer
    };

    // Transaction: check stock then deduct
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      const insufficient = [];

      const tagMap = {}; // productId -> tag

      const processItem = (index) => {
        if (index >= items.length) return deductItem(0);

        const it = items[index];
        const pid = it.productId;
        const specKey = it.specKey || null;
        const qty = Number(it.qty || 0);

        if (!pid || qty <= 0) return processItem(index + 1);

        db.get('SELECT stock, variantsJson, tag FROM products WHERE id = ?', [pid], (err, row) => {
          if (err || !row) {
            return db.run('ROLLBACK', () =>
              res.status(500).json({ ok: false, message: '查詢商品失敗' })
            );
          }

          const stock = Number(row.stock || 0);
          const variants = safeJsonParse(row.variantsJson, []);
          tagMap[pid] = row.tag || '';

if (specKey && variants.length > 0) {
            const v = variants.find(v => v.name === specKey || v.key === specKey);
            if (!v) {
              return db.run('ROLLBACK', () =>
                res.status(400).json({ ok: false, message: '找不到該款式' })
              );
            }
            if (Number(v.stock || 0) < qty) {
              insufficient.push({ productId: pid, specKey, remain: Number(v.stock || 0), want: qty });
            }
          } else {
            if (stock < qty) {
              insufficient.push({ productId: pid, specKey: null, remain: stock, want: qty });
            }
          }

          if (insufficient.length > 0) {
            return db.run('ROLLBACK', () =>
              res.status(400).json({ ok: false, message: '部分商品庫存不足', insufficient })
            );
          }

          processItem(index + 1);
        });
      };

      const deductItem = (idx) => {
        if (idx >= items.length) {
  // ✅ Split orders: 現貨 / 備貨(10-15天) 分開出單
  const normalizedItems = (items || []).map(it => ({
    ...it,
    tag: it.tag || tagMap[it.productId] || ''
  }));

  const leadtimeItems = normalizedItems.filter(it => it.tag === 'leadtime_10_15');
  const stockItems = normalizedItems.filter(it => it.tag !== 'leadtime_10_15');

  const updatedOrders = readOrders();

  // 重新產生 ID（可能會有 2 張單）
  const id1 = generateOrderId(updatedOrders);
  const now2 = new Date().toISOString();

  // shippingFee 只收一次：現貨單收，備貨單不再重複收
  const stockSubtotal = stockItems.reduce((s, it) => s + (Number(it.price||0)*Number(it.qty||0)), 0);
  const leadSubtotal  = leadtimeItems.reduce((s, it) => s + (Number(it.price||0)*Number(it.qty||0)), 0);

  const stockOrder = {
    ...newOrder,
    id: id1,
    createdAt: now2,
    updatedAt: now2,
    fulfillType: 'stock',        // ✅ 現貨單
    items: stockItems,
    subtotal: stockSubtotal,
    totalAmount: stockSubtotal + shippingFee
  };

  let leadOrder = null;

  if (leadtimeItems.length > 0 && stockItems.length > 0) {
    // 有拆單：備貨單單獨一張
    const id2 = generateOrderId([...updatedOrders, stockOrder]);
    leadOrder = {
      ...newOrder,
      id: id2,
      createdAt: now2,
      updatedAt: now2,
      fulfillType: 'leadtime',   // ✅ 備貨單
      items: leadtimeItems,
      subtotal: leadSubtotal,
      shippingFee: 0,
      totalAmount: leadSubtotal
    };
  } else if (leadtimeItems.length > 0 && stockItems.length === 0) {
    // 全部都是備貨：就只出一張備貨單（沿用 stockOrder 這張）
    stockOrder.fulfillType = 'leadtime';
    stockOrder.items = leadtimeItems;
    stockOrder.subtotal = leadSubtotal;
    stockOrder.totalAmount = leadSubtotal + shippingFee;
  } else {
    // 全部現貨：維持一張
  }

  updatedOrders.push(stockOrder);
  if (leadOrder) updatedOrders.push(leadOrder);
  saveOrders(updatedOrders);

  return db.run('COMMIT', () => {
  (async () => {
    let adminSent = false;
    let customerSent = false;

    // 先嘗試寄信（失敗也不影響下單成功）
    try {
      if (ORDER_NOTIFY_EMAIL) {
        // 店長：現貨單
        const r1 = await sendEmailViaResend({
          to: ORDER_NOTIFY_EMAIL,
          subject: `🔔 新訂單通知：${stockOrder.id}`,
          html: buildAdminMail({
            orderId: stockOrder.id,
            customer,
            items: stockOrder.items,
            totalAmount: stockOrder.totalAmount,
            shippingFee: stockOrder.shippingFee,
            fulfillType: stockOrder.fulfillType || ''
          })
        });

        // 店長：若拆單，備貨單也寄一封
        let r2 = { ok: true, skipped: true };
        if (leadOrder) {
          r2 = await sendEmailViaResend({
            to: ORDER_NOTIFY_EMAIL,
            subject: `🔔 新訂單通知（備貨單）：${leadOrder.id}`,
            html: buildAdminMail({
              orderId: leadOrder.id,
              customer,
              items: leadOrder.items,
              totalAmount: leadOrder.totalAmount,
              shippingFee: leadOrder.shippingFee,
              fulfillType: leadOrder.fulfillType || 'leadtime'
            })
          });
        }

        adminSent = !!(r1.ok && (leadOrder ? r2.ok : true));
      }
    } catch (e) {
      console.error('❌ admin mail error', e);
    }

    try {
      const toCustomer = String(customer?.email || '').trim();
      if (toCustomer) {
        const combinedItems = [
          ...(stockOrder?.items || []),
          ...(leadOrder?.items || [])
        ];
        const combinedId = leadOrder ? `${stockOrder.id} / ${leadOrder.id}` : stockOrder.id;
        const combinedTotal = (Number(stockOrder.totalAmount || 0) || 0) + (leadOrder ? (Number(leadOrder.totalAmount || 0) || 0) : 0);

        const rc = await sendEmailViaResend({
          to: toCustomer,
          subject: `📦【三小隻日常百貨】訂單成立通知：${combinedId}`,
          html: buildCustomerMail({
            orderId: combinedId,
            customer,
            items: combinedItems,
            totalAmount: combinedTotal,
            shippingFee: stockOrder.shippingFee
          })
        });
        customerSent = !!rc.ok;
      }
    } catch (e) {
      console.error('❌ customer mail error', e);
    }

    res.json({
      ok: true,
      id: stockOrder.id,
      splitIds: leadOrder ? [stockOrder.id, leadOrder.id] : [stockOrder.id],
      createdAt: stockOrder.createdAt,
      status: stockOrder.status,
      subtotal: stockOrder.subtotal,
      shippingFee: stockOrder.shippingFee,
      totalAmount: stockOrder.totalAmount + (leadOrder ? leadOrder.totalAmount : 0),
      shipType: stockOrder.shipType,
      email: { adminSent, customerSent }
    });
  })();
});
}
const it = items[idx];
        const pid = it.productId;
        const specKey = it.specKey || null;
        const qty = Number(it.qty || 0);

        if (!pid || qty <= 0) return deductItem(idx + 1);

        db.get('SELECT stock, variantsJson, tag FROM products WHERE id = ?', [pid], (err, row) => {
          if (err || !row) {
            return db.run('ROLLBACK', () =>
              res.status(500).json({ ok: false, message: '扣庫存時找不到商品' })
            );
          }

          let stock = Number(row.stock || 0);
          const variants = safeJsonParse(row.variantsJson, []);
stock = Math.max(0, stock - qty);

          if (specKey && variants.length > 0) {
            const v = variants.find(v => v.name === specKey || v.key === specKey);
            if (v) v.stock = Math.max(0, Number(v.stock || 0) - qty);
          }

          db.run(
            'UPDATE products SET stock = ?, variantsJson = ? WHERE id = ?',
            [stock, JSON.stringify(variants), pid],
            (err2) => {
              if (err2) {
                return db.run('ROLLBACK', () =>
                  res.status(500).json({ ok: false, message: '更新庫存失敗' })
                );
              }
              deductItem(idx + 1);
            }
          );
        });
      };

      processItem(0);
    });

  } catch (err) {
    console.error('❌ 建立訂單失敗', err);
    res.status(500).json({ ok: false, message: '建立訂單失敗，請稍後再試' });
  }
});

/* =========================================================
 * Front: query order (phone + id)
 * ========================================================= */
app.get('/api/orders/query', (req, res) => {
  const phone = String(req.query.phone || '').trim();
  const id = String(req.query.id || '').trim();

  if (!phone || !id) return res.status(400).json({ message: '請提供 phone 與 id' });

  const orders = readOrders();
  const order = orders.find(o =>
    o.id === id &&
    o.customer &&
    String(o.customer.phone || '').trim() === phone
  );

  if (!order) {
    return res.status(404).json({ message: '查無此訂單，請確認電話與訂單編號是否正確。' });
  }

  // ✅ 前台查詢訂單狀態：統一狀態名稱（避免舊資料是 pending）
  const normalizedStatus = (() => {
    const s = String(order.status || 'new');
    if (s === 'pending') return 'new';
    return s;
  })();

  const statusText = (() => {
    switch (normalizedStatus) {
      case 'shipped': return '已出貨';
      case 'completed': return '已完成';
      case 'cancelled': return '已取消';
      default: return '未完成 / 新訂單';
    }
  })();

  // ✅ 回傳 statusText，前台只要顯示這個就不會漏掉「已出貨」
  res.json({
    ok: true,
    order: {
      ...order,
      status: normalizedStatus,
      statusText
    }
  });
});

/* =========================================================
 * Admin: mark paid (最安全版：只要後台 Cookie + 防 CSRF header)
 * ========================================================= */
app.post("/api/payments/mark-paid", authAdmin, requireAjaxHeader, (req, res) => {
  const { orderId, paymentRef } = req.body || {};
  if (!orderId) return res.status(400).json({ ok: false, message: "missing orderId" });

  const orders = readOrders();
  const idx = orders.findIndex(o => o.id === orderId);
  if (idx === -1) return res.status(404).json({ ok: false, message: "找不到訂單" });

  orders[idx].paymentStatus = "paid";
  orders[idx].paymentRef = paymentRef || orders[idx].paymentRef || "";
  orders[idx].paidAt = new Date().toISOString();
  orders[idx].updatedAt = new Date().toISOString();

  saveOrders(orders);
  res.json({ ok: true, order: orders[idx] });
});

/* =========================================================
 * OPTIONAL: Payment webhook (server-to-server only, uses PAY_MARK_SECRET)
 * ========================================================= */
app.post("/api/payments/webhook/mark-paid", requirePaySecret, (req, res) => {
  const { orderId, paymentRef } = req.body || {};
  if (!orderId) return res.status(400).json({ ok: false, message: "missing orderId" });

  const orders = readOrders();
  const idx = orders.findIndex(o => o.id === orderId);
  if (idx === -1) return res.status(404).json({ ok: false, message: "找不到訂單" });

  orders[idx].paymentStatus = "paid";
  orders[idx].paymentRef = paymentRef || orders[idx].paymentRef || "";
  orders[idx].paidAt = new Date().toISOString();
  orders[idx].updatedAt = new Date().toISOString();

  saveOrders(orders);
  res.json({ ok: true });
});

/* =========================================================
 * Admin: products (SQLite)
 * ========================================================= */
app.get('/api/admin/products', authAdmin, requireAjaxHeader, (req, res) => {
  db.all('SELECT * FROM products ORDER BY id DESC', [], (err, rows) => {
    if (err) {
      console.error('取得商品列表失敗', err);
      return res.status(500).json({ success: false, message: '取得商品失敗' });
    }

    const products = (rows || []).map(row => ({
      id: row.id,
      code: row.code,
      name: row.name,
      price: row.price,
      stock: row.stock,
      category: row.category,
      status: row.status,
      tag: row.tag || '',
      imageUrl: row.imageUrl,
      description: row.description,
      variants: safeJsonParse(row.variantsJson, []),
      detailImages: safeJsonParse(row.detailImagesJson, [])
    }));

    res.json({ success: true, products });
  });
});

app.post('/api/admin/products', authAdmin, requireAjaxHeader, (req, res) => {
  const {
    code, name, price, stock, category, status, tag, imageUrl, description, variants, detailImages
  } = req.body || {};

  if (!name) return res.status(400).json({ success: false, message: '缺少商品名稱' });

  const priceVal = Number(price || 0);
  const stockVal = Number(stock || 0);

  // ✅ 總庫存自動計算：有 variants 就用 variants 庫存加總
  const vTotal = computeTotalStock(variants || []);
  const finalStockVal = (vTotal == null) ? stockVal : vTotal;

  const sql = `
    INSERT INTO products
    (code, name, price, stock, category, status, tag, imageUrl, description, variantsJson, detailImagesJson)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    code || null,
    name,
    isNaN(priceVal) ? 0 : priceVal,
    isNaN(finalStockVal) ? 0 : finalStockVal,
    category || null,
    status || 'on',
    tag || null,
    imageUrl || null,
    description || null,
    JSON.stringify(variants || []),
    JSON.stringify(detailImages || [])
  ];

  db.run(sql, params, function (err) {
    if (err) {
      console.error('新增商品失敗', err);
      return res.status(500).json({ success: false, message: '新增商品失敗' });
    }
    res.json({ success: true, id: this.lastID });
  });
});

app.patch('/api/admin/products/:id', authAdmin, requireAjaxHeader, (req, res) => {
  const productId = req.params.id;
  const {
    code, name, price, stock, category, status, tag, imageUrl, description, variants, detailImages
  } = req.body || {};

  const priceVal = Number(price || 0);
  const stockVal = Number(stock || 0);

  // ✅ 總庫存自動計算：有 variants 就用 variants 庫存加總
  const vTotal = computeTotalStock(variants || []);
  const finalStockVal = (vTotal == null) ? stockVal : vTotal;

  const sql = `
    UPDATE products
    SET code = ?, name = ?, price = ?, stock = ?, category = ?, status = ?,
        tag = ?, imageUrl = ?, description = ?, variantsJson = ?, detailImagesJson = ?
    WHERE id = ?
  `;

  const params = [
    code || null,
    name || '',
    isNaN(priceVal) ? 0 : priceVal,
    isNaN(finalStockVal) ? 0 : finalStockVal,
    category || null,
    status || 'on',
    tag || null,
    imageUrl || null,
    description || null,
    JSON.stringify(variants || []),
    JSON.stringify(detailImages || []),
    productId
  ];

  db.run(sql, params, function (err) {
    if (err) {
      console.error('更新商品失敗', err);
      return res.status(500).json({ success: false, message: '更新商品失敗' });
    }
    res.json({ success: true });
  });
});

app.delete('/api/admin/products/:id', authAdmin, requireAjaxHeader, (req, res) => {
  const productId = req.params.id;

  db.run('DELETE FROM products WHERE id = ?', [productId], function (err) {
    if (err) {
      console.error('刪除商品失敗', err);
      return res.status(500).json({ success: false, message: '刪除商品失敗' });
    }
    res.json({ success: true });
  });
});

/* =========================================================
 * Admin: orders (orders.json)
 * ========================================================= */
app.get('/api/admin/orders', authAdmin, requireAjaxHeader, (req, res) => {
  const orders = readOrders();
  res.json({ ok: true, orders });
});

app.patch('/api/admin/orders/:id', authAdmin, requireAjaxHeader, (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};

  if (!status) return res.status(400).json({ ok: false, message: '缺少狀態欄位' });

  const orders = readOrders();
  const idx = orders.findIndex(o => o.id === id);

  if (idx === -1) return res.status(404).json({ ok: false, message: '找不到這筆訂單' });

  orders[idx].status = status;
  orders[idx].updatedAt = new Date().toISOString();
  saveOrders(orders);

  res.json({ ok: true, order: orders[idx] });
});

/* =========================================================
 * Start
 * ========================================================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port', PORT);
});
