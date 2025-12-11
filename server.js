// server.js
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const app = express();

// ===== 資料庫設定：SQLite（商品用） =====
const db = new sqlite3.Database(path.join(__dirname, 'sanxiaozi.db'));

db.serialize(() => {
  // 商品表
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT,
      name TEXT NOT NULL,
      price INTEGER DEFAULT 0,
      stock INTEGER DEFAULT 0,
      category TEXT,
      status TEXT DEFAULT 'on',
      imageUrl TEXT,
      description TEXT,
      variantsJson TEXT,
      detailImagesJson TEXT
    )
  `);

  // 訂單表（目前保留未使用，之後若要改成用 SQLite 存訂單可以用）
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT DEFAULT 'new',
      createdAt TEXT,
      totalAmount INTEGER DEFAULT 0,
      customerJson TEXT,
      itemsJson TEXT
    )
  `);
});

// ===== 基本中介層設定 =====
app.use(cors());
app.use(express.json());

// 靜態檔案：public 資料夾
app.use(express.static(path.join(__dirname, 'public')));

// ===== 訂單 JSON 檔案（後台列表 / 狀態用） =====
const DATA_FILE = path.join(__dirname, 'orders.json');

// 後台登入密碼
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'a1216321';

// ----- orders.json 讀寫 -----
function readOrders() {
  try {
    const text = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err.code === 'ENOENT') {
      // 檔案不存在 → 視為空陣列
      return [];
    }
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

// 產生訂單編號：ND + YYYYMMDD + 四碼流水號
function generateOrderId(allOrders) {
  const now = new Date();
  const y = now.getFullYear().toString();
  const m = (now.getMonth() + 1).toString().padStart(2, '0');
  const d = now.getDate().toString().padStart(2, '0');
  const datePrefix = `${y}${m}${d}`;

  const todayOrders = allOrders.filter(o =>
    (o.id || '').startsWith('ND' + datePrefix)
  );
  const nextIndex = todayOrders.length + 1;
  const indexStr = nextIndex.toString().padStart(4, '0');
  return `ND${datePrefix}${indexStr}`;
}

// ===== 後台登入：簡易 Token 機制 =====
const adminTokens = new Set();

function createAdminToken() {
  return crypto.randomBytes(24).toString('hex');
}

function authAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ ok: false, message: '未登入或權限不足' });
  }
  next();
}

// 後台登入
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (!password) {
    return res.status(400).json({ ok: false, message: '請輸入密碼' });
  }
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, message: '密碼錯誤' });
  }

  const token = createAdminToken();
  adminTokens.add(token);
  res.json({ ok: true, token });
});

// 後台登出
app.post('/api/admin/logout', authAdmin, (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) adminTokens.delete(token);
  res.json({ ok: true });
});

