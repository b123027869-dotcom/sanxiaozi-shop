// server.js
require('dotenv').config();
const ECPAY_MERCHANT_ID = process.env.ECPAY_MERCHANT_ID || '';
const ECPAY_HASH_KEY    = process.env.ECPAY_HASH_KEY || '';
const ECPAY_HASH_IV     = process.env.ECPAY_HASH_IV || '';
console.log('🔥 SANXIAOZI ADMIN SERVER STARTED');

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.set('trust proxy', 1);

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
      "connect-src 'self' http://localhost:3000 https://sanxiaozi-shop.onrender.com https://*.supabase.co",
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
    if (!origin) return cb(null, true);                 // server-to-server / curl 會是空
    if (ALLOW_ORIGINS.has(origin)) return cb(null, true); // 你允許的前端
    return cb(null, false);                             // ✅ 不丟錯，只是不加 CORS header
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-requested-with', 'x-pay-secret']
}));


app.use(express.json());
app.use(express.urlencoded({ extended: true })); // ✅ 綠界回呼最常用 urlencoded
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
  if (!RESEND_API_KEY || !RESEND_FROM) {
    return { ok: false, skipped: true, reason: 'missing_config' };
  }

  const email = String(to || '').trim();

  // ✅ 基本 email 格式檢查（不合法就直接略過，不丟錯）
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.warn('⚠️ skip email: invalid address =', JSON.stringify(email));
    return { ok: false, skipped: true, reason: 'invalid_email' };
  }

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: RESEND_FROM, to: email, subject, html })
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

const ECPAY_ENV = (process.env.ECPAY_ENV || 'prod').toLowerCase();

function ecpayGatewayUrl() {
  return (ECPAY_ENV === 'stage')
    ? 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5'
    : 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';
}

function ecpayUrlEncode(str) {
  const encoded = encodeURIComponent(str).toLowerCase().replace(/%20/g, '+');
  return encoded
    .replace(/%2d/g, '-')
    .replace(/%5f/g, '_')
    .replace(/%2e/g, '.')
    .replace(/%21/g, '!')
    .replace(/%2a/g, '*')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')');
}


function normalizeEcpayBody(input) {
  const out = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (Array.isArray(v)) out[k] = String(v[0] ?? '');
    else if (v && typeof v === 'object') out[k] = String(v.value ?? '');
    else out[k] = String(v ?? '');
  }
  return out;
}







function genCheckMacValue(params) {
  const raw = { ...params };
  delete raw.CheckMacValue;

  const keys = Object.keys(raw).sort((a,b) => a.localeCompare(b));
  const qs = keys.map(k => `${k}=${raw[k]}`).join('&');

  const toEncode = `HashKey=${ECPAY_HASH_KEY}&${qs}&HashIV=${ECPAY_HASH_IV}`;
  const encoded = ecpayUrlEncode(toEncode);
  return crypto.createHash('sha256').update(encoded).digest('hex').toUpperCase();
}

