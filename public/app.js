if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  alert("我真的有讀到 app.js");
}

let __allThumbsBuiltForProductId = null;

/* =========================================================
 * Shipping / Free shipping rule (單一來源設定)
 * ========================================================= */
const SHIPPING_RULE = {
  freeThreshold: 699,                // ⭐ 免運門檻
  freeText: '滿 NT$699 全館免運',     // ⭐ 顯示文案
  storeFee: 100,                      // 超商運費
  homeFee: 120                       // 宅配運費
};

/* =========================================================
   A) 常數設定（圖片 / API）
========================================================= */
const SUPABASE_IMG_BASE =
  "https://ckqdimygblkasofycwvr.supabase.co/storage/v1/object/public/product-images/";

function resolveImgUrl(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return SUPABASE_IMG_BASE + url.replace(/^\/+/, "");
}

const API_BASE =
  (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "http://localhost:3000"
    : location.origin;

/* =========================================================
   API helpers
========================================================= */
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
   B) 商品資料
========================================================= */
let products = [];
let currentCategory = "all";
let currentKeyword = "";

const productGrid = document.getElementById("productGrid");
const productEmptyHint = document.getElementById("productEmptyHint");

/* =========================================================
   C) 載入商品
========================================================= */
async function loadProducts() {
  const data = await apiGet("/api/products");
  const list = data.products || data.data || [];
  products = Array.isArray(list) ? list : [];
}

