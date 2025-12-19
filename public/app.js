/* =========================================================
 * 三小隻日常百貨 - Frontend app.js (FINAL)
 * - 保留所有功能 + 穩定化（避免重複綁定/輪播不蓋字/圖庫/Lightbox）
 * ========================================================= */

(() => {
  /* ✅ Debug marker (只在本機顯示) */
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    console.log("✅ Loaded public/app.js (FINAL)");
    // alert("我真的有讀到 app.js"); // 需要時再打開
  }

  /* =========================================================
   * Shipping rule
   * ========================================================= */
  const SHIPPING_RULE = {
    freeThreshold: 699,
    storeFee: 100,
    homeFee: 120,
  };

  /* =========================================================
   * Image / API constants
   * ========================================================= */
  const SUPABASE_IMG_BASE =
    "https://ckqdimygblkasofycwvr.supabase.co/storage/v1/object/public/product-images/";

  function resolveImgUrl(url) {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    return SUPABASE_IMG_BASE + String(url).replace(/^\/+/, "");
  }

  const API_BASE =
    (location.hostname === "localhost" || location.hostname === "127.0.0.1")
      ? "http://localhost:3000"
      : location.origin;

  async function apiGet(path) {
    const res = await fetch(API_BASE + path);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error("API 錯誤：" + res.status + " " + text);
    }
    return res.json();
  }

  async function apiPost(path, data) {
    const res = await fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error("API 錯誤：" + res.status + " " + text);
    }
    return res.json();
  }

  /* =========================================================
   * DOM helpers
   * ========================================================= */
  function $(id) { return document.getElementById(id); }

  window.scrollToSection = function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  window.backToProducts = function () {
    const pd = $("productDetail");
    if (pd) pd.style.display = "none";
    scrollToSection("products");
  };

  /* =========================================================
   * State
   * ========================================================= */
  let products = [];
  let currentCategory = "all";
  let currentKeyword = "";

  let cartItems = []; // {productId, specKey, qty}

// =========================================================
// ✅ Stock helpers：加入購物車前先檢查庫存（不顯示錯誤代碼）
// 規則：優先用「款式 stock」，沒有才用「商品 stock」；都沒有就視為不限量
// =========================================================
function getAvailableStock(product, specKey) {
  if (!product) return Infinity;

  const spec =
    (product.specs || []).find((s) => s.key === specKey) || null;

  const specStock = Number(spec?.stock);
  if (Number.isFinite(specStock)) return Math.max(0, specStock);

  const prodStock = Number(product.stock);
  if (Number.isFinite(prodStock)) return Math.max(0, prodStock);

  return Infinity; // 沒有 stock 欄位就不擋
}



function getCartQty(productId, specKey) {
  return cartItems
    .filter((x) => x.productId === productId && x.specKey === specKey)
    .reduce((sum, x) => sum + (Number(x.qty) || 0), 0);
}


  /* =========================================================
   * Product list
   * ========================================================= */
  const productGrid = $("productGrid");
  const productEmptyHint = $("productEmptyHint");

  async function loadProducts() {
    const data = await apiGet("/api/products");
    const list = data.products || data.data || [];
    products = Array.isArray(list) ? list : [];
  }

  function productMatches(p) {
    if (currentCategory !== "all") {
      const cats = Array.isArray(p.categories) ? p.categories : [];
      if (!cats.includes(currentCategory)) return false;
    }
    if (!currentKeyword) return true;

    const text = [
      p.name,
      p.subtitle,
      (p.categories || []).join(" "),
      p.shortDesc,
      p.code,
      p.tag
    ].join(" ").toLowerCase();

    return text.includes(currentKeyword.toLowerCase());
  }

  function renderProductGrid() {
    if (!productGrid) return;
    productGrid.innerHTML = "";

    const filtered = products.filter(productMatches);

    if (productEmptyHint) {
      productEmptyHint.style.display = filtered.length ? "none" : "block";
    }

    filtered.forEach((product) => {
      const specs = Array.isArray(product.specs) ? product.specs : [];
      const firstSpec = specs[0];

      const mainImgRaw =
        product.imageUrl ||
        (firstSpec && firstSpec.mainImg) ||
        (firstSpec && firstSpec.thumbs && firstSpec.thumbs[0]) ||
        "";

      const mainImg = resolveImgUrl(mainImgRaw);

      const card = document.createElement("article");
      card.className = "product-card";

      card.innerHTML = `
        ${product.tag ? `<div class="product-tag">${product.tag}</div>` : ""}
        <div class="product-img">
          ${mainImg ? `<img src="${mainImg}" alt="${escapeHtml(product.name || "")}">` : ""}
        </div>
        <h4 class="product-name">${escapeHtml(product.name || "")}</h4>
        <div class="product-bottom">
          <div class="product-price">NT$ ${Number(product.price) || 0}</div>
          <div class="card-hint">點擊查看商品詳情</div>
        </div>
      `;

      const open = () => openProduct(product.id);
      card.querySelector(".product-img")?.addEventListener("click", open);
      card.querySelector(".product-name")?.addEventListener("click", open);

      productGrid.appendChild(card);
    });
  }

  /* =========================================================
   * Categories + Search
   * ========================================================= */
  function bindCategoryChips() {
    document.querySelectorAll(".category-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".category-chip").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentCategory = btn.dataset.category || "all";
        renderProductGrid();
      });
    });
  }

  function bindSearch() {
    const input = $("heroSearchInput");
    if (!input) return;

    let t = null;
    input.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        currentKeyword = String(input.value || "").trim();
        renderProductGrid();
      }, 120);
    });
  }

  /* =========================================================
   * Product detail + gallery
   * ========================================================= */
  const productDetailSection = $("productDetail");
  const detailTitleMain = $("detailTitleMain");
  const detailName = $("detailName");
  const detailSub = $("detailSub");
  const detailPrice = $("detailPrice");
  const detailDesc = $("detailDesc");
  const detailMainImg = $("detailMainImg");
  const detailThumbs = $("detailThumbs");
  const detailSpecs = $("detailSpecs");
  const detailQtyInput = $("detailQtyInput");
  const detailAddBtn = $("detailAddBtn");
  const detailQtyMinus = $("detailQtyMinus");
  const detailQtyPlus = $("detailQtyPlus");
  const detailLineBtn = $("detailLineBtn");

  let currentDetailProductId = null;
  let currentDetailSpecKey = null;

  // 全商品圖庫只建一次（避免反覆建縮圖造成 lag）
  let __allThumbsBuiltForProductId = null;

  const detailGallery = {
    images: [], // raw list
    index: 0,
  };

  function openProduct(productId) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;

    currentDetailProductId = productId;
    currentDetailSpecKey = null;

    if (detailTitleMain) detailTitleMain.textContent = product.name || "";
    if (detailName) detailName.textContent = product.name || "";
    if (detailSub) detailSub.textContent = product.subtitle || "";
    if (detailPrice) detailPrice.textContent = String(Number(product.price) || 0);
	const tagEl = document.getElementById("detailTagNote");