function buildAutoSubmitForm(action, fields) {
  const inputs = Object.entries(fields).map(([k,v]) =>
    `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(String(v ?? ''))}">`
  ).join('\n');

  return `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body>
  <p style="font-family:system-ui;padding:16px;">正在前往綠界付款頁面…</p>
  <form id="__ecpay" method="POST" action="${escapeHtml(action)}">
    ${inputs}
  </form>
  <script>document.getElementById('__ecpay').submit();</script>
</body></html>`;
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


async function sendPaidEmailsByPaymentRef(paymentRef) {
  if (!paymentRef) return;

  // 撈出同一個 paymentRef 的所有訂單（支援拆單）
  const { data: orders, error } = await supabase
    .from('orders')
    .select('*')
    .eq('paymentRef', paymentRef)
    .order('createdAt', { ascending: true });

  if (error) throw error;
  if (!orders || orders.length === 0) return;

  // 已寄過就不要再寄（避免回呼重送）
  const alreadySent = orders.some(o => o.emailSent === true);
  if (alreadySent) return;

  // 合併資料（給客人一封就好）
  const mergedIds = orders.map(o => o.id).join(' / ');
  const mergedItems = orders.flatMap(o => safeJson(o.items, []) || []);
  const customer = safeJson(orders[0].customer, {}) || {};
  const mergedTotal = orders.reduce((s, o) => s + (Number(o.totalAmount || 0) || 0), 0);

  // 運費：通常只有現貨那單有收，取第一筆 shippingFee > 0 的，沒有就取第一筆
  const shipFee = (() => {
    const hit = orders.find(o => (Number(o.shippingFee || 0) || 0) > 0);
    return Number((hit || orders[0]).shippingFee || 0) || 0;
  })();

  // 1) 寄給站長（每筆訂單各寄一封，方便你對帳）
  try {
    if (ORDER_NOTIFY_EMAIL) {
      for (const o of orders) {
        const oCustomer = safeJson(o.customer, {}) || {};
        const oItems = safeJson(o.items, []) || [];
        await sendEmailViaResend({
          to: ORDER_NOTIFY_EMAIL,
          subject: `✅ 付款成功通知：${o.id}`,
          html: buildAdminMail({
            orderId: o.id,
            customer: oCustomer,
            items: oItems,
            totalAmount: Number(o.totalAmount || 0) || 0,
            shippingFee: Number(o.shippingFee || 0) || 0,
            fulfillType: o.fulfillType || ''
          })
        });
      }
    }
  } catch (e) {
    console.error('❌ admin paid mail error', e);
  }

  // 2) 寄給客人（合併一封）
  try {
    const toCustomer = String(customer?.email || '').trim();
    if (toCustomer) {
      await sendEmailViaResend({
        to: toCustomer,
        subject: `✅【三小隻日常百貨】付款成功：${mergedIds}`,
        html: buildCustomerMail({
          orderId: mergedIds,
          customer,
          items: mergedItems,
          totalAmount: mergedTotal,
          shippingFee: shipFee
        })
      });
    }
  } catch (e) {
    console.error('❌ customer paid mail error', e);
  }

  // 寫入已寄信旗標（全部同一個 paymentRef 都標記）
  try {
    const { error: uerr } = await supabase
      .from('orders')
      .update({ emailSent: true, emailSentAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .eq('paymentRef', paymentRef);

    if (uerr) throw uerr;
  } catch (e) {
    console.error('❌ set emailSent failed', e);
  }
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

const STORAGE_BUCKET = process.env.SUPABASE_BUCKET || 'product-images';

function storagePathFromUrl(url) {
  const u = String(url || '').trim();
  if (!u) return null;

  if (!/^https?:\/\//i.test(u)) return u.replace(/^\/+/, '');

  const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
  const idx = u.indexOf(marker);
  if (idx >= 0) return u.slice(idx + marker.length).replace(/^\/+/, '');

  return null;
}

async function storageRemovePaths(paths) {
  try {
    const list = (paths || []).filter(Boolean);
    if (list.length === 0) return;

    const { error } = await supabase
      .storage
      .from(STORAGE_BUCKET)
      .remove(list);

    if (error) console.warn('⚠️ storage remove failed:', error);
  } catch (e) {
    console.warn('⚠️ storage remove exception:', e);
  }
}


function collectProductImagePaths(productRow) {
  const paths = new Set();

  const imageUrl = productRow?.imageUrl;
  const p1 = storagePathFromUrl(imageUrl);
  if (p1) paths.add(p1);

  const detailImages = safeJson(productRow?.detailImages, safeJson(productRow?.detailImagesJson, [])) || [];
  for (const u of detailImages) {
    const p = storagePathFromUrl(u);
    if (p) paths.add(p);
  }

  const variants = safeJson(productRow?.variants, safeJson(productRow?.variantsJson, [])) || [];
  for (const v of variants) {
    const p = storagePathFromUrl(v?.imageUrl);
    if (p) paths.add(p);
  }

  return [...paths];
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
  // 1) 先抓商品資料（為了拿到圖片路徑）
  const p = await dbGetProductById(id);
  if (!p) return;

  // 2) 刪 Storage 圖檔（最佳努力：失敗不阻擋刪商品）
  try {
    const paths = collectProductImagePaths(p);
    if (paths.length > 0) {
      const { error: serr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove(paths);

      if (serr) console.warn('⚠️ storage remove failed:', serr);
    }
  } catch (e) {
    console.warn('⚠️ storage remove exception:', e);
  }

  // 3) 再刪 products 那列
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
 * - 支援：款式庫存、總庫存、預購(用負數累積)、預購上限
 * ========================================================= */
async function deductStockForItems(items) {
  const tagMap = {}; // productId -> tag
  const PREORDER_LIMIT_DEFAULT = 20; // ✅ 預購/備貨上限（要幾件就改這裡）

  for (const it of (items || [])) {
    const pid = Number(it.productId);
    const specKey = (it.specKey != null && String(it.specKey).trim() !== '') ? String(it.specKey).trim() : null;
    const qty = Number(it.qty || 0);

    if (!pid || qty <= 0) continue;

    let ok = false;
    let lastErr = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const p = await dbGetProductById(pid);
      if (!p) throw new Error('扣庫存時找不到商品');

      const stock = Number(p.stock || 0); // 允許負數：代表預購已售
      const variants = safeJson(p.variants, safeJson(p.variantsJson, [])) || [];
      const tag = String(p.tag || '').trim();
      tagMap[pid] = tag;

      // ====== A) 有款式 ======
      if (specKey && Array.isArray(variants) && variants.length > 0) {
        const v = variants.find(x => String(x?.name || x?.key || '').trim() === specKey);
        if (!v) throw new Error('找不到該款式');

        const vStock = Number(v.stock || 0); // 允許負數：款式預購已售

        // 款式庫存 > 0：正常扣；<=0：預購模式（用負數累積）
        if (vStock > 0) {
          if (vStock < qty) {
            const e = new Error('部分商品庫存不足');
            e.insufficient = [{ productId: pid, specKey, remain: vStock, want: qty }];
            throw e;
          }
          v.stock = vStock - qty;
        } else {
          const sold = Math.abs(vStock);
          const remaining = PREORDER_LIMIT_DEFAULT - sold;
          if (qty > remaining) {
            const e = new Error('此款式預購已達上限');
            e.insufficient = [{ productId: pid, specKey, remain: remaining, want: qty }];
            throw e;
          }
          v.stock = vStock - qty; // 0 -> -qty -> -qty2...
        }

        // 商品總庫存：為了讓前台能顯示「剩餘/已售」一致，這裡也用同樣方式扣（可變負數）
        const newStock = stock - qty;

        const { error } = await supabase
          .from('products')
          .update({ stock: newStock, variants })
          .eq('id', pid)
          .eq('stock', stock); // 樂觀鎖

        if (!error) { ok = true; break; }
        lastErr = error;
        continue;
      }

      // ====== B) 無款式（只有商品總庫存） ======
      let newStock = stock;

      if (stock > 0) {
        if (stock < qty) {
          const e = new Error('部分商品庫存不足');
          e.insufficient = [{ productId: pid, specKey: null, remain: stock, want: qty }];
          throw e;
        }
        newStock = stock - qty;
      } else {
        // 預購模式：stock <= 0 用負數累積
        const sold = Math.abs(stock);
        const remaining = PREORDER_LIMIT_DEFAULT - sold;
        if (qty > remaining) {
          const e = new Error('此商品預購已達上限');
          e.insufficient = [{ productId: pid, specKey: null, remain: remaining, want: qty }];
          throw e;
        }
        newStock = stock - qty; // 0 -> -qty -> -qty2...
      }

      const { error } = await supabase
        .from('products')
        .update({ stock: newStock })
        .eq('id', pid)
        .eq('stock', stock); // 樂觀鎖

      if (!error) { ok = true; break; }
      lastErr = error;
    }

    if (!ok) {
      console.error('❌ deduct stock failed', lastErr);
      throw new Error('更新庫存失敗（可能同時下單，請重試）');
    }
  }

  return tagMap;
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
	const email = String(customer.email || '').trim();
const atCount = (email.match(/@/g) || []).length;
if (atCount !== 1) {
  return res.status(400).json({ ok: false, message: 'Email 格式不正確，@ 只能有一個，請修改後再送出' });
}
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, message: '購物車是空的' });
    }

    // Shipping rules
    const FREE_SHIP_THRESHOLD = 699;
    const SHIPPING_FEE = 100;
    const SHIP_METHODS_WITH_FEE = new Set(['711', 'family', 'hilife', 'ok', 'home']);

   // ✅ 1) 後端重算商品單價（不信任前端 price / name / tag）
const normalizedItems = [];
for (const it of items) {
  const pid = Number(it.productId);
  const qty = Number(it.qty || 0);

  if (!pid || qty <= 0) continue;

  const p = await dbGetProductById(pid);
  if (!p) {
    return res.status(400).json({ ok: false, message: "購物車內有不存在的商品" });
  }

  const serverPrice = Number(p.price || 0) || 0;
  const serverTag = String(p.tag || "").trim();

  const specKey = String(it.specKey || it.key || it.spec || "").trim() || null;
  const specLabel = String(it.specLabel || "").trim();

  normalizedItems.push({
    productId: pid,
    qty,
    specKey,
    specLabel,
    price: serverPrice,  // ✅ 強制用後端價格
    name: p.name || "",
    tag: serverTag
  });
}

if (normalizedItems.length === 0) {
  return res.status(400).json({ ok: false, message: "購物車是空的" });
}

// ✅ 2) subtotal 用後端重算的 items 來算（杜絕改價）
const subtotal = normalizedItems.reduce((sum, it) => sum + it.price * it.qty, 0);


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

const payMethod = String(customer.pay || "cod").toLowerCase();
const needEcpay = (payMethod === "card" || payMethod === "atm");
let payStatus = "unpaid";
if (["card", "atm", "linepay"].includes(payMethod)) payStatus = "pending";

    // ✅ 先扣庫存（若不足會 throw）
    const tagMap = await deductStockForItems(normalizedItems);

// ✅ normalizedItems 已經是後端重建好的；這裡只保險補上 tagMap
const finalItems = normalizedItems.map(it => ({
  ...it,
  tag: it.tag || tagMap[it.productId] || ''
}));


const leadtimeItems = finalItems.filter(it => it.tag === 'leadtime_10_15');
const stockItems = finalItems.filter(it => it.tag !== 'leadtime_10_15');

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
      paidAt: null,

      items: finalItems,
      customer: fixedCustomer
    };

    const createdIds = [];
    let stockOrder = null;
    let leadOrder = null;

    // 產生第一張（現貨/或全備貨）
    const id1 = await generateOrderIdFromDB();
	const paymentRef = id1; // 用第一張單號當付款 ref

    stockOrder = {
      ...orderBase,
      id: id1,
	  paymentRef: paymentRef,
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
		paymentRef: paymentRef,
        fulfillType: 'leadtime',
        items: leadtimeItems,
        subtotal: leadSubtotal,
        shippingFee: 0,
        totalAmount: leadSubtotal
      };
      await dbInsertOrder(leadOrder);
      createdIds.push(leadOrder.id);
    }





res.json({
  ok: true,
  id: stockOrder.id,
  splitIds: createdIds,
  createdAt: stockOrder.createdAt,
  status: stockOrder.status,
  subtotal: stockOrder.subtotal,
  shippingFee: stockOrder.shippingFee,
  totalAmount: (Number(stockOrder.totalAmount || 0) || 0) + (leadOrder ? (Number(leadOrder.totalAmount || 0) || 0) : 0),
  shipType: stockOrder.shipType,

  // ✅ 新增這段（重點：前一行要有逗號）
payment: needEcpay
  ? { redirectUrl: `/pay/ecpay?ref=${encodeURIComponent(paymentRef)}&pm=${encodeURIComponent(payMethod)}` }
  : null

});

  } catch (err) {
    console.error('❌ 建立訂單失敗', err);

    // 你在 deductStockForItems() 裡有丟 err.insufficient
    if (err && err.insufficient) {
      return res.status(400).json({
        ok: false,
        message: '部分商品庫存不足',
        insufficient: err.insufficient
      });
    }

    return res.status(500).json({
      ok: false,
      message: err?.message || '建立訂單失敗，請稍後再試'
    });
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

    const ref = String(order?.paymentRef || paymentRef || "").trim();
    if (ref) await sendPaidEmailsByPaymentRef(ref);

    return res.json({ ok: true, order });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, message: "更新付款狀態失敗" });
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

    const ref = String(order?.paymentRef || paymentRef || "").trim();
    if (ref) await sendPaidEmailsByPaymentRef(ref);

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, message: "更新付款狀態失敗" });
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
	
  const removed = Array.isArray(req.body?.removedDetailImages) ? req.body.removedDetailImages : [];