// ====================================================================
// 前台：商品列表（只顯示上架中的商品）
// ====================================================================
app.get('/api/products', (req, res) => {
  const sql = `
    SELECT
      id,
      code,
      name,
      price,
      stock,
      category,
      status,
      imageUrl,
      description,
      variantsJson,
      detailImagesJson
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
      let variants = [];
      try {
        variants = row.variantsJson ? JSON.parse(row.variantsJson) : [];
      } catch {
        variants = [];
      }

      let detailImages = [];
      try {
        detailImages = row.detailImagesJson ? JSON.parse(row.detailImagesJson) : [];
      } catch {
        detailImages = [];
      }

      // 分類（後台 category 欄位可以填：cup desk gift 等）
      const categories = row.category
        ? row.category.split(/[,\s]+/).filter(Boolean)
        : [];

      // 商品層級的小圖（所有款式共用）
      const commonThumbs = detailImages.length
        ? detailImages
        : (row.imageUrl ? [row.imageUrl] : []);

      // 前台 specs：由 variants 轉換
      let specs;
      if (variants.length > 0) {
        specs = variants.map((v, idx) => {
          const vStock = Number(v.stock || 0) || 0;
          const mainImg = v.imageUrl || row.imageUrl || '';
          const thumbs = mainImg
            ? [mainImg, ...commonThumbs.filter(u => u !== mainImg)]
            : commonThumbs;

          return {
            key: v.name || `v${idx + 1}`,        // key 用 name
            label: v.name || `款式 ${idx + 1}`,
            stock: vStock,
            mainImg,
            thumbs
          };
        });
      } else {
        // 沒設定款式時給一個預設款
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
        stock: row.stock,
        categories,
        tag: '',
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

// ====================================================================
// 前台：建立訂單（檢查庫存 + 扣 SQLite 庫存 + 寫入 orders.json）
// ====================================================================
app.post('/api/orders', (req, res) => {
  const { customer, items } = req.body || {};

  if (!customer || !customer.name || !customer.phone || !customer.email) {
    return res.status(400).json({ ok: false, message: '缺少必要的顧客資料' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, message: '購物車是空的' });
  }

  // 計算總金額
  const totalAmount = items.reduce((sum, it) => {
    return sum + (Number(it.price || 0) * Number(it.qty || 0));
  }, 0);

  const allOrders = readOrders();
  const id = generateOrderId(allOrders);
  const now = new Date().toISOString();

  const newOrder = {
    id,
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    totalAmount,
    items,
    customer
  };

  // 使用 SQLite transaction 確保庫存檢查 + 扣庫存是原子操作
  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    let failed = false;
    let failMessage = "";
    const insufficient = [];

    // 先檢查每一筆庫存
    const processItem = (index) => {
      if (index >= items.length) {
        // 所有商品庫存 OK，開始扣庫存
        return deductItem(0);
      }

      const it = items[index];
      const pid = it.productId;
      const specKey = it.specKey || null;
      const qty = Number(it.qty || 0);

      if (!pid || qty <= 0) {
        return processItem(index + 1);
      }

      db.get(
        "SELECT stock, variantsJson FROM products WHERE id = ?",
        [pid],
        (err, row) => {
          if (err || !row) {
            failed = true;
            failMessage = "查詢商品失敗";
            return db.run("ROLLBACK", () =>
              res.status(500).json({ ok: false, message: failMessage })
            );
          }

          let stock = Number(row.stock || 0);
          let variants = [];
          try {
            variants = row.variantsJson ? JSON.parse(row.variantsJson) : [];
          } catch {
            variants = [];
          }

          if (specKey && variants.length > 0) {
            const v = variants.find(v => v.name === specKey || v.key === specKey);
            if (!v) {
              failed = true;
              failMessage = "找不到該款式";
              return db.run("ROLLBACK", () =>
                res.status(400).json({ ok: false, message: failMessage })
              );
            }
            if (Number(v.stock) < qty) {
              insufficient.push({
                productId: pid,
                specKey,
                remain: Number(v.stock) || 0,
                want: qty
              });
            }
          } else {
            if (stock < qty) {
              insufficient.push({
                productId: pid,
                specKey: null,
                remain: stock,
                want: qty
              });
            }
          }

          if (insufficient.length > 0) {
            failed = true;
            failMessage = "部分商品庫存不足";
            return db.run("ROLLBACK", () =>
              res.status(400).json({ ok: false, message: failMessage, insufficient })
            );
          }

          processItem(index + 1);
        }
      );
    };

    // 實際扣庫存
    const deductItem = (idx) => {
      if (idx >= items.length) {
        // 扣庫存完成 → 寫入訂單 JSON → COMMIT
        const updatedOrders = readOrders();
        updatedOrders.push(newOrder);
        saveOrders(updatedOrders);

        return db.run("COMMIT", () => {
          res.json({
            ok: true,
            id: newOrder.id,
            createdAt: newOrder.createdAt,
            status: newOrder.status,
            totalAmount: newOrder.totalAmount
          });
        });
      }

      const it = items[idx];
      const pid = it.productId;
      const specKey = it.specKey || null;
      const qty = Number(it.qty || 0);

      if (!pid || qty <= 0) {
        return deductItem(idx + 1);
      }

      db.get(
        "SELECT stock, variantsJson FROM products WHERE id = ?",
        [pid],
        (err, row) => {
          if (err || !row) {
            failed = true;
            const msg = "扣庫存時找不到商品";
            return db.run("ROLLBACK", () =>
              res.status(500).json({ ok: false, message: msg })
            );
          }

          let stock = Number(row.stock || 0);
          let variants = [];
          try {
            variants = row.variantsJson ? JSON.parse(row.variantsJson) : [];
          } catch {
            variants = [];
          }

          // 扣總庫存
          stock = Math.max(0, stock - qty);

          // 扣款式庫存
          if (specKey && variants.length > 0) {
            const v = variants.find(v => v.name === specKey || v.key === specKey);
            if (v) {
              let vStock = Number(v.stock || 0);
              v.stock = Math.max(0, vStock - qty);
            }
          }

          const newVariantsJson = JSON.stringify(variants);

          db.run(
            "UPDATE products SET stock = ?, variantsJson = ? WHERE id = ?",
            [stock, newVariantsJson, pid],
            (err2) => {
              if (err2) {
                failed = true;
                const msg = "更新庫存失敗";
                return db.run("ROLLBACK", () =>
                  res.status(500).json({ ok: false, message: msg })
                );
              }
              deductItem(idx + 1);
            }
          );
        }
      );
    };

    processItem(0);
  });
});

// ====================================================================
// 前台：訂單查詢（電話 + 訂單編號）
// ====================================================================
app.get('/api/orders/query', (req, res) => {
  const phone = (req.query.phone || '').trim();
  const id = (req.query.id || '').trim();

  if (!phone || !id) {
    return res.status(400).json({ message: '請提供 phone 與 id' });
  }

  const orders = readOrders();
  const order = orders.find(
    o =>
      (o.id === id) &&
      o.customer &&
      (String(o.customer.phone || '').trim() === phone)
  );

  if (!order) {
    return res.status(404).json({ message: '查無此訂單，請確認電話與訂單編號是否正確。' });
  }

  res.json({ ok: true, order });
});

// ====================================================================
// 後台：商品管理（使用 SQLite，建議加 authAdmin）
// ====================================================================
app.get('/api/admin/products', authAdmin, (req, res) => {
  db.all('SELECT * FROM products ORDER BY id DESC', [], (err, rows) => {
    if (err) {
      console.error('取得商品列表失敗', err);
      return res.status(500).json({ success: false, message: '取得商品失敗' });
    }

    const products = rows.map(row => ({
      id: row.id,
      code: row.code,
      name: row.name,
      price: row.price,
      stock: row.stock,
      category: row.category,
      status: row.status,
      imageUrl: row.imageUrl,
      description: row.description,
      variants: row.variantsJson ? JSON.parse(row.variantsJson) : [],
      detailImages: row.detailImagesJson ? JSON.parse(row.detailImagesJson) : []
    }));

    res.json({ success: true, products });
  });
});

app.post('/api/admin/products', authAdmin, (req, res) => {
  const {
    code,
    name,
    price,
    stock,
    category,
    status,
    imageUrl,
    description,
    variants,
    detailImages
  } = req.body || {};

  if (!name) {
    return res.status(400).json({ success: false, message: '缺少商品名稱' });
  }

  const priceVal = Number(price || 0);
  const stockVal = Number(stock || 0);

  const variantsJson = JSON.stringify(variants || []);
  const detailImagesJson = JSON.stringify(detailImages || []);

  const sql = `
    INSERT INTO products
    (code, name, price, stock, category, status, imageUrl, description, variantsJson, detailImagesJson)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    code || null,
    name,
    isNaN(priceVal) ? 0 : priceVal,
    isNaN(stockVal) ? 0 : stockVal,
    category || null,
    status || 'on',
    imageUrl || null,
    description || null,
    variantsJson,
    detailImagesJson
  ];

  db.run(sql, params, function (err) {
    if (err) {
      console.error('新增商品失敗', err);
      return res.status(500).json({ success: false, message: '新增商品失敗' });
    }
    res.json({ success: true, id: this.lastID });
  });
});