if (tagEl) {
  const t = String(product.tag || "").trim();
  tagEl.textContent = (t === "leadtime_10_15") ? "較長備貨（10-15天）" : "";
  tagEl.style.display = tagEl.textContent ? "inline-block" : "none";
}
    if (detailDesc) detailDesc.innerHTML = product.detailHtml || "";

    // 1) 建立「整個商品」全圖庫 + 全縮圖列（只做一次）
    if (__allThumbsBuiltForProductId !== productId) {
      __allThumbsBuiltForProductId = productId;

      const allRaw = [];
      (product.specs || []).forEach((s) => {
        if (s?.mainImg) allRaw.push(s.mainImg);
        (s?.thumbs || []).forEach((x) => allRaw.push(x));
      });
      if (!allRaw.length && product.imageUrl) allRaw.push(product.imageUrl);

      // 去重（用 resolve 後的 URL）
      const seen = new Set();
      const uniqRaw = [];
      for (const raw of allRaw) {
        const u = resolveImgUrl(raw);
        if (!u) continue;
        if (seen.has(u)) continue;
        seen.add(u);
        uniqRaw.push(raw);
      }

      detailGallery.images = uniqRaw;
      detailGallery.index = 0;

      // 建縮圖列（永遠顯示全圖庫）
      if (detailThumbs) {
        detailThumbs.innerHTML = "";
        detailGallery.images.forEach((raw, i) => {
          const t = document.createElement("img");
          t.src = resolveImgUrl(raw);
          t.dataset.raw = raw;
          if (i === 0) t.classList.add("active");
          t.addEventListener("click", () => {
            setMainImageByIndex(i);
            t.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
          });
          detailThumbs.appendChild(t);
        });
      }

      ensureDetailGalleryBindings();
    }

    // 2) 款式按鈕
    if (detailSpecs) {
      detailSpecs.innerHTML = "";
      (product.specs || []).forEach((spec, i) => {
        const btn = document.createElement("button");
        btn.textContent = spec.label || spec.key || `款式${i + 1}`;
        btn.className = "pd-spec-btn" + (i === 0 ? " active" : "");
        btn.addEventListener("click", () => setDetailSpec(productId, spec.key));
        detailSpecs.appendChild(btn);
      });
    }

    // 3) 預設選第一個款式
    if (product.specs && product.specs[0]) {
      setDetailSpec(productId, product.specs[0].key);
    } else {
      setMainImageByIndex(0);
    }

    // 4) 數量 reset
    if (detailQtyInput) detailQtyInput.value = "1";

    // 5) 顯示並捲到詳情
    if (productDetailSection) productDetailSection.style.display = "block";
    setTimeout(() => scrollToSection("productDetail"), 50);
  }

  function setDetailSpec(productId, specKey) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
	
	// ✅ 每次切款式都重新確認備貨標籤顯示（避免被其它提示覆蓋）
const tagEl = document.getElementById("detailTagNote");
if (tagEl) {
  const t = String(product.tag || "").trim();
  tagEl.textContent = (t === "leadtime_10_15") ? "較長備貨（10-15天）" : "";
  tagEl.style.display = tagEl.textContent ? "inline-block" : "none";
}


    const spec = (product.specs || []).find((s) => s.key === specKey);
    if (!spec) return;

    currentDetailSpecKey = spec.key;

    const wantRaw = spec.mainImg || spec.thumbs?.[0] || product.imageUrl || "";
    const wantUrl = resolveImgUrl(wantRaw);

    let hitIndex = -1;
    for (let i = 0; i < (detailGallery.images || []).length; i++) {
      if (resolveImgUrl(detailGallery.images[i]) === wantUrl) {
        hitIndex = i;
        break;
      }
    }
    setMainImageByIndex(hitIndex >= 0 ? hitIndex : 0);

    // active 樣式
    if (detailSpecs) {
      [...detailSpecs.children].forEach((b) => {
        b.classList.toggle("active", b.textContent === (spec.label || spec.key));
      });
    }
	
// ✅ 庫存提示（0 也可下單：顯示備貨提示，不鎖按鈕）
const available = getAvailableStock(product, currentDetailSpecKey);
const noteEl = document.getElementById("detailPriceNote");
const addBtn = document.getElementById("detailAddBtn");

if (noteEl) noteEl.textContent = "";
if (addBtn) addBtn.disabled = false;