const removedPaths = removed.map(storagePathFromUrl).filter(Boolean);

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
	await storageRemovePaths(removedPaths);

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
 * ECPay: redirect + callback
 * ========================================================= */

// 1) 客人下單後要導去綠界：GET /pay/ecpay?ref=xxxx
app.get('/pay/ecpay', async (req, res) => {
  try {
    const ref = String(req.query.ref || '').trim();
	const pm = String(req.query.pm || '').toLowerCase();
const choosePayment = (pm === 'atm') ? 'ATM' : (pm === 'card') ? 'Credit' : 'ALL';

    if (!ref) return res.status(400).send('missing ref');

    if (!ECPAY_MERCHANT_ID || !ECPAY_HASH_KEY || !ECPAY_HASH_IV) {
      return res.status(500).send('ECPay env not set');
    }

    // 同一個 paymentRef 可能對應拆單兩筆
    const { data: orders, error } = await supabase
      .from('orders')
      .select('id,totalAmount,paymentStatus')
      .eq('paymentRef', ref);

    if (error) throw error;
    if (!orders || orders.length === 0) return res.status(404).send('order not found');

    const alreadyPaid = orders.some(o => String(o.paymentStatus || '') === 'paid');
    if (alreadyPaid) return res.send('已付款完成，請回到商店查看訂單。');

    const totalAmount = orders.reduce((s, o) => s + (Number(o.totalAmount || 0) || 0), 0);

    const now = new Date();
    const yyyy = now.getFullYear();
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const HH = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const tradeDate = `${yyyy}/${MM}/${dd} ${HH}:${mm}:${ss}`;

    const host = `${req.protocol}://${req.get('host')}`;

    const baseParams = {
      MerchantID: ECPAY_MERCHANT_ID,
      MerchantTradeNo: ref,                 // <=20字，ref 用訂單號 OK
      MerchantTradeDate: tradeDate,
      PaymentType: 'aio',
      TotalAmount: totalAmount,
      TradeDesc: '三小隻日常百貨訂單付款',
      ItemName: '三小隻日常百貨商品一批',
      ChoosePayment: choosePayment,               // 讓客人選信用卡/ATM
      EncryptType: 1,

	  PaymentInfoURL: `${host}/api/ecpay/payment-info`, // ✅ ATM 虛擬帳號資料回傳
	  ExpireDate: 3,                                   // ✅ 虛擬帳號有效天數（1~60）
      ReturnURL: `${host}/api/ecpay/return`,             // 綠界 server 回呼
	  
      OrderResultURL: `${host}/pay/ecpay/result?ref=${encodeURIComponent(ref)}`,
      ClientBackURL: `${host}/#checkoutSection`,
    };

    const CheckMacValue = genCheckMacValue(baseParams);
    const formHtml = buildAutoSubmitForm(ecpayGatewayUrl(), { ...baseParams, CheckMacValue });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(formHtml);
  } catch (e) {
    console.error(e);
    res.status(500).send('create ecpay form failed');
  }
});
// 2.5) 綠界 ATM 取得「虛擬帳號資訊」會 POST 到這裡（server-to-server）
app.post('/api/ecpay/payment-info', async (req, res) => {
  try {
    const body = normalizeEcpayBody(req.body || {});

    console.log("ECPAY PAYMENT-INFO BODY:", body);

    // ✅ 驗證 CheckMacValue
    const recv = String(body.CheckMacValue || '');
    const calc = genCheckMacValue(body);

    if (!recv || recv !== calc) {
      console.error('❌ ECPay payment-info CheckMacValue mismatch');
      return res.status(400).send('0|FAIL');
    }

    const ref = String(body.MerchantTradeNo || '').trim(); // 你的 paymentRef
    if (!ref) return res.send('1|OK');

    // ✅ 這三個欄位是 ATM 會給的（綠界欄位名稱常見如下）
    const atmBankCode = String(body.BankCode || '').trim();
    const atmVAccount = String(body.vAccount || body.Account || '').trim();
    const atmExpireDate = String(body.ExpireDate || '').trim();

    const patch = {
      atmBankCode: atmBankCode || null,
      atmVAccount: atmVAccount || null,
      atmExpireDate: atmExpireDate || null,
      merchantTradeNo: ref,
      updatedAt: new Date().toISOString()
    };

    const { error } = await supabase
      .from('orders')
      .update(patch)
      .eq('paymentRef', ref);

    if (error) throw error;

    return res.send('1|OK');
  } catch (e) {
    console.error('❌ /api/ecpay/payment-info error', e);
    return res.status(500).send('0|ERR');
  }
});





