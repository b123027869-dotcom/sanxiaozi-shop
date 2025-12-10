// server.js
// 三小子店 - 簡單版後端：Express + SQLite（better-sqlite3）

const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// ================== 資料庫初始化 ==================

// 開 SQLite 資料庫檔案（不存在會自動建立）
const dbFile = path.join(__dirname, 'shop.db');
const db = new Database(dbFile);

// 啟用外鍵、基本設定 & 建表
function initDb() {
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,             -- 訂單編號，例如 ND202512100001
      created_at TEXT NOT NULL,        -- ISO 時間字串
      completed_at TEXT,               -- 完結時間（可為 NULL）
      status TEXT NOT NULL,            -- pending / completed
      customer_name TEXT,
      phone TEXT,
      email TEXT,
      line_id TEXT,
      address TEXT,
      ship TEXT,
      pay TEXT,
      note TEXT,
      total_amount INTEGER NOT NULL    -- 整數金額（NT$）
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      spec_key TEXT,
      spec_label TEXT,
      name TEXT,
      price INTEGER NOT NULL,
      qty INTEGER NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    -- 儲存每個商品的價格 & 各款式庫存（JSON）
    CREATE TABLE IF NOT EXISTS product_state (
      product_id TEXT PRIMARY KEY,
      price INTEGER NOT NULL,
      price_note TEXT,
      stocks_json TEXT                 -- JSON：{ "usagi": 10, "kuri": 5, ... }
    );
  ');
}

initDb();

// ================== 中介層設定 ==================

app.use(cors());             // 開放 CORS，方便從前端或別的網域呼叫
app.use(express.json());     // 解析 JSON body
app.use(express.static(path.join(__dirname, 'public'))); // 提供 /public 靜態檔案

// ================== 小工具：產生訂單編號 ==================

function generateOrderId() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const prefix = `ND${y}${m}${d}`;

  // 找出今天最後一筆訂單，編號加一
  const row = db
    .prepare('SELECT id FROM orders WHERE id LIKE ? ORDER BY id DESC LIMIT 1')
    .get(prefix + '%');

  let index = 1;
  if (row && row.id) {
    const last = row.id;
    const numStr = last.slice(prefix.length); // 取最後四位
    const num = parseInt(numStr, 10);
    if (!isNaN(num)) index = num + 1;
  }

  return prefix + String(index).padStart(4, '0');
}

// ================== 健康檢查 ==================

app.get('/api/ping', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ================== 訂單相關 API ==================

// 取得所有訂單（含品項）
app.get('/api/orders', (req, res) => {
  try {
    const orders = db.prepare('SELECT * FROM orders').all();
    const items = db.prepare('SELECT * FROM order_items').all();

    const itemsByOrder = {};
    items.forEach((it) => {
      if (!itemsByOrder[it.order_id]) itemsByOrder[it.order_id] = [];
      itemsByOrder[it.order_id].push({
        productId: it.product_id,
        specKey: it.spec_key,
        specLabel: it.spec_label,
        name: it.name,
        price: it.price,
        qty: it.qty,
      });
    });

    const result = orders.map((o) => ({
      id: o.id,
      createdAt: o.created_at,
      completedAt: o.completed_at,
      status: o.status,
      totalAmount: o.total_amount,
      customer: {
        name: o.customer_name,
        phone: o.phone,
        email: o.email,
        lineId: o.line_id,
        address: o.address,
        ship: o.ship,
        pay: o.pay,
        note: o.note,
      },
      items: itemsByOrder[o.id] || [],
    }));

    res.json(result);
  } catch (err) {
    console.error('GET /api/orders error', err);
    res.status(500).json({ error: 'Failed to get orders.' });
  }
});

// 新增訂單（前台結帳會呼叫）
app.post('/api/orders', (req, res) => {
  try {
    const { items, customer } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items 必須是非空陣列' });
    }
    if (!customer || !customer.name || !customer.phone || !customer.email) {
      return res
        .status(400)
        .json({ error: 'customer 資料不完整（姓名 / 電話 / Email 必填）' });
    }

    let totalAmount = 0;
    items.forEach((it) => {
      const price = Number(it.price) || 0;
      const qty = Number(it.qty) || 0;
      totalAmount += price * qty;
    });

    const id = generateOrderId();
    const nowIso = new Date().toISOString();

    const insertOrder = db.prepare(`
      INSERT INTO orders (
        id, created_at, completed_at, status,
        customer_name, phone, email, line_id,
        address, ship, pay, note, total_amount
      ) VALUES (
        @id, @created_at, NULL, 'pending',
        @customer_name, @phone, @email, @line_id,
        @address, @ship, @pay, @note, @total_amount
      )
    `);

    const insertItem = db.prepare(`
      INSERT INTO order_items (
        order_id, product_id, spec_key, spec_label, name, price, qty
      ) VALUES (
        @order_id, @product_id, @spec_key, @spec_label, @name, @price, @qty
      )
    `);

    const tx = db.transaction(() => {
      insertOrder.run({
        id,
        created_at: nowIso,
        customer_name: customer.name,
        phone: customer.phone,
        email: customer.email,
        line_id: customer.lineId || '',
        address: customer.address || '',
        ship: customer.ship || '',
        pay: customer.pay || '',
        note: customer.note || '',
        total_amount: totalAmount,
      });

      items.forEach((it) => {
        insertItem.run({
          order_id: id,
          product_id: it.productId,
          spec_key: it.specKey || '',
          spec_label: it.specLabel || '',
          name: it.name || '',
          price: Number(it.price) || 0,
          qty: Number(it.qty) || 0,
        });
      });
    });

    tx();

    res.status(201).json({
      id,
      createdAt: nowIso,
      status: 'pending',
      totalAmount,
    });
  } catch (err) {
    console.error('POST /api/orders error', err);
    res.status(500).json({ error: 'Failed to create order.' });
  }
});