if (available !== Infinity) {
  if (available <= 0) {
    if (noteEl) noteEl.textContent = "庫存：0（可下單需較長備貨）";
    if (addBtn) addBtn.disabled = false; // ✅ 不鎖
  } else {
    if (noteEl) noteEl.textContent = `（剩餘庫存：${available}）`;
    if (addBtn) addBtn.disabled = false;
  }
}
}

  /* =========================================================
   * Lightbox (legacy #imgLightbox)
   * ========================================================= */
  let __lbBound = false;

  function ensureLightbox() {
    const lb = $("imgLightbox");
    if (!lb || __lbBound) return;

    const closeBtn = $("lbClose");
    const prevBtn = $("lbPrev");
    const nextBtn = $("lbNext");
    const stage = $("lbStage");
    const imgEl = $("lbImg");

    const close = () => closeLightbox();

    closeBtn && closeBtn.addEventListener("click", close);
    prevBtn && prevBtn.addEventListener("click", () => lightboxStep(-1));
    nextBtn && nextBtn.addEventListener("click", () => lightboxStep(1));

    lb.addEventListener("click", (e) => {
      if (e.target === lb || e.target === stage) close();
    });

    document.addEventListener("keydown", (e) => {
      if (!lb.classList.contains("open")) return;
      if (e.key === "Escape") return close();
      if (e.key === "ArrowLeft") return lightboxStep(-1);
      if (e.key === "ArrowRight") return lightboxStep(1);
    });

    // 手機滑動（在放大圖上）
    if (imgEl) {
      let sx = 0, sy = 0, tracking = false;
      const SWIPE_MIN_X = 40;
      const SWIPE_MAX_Y = 80;

      imgEl.addEventListener("touchstart", (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        tracking = true;
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
      }, { passive: true });

      imgEl.addEventListener("touchend", (e) => {
        if (!tracking) return;
        tracking = false;
        const t = e.changedTouches && e.changedTouches[0];
        if (!t) return;

        const dx = t.clientX - sx;
        const dy = t.clientY - sy;

        if (Math.abs(dy) > SWIPE_MAX_Y) return;
        if (Math.abs(dx) < SWIPE_MIN_X) return;

        if (dx < 0) lightboxStep(1);
        else lightboxStep(-1);
      }, { passive: true });
    }

    __lbBound = true;
  }

  function openLightboxByIndex(idx) {
    ensureLightbox();
    const lb = $("imgLightbox");
    const imgEl = $("lbImg");
    const hintEl = $("lbHint");
    if (!lb || !imgEl) return;

    const imgs = detailGallery.images || [];
    if (!imgs.length) return;

    const safe = (idx + imgs.length) % imgs.length;
    detailGallery.index = safe;

    imgEl.src = resolveImgUrl(imgs[safe]);
    if (hintEl) hintEl.textContent = `${safe + 1} / ${imgs.length}　｜點擊空白處或按 ESC 關閉｜左右鍵切換｜手機可左右滑`;

    lb.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    const lb = $("imgLightbox");
    if (!lb) return;
    lb.classList.remove("open");
    document.body.style.overflow = "";
  }

  function lightboxStep(delta) {
    const imgs = detailGallery.images || [];
    if (!imgs.length) return;

    const next = (detailGallery.index + delta + imgs.length) % imgs.length;
    detailGallery.index = next;

    // 同步回詳情主圖
    setMainImageByIndex(next);

    const lb = $("imgLightbox");
    const imgEl = $("lbImg");
    const hintEl = $("lbHint");
    if (!lb || !lb.classList.contains("open") || !imgEl) return;

    imgEl.style.opacity = "0";
    setTimeout(() => {
      imgEl.src = resolveImgUrl(imgs[next]);
      imgEl.style.opacity = "1";
      if (hintEl) hintEl.textContent = `${next + 1} / ${imgs.length}　｜點擊空白處或按 ESC 關閉｜左右鍵切換｜手機可左右滑`;
    }, 80);
  }

  /* 主圖滑動 + 點擊 Lightbox */
  let __detailSwipeBound = false;
  function ensureDetailGalleryBindings() {
    if (__detailSwipeBound) return;
    __detailSwipeBound = true;

    if (!detailMainImg) return;

    // 點擊放大
    detailMainImg.addEventListener("click", () => openLightboxByIndex(detailGallery.index));

    // 手機左右滑切主圖
    let sx = 0, sy = 0, tracking = false;
    const SWIPE_MIN_X = 35;
    const SWIPE_MAX_Y = 80;

    detailMainImg.addEventListener("touchstart", (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      tracking = true;
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
    }, { passive: true });

    detailMainImg.addEventListener("touchend", (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;

      const dx = t.clientX - sx;
      const dy = t.clientY - sy;

      if (Math.abs(dy) > SWIPE_MAX_Y) return;
      if (Math.abs(dx) < SWIPE_MIN_X) return;

      if (dx < 0) setMainImageByIndex(detailGallery.index + 1);
      else setMainImageByIndex(detailGallery.index - 1);
    }, { passive: true });
  }

  /* =========================================================
   * Detail qty controls
   * ========================================================= */
  let __detailQtyBound = false;
  function bindDetailQtyControls() {
    if (__detailQtyBound) return;
    __detailQtyBound = true;

    const minus = detailQtyMinus;
    const plus = detailQtyPlus;
    const input = detailQtyInput;
    if (!minus || !plus || !input) return;

    const clamp = (v) => Math.max(1, Math.min(99, v));
    const read = () => {
      const n = parseInt(String(input.value || "1").trim(), 10);
      return clamp(Number.isFinite(n) ? n : 1);
    };
    const write = (v) => { input.value = String(clamp(v)); };

    minus.addEventListener("click", () => write(read() - 1));
    plus.addEventListener("click", () => write(read() + 1));

    input.addEventListener("input", () => {
      input.value = String(input.value).replace(/[^\d]/g, "");
    });
    input.addEventListener("blur", () => write(read()));
  }

  /* =========================================================
   * Cart
   * ========================================================= */
  function syncShippingRuleText() {
    const el = $("shippingRuleText");
    if (!el) return;
    el.textContent = `滿 NT$${SHIPPING_RULE.freeThreshold} 超商免運`;
  }

  function calcShipping(subtotal, shipType) {
    if (subtotal >= SHIPPING_RULE.freeThreshold) return 0;
    if (shipType === "home") return SHIPPING_RULE.homeFee;
    return SHIPPING_RULE.storeFee;
  }

  function getCartCount() {
    return cartItems.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  }