// 2) 綠界付款完成會 POST 到這裡（server-to-server）
app.post('/api/ecpay/return', async (req, res) => {
  try {
    const body = normalizeEcpayBody(req.body || {});
console.log("ECPAY RETURN BODY:", body);
    const recv = String(body.CheckMacValue || '');
    const calc = genCheckMacValue(body);

    if (!recv || recv !== calc) {
      console.error('❌ ECPay CheckMacValue mismatch');
      return res.status(400).send('0|FAIL');
    }

    const rtnCode = String(body.RtnCode || '');
    const ref = String(body.MerchantTradeNo || '').trim(); // 我們用 ref 當 paymentRef
    const tradeNo = String(body.TradeNo || '').trim();

if (rtnCode === '1' && ref) {
  const patch = {
    paymentStatus: "paid",
    paidAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ecpayTradeNo: tradeNo || ""
  };

const { error } = await supabase
  .from('orders')
  .update(patch)
  .or(`paymentRef.eq.${ref},id.eq.${ref},merchantTradeNo.eq.${ref}`);


  if (error) throw error;

  // ✅ 付款成功才寄信
  await sendPaidEmailsByPaymentRef(ref);
}

    // 綠界要求回 1|OK
    return res.send('1|OK');
  } catch (e) {
    console.error('❌ ECPay return error', e);
    return res.status(500).send('0|ERR');
  }
});

