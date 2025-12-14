// server.js
require('dotenv').config();
console.log('🔥 SANXIAOZI ADMIN SERVER STARTED');

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

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
    if (!origin) return cb(null, true);
    if (ALLOW_ORIGINS.has(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-requested-with', 'x-pay-secret']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* =========================================================
 * Supabase (DB)
 * ========================================================= */
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('⚠️ Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Server will not work correctly.');
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/* =========================================================
 * Admin Auth (最安全版：HttpOnly Cookie session)
 * ========================================================= */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'a1216321';
const PAY_MARK_SECRET = process.env.PAY_MARK_SECRET || '';

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
  if (!PAY_MARK_SECRET) return res.status(500).json({ ok: false, message: 'PAY_MARK_SECRET not set' });
  if (!got || got !== PAY_MARK_SECRET) return res.status(401).json({ ok: false, message: 'unauthorized' });
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

  // ✅ 重點：
  // - 正式站：SameSite=None; Secure（讓前台/後台跨子網域/跨站也能帶 cookie）
  // - 本地：SameSite=Lax（但你必須用 http://localhost:3000/admin.html 開後台，避免 5500 跨站）
  const cookieAttrs = isProd
    ? `Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${60 * 60 * 24 * 7}`
    : `Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`;

  res.setHeader('Set-Cookie', [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieAttrs}`
  ]);

  res.json({ ok: true });
});

// ✅ 登出：清 cookie + 清 session
app.post('/api/admin/logout', authAdmin, requireAjaxHeader, (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[ADMIN_COOKIE_NAME];
  if (token) adminTokens.delete(token);

  const isProd = process.env.NODE_ENV === 'production';
  const cookieAttrs = isProd
    ? `Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`
    : `Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

  res.setHeader('Set-Cookie', [
    `${ADMIN_COOKIE_NAME}=; ${cookieAttrs}`
  ]);

  res.json({ ok: true });
});

/* =========================================================
 * Email (Resend): admin notify + customer confirmation
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

/* =========================================================
 * Helpers
 * ========================================================= */
function safeJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return fallback; }
  }
  return v;
}

function computeTotalStock(variants) {
  try {
    if (!Array.isArray(variants) || variants.length === 0) return null;
    return variants.reduce((sum, v) => sum + (Number(v?.stock || 0) || 0), 0);
  } catch {
    return null;
  }
}

// ND + YYYYMMDD + 4 digits（改用 Supabase orders 計算）
async function generateOrderIdFromDB() {
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const datePrefix = `${y}${m}${d}`;
  const prefix = `ND${datePrefix}`;

  const { data, error } = await supabase
    .from('orders')
    .select('id')
    .like('id', `${prefix}%`);

  if (error) throw error;
  const nextIndex = (data?.length || 0) + 1;
  return `${prefix}${String(nextIndex).padStart(4, '0')}`;
}

/* =========================================================
 * DB wrappers: Products / Orders (Supabase)
 * ========================================================= */