function updateCartButtonCount() {
  const badge = document.getElementById("cartCountBadge");
  if (!badge) return;

  const n = getCartCount();
  badge.textContent = String(n);
  badge.style.display = n > 0 ? "flex" : "none";
}

  function renderCartListUI() {
    const cartListEl = $("cartList");
    if (!cartListEl) return;

    if (!cartItems.length) {
      cartListEl.innerHTML = "（你的購物車目前是空的）";
      return;
    }

    cartListEl.innerHTML = cartItems.map((item, idx) => {
      const p = products.find((x) => x.id === item.productId);
      if (!p) return "";

      const spec = (p.specs || []).find((s) => s.key === item.specKey) || null;
      const specLabel = spec?.label ? `（${escapeHtml(spec.label)}）` : "";
      const price = Number(p.price) || 0;
      const qty = Number(item.qty) || 0;
      const lineTotal = price * qty;

      return `
        <div style="
          display:flex;
          justify-content:space-between;
          gap:10px;
          align-items:flex-start;
          padding:10px 12px;
          border-radius:12px;
          background:#fff;
          border:1px solid rgba(188,220,255,.8);
          margin:8px 0;
        ">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:900;color:#3f3a4f;font-size:13px;word-break:break-word;">
              ${escapeHtml(p.name || "")} ${specLabel}
            </div>
<div style="margin-top:4px;font-size:12px;color:#6c6480;">
  單價 NT$ ${price}　×　${qty}　＝　<strong>NT$ ${lineTotal}</strong>
</div>

<div style="margin-top:8px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
  <div style="display:flex; align-items:center; gap:6px; background:#fffdf5; border:1px dashed #f0d9a4; padding:6px 10px; border-radius:999px;">
    <button type="button" class="cart-qty-btn" data-idx="${idx}" data-delta="-1"
      style="
        width:28px;height:28px;border-radius:10px;
        border:1px solid rgba(188,220,255,.9);
        background:#fff; cursor:pointer; font-weight:900;
      "
      aria-label="減少數量"
    >−</button>

    <span style="min-width:22px; text-align:center; font-weight:900; color:#3f3a4f;">${qty}</span>

    <button type="button" class="cart-qty-btn" data-idx="${idx}" data-delta="1"
      style="
        width:28px;height:28px;border-radius:10px;
        border:1px solid rgba(188,220,255,.9);
        background:#fff; cursor:pointer; font-weight:900;
      "
      aria-label="增加數量"
    >＋</button>
  </div>

  <span style="font-size:12px;color:#9a7641;">
    （可直接在購物車調整數量）
  </span>
</div>

          </div>

          <button type="button" data-idx="${idx}" class="cart-remove-btn"
            style="
              flex:0 0 auto;
              border:none;
              border-radius:999px;
              padding:6px 10px;
              cursor:pointer;
              background:#fff0e8;
              border:1px solid #f7a27a;
              color:#b8481e;
              font-weight:900;
              font-size:12px;
            "
          >刪除</button>
        </div>
      `;
    }).join("");

    cartListEl.querySelectorAll(".cart-remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        if (Number.isNaN(idx)) return;
        cartItems.splice(idx, 1);
        updateCartSummaryUI();
      });
    });
	cartListEl.querySelectorAll(".cart-qty-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const idx = Number(btn.dataset.idx);
    const delta = Number(btn.dataset.delta);

    if (Number.isNaN(idx) || Number.isNaN(delta)) return;
    const item = cartItems[idx];
    if (!item) return;

    const nextQty = (Number(item.qty) || 0) + delta;

    // ✅ 不允許小於 1：小於 1 就直接刪除（跟你原本刪除一致）
    if (nextQty <= 0) {
      cartItems.splice(idx, 1);
      updateCartSummaryUI();
      return;
    }

    // ✅ 庫存檢查（沿用你既有規則：spec stock 優先，再 product stock）
    const p = products.find((x) => x.id === item.productId);
    const available = getAvailableStock(p, item.specKey);
if (available !== Infinity && available > 0 && nextQty > available) {
  alert(`庫存不足～此款式最多 ${available} 件 🤍`);
  return;
}
// available <= 0：允許備貨，不擋


    item.qty = nextQty;
    updateCartSummaryUI();
  });
});

  }

  function updateCartSummaryUI() {
    syncShippingRuleText();

    let subtotal = 0;
    for (const item of cartItems) {
      const p = products.find((x) => x.id === item.productId);
      if (!p) continue;
      subtotal += (Number(p.price) || 0) * (Number(item.qty) || 0);
    }

    const shipType = $("checkoutShip")?.value || "711";
    const shippingFee = calcShipping(subtotal, shipType);
    const total = subtotal + shippingFee;

    const sumSubtotalEl = $("sumSubtotal");
    const sumShippingEl = $("sumShipping");
    const sumTotalEl = $("sumTotal");
    const cartSummaryEl = $("cartSummary");
    const shipHintEl = $("shipHint");

    if (sumSubtotalEl) sumSubtotalEl.textContent = `NT$ ${subtotal}`;
    if (sumShippingEl) sumShippingEl.textContent = `NT$ ${shippingFee}`;
    if (sumTotalEl) sumTotalEl.textContent = `NT$ ${total}`;

    if (cartSummaryEl) cartSummaryEl.style.display = cartItems.length ? "block" : "none";

    if (shipHintEl) {
      if (subtotal >= SHIPPING_RULE.freeThreshold) {
        shipHintEl.textContent = "🎉 已達免運門檻！";
      } else {
        const diff = SHIPPING_RULE.freeThreshold - subtotal;
        shipHintEl.textContent = `再買 NT$${diff} 即可免運 🚚`;
      }
    }

    renderCartListUI();
    updateCartButtonCount();
  }

let __addToCartBound = false;
function bindAddToCart() {
  if (!detailAddBtn || __addToCartBound) return;
  __addToCartBound = true;

  detailAddBtn.addEventListener("click", () => {
    if (!currentDetailProductId) return;

    const product = products.find(p => p.id === currentDetailProductId);
    if (!product) return;

    const qty = Math.max(1, parseInt(detailQtyInput?.value, 10) || 1);
    const specKey = currentDetailSpecKey || "__default__";

const availableStock = getAvailableStock(product, specKey);
const inCartQty = getCartQty(currentDetailProductId, specKey);

// ✅ 庫存非 0：不允許超過庫存（含購物車既有數量）
// ✅ 庫存 = 0：允許下單（視為備貨）
if (availableStock !== Infinity && availableStock > 0) {
  const nextTotal = inCartQty + qty;
  if (nextTotal > availableStock) {
    alert(`庫存不足～此款式最多 ${availableStock} 件 🤍`);
    return;
  }
}


    /* =========================
       ✅ 4️⃣ 正常加入購物車
    ========================= */
    const existing = cartItems.find(
      x => x.productId === currentDetailProductId && x.specKey === specKey
    );

    if (existing) existing.qty += qty;
    else cartItems.push({ productId: currentDetailProductId, specKey, qty });

    alert("已加入購物車！🤍");
    updateCartSummaryUI();
  });
}