// 3) 客人付款後回來看到的頁面（顯示 ATM 虛擬帳號 / 或付款結果）
app.get('/pay/ecpay/result', async (req, res) => {
  try {
    const ref = String(req.query.ref || '').trim();
    if (!ref) return res.status(400).send('missing ref');

    const { data: orders, error } = await supabase
      .from('orders')
      .select('id,paymentStatus,paymentMethod,atmBankCode,atmVAccount,atmExpireDate,totalAmount,createdAt')
      .eq('paymentRef', ref)
      .order('createdAt', { ascending: true });

    if (error) throw error;

    const paid = (orders || []).some(o => String(o.paymentStatus) === 'paid');
    const isATM = (orders || []).some(o => String(o.paymentMethod || '') === 'atm');

    // ATM 資訊（同一 paymentRef 拆單，抓第一筆有值的）
    const atmInfo = (() => {
      const hit = (orders || []).find(o => o.atmVAccount || o.atmBankCode || o.atmExpireDate) || {};
      return {
        bank: String(hit.atmBankCode || '').trim(),
        acc: String(hit.atmVAccount || '').trim(),
        exp: String(hit.atmExpireDate || '').trim()
      };
    })();

    const total = (orders || []).reduce((s, o) => s + (Number(o.totalAmount || 0) || 0), 0);

    // 畫面：已付款 -> 成功；未付款且 ATM -> 顯示帳號；其他 -> 處理中
    const title = paid ? '✅ 付款成功' : (isATM ? '🏧 ATM 虛擬帳號已產生，請於期限內完成轉帳' : '⏳ 付款處理中 / 尚未完成');

    const atmBlock = (!paid && isATM)
      ? `
        <div style="margin-top:12px;padding:12px 14px;border:1px dashed #f0d9a4;border-radius:12px;background:#fffdf5;">
          <div style="font-weight:900;margin-bottom:6px;">ATM 轉帳資訊</div>
          <div>銀行代碼：<strong>${escapeHtml(atmInfo.bank || '（等待綠界回傳中）')}</strong></div>
          <div>虛擬帳號：<strong style="font-size:16px;">${escapeHtml(atmInfo.acc || '（等待綠界回傳中）')}</strong></div>
          <div>繳費期限：<strong>${escapeHtml(atmInfo.exp || '（等待綠界回傳中）')}</strong></div>
          <div style="margin-top:8px;color:#9a7641;font-size:13px;">
            轉帳完成後，系統會自動更新為「已付款」，我們就會為你安排出貨 🤍
          </div>
        </div>
      ` : '';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!doctype html><html lang="zh-Hant"><body style="font-family:system-ui;padding:16px;">
      <h2>${title}</h2>
      <p>付款編號：${escapeHtml(ref)}</p>
      <p>合計金額：<strong>NT$ ${Number(total||0)||0}</strong></p>
      ${atmBlock}
      <p style="margin-top:14px;"><a href="/">回首頁</a></p>
    </body></html>`);
  } catch (e) {
    console.error('❌ /pay/ecpay/result error:', e);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!doctype html><html><body style="font-family:system-ui;padding:16px;">
      <h2>✅ 已收到付款結果</h2>
      <p>系統正在同步訂單狀態，請回到商店查看。</p>
      <p><a href="/">回首頁</a></p>
    </body></html>`);
  }
});


// 3-POST) 綠界有時會用 POST 打回 OrderResultURL（瀏覽器端）
// 一定要接住 POST，不然會出現 Cannot POST /pay/ecpay/result
app.post('/pay/ecpay/result', (req, res) => {
  const ref =
    String(req.query.ref || '').trim() ||
    String(req.body?.MerchantTradeNo || req.body?.merchantTradeNo || '').trim();

  // ⚠️ 沒 ref 也不要丟錯給客人，直接回首頁
  if (!ref) return res.redirect(302, '/');

  // 導回 GET 版本顯示結果
  return res.redirect(302, `/pay/ecpay/result?ref=${encodeURIComponent(ref)}`);
});

// ✅ Debug endpoint: 確認 Render 真的有跑到最新程式
app.all('/__ping', (req, res) => {
  console.log('✅ HIT /__ping', {
    method: req.method,
    ip: req.ip,
    ua: req.headers['user-agent'],
    time: new Date().toISOString(),
  });
  res.json({ ok: true, time: new Date().toISOString() });
});




/* =========================================================
 * Start
 * ========================================================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port', PORT);
});