async function dbListProductsAdmin() {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('id', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function dbListProductsFront() {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('status', 'on')
    .order('id', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function dbGetProductById(id) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function dbInsertProduct(payload) {
  const { data, error } = await supabase
    .from('products')
    .insert([payload])
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

async function dbUpdateProduct(id, payload) {
  const { error } = await supabase
    .from('products')
    .update(payload)
    .eq('id', id);
  if (error) throw error;
}

async function dbDeleteProduct(id) {
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

async function dbListOrdersAdmin() {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .order('createdAt', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function dbUpdateOrderStatus(orderId, status) {
  const { data, error } = await supabase
    .from('orders')
    .update({ status, updatedAt: new Date().toISOString() })
    .eq('id', orderId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function dbMarkOrderPaid(orderId, paymentRef) {
  const patch = {
    paymentStatus: "paid",
    paymentRef: paymentRef || "",
    paidAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const { data, error } = await supabase
    .from('orders')
    .update(patch)
    .eq('id', orderId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function dbInsertOrder(order) {
  const { error } = await supabase
    .from('orders')
    .insert([order]);
  if (error) throw error;
}

/* =========================================================
 * Stock deduction (best-effort atomic update with retry)
 * - 若你要 100% 併發安全：我之後會給你一個 Postgres RPC function 版本
 * ========================================================= */
async function deductStockForItems(items) {
  // 先檢查 + 扣庫存：逐項處理，遇到不足就 throw
  // 這裡做 "讀 -> 算 -> 條件更新"（eq(stock,oldStock)）並重試，降低併發風險
  const tagMap = {}; // productId -> tag

  for (const it of items) {
    const pid = it.productId;
    const specKey = it.specKey || null;
    const qty = Number(it.qty || 0);
    if (!pid || qty <= 0) continue;

    let ok = false;
    let lastErr = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const p = await dbGetProductById(pid);
      if (!p) throw new Error('扣庫存時找不到商品');

      const stock = Number(p.stock || 0);
      const variants = safeJson(p.variants, safeJson(p.variantsJson, [])) || [];
      const tag = p.tag || '';
      tagMap[pid] = tag;

      if (specKey && Array.isArray(variants) && variants.length > 0) {
        const v = variants.find(v => v?.name === specKey || v?.key === specKey);
        if (!v) throw new Error('找不到該款式');
        const vStock = Number(v.stock || 0);
        if (vStock < qty) {
          const e = new Error('部分商品庫存不足');
          e.insufficient = [{ productId: pid, specKey, remain: vStock, want: qty }];
          throw e;
        }
        v.stock = Math.max(0, vStock - qty);

        // 總庫存也跟著減（保留你原本邏輯）
        const newStock = Math.max(0, stock - qty);

        // 條件更新（用 old stock 當條件）
        const { error } = await supabase
          .from('products')
          .update({ stock: newStock, variants })
          .eq('id', pid)
          .eq('stock', stock);

        if (!error) { ok = true; break; }
        lastErr = error;
        continue;
      } else {
        if (stock < qty) {
          const e = new Error('部分商品庫存不足');
          e.insufficient = [{ productId: pid, specKey: null, remain: stock, want: qty }];
          throw e;
        }

        const newStock = Math.max(0, stock - qty);
        const { error } = await supabase
          .from('products')
          .update({ stock: newStock })
          .eq('id', pid)
          .eq('stock', stock);

        if (!error) { ok = true; break; }
        lastErr = error;
        continue;
      }
    }

    if (!ok) {
      console.error('❌ deduct stock failed', lastErr);
      throw new Error('更新庫存失敗（可能同時下單，請重試）');
    }
  }

  return tagMap;
}

/* =========================================================
 * Front: products list (only status=on)
 * ========================================================= */
app.get('/api/products', async (req, res) => {
  try {
    const rows = await dbListProductsFront();

    const products = (rows || []).map(row => {
      const variants = safeJson(row.variants, safeJson(row.variantsJson, [])) || [];
      const detailImages = safeJson(row.detailImages, safeJson(row.detailImagesJson, [])) || [];

      const categories = row.category
        ? String(row.category).split(/[,\s]+/).filter(Boolean)
        : [];

      const commonThumbs = detailImages.length
        ? detailImages
        : (row.imageUrl ? [row.imageUrl] : []);

      const vTotal = computeTotalStock(variants);
      const computedStock = (vTotal == null) ? Number(row.stock || 0) : vTotal;

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
          stock: row.stock != null ? Number(row.stock || 0) : null,
          mainImg: row.imageUrl || '',
          thumbs: commonThumbs
        }];
      }

      return {
        id: row.id,
        code: row.code,
        name: row.name,
        price: Number(row.price || 0),
        stock: computedStock,
        categories,
        tag: row.tag || '',
        subtitle: '',
        priceNote: '',
        shortDesc: row.description
          ? String(row.description).slice(0, 40) + (String(row.description).length > 40 ? '…' : '')
          : '',
        imageUrl: row.imageUrl,
        detailHtml: row.description || '',
        specs
      };
    });

    res.json({ success: true, products });
  } catch (err) {
    console.error('查詢 products 失敗', err);
    res.status(500).json({ success: false, message: '查詢商品失敗' });
  }
});

/* =========================================================
 * Front: create order (check stock -> deduct -> write orders to Supabase)
 * ========================================================= */
app.post('/api/orders', async (req, res) => {
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

    // ✅ 後台用 new/completed/cancelled/shipped 篩選，所以新訂單用 new
    // ✅ 同步 shipType 到 customer.ship
    const fixedCustomer = { ...customer, ship: shipType };

    const payMethod = String(customer.pay || "shopee").toLowerCase();
    let payStatus = "unpaid";
    if (["linepay", "ecpay", "card"].includes(payMethod)) payStatus = "pending";

    // ✅ 先扣庫存（若不足會 throw）
    const tagMap = await deductStockForItems(items);

    // ✅ Split orders: 現貨 / 備貨(10-15天) 分開出單
    const normalizedItems = (items || []).map(it => ({
      ...it,
      tag: it.tag || tagMap[it.productId] || ''
    }));

    const leadtimeItems = normalizedItems.filter(it => it.tag === 'leadtime_10_15');
    const stockItems = normalizedItems.filter(it => it.tag !== 'leadtime_10_15');

    const now = new Date().toISOString();

    const stockSubtotal = stockItems.reduce((s, it) => s + (Number(it.price||0)*Number(it.qty||0)), 0);
    const leadSubtotal  = leadtimeItems.reduce((s, it) => s + (Number(it.price||0)*Number(it.qty||0)), 0);

    const orderBase = {
      status: 'new',
      createdAt: now,
      updatedAt: now,

      shipType,
      subtotal,
      shippingFee,
      totalAmount,

      paymentMethod: payMethod,
      paymentStatus: payStatus,
      paymentRef: "",
      paidAt: null,

      items: normalizedItems,
      customer: fixedCustomer
    };

    const createdIds = [];
    let stockOrder = null;
    let leadOrder = null;

    // 產生第一張（現貨/或全備貨）
    const id1 = await generateOrderIdFromDB();

    stockOrder = {
      ...orderBase,
      id: id1,
      fulfillType: (leadtimeItems.length > 0 && stockItems.length === 0) ? 'leadtime' : 'stock',
      items: (leadtimeItems.length > 0 && stockItems.length === 0) ? leadtimeItems : stockItems,
      subtotal: (leadtimeItems.length > 0 && stockItems.length === 0) ? leadSubtotal : stockSubtotal,
      // shippingFee 只收一次：現貨單收，備貨單不再重複收
      shippingFee: shippingFee,
      totalAmount: ((leadtimeItems.length > 0 && stockItems.length === 0) ? leadSubtotal : stockSubtotal) + shippingFee,
    };

    await dbInsertOrder(stockOrder);
    createdIds.push(stockOrder.id);

    if (leadtimeItems.length > 0 && stockItems.length > 0) {
      const id2 = await generateOrderIdFromDB();
      leadOrder = {
        ...orderBase,
        id: id2,
        fulfillType: 'leadtime',
        items: leadtimeItems,
        subtotal: leadSubtotal,
        shippingFee: 0,
        totalAmount: leadSubtotal
      };
      await dbInsertOrder(leadOrder);
      createdIds.push(leadOrder.id);
    }

    // ✅ 寄信（失敗不影響下單成功）
    (async () => {
      try {
        if (ORDER_NOTIFY_EMAIL) {
          await sendEmailViaResend({
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

          if (leadOrder) {
            await sendEmailViaResend({
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
          const combinedTotal =
            (Number(stockOrder.totalAmount || 0) || 0) +
            (leadOrder ? (Number(leadOrder.totalAmount || 0) || 0) : 0);

          await sendEmailViaResend({
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
        }
      } catch (e) {
        console.error('❌ customer mail error', e);
      }
    })();

    res.json({
      ok: true,
      id: stockOrder.id,
      splitIds: createdIds,
      createdAt: stockOrder.createdAt,
      status: stockOrder.status,
      subtotal: stockOrder.subtotal,
      shippingFee: stockOrder.shippingFee,
      totalAmount: (Number(stockOrder.totalAmount || 0) || 0) + (leadOrder ? (Number(leadOrder.totalAmount || 0) || 0) : 0),
      shipType: stockOrder.shipType
    });

  } catch (err) {
    console.error('❌ 建立訂單失敗', err);
    if (err?.insufficient) {
      return res.status(400).json({ ok: false, message: '部分商品庫存不足', insufficient: err.insufficient });
    }
    res.status(500).json({ ok: false, message: err?.message || '建立訂單失敗，請稍後再試' });
  }
});

/* =========================================================
 * Front: query order (phone + id)
 * ========================================================= */
app.get('/api/orders/query', async (req, res) => {
  const phone = String(req.query.phone || '').trim();
  const id = String(req.query.id || '').trim();

  if (!phone || !id) return res.status(400).json({ message: '請提供 phone 與 id' });

  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ message: '查無此訂單，請確認電話與訂單編號是否正確。' });

    const customer = safeJson(data.customer, {}) || {};
    if (String(customer.phone || '').trim() !== phone) {
      return res.status(404).json({ message: '查無此訂單，請確認電話與訂單編號是否正確。' });
    }

    const normalizedStatus = (() => {
      const s = String(data.status || 'new');
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

    res.json({
      ok: true,
      order: {
        ...data,
        customer,
        items: safeJson(data.items, []) || [],
        status: normalizedStatus,
        statusText
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: '查詢訂單失敗' });
  }
});

/* =========================================================
 * Admin: mark paid (Cookie + 防 CSRF header)
 * ========================================================= */
app.post("/api/payments/mark-paid", authAdmin, requireAjaxHeader, async (req, res) => {
  const { orderId, paymentRef } = req.body || {};
  if (!orderId) return res.status(400).json({ ok: false, message: "missing orderId" });

  try {
    const order = await dbMarkOrderPaid(orderId, paymentRef);
    if (!order) return res.status(404).json({ ok: false, message: "找不到訂單" });
    res.json({ ok: true, order });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: '更新付款狀態失敗' });
  }
});

/* =========================================================
 * OPTIONAL: Payment webhook (server-to-server only, uses PAY_MARK_SECRET)
 * ========================================================= */
app.post("/api/payments/webhook/mark-paid", requirePaySecret, async (req, res) => {
  const { orderId, paymentRef } = req.body || {};
  if (!orderId) return res.status(400).json({ ok: false, message: "missing orderId" });

  try {
    const order = await dbMarkOrderPaid(orderId, paymentRef);
    if (!order) return res.status(404).json({ ok: false, message: "找不到訂單" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: '更新付款狀態失敗' });
  }
});

/* =========================================================
 * Admin: products (Supabase)
 * ========================================================= */
app.get('/api/admin/products', authAdmin, requireAjaxHeader, async (req, res) => {
  try {
    const rows = await dbListProductsAdmin();
    const products = (rows || []).map(row => ({
      id: row.id,
      code: row.code,
      name: row.name,
      price: Number(row.price || 0),
      stock: Number(row.stock || 0),
      category: row.category,
      status: row.status,
      tag: row.tag || '',
      imageUrl: row.imageUrl,
      description: row.description,
      variants: safeJson(row.variants, safeJson(row.variantsJson, [])) || [],
      detailImages: safeJson(row.detailImages, safeJson(row.detailImagesJson, [])) || []
    }));
    res.json({ success: true, products });
  } catch (err) {
    console.error('取得商品列表失敗', err);
    res.status(500).json({ success: false, message: '取得商品失敗' });
  }
});

app.post('/api/admin/products', authAdmin, requireAjaxHeader, async (req, res) => {
  const {
    code, name, price, stock, category, status, tag, imageUrl, description, variants, detailImages
  } = req.body || {};

  if (!name) return res.status(400).json({ success: false, message: '缺少商品名稱' });

  const priceVal = Number(price || 0);
  const stockVal = Number(stock || 0);

  // ✅ 總庫存自動計算：有 variants 就用 variants 庫存加總
  const vTotal = computeTotalStock(variants || []);
  const finalStockVal = (vTotal == null) ? stockVal : vTotal;

  try {
    const payload = {
      code: code || null,
      name,
      price: isNaN(priceVal) ? 0 : priceVal,
      stock: isNaN(finalStockVal) ? 0 : finalStockVal,
      category: category || null,
      status: status || 'on',
      tag: tag || null,
      imageUrl: imageUrl || null,
      description: description || null,
      variants: variants || [],
      detailImages: detailImages || []
    };

    const data = await dbInsertProduct(payload);
    res.json({ success: true, id: data?.id });
  } catch (err) {
    console.error('新增商品失敗', err);
    res.status(500).json({ success: false, message: '新增商品失敗' });
  }
});

app.patch('/api/admin/products/:id', authAdmin, requireAjaxHeader, async (req, res) => {
  const productId = req.params.id;
  const {
    code, name, price, stock, category, status, tag, imageUrl, description, variants, detailImages
  } = req.body || {};

  const priceVal = Number(price || 0);
  const stockVal = Number(stock || 0);

  const vTotal = computeTotalStock(variants || []);
  const finalStockVal = (vTotal == null) ? stockVal : vTotal;

  try {
    const payload = {
      code: code || null,
      name: name || '',
      price: isNaN(priceVal) ? 0 : priceVal,
      stock: isNaN(finalStockVal) ? 0 : finalStockVal,
      category: category || null,
      status: status || 'on',
      tag: tag || null,
      imageUrl: imageUrl || null,
      description: description || null,
      variants: variants || [],
      detailImages: detailImages || []
    };

    await dbUpdateProduct(productId, payload);
    res.json({ success: true });
  } catch (err) {
    console.error('更新商品失敗', err);
    res.status(500).json({ success: false, message: '更新商品失敗' });
  }
});

app.delete('/api/admin/products/:id', authAdmin, requireAjaxHeader, async (req, res) => {
  const productId = req.params.id;

  try {
    await dbDeleteProduct(productId);
    res.json({ success: true });
  } catch (err) {
    console.error('刪除商品失敗', err);
    res.status(500).json({ success: false, message: '刪除商品失敗' });
  }
});

/* =========================================================
 * Admin: orders (Supabase)
 * ========================================================= */
app.get('/api/admin/orders', authAdmin, requireAjaxHeader, async (req, res) => {
  try {
    const rows = await dbListOrdersAdmin();
    // 讓 admin.html 直接用：customer/items 變回物件/陣列
    const orders = (rows || []).map(o => ({
      ...o,
      customer: safeJson(o.customer, {}) || {},
      items: safeJson(o.items, []) || [],
    }));
    res.json({ ok: true, orders });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: '讀取訂單失敗' });
  }
});

app.patch('/api/admin/orders/:id', authAdmin, requireAjaxHeader, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};

  if (!status) return res.status(400).json({ ok: false, message: '缺少狀態欄位' });

  try {
    const order = await dbUpdateOrderStatus(id, status);
    if (!order) return res.status(404).json({ ok: false, message: '找不到這筆訂單' });
    res.json({ ok: true, order });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: '更新訂單狀態失敗' });
  }
});

/* =========================================================
 * Start
 * ========================================================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port', PORT);
});