/* =========================================================
 * Hero from products (FINAL + 防呆：避免只剩 1 張 + 隱藏 leadtime_10_15)
 * ========================================================= */
function buildHeroFromProducts() {
  const slidesEl = $("heroBannerSlides");
  const dotsEl = $("heroBannerDots");
  if (!slidesEl || !dotsEl) return;
  if (!Array.isArray(products) || !products.length) return;

  const HERO_LIMIT = 6;

  // ✅ 不要讓 leadtime_10_15 這種 tag 出現在輪播 tag，也不要用它當輪播主打來源
  const isLeadtimeTag = (t) => {
    const s = String(t || "").trim();
    if (!s) return false;
    return /^leadtime_?10_?15$/i.test(s) || /LEADTIME10_15/i.test(s);
  };

  const STORAGE_KEY = "hero_product_order_v2";

  slidesEl.innerHTML = "";
  dotsEl.innerHTML = "";

  // ✅ source：只挑「有 tag」且不是 leadtime 的商品作為輪播主打來源
  const source = products.filter((p) => {
    const t = String(p?.tag || "").trim();
    return t && !isLeadtimeTag(t);
  });

  // ✅ 如果沒有任何主打 tag，就回退到全部商品
  const baseList = source.length ? source : products;

  // ✅ 讀取 localStorage 的輪播順序
  let order = [];
  try {
    order = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    order = [];
  }

  // ✅ 防呆：只要 order 太短、或 order 裡有效商品太少，就自動重建
  const needCount = Math.min(HERO_LIMIT, baseList.length);
  const validCount = Array.isArray(order)
    ? order
        .map((id) => baseList.find((p) => String(p.id) === String(id)))
        .filter(Boolean).length
    : 0;

  if (!Array.isArray(order) || order.length < needCount || validCount < needCount) {
    order = baseList.map((p) => p.id);

    // shuffle
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
    } catch {}
  }

  // ✅ 依照 order 生成輪播清單
  let shuffled = order
    .map((id) => baseList.find((p) => String(p.id) === String(id)))
    .filter(Boolean)
    .slice(0, HERO_LIMIT);

  // ✅ 若仍然拿不到（極端情況），直接用 baseList 前幾筆
  if (!shuffled.length) {
    shuffled = baseList.slice(0, HERO_LIMIT);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(shuffled.map((p) => p.id)));
    } catch {}
  }

  // ✅ 建 slides + dots
  shuffled.forEach((p, i) => {
    const imgRaw =
      p.imageUrl ||
      p.specs?.[0]?.mainImg ||
      p.specs?.[0]?.thumbs?.[0] ||
      "";
    const img = resolveImgUrl(imgRaw);

    const ctaText =
      String(p.tag || "").includes("熱") ? "🔥 馬上搶購" :
      String(p.tag || "").includes("新") ? "🆕 立即看看" :
      "查看商品";

    const slide = document.createElement("div");
    slide.className = "hero-banner-slide" + (i === 0 ? " active" : "");
    slide.dataset.id = p.id;

    slide.innerHTML = `
      ${(p.tag && !isLeadtimeTag(p.tag)) ? `<span class="hero-tag">${escapeHtml(p.tag)}</span>` : ""}

      <div class="hero-banner-media">
        ${img ? `<img src="${img}" alt="${escapeHtml(p.name || "")}">` : ""}
      </div>

      <div class="hero-content">
        <h2>${escapeHtml(p.name || "")}</h2>
        ${p.subtitle ? `<p>${escapeHtml(p.subtitle)}</p>` : ""}
        <div class="hero-banner-cta">
          <button class="cta-primary" type="button">${ctaText}</button>
        </div>
      </div>
    `;

    slidesEl.appendChild(slide);

    // ✅ dots 用 button（更穩、可點、吃到你 CSS）
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "hero-dot" + (i === 0 ? " active" : "");
    dot.setAttribute("aria-label", `輪播第 ${i + 1} 張`);
    dotsEl.appendChild(dot);
  });

  // ✅ 最後一張：查看全部商品
  const moreSlide = document.createElement("div");
  moreSlide.className = "hero-banner-slide";
  moreSlide.innerHTML = `
    <div class="hero-content" style="height:100%;">
      <h2>看看全部商品</h2>
      <p>把喜歡的可愛，都放進日常裡 ♡</p>
      <div class="hero-banner-cta">
        <button class="cta-secondary" type="button">前往商品列表 →</button>
      </div>
    </div>
  `;
  slidesEl.appendChild(moreSlide);

  const moreDot = document.createElement("button");
  moreDot.type = "button";
  moreDot.className = "hero-dot";
  moreDot.setAttribute("aria-label", "輪播：查看全部商品");
  dotsEl.appendChild(moreDot);
}


  function initHeroBanner() {
    const slidesEl = $("heroBannerSlides");
    const dotsEl = $("heroBannerDots");
    if (!slidesEl || !dotsEl) return;

    const AUTOPLAY_MS = 4000;

    const getSlides = () => Array.from(slidesEl.querySelectorAll(".hero-banner-slide"));
    const getDots = () => Array.from(dotsEl.querySelectorAll(".hero-dot"));

    let index = 0;
    let timer = null;

    function setActive(nextIndex) {
      const slides = getSlides();
      const dots = getDots();
      if (!slides.length) return;

      if (nextIndex >= slides.length) nextIndex = 0;
      if (nextIndex < 0) nextIndex = slides.length - 1;

      index = nextIndex;
      slides.forEach((s, i) => s.classList.toggle("active", i === index));
      dots.forEach((d, i) => d.classList.toggle("active", i === index));
    }

    function startAuto() {
      stopAuto();
      timer = setInterval(() => setActive(index + 1), AUTOPLAY_MS);
    }
    function stopAuto() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    // CTA click (event delegation)
    slidesEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".cta-primary, .cta-secondary");
      if (!btn) return;

      const slide = btn.closest(".hero-banner-slide");
      const id = slide?.dataset?.id;

      if (id) openProduct(Number(id));
      else scrollToSection("products");
    });

    // dots click
    dotsEl.addEventListener("click", (e) => {
      const dot = e.target.closest(".hero-dot");
      if (!dot) return;
      const dots = getDots();
      const idx = dots.indexOf(dot);
      if (idx >= 0) {
        setActive(idx);
        startAuto();
      }
    });

    // swipe
    let startX = 0, startY = 0, tracking = false;
    const SWIPE_MIN_X = 40;
    const SWIPE_MAX_Y = 60;

    const banner = slidesEl.closest(".hero-banner") || slidesEl;

    banner.addEventListener("touchstart", (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      tracking = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });

    banner.addEventListener("touchend", (e) => {
      if (!tracking) return;
      tracking = false;

      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;

      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (Math.abs(dy) > SWIPE_MAX_Y) return;
      if (Math.abs(dx) < SWIPE_MIN_X) return;

      if (dx < 0) setActive(index + 1);
      else setActive(index - 1);

      startAuto();
    }, { passive: true });

    banner.addEventListener("mouseenter", stopAuto);
    banner.addEventListener("mouseleave", startAuto);

    setActive(0);
    startAuto();
  }

  /* =========================================================
   * Checkout
   * ========================================================= */
   
     /* =========================================================
   * ✅ Remember customer info (localStorage)
   * - 目的：下次開頁自動帶入
   * - 也提供「套用上次資料 / 清除記憶」按鈕
   * ========================================================= */
  const CUSTOMER_DRAFT_KEY = "sxz_checkout_draft_v1";

  function readDraft() {
    try {
      const raw = localStorage.getItem(CUSTOMER_DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeDraft(draft) {
    try {
      localStorage.setItem(CUSTOMER_DRAFT_KEY, JSON.stringify(draft || {}));
    } catch {}
  }

  function clearDraft() {
    try { localStorage.removeItem(CUSTOMER_DRAFT_KEY); } catch {}
  }

  function getCurrentDraftFromForm() {
    return {
      name: $("checkoutName")?.value?.trim() || "",
      phone: $("checkoutPhone")?.value?.trim() || "",
      emailLocal: $("checkoutEmailLocal")?.value?.trim() || "",
      emailDomain: $("checkoutEmailDomain")?.value || "gmail.com",
      emailCustom: $("checkoutEmailCustom")?.value?.trim() || "",
      address: $("checkoutAddress")?.value?.trim() || "",
      line: $("checkoutLine")?.value?.trim() || "",
      ship: $("checkoutShip")?.value || "711",
      pay: $("checkoutPay")?.value || "card",
    };
  }

  function applyDraftToForm(d) {
    if (!d) return;

    if ($("checkoutName") && d.name) $("checkoutName").value = d.name;
    if ($("checkoutPhone") && d.phone) $("checkoutPhone").value = d.phone;

    if ($("checkoutEmailLocal") && d.emailLocal) $("checkoutEmailLocal").value = d.emailLocal;
    if ($("checkoutEmailDomain") && d.emailDomain) $("checkoutEmailDomain").value = d.emailDomain;
    if ($("checkoutEmailCustom") && d.emailCustom) $("checkoutEmailCustom").value = d.emailCustom;

    // ✅ 你的 custom 網域欄位顯示/隱藏要同步一次
    const domainSel = $("checkoutEmailDomain");
    const custom = $("checkoutEmailCustom");
    if (domainSel && custom) {
      custom.style.display = (domainSel.value === "custom") ? "block" : "none";
    }

    if ($("checkoutAddress") && d.address) $("checkoutAddress").value = d.address;
    if ($("checkoutLine") && d.line) $("checkoutLine").value = d.line;

    if ($("checkoutShip") && d.ship) $("checkoutShip").value = d.ship;
    if ($("checkoutPay") && d.pay) $("checkoutPay").value = d.pay;
  }

  function bindDraftAutoSave() {
    const ids = [
      "checkoutName",
      "checkoutPhone",
      "checkoutEmailLocal",
      "checkoutEmailDomain",
      "checkoutEmailCustom",
      "checkoutAddress",
      "checkoutLine",
      "checkoutShip",
      "checkoutPay",
    ];

    let t = null;
    const saveSoon = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        writeDraft(getCurrentDraftFromForm());
      }, 200);
    };

    ids.forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener("input", saveSoon);
      el.addEventListener("change", saveSoon);
      el.addEventListener("blur", saveSoon);
      // ✅ 「點格子就看到」：focus 時若目前是空的，就提示/套用
      el.addEventListener("focus", () => {
        const d = readDraft();
        if (!d) return;

        // 只有在欄位全空或主要欄位空時才自動帶（避免打到一半被蓋掉）
        const nameEl = $("checkoutName");
        const phoneEl = $("checkoutPhone");
        if (nameEl && phoneEl && (!nameEl.value.trim() && !phoneEl.value.trim())) {
          applyDraftToForm(d);
        }
      });
    });
  }

  function injectDraftButtons() {
    const form = $("checkoutForm");
    if (!form) return;

    // 避免重複插入
    if (document.getElementById("sxzDraftBtnBar")) return;

    const bar = document.createElement("div");
    bar.id = "sxzDraftBtnBar";
    bar.style.cssText = "display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 0;align-items:center;";

    const btnUse = document.createElement("button");
    btnUse.type = "button";
    btnUse.className = "btn-secondary";
    btnUse.textContent = "✨ 套用上次填寫";
    btnUse.addEventListener("click", () => {
      const d = readDraft();
      if (!d) { alert("目前沒有已記憶的資料喔 🤍"); return; }
      applyDraftToForm(d);
      alert("已套用上次填寫 ✅");
    });

    const btnClear = document.createElement("button");
    btnClear.type = "button";
    btnClear.className = "btn-secondary";
    btnClear.textContent = "🧹 清除記憶";
    btnClear.addEventListener("click", () => {
      clearDraft();
      alert("已清除記憶 ✅");
    });

    bar.appendChild(btnUse);
    bar.appendChild(btnClear);

    // 插在表單最上方
    form.prepend(bar);
  }

  function initCustomerMemory() {
    // 1) 載入並套用（只在主要欄位還沒填時才自動套）
    const d = readDraft();
    const nameEl = $("checkoutName");
    const phoneEl = $("checkoutPhone");
    if (d && nameEl && phoneEl && (!nameEl.value.trim() && !phoneEl.value.trim())) {
      applyDraftToForm(d);
    }

    // 2) 自動儲存草稿（打字就記）
    bindDraftAutoSave();

    // 3) 加入「套用/清除」按鈕
    injectDraftButtons();
  }

   
   
   
   
   
   
  function getShopeeUrlForCOD() {
    return "https://shopee.tw/a0931866109?categoryId=100639&entryPoint=ShopByPDP&itemId=47802373263";
  }