// 變更訂單狀態（後台改「已完結」用）
app.patch('/api/orders/:id/status', (req, res) => {
  try {
    const orderId = req.params.id;
    const { status } = req.body || {};
    if (!['pending', 'completed'].includes(status)) {
      return res.status(400).json({ error: 'status 必須是 pending 或 completed' });
    }

    const nowIso = new Date().toISOString();
    const stmt = db.prepare(`
      UPDATE orders
      SET status = @status,
          completed_at = CASE WHEN @status = 'completed' THEN @completed_at ELSE NULL END
      WHERE id = @id
    `);

    const info = stmt.run({
      id: orderId,
      status,
      completed_at: nowIso,
    });

    if (info.changes === 0) {
      return res.status(404).json({ error: '找不到此訂單' });
    }

    res.json({
      id: orderId,
      status,
      completedAt: status === 'completed' ? nowIso : null,
    });
  } catch (err) {
    console.error('PATCH /api/orders/:id/status error', err);
    res.status(500).json({ error: 'Failed to update order status.' });
  }
});

// ================== 商品狀態 API ==================

// 取得所有商品狀態（價格 + 每款庫存）
app.get('/api/product-state', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM product_state').all();
    const result = {};

    rows.forEach((r) => {
      let stocks = {};
      if (r.stocks_json) {
        try {
          stocks = JSON.parse(r.stocks_json);
        } catch (e) {
          stocks = {};
        }
      }
      result[r.product_id] = {
        price: r.price,
        priceNote: r.price_note || '',
        stocks,
      };
    });

    res.json(result);
  } catch (err) {
    console.error('GET /api/product-state error', err);
    res.status(500).json({ error: 'Failed to get product state.' });
  }
});

// 更新單一商品的價格 & 庫存（後台存檔用）
app.post('/api/product-state/:productId', (req, res) => {
  try {
    const productId = req.params.productId;
    const { price, priceNote, stocks } = req.body || {};

    const p = Number(price);
    if (!p || p <= 0) {
      return res.status(400).json({ error: 'price 必須是大於 0 的數字' });
    }

    let stocksJson = null;
    if (stocks && typeof stocks === 'object') {
      stocksJson = JSON.stringify(stocks);
    }

    const stmt = db.prepare(`
      INSERT INTO product_state (product_id, price, price_note, stocks_json)
      VALUES (@product_id, @price, @price_note, @stocks_json)
      ON CONFLICT(product_id) DO UPDATE SET
        price = excluded.price,
        price_note = excluded.price_note,
        stocks_json = excluded.stocks_json
    `);

    stmt.run({
      product_id: productId,
      price: p,
      price_note: priceNote || '',
      stocks_json: stocksJson,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/product-state/:productId error', err);
    res.status(500).json({ error: 'Failed to update product state.' });
  }
});

// ================== 前端路由處理 ==================
// 只要不是 /api/ 開頭，就回傳 index.html（讓前端單頁應用可以正常運作）
app.get('*', (req, res, next) => {
  if (req.originalUrl.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ================== 啟動伺服器 ==================

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
