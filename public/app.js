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
	
	  // ✅ 庫存提示 + 缺貨禁用（顯示給客戶看，不噴錯誤碼）
  const available = getAvailableStock(product, currentDetailSpecKey);
  const noteEl = document.getElementById("detailPriceNote");
  const addBtn = document.getElementById("detailAddBtn");

  if (noteEl) noteEl.textContent = "";
  if (addBtn) addBtn.disabled = false;

  if (available !== Infinity) {
    if (available <= 0) {
      if (noteEl) noteEl.textContent = "（此款式庫存不足 / 已售完）";
      if (addBtn) addBtn.disabled = true;
    } else {
      if (noteEl) noteEl.textContent = `（剩餘庫存：${available}）`;
    }
  }

  }

  function setMainImageByIndex(nextIdx, { syncThumb = true } = {}) {
    const imgs = detailGallery.images || [];
    if (!imgs.length) return;

    const idx = (nextIdx + imgs.length) % imgs.length;
    detailGallery.index = idx;

    const url = resolveImgUrl(imgs[idx]);
    if (detailMainImg) detailMainImg.src = url;

    if (syncThumb && detailThumbs) {
      const thumbs = Array.from(detailThumbs.querySelectorAll("img"));
      thumbs.forEach((t) => t.classList.remove("active"));
      const hit = thumbs.find((t) => t.dataset.raw === imgs[idx]);
      if (hit) {
        hit.classList.add("active");
        hit.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      }
    }

    if (detailMainImg) {
      detailMainImg.onload = () => {
        const w = detailMainImg.naturalWidth || 0;
        const h = detailMainImg.naturalHeight || 0;
        detailMainImg.classList.toggle("is-portrait", h > w);
        detailMainImg.classList.toggle("is-landscape", w >= h);
      };
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
    const btn = document.querySelector('button.btn-primary[onclick*="scrollToSection(\'cart\')"]');
    if (!btn) return;
    btn.textContent = `查看購物車（${getCartCount()}）`;
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

function bindAddToCart() {
  if (!detailAddBtn) return;

  detailAddBtn.addEventListener("click", () => {
    if (!currentDetailProductId) return;

    const product = products.find(p => p.id === currentDetailProductId);
    if (!product) return;

    const qty = Math.max(1, parseInt(detailQtyInput?.value, 10) || 1);
    const specKey = currentDetailSpecKey || "__default__";

    /* =========================
       ✅ 1️⃣ 計算庫存
       規則：有款式 stock 用款式，沒有就用商品 stock
    ========================= */
    let availableStock = Infinity;

    if (Array.isArray(product.specs)) {
      const spec = product.specs.find(s => s.key === specKey);
      if (spec && Number.isFinite(Number(spec.stock))) {
        availableStock = Number(spec.stock);
      }
    }

    if (availableStock === Infinity && Number.isFinite(Number(product.stock))) {
      availableStock = Number(product.stock);
    }

    /* =========================
       ✅ 2️⃣ 計算購物車內已有數量
    ========================= */
    const inCartQty = cartItems
      .filter(x => x.productId === currentDetailProductId && x.specKey === specKey)
      .reduce((sum, x) => sum + x.qty, 0);

    /* =========================
       ✅ 3️⃣ 庫存不足 → 溫柔提示（不顯示錯誤碼）
    ========================= */
    if (availableStock !== Infinity) {
      if (availableStock <= 0) {
        alert("這個款式目前庫存不足或已售完 🥲\n可以換其他款式看看唷～");
        return;
      }

      if (inCartQty + qty > availableStock) {
        alert(
          `庫存不足～目前此款式剩 ${availableStock} 件。\n` +
          `你的購物車已有 ${inCartQty} 件，請調整數量或選擇其他款式 🤍`
        );
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
   * Hero from products (FIXED structure)
   * ========================================================= */
  function buildHeroFromProducts() {
    const slidesEl = $("heroBannerSlides");
    const dotsEl = $("heroBannerDots");
    if (!slidesEl || !dotsEl) return;
    if (!products.length) return;

    const HERO_LIMIT = 6;
    const STORAGE_KEY = "hero_product_order_v2";

    slidesEl.innerHTML = "";
    dotsEl.innerHTML = "";

    const source = products.filter(p => p.tag && String(p.tag).trim() !== "");
    const baseList = source.length ? source : products;

    let order = [];
    try { order = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch {}

    if (!order.length) {
      order = baseList.map(p => p.id);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
    }

    const shuffled = order
      .map(id => baseList.find(p => p.id === id))
      .filter(Boolean)
      .slice(0, HERO_LIMIT);

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

      // ✅ 固定結構：hero-tag + hero-banner-media + hero-content + hero-banner-cta
      slide.innerHTML = `
        ${p.tag ? `<span class="hero-tag">${escapeHtml(p.tag)}</span>` : ""}

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

      const dot = document.createElement("span");
      dot.className = "hero-dot" + (i === 0 ? " active" : "");
      dotsEl.appendChild(dot);
    });

    // 最後一張：查看全部商品
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

    const moreDot = document.createElement("span");
    moreDot.className = "hero-dot";
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
  function getShopeeUrlForCOD() {
    return "https://shopee.tw/a0931866109?categoryId=100639&entryPoint=ShopByPDP&itemId=47802373263";
  }

  function buildCheckoutEmail() {
    const local = $("checkoutEmailLocal")?.value?.trim() || "";
    const domainSel = $("checkoutEmailDomain")?.value || "gmail.com";
    const custom = $("checkoutEmailCustom")?.value?.trim() || "";
    const domain = domainSel === "custom" ? custom : domainSel;
    if (!local || !domain) return "";
    return `${local}@${domain}`;
  }

  let __checkoutBound = false;
  function bindCheckoutFormSubmit() {
    if (__checkoutBound) return;
    __checkoutBound = true;

    const form = $("checkoutForm");
    if (!form) return;

    // email domain custom toggle
    const domainSel = $("checkoutEmailDomain");
    const custom = $("checkoutEmailCustom");
    if (domainSel && custom) {
      const sync = () => {
        custom.style.display = (domainSel.value === "custom") ? "block" : "none";
      };
      domainSel.addEventListener("change", sync);
      sync();
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

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

      if (!name || !phone || !email || !address) {
        alert("請把必填欄位填完整：姓名、手機、Email、地址/門市 🤍");
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
            tag: p?.tag || ""
          };
        }).filter(x => x.productId && x.qty > 0);

        const payload = {
          customer: { name, phone, email, address, line, ship, pay, note },
          items
        };

        const resp = await apiPost("/api/orders", payload);

        if (!resp || resp.ok !== true) {
          alert(resp?.message || "建立訂單失敗，請稍後再試");
          return;
        }

        const ids = Array.isArray(resp.splitIds)
          ? resp.splitIds
          : (resp.id ? [resp.id] : []);

        alert(`🎉 訂單已送出成功！\n訂單編號：${ids.join(" / ")}\n我們會用 Email / LINE 通知出貨進度 🤍`);

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
  function bindDetailLineBtn() {
    if (!detailLineBtn) return;
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