function normalizeEmailInput(s) {
  // 去空白、全形＠轉半形、順便把左右空白去掉
  return String(s || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/＠/g, "@");
}

// ✅ 防呆 Email：避免 @@、避免 you@gmail.com@yahoo.com、也允許客戶直接貼完整 email
function buildCheckoutEmail() {
  const localRaw = normalizeEmailInput($("checkoutEmailLocal")?.value);
  const domainSel = $("checkoutEmailDomain")?.value || "gmail.com";
  const customRaw = normalizeEmailInput($("checkoutEmailCustom")?.value);

  // 1) 客戶如果「直接輸入完整 email」(含@) → 直接用，不要再拼尾碼
  if (localRaw.includes("@")) {
    // 若他打了多個@，只用第一個切開組回來（避免 @@）
    const at = localRaw.indexOf("@");
    const left = localRaw.slice(0, at);
    const right = localRaw.slice(at + 1);

    const full = `${left}@${right}`.replace(/^@+/, "");
    return full;
  }

  // 2) 否則用下拉/自訂網域來拼
  let domain = domainSel === "custom" ? customRaw : String(domainSel || "");
  domain = normalizeEmailInput(domain).replace(/^@+/, ""); // 網域不要帶@

  if (!localRaw || !domain) return "";
  return `${localRaw}@${domain}`;
}


  // ✅ Checkout 格式防呆（前台檢查）
  function normalizeDigits(s) {
    return String(s || "").replace(/[^\d]/g, "");
  }

  function isValidTWMobile(phone) {
    const d = normalizeDigits(phone);
    // 台灣手機常見：09xxxxxxxx（10碼）
    return /^09\d{8}$/.test(d);
  }

  function isValidEmail(email) {
    const e = String(email || "").trim();
    // 不用太嚴格，但要擋掉明顯亂填
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
  }


  let __checkoutBound = false;
  function bindCheckoutFormSubmit() {
    if (__checkoutBound) return;
    __checkoutBound = true;

    const form = $("checkoutForm");
    if (!form) return;
	let lastSubmitAt = 0; // ✅ 防止短時間連續送出

    // email domain custom toggle
    const domainSel = $("checkoutEmailDomain");
    const custom = $("checkoutEmailCustom");
    if (domainSel && custom) {
      const sync = () => {
        custom.style.display = (domainSel.value === "custom") ? "block" : "none";
      };
      domainSel.addEventListener("change", sync);
      sync();
	  const emailHint = $("emailHint");
const emailLocal = $("checkoutEmailLocal");

const refreshEmailHint = () => {
  const emailNow = buildCheckoutEmail();
  if (emailHint) {
    emailHint.textContent = emailNow
      ? `✅ 將寄送訂單明細到：${emailNow}`
      : "⌜ @ ⌟不需要另外加（右邊已經有），將寄送訂單明細";
  }
};

emailLocal && emailLocal.addEventListener("input", refreshEmailHint);
domainSel && domainSel.addEventListener("change", refreshEmailHint);
custom && custom.addEventListener("input", refreshEmailHint);
refreshEmailHint();
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
	  
	  // ✅ 8 秒內禁止重複送出（防狂點/防亂下單）
const now = Date.now();
if (now - lastSubmitAt < 8000) {
  alert("請稍等一下再送出訂單 ⏳");
  return;
}
lastSubmitAt = now;


      if (!cartItems.length) {
        alert("購物車是空的～先把喜歡的商品加入購物車再送出訂單唷 🤍");
        scrollToSection("products");
        return;
      }

      const name = $("checkoutName")?.value?.trim() || "";
      const phone = $("checkoutPhone")?.value?.trim() || "";
      const address = $("checkoutAddress")?.value?.trim() || "";
      const line = $("checkoutLine")?.value?.trim() || "";
      const ship = $("checkoutShip")?.value || "711";
      const pay = $("checkoutPay")?.value || "card";
      const note = $("checkoutNote")?.value?.trim() || "";

      const email = buildCheckoutEmail();
      const emailHidden = $("checkoutEmail");
      if (emailHidden) emailHidden.value = email;

     // 基本防呆
if (!name || name.length < 2) {
  alert("請填寫正確的收件人姓名（至少 2 個字）🤍");
  return;
}

if (!/^09\d{8}$/.test(phone)) {
  alert("請填寫正確的手機號碼（例：09xxxxxxxx）📱");
  return;
}

if (!isValidEmail(email)) {
  alert("請填寫正確的 Email ✉️\n小提醒：右邊已經有 @gmail.com，不需要再自己打 @ 喔 🤍");
  return;
}


if (address.length < 4) {
  alert("請填寫完整的收件地址或門市資訊 🏠");
  return;
}


      if (String(pay).toLowerCase() === "cod") {
        alert("本網站暫不支援貨到付款～我幫你開蝦皮下單（可貨到付款）🛒");
        window.open(getShopeeUrlForCOD(), "_blank", "noopener,noreferrer");
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      const oldText = submitBtn ? submitBtn.textContent : "";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "送出中…";
      }

      try {
        const items = cartItems.map((it) => {
          const p = products.find((x) => x.id === it.productId);
          const spec = (p?.specs || []).find((s) => s.key === it.specKey) || null;
return {
  productId: it.productId,
  specKey: it.specKey,
  specLabel: spec?.label || "",
  name: p?.name || "",
  price: Number(p?.price || 0) || 0,
  qty: Number(it.qty || 0) || 0,
  tag: p?.tag || "",

  // ✅ 新增：是否為備貨（庫存=0）
  backorder: (() => {
    const available = getAvailableStock(p, it.specKey);
    return (available !== Infinity && available <= 0);
  })(),

  // ✅ 新增：顯示用備註（給後台/Email）
  backorderNote: (() => {
    const available = getAvailableStock(p, it.specKey);
    return (available !== Infinity && available <= 0) ? "需較長備貨" : "";
  })(),
};

        }).filter(x => x.productId && x.qty > 0);

// ✅ 付款方式：用表單選到的 pay（你上面已經 const pay = ... 了）
// 如果你想「強制都走綠界」，用 payMethod 這個名字，別用 pay 來遮蔽
const payMethod = String(pay || "").toLowerCase(); // pay 來自外層：checkoutPay
// ✅ 如果購物車裡有任何「庫存=0」的商品，就在訂單備註加一句提醒
const hasBackorder = items.some(x => x.backorder === true);
const backorderMsg = hasBackorder ? "【本筆訂單含需較長備貨商品】" : "";
const finalNote = [backorderMsg, note].filter(Boolean).join(" ");

const payload = {
  customer: { name, phone, email, address, line, ship, pay: payMethod, note: finalNote },
  items
};

// ✅ 真的建立訂單（你原本缺這行，resp 才會存在）
const resp = await apiPost("/api/orders", payload);

if (!resp || resp.ok !== true) {
  alert(resp?.message || "建立訂單失敗，請稍後再試");
  return;
}

/* ✅【貼這裡】有綠界付款就直接跳轉 */
if (resp?.payment?.redirectUrl) {
  location.href = resp.payment.redirectUrl;
  return;
}

		


        const ids = Array.isArray(resp.splitIds)
          ? resp.splitIds
          : (resp.id ? [resp.id] : []);

        alert(`🎉 訂單已送出成功！\n訂單編號：${ids.join(" / ")}\n我們會用 Email / LINE 通知出貨進度 🤍`);
		writeDraft(getCurrentDraftFromForm());
        cartItems = [];
        updateCartSummaryUI();

        scrollToSection("order-query");

        const qp = $("queryPhone");
        const qo = $("queryOrderId");
        if (qp) qp.value = phone;
        if (qo && ids[0]) qo.value = ids[0];

      } catch (err) {
        alert(String(err?.message || err || "建立訂單失敗，請稍後再試"));
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = oldText || "送出訂單";
        }
      }
    });
  }

  /* =========================================================
   * Order query
   * ========================================================= */
  let __orderQueryBound = false;
  function bindOrderQueryForm() {
    if (__orderQueryBound) return;
    __orderQueryBound = true;

    const form = $("orderQueryForm");
    const resultEl = $("orderResult");
    if (!form || !resultEl) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const phone = $("queryPhone")?.value?.trim() || "";
      const id = $("queryOrderId")?.value?.trim() || "";
      if (!phone || !id) {
        alert("請輸入手機號碼與訂單編號");
        return;
      }

      resultEl.innerHTML = "查詢中…";

      try {
        const q = new URLSearchParams({ phone, id }).toString();
        const data = await apiGet(`/api/orders/query?${q}`);

        const order = data.order || data.data || data;
        if (!order) {
          resultEl.innerHTML = "查無資料";
          return;
        }

        const status = order.status || order.normalizedStatus || order.state || "new";
        const total = order.totalAmount || order.total || order.amount || "";
        const createdAt = order.createdAt || order.created_at || "";

        resultEl.innerHTML = `
          <div style="margin-top:10px;padding:12px 14px;border-radius:14px;background:#fffdf5;border:1px dashed #f0d9a4;">
            <div style="font-weight:900;">訂單編號：${escapeHtml(id)}</div>
            <div style="margin-top:6px;">狀態：<strong>${escapeHtml(String(status))}</strong></div>
            ${total !== "" ? `<div style="margin-top:6px;">總計：<strong>NT$ ${escapeHtml(String(total))}</strong></div>` : ""}
            ${createdAt ? `<div style="margin-top:6px;color:#6c6480;font-size:12px;">建立時間：${escapeHtml(String(createdAt))}</div>` : ""}
          </div>
        `;
      } catch (err) {
        resultEl.innerHTML = "";
        alert(String(err?.message || err || "查詢失敗"));
      }
    });
  }

  /* =========================================================
   * LINE button in detail
   * ========================================================= */
let __detailLineBound = false;
function bindDetailLineBtn() {
  if (!detailLineBtn || __detailLineBound) return;
  __detailLineBound = true;

  detailLineBtn.addEventListener("click", () => {
    window.open("https://lin.ee/FDKoij6", "_blank", "noopener,noreferrer");
  });
}

  /* =========================================================
   * Init
   * ========================================================= */
  async function initPage() {
    await loadProducts();

    buildHeroFromProducts();
    renderProductGrid();
    initHeroBanner();

    bindCategoryChips();
    bindSearch();

    bindDetailQtyControls();
    bindAddToCart();
    bindDetailLineBtn();

    bindCheckoutFormSubmit();
	initCustomerMemory();
    bindOrderQueryForm();

    updateCartSummaryUI();

    const shipSel = $("checkoutShip");
    if (shipSel) shipSel.addEventListener("change", updateCartSummaryUI);
  }

  document.addEventListener("DOMContentLoaded", initPage);

  /* =========================================================
   * Utils
   * ========================================================= */
  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
})();