app.patch('/api/admin/products/:id', authAdmin, (req, res) => {
  const productId = req.params.id;
  const {
    code,
    name,
    price,
    stock,
    category,
    status,
    imageUrl,
    description,
    variants,
    detailImages
  } = req.body || {};

  const priceVal = Number(price || 0);
  const stockVal = Number(stock || 0);

  const variantsJson = JSON.stringify(variants || []);
  const detailImagesJson = JSON.stringify(detailImages || []);

  const sql = `
    UPDATE products
    SET code = ?, name = ?, price = ?, stock = ?, category = ?, status = ?,
        imageUrl = ?, description = ?, variantsJson = ?, detailImagesJson = ?
    WHERE id = ?
  `;
  const params = [
    code || null,
    name || '',
    isNaN(priceVal) ? 0 : priceVal,
    isNaN(stockVal) ? 0 : stockVal,
    category || null,
    status || 'on',
    imageUrl || null,
    description || null,
    variantsJson,
    detailImagesJson,
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

app.delete('/api/admin/products/:id', authAdmin, (req, res) => {
  const productId = req.params.id;

  db.run('DELETE FROM products WHERE id = ?', [productId], function (err) {
    if (err) {
      console.error('刪除商品失敗', err);
      return res.status(500).json({ success: false, message: '刪除商品失敗' });
    }
    res.json({ success: true });
  });
});

// ====================================================================
// 後台：訂單管理（使用 orders.json，token 保護）
// ====================================================================
app.get('/api/admin/orders', authAdmin, (req, res) => {
  const orders = readOrders();
  res.json({ ok: true, orders });
});

app.patch('/api/admin/orders/:id', authAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};

  if (!status) {
    return res.status(400).json({ ok: false, message: '缺少狀態欄位' });
  }

  const orders = readOrders();
  const idx = orders.findIndex(o => o.id === id);
  if (idx === -1) {
    return res.status(404).json({ ok: false, message: '找不到這筆訂單' });
  }

  orders[idx].status = status;
  orders[idx].updatedAt = new Date().toISOString();
  saveOrders(orders);

  res.json({ ok: true, order: orders[idx] });
});

// ===== 啟動伺服器 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port', PORT);
});