/* =========================================================
   D) 商品列表（只能看，不能下單）
========================================================= */
function renderProductGrid() {
  if (!productGrid) return;
  productGrid.innerHTML = "";

  const filtered = products.filter((p) => {
    if (currentCategory !== "all" && !(p.categories || []).includes(currentCategory)) {
      return false;
    }
    if (!currentKeyword) return true;

    const text = [
      p.name,
      p.subtitle,
      (p.categories || []).join(" "),
      p.shortDesc,
      p.code,
    ]
      .join(" ")
      .toLowerCase();

    return text.includes(currentKeyword.toLowerCase());
  });

  if (productEmptyHint) {
    productEmptyHint.style.display = filtered.length ? "none" : "block";
  }

  filtered.forEach((product) => {
    const specs = product.specs || [];
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
        ${mainImg ? `<img src="${mainImg}" alt="${product.name}">` : ""}
      </div>
      <h4 class="product-name">${product.name}</h4>

      <div class="product-bottom">
        <div class="product-price">NT$ ${product.price}</div>
        <div class="card-hint">點擊查看商品詳情</div>
      </div>
    `;

    card.querySelector(".product-img").onclick = () => openProduct(product.id);
    card.querySelector(".product-name").onclick = () => openProduct(product.id);

    productGrid.appendChild(card);
  });
}

/* =========================================================
   E) 商品詳情（唯一能下單的地方）
========================================================= */
const productDetailSection = document.getElementById("productDetail");
const detailName = document.getElementById("detailName");
const detailSub = document.getElementById("detailSub");
const detailPrice = document.getElementById("detailPrice");
const detailDesc = document.getElementById("detailDesc");
const detailMainImg = document.getElementById("detailMainImg");
const detailThumbs = document.getElementById("detailThumbs");
const detailSpecs = document.getElementById("detailSpecs");
const detailQtyInput = document.getElementById("detailQtyInput");
const detailAddBtn = document.getElementById("detailAddBtn");

let currentDetailProductId = null;
let currentDetailSpecKey = null;

function openProduct(productId) {
  const product = products.find((p) => p.id === productId);
  if (!product) return;

  currentDetailProductId = productId;
  currentDetailSpecKey = null;

  detailName.textContent = product.name;
  detailSub.textContent = product.subtitle || "";
  detailPrice.textContent = product.price;
  detailDesc.innerHTML = product.detailHtml || "";

  // ============================
  // ✅ 建立「整個商品」的全圖庫 + 全縮圖列（只做一次）
  // ============================
  if (__allThumbsBuiltForProductId !== productId) {
    __allThumbsBuiltForProductId = productId;

    const allRaw = [];

    // 收集：每個款式的 mainImg + thumbs
    (product.specs || []).forEach((s) => {
      if (s?.mainImg) allRaw.push(s.mainImg);
      (s?.thumbs || []).forEach((x) => allRaw.push(x));
    });

    // 如果都沒圖，退回商品主圖
    if (!allRaw.length && product.imageUrl) allRaw.push(product.imageUrl);

    // ✅ 去重（用最終 URL 去重）
    const seen = new Set();
    const allUrls = [];
    for (const raw of allRaw) {
      const u = resolveImgUrl(raw);
      if (!u) continue;
      if (seen.has(u)) continue;
      seen.add(u);
      allUrls.push(raw); // 這裡保留 raw，後面 setMainImageByIndex 會 resolve
    }

    detailGallery.images = allUrls;
    detailGallery.index = 0;

    // ✅ 建立縮圖列（永遠顯示全圖）
detailThumbs.innerHTML = "";
detailGallery.images.forEach((raw, i) => {
  const t = document.createElement("img");
  t.src = resolveImgUrl(raw);
  t.dataset.raw = raw;
  if (i === 0) t.classList.add("active");

  t.onclick = () => {
    setMainImageByIndex(i);
    t.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  };

  detailThumbs.appendChild(t);
});

    // ✅ 綁定「主圖滑動 + 點擊 Lightbox」（只綁一次）
    ensureDetailGalleryBindings();
  }

  // ============================
  // ✅ 款式按鈕（照舊）
  // ============================
  detailSpecs.innerHTML = "";
  (product.specs || []).forEach((spec, i) => {
    const btn = document.createElement("button");
    btn.textContent = spec.label;
    btn.className = "pd-spec-btn" + (i === 0 ? " active" : "");
    btn.onclick = () => setDetailSpec(productId, spec.key);
    detailSpecs.appendChild(btn);
  });

  // ✅ 預設選第一個款式：只切圖，不重建縮圖列
  if (product.specs && product.specs[0]) {
    setDetailSpec(productId, product.specs[0].key);
  } else {
    // 沒款式就顯示全圖庫第一張
    setMainImageByIndex(0);
  }

  detailQtyInput.value = 1;
  productDetailSection.style.display = "block";

  setTimeout(() => {
    productDetailSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 50);
}


function setDetailSpec(productId, specKey) {
  const product = products.find((p) => p.id === productId);
  if (!product) return;

  const spec = (product.specs || []).find((s) => s.key === specKey);
  if (!spec) return;

  currentDetailSpecKey = spec.key;

  // 主圖尺寸（避免遮擋）
  detailMainImg.style.maxHeight = "40vh";
  detailMainImg.style.objectFit = "contain";

  // ✅ 切到「該款式」的第一張（在全縮圖列中找得到就跳過去）
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

  // ✅ 規格按鈕 active
  [...detailSpecs.children].forEach((b) => {
    b.classList.toggle("active", b.textContent === spec.label);
  });
}




/* =========================================================
   F) 購物車（只從詳情加入）
========================================================= */
let cartItems = [];

// =========================================================
// Shipping rule text (同步顯示到購物車摘要)
// 你要顯示：「滿 699 超商免運」→ 這裡統一產生文案（不寫死 699）
// =========================================================
function syncShippingRuleText() {
  const el = document.getElementById("shippingRuleText");
  if (!el) return;

  el.textContent = `滿 NT$${SHIPPING_RULE.freeThreshold} 超商免運`;
}

// =========================================================
// Shipping fee calculator (單一來源：免運門檻 / 運費)
// =========================================================
function calcShipping(subtotal, shipType) {
  // 免運
  if (subtotal >= SHIPPING_RULE.freeThreshold) return 0;

  // 宅配 / 超商
  if (shipType === "home") return SHIPPING_RULE.homeFee;
  return SHIPPING_RULE.storeFee; // 711 / family
}

// =========================================================
// Cart UI helpers
// =========================================================
function getCartCount() {
  return cartItems.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
}

function updateCartButtonCount() {
  const btn = document.querySelector('button.btn-primary[onclick*="scrollToSection(\'cart\')"]');
  if (!btn) return;
  btn.textContent = `查看購物車（${getCartCount()}）`;
}

function renderCartListUI() {
  const cartListEl = document.getElementById("cartList");
  if (!cartListEl) return;

  if (!cartItems.length) {
    cartListEl.innerHTML = "（你的購物車目前是空的）";
    return;
  }

  const rows = cartItems.map((item, idx) => {
    const p = products.find((x) => x.id === item.productId);
    if (!p) return "";

    const spec =
      (p.specs || []).find((s) => s.key === item.specKey) || null;

    const specLabel = spec?.label ? `（${spec.label}）` : "";
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
            ${p.name} ${specLabel}
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

  cartListEl.innerHTML = rows;

  cartListEl.querySelectorAll(".cart-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      if (Number.isNaN(idx)) return;
      cartItems.splice(idx, 1);
      updateCartSummaryUI();
    });
  });
}

// =========================================================
// 更新購物車摘要（小計/運費/總計/免運提示/規則文字/列表/按鈕數字）
// =========================================================
function updateCartSummaryUI() {
  // 1) 同步免運規則文字（#shippingRuleText）
  syncShippingRuleText();

  // 2) 計算小計 subtotal
  let subtotal = 0;
  for (const item of cartItems) {
    const p = products.find((x) => x.id === item.productId);
    if (!p) continue;
    subtotal += (Number(p.price) || 0) * (Number(item.qty) || 0);
  }

  // 3) 取得配送方式（#checkoutShip）
  const shipType = document.getElementById("checkoutShip")?.value || "711";

  // 4) 算運費
  const shippingFee = calcShipping(subtotal, shipType);
  const total = subtotal + shippingFee;

  // 5) 更新 UI
  const sumSubtotalEl = document.getElementById("sumSubtotal");
  const sumShippingEl = document.getElementById("sumShipping");
  const sumTotalEl = document.getElementById("sumTotal");
  const cartSummaryEl = document.getElementById("cartSummary");
  const shipHintEl = document.getElementById("shipHint");

  if (sumSubtotalEl) sumSubtotalEl.textContent = `NT$ ${subtotal}`;
  if (sumShippingEl) sumShippingEl.textContent = `NT$ ${shippingFee}`;
  if (sumTotalEl) sumTotalEl.textContent = `NT$ ${total}`;

  if (cartSummaryEl) cartSummaryEl.style.display = cartItems.length ? "block" : "none";

  // 6) 免運提示
  if (shipHintEl) {
    if (subtotal >= SHIPPING_RULE.freeThreshold) {
      shipHintEl.textContent = "🎉 已達免運門檻！";
    } else {
      const diff = SHIPPING_RULE.freeThreshold - subtotal;
      shipHintEl.textContent = `再買 NT$${diff} 即可免運 🚚`;
    }
  }

  // 7) 補：購物車列表 & 按鈕數量
  renderCartListUI();
  updateCartButtonCount();
}

// =========================================================
// 加入購物車（同商品同款式 → 合併數量）
// =========================================================
detailAddBtn.onclick = () => {
  if (!currentDetailProductId) return;

  // 數量（最少 1）
  const qty = Math.max(1, parseInt(detailQtyInput?.value, 10) || 1);

  // 沒有款式時給一個預設 key
  const specKey = currentDetailSpecKey || "__default__";

  const existing = cartItems.find(
    (x) => x.productId === currentDetailProductId && x.specKey === specKey
  );

  if (existing) {
    existing.qty += qty;
  } else {
    cartItems.push({
      productId: currentDetailProductId,
      specKey,
      qty,
    });
  }

  alert("已加入購物車！");
  updateCartSummaryUI();
};
// =========================================================
// Hero Banner：用所有商品「隨機順序」建立輪播（完整版）
// =========================================================
function buildHeroFromProducts() {
  const slidesEl = document.getElementById("heroBannerSlides");
  const dotsEl = document.getElementById("heroBannerDots");
  if (!slidesEl || !dotsEl) return;
  if (!products.length) return;

  const HERO_LIMIT = 6; // ⭐ Hero 最多顯示幾個商品
  const STORAGE_KEY = "hero_product_order_v1";

  slidesEl.innerHTML = "";
  dotsEl.innerHTML = "";

  // 1️⃣ 只優先顯示有 tag 的商品（沒 tag 才 fallback 全部）
  const source = products.filter(p => p.tag && String(p.tag).trim() !== "");
  const baseList = source.length ? source : products;

  // 2️⃣ 使用者固定隨機順序
  let order = [];
  try {
    order = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {}

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

  // 3️⃣ 建立 slide
  shuffled.forEach((p, i) => {
    const imgRaw =
      p.imageUrl ||
      p.specs?.[0]?.mainImg ||
      p.specs?.[0]?.thumbs?.[0] ||
      "";

    const img = resolveImgUrl(imgRaw);

    const ctaText =
      p.tag?.includes("熱") ? "🔥 馬上搶購" :
      p.tag?.includes("新") ? "🆕 立即看看" :
      "查看商品";

    const slide = document.createElement("div");
    slide.className = "hero-banner-slide" + (i === 0 ? " active" : "");
    slide.dataset.id = p.id;

    slide.innerHTML = `
      ${img ? `<img src="${img}" alt="${p.name}">` : ""}
      ${p.tag ? `<span class="hero-tag">${p.tag}</span>` : ""}
      <div class="hero-content">
        <h2>${p.name}</h2>
        ${p.subtitle ? `<p>${p.subtitle}</p>` : ""}
        <button class="cta-primary">${ctaText}</button>
      </div>
    `;

    slidesEl.appendChild(slide);

    const dot = document.createElement("span");
    dot.className = "hero-dot" + (i === 0 ? " active" : "");
    dotsEl.appendChild(dot);
  });

  // 4️⃣ 最後一張：查看全部商品
  const moreSlide = document.createElement("div");
  moreSlide.className = "hero-banner-slide";
  moreSlide.innerHTML = `
    <div class="hero-content center">
      <h2>看看全部商品</h2>
      <button class="cta-secondary">前往商品列表 →</button>
    </div>
  `;
  slidesEl.appendChild(moreSlide);

  const moreDot = document.createElement("span");
  moreDot.className = "hero-dot";
  dotsEl.appendChild(moreDot);
}


/* =========================================================
   G) Hero Banner（只開詳情）
========================================================= */
function initHeroBanner() {
  const slidesEl = document.getElementById("heroBannerSlides");
  const dotsEl = document.getElementById("heroBannerDots");
  if (!slidesEl || !dotsEl) return;

  const AUTOPLAY_MS = 4000;

  function getSlides() {
    return Array.from(slidesEl.querySelectorAll(".hero-banner-slide"));
  }
  function getDots() {
    return Array.from(dotsEl.querySelectorAll(".hero-dot"));
  }

  let index = 0;
  let timer = null;

function setActive(nextIndex) {
  const slides = getSlides();
  const dots = getDots();
  if (!slides.length) return;

  // ⭐ 如果滑到最後一張（查看全部）→ 下一次回第一張
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

  // ✅ 1) CTA 按鈕（事件委派）→ 開商品詳情
  slidesEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".cta-primary, .cta-secondary");
    if (!btn) return;
    const id = btn.closest(".hero-banner-slide")?.dataset?.id;
    if (id) openProduct(Number(id));
  });

  // ✅ 2) 點 dot 切換（也會同步 active）
  dotsEl.addEventListener("click", (e) => {
    const dot = e.target.closest(".hero-dot");
    if (!dot) return;

    const dots = getDots();
    const idx = dots.indexOf(dot);
    if (idx >= 0) {
      setActive(idx);
      startAuto(); // 點了就重置計時
    }
  });

  // ✅ 3) 手機左右滑切換（swipe）
  let startX = 0;
  let startY = 0;
  let tracking = false;
  const SWIPE_MIN_X = 40;
  const SWIPE_MAX_Y = 60;

  const banner = slidesEl.closest(".hero-banner") || slidesEl;

  banner.addEventListener("touchstart", (e) => {
    if (e.target.closest(".cta-primary, .cta-secondary")) return; // 避免按鈕誤判
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

    if (dx < 0) setActive(index + 1);  // 左滑下一張
    else setActive(index - 1);         // 右滑上一張

    startAuto();
  }, { passive: true });

  // ✅ 4) 滑鼠移入停止 / 移出繼續（桌機體驗）
  banner.addEventListener("mouseenter", stopAuto);
  banner.addEventListener("mouseleave", startAuto);

  // ✅ 初始化 active（如果你 HTML 第 0 張已經有 active，也不衝突）
  setActive(0);
  startAuto();
}

/* =========================================================
   ✅ 商品詳情：圖庫（主圖/縮圖/滑動）＋ Lightbox
========================================================= */
let detailGallery = {
  images: [],     // 這個款式的圖片列表（含主圖+縮圖）
  index: 0,       // 目前顯示第幾張
};






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


/* -------------------------
   ① Lightbox（像蝦皮）
------------------------- */
function ensureLightbox() {
  if (document.getElementById("sxzLightbox")) return;

  const lb = document.createElement("div");
  lb.id = "sxzLightbox";
  
  lb.innerHTML = `
    <div class="lb-backdrop"></div>
    <div class="lb-panel" role="dialog" aria-modal="true">
      <button class="lb-close" type="button" aria-label="關閉">×</button>
      <img class="lb-img" alt="預覽">
      <button class="lb-nav lb-prev" type="button" aria-label="上一張">‹</button>
      <button class="lb-nav lb-next" type="button" aria-label="下一張">›</button>
      <div class="lb-indicator"></div>
    </div>
  `;
  document.body.appendChild(lb);
  lb.querySelector(".lb-img").addEventListener("click", () => closeLightbox());
  const close = () => closeLightbox();
  lb.querySelector(".lb-backdrop").addEventListener("click", close);
  lb.querySelector(".lb-close").addEventListener("click", close);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") return closeLightbox();
  if (!lb.classList.contains("open")) return;
  if (e.key === "ArrowLeft") return lightboxStep(-1);
  if (e.key === "ArrowRight") return lightboxStep(1);
});


  // Lightbox 手機滑動
  let sx = 0, sy = 0, tracking = false;
  const SWIPE_MIN_X = 40;
  const SWIPE_MAX_Y = 80;

  lb.querySelector(".lb-img").addEventListener("touchstart", (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    tracking = true;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
  }, { passive: true });

  lb.querySelector(".lb-img").addEventListener("touchend", (e) => {
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

  // 點左右按鈕
  lb.querySelector(".lb-prev").addEventListener("click", () => lightboxStep(-1));
  lb.querySelector(".lb-next").addEventListener("click", () => lightboxStep(1));
}

function openLightboxByIndex(idx) {
  ensureLightbox();
  const lb = document.getElementById("sxzLightbox");
  const imgEl = lb.querySelector(".lb-img");
  const indEl = lb.querySelector(".lb-indicator");
  const imgs = detailGallery.images || [];
  if (!imgs.length) return;

  const safe = (idx + imgs.length) % imgs.length;
  detailGallery.index = safe;

  imgEl.src = resolveImgUrl(imgs[safe]);
  indEl.textContent = `${safe + 1} / ${imgs.length}`;

  lb.classList.add("open");
  document.body.classList.add("no-scroll");
}

function closeLightbox() {
  const lb = document.getElementById("sxzLightbox");
  if (!lb) return;
  lb.classList.remove("open");
  document.body.classList.remove("no-scroll");
}

function lightboxStep(delta) {
  const lb = document.getElementById("sxzLightbox");
  if (!lb || !lb.classList.contains("open")) return;

  const imgs = detailGallery.images || [];
  if (!imgs.length) return;

  const imgEl = lb.querySelector(".lb-img");
  const indEl = lb.querySelector(".lb-indicator");

  const next = (detailGallery.index + delta + imgs.length) % imgs.length;
  detailGallery.index = next;

  // ✅ 淡出 → 換圖 → 淡入
  imgEl.style.opacity = "0";
  setTimeout(() => {
    imgEl.src = resolveImgUrl(imgs[next]);
    indEl.textContent = `${next + 1} / ${imgs.length}`;
    imgEl.style.opacity = "1";

    // 同步回詳情主圖
    setMainImageByIndex(next);
  }, 80);
}

/* -------------------------
   ② 手機主圖滑動切換縮圖
------------------------- */
function bindDetailSwipeOnMainImage() {
  if (!detailMainImg) return;

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

    // 垂直捲動就放過
    if (Math.abs(dy) > SWIPE_MAX_Y) return;
    if (Math.abs(dx) < SWIPE_MIN_X) return;

    if (dx < 0) setMainImageByIndex(detailGallery.index + 1); // 左滑下一張
    else setMainImageByIndex(detailGallery.index - 1);        // 右滑上一張
  }, { passive: true });

  // 主圖點擊→Lightbox
  detailMainImg.style.cursor = "zoom-in";
  detailMainImg.addEventListener("click", () => openLightboxByIndex(detailGallery.index));
}

// 只要頁面載入一次就綁定（避免重複綁）
let __detailSwipeBound = false;
function ensureDetailGalleryBindings() {
  if (__detailSwipeBound) return;
  __detailSwipeBound = true;
  bindDetailSwipeOnMainImage();
}


/* =========================================================
   H) 初始化（✅ 修掉你巢狀 initPage 的 bug）
========================================================= */
async function initPage() {
  await loadProducts();
    // ⭐ 先用商品建立 Hero 輪播（隨機）
  buildHeroFromProducts();
  renderProductGrid();
  initHeroBanner();

  // ✅ 初次同步一次（購物車目前空也沒關係）
  updateCartSummaryUI();

  // ✅ 配送方式變更 → 重新計算運費/免運提示
  const shipSel = document.getElementById("checkoutShip");
  if (shipSel) shipSel.addEventListener("change", updateCartSummaryUI);
}

document.addEventListener("DOMContentLoaded", initPage);

