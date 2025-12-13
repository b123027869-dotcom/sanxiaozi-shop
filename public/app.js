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
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'http://localhost:3000'
        : location.origin;

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

    async function apiGet(path) {
      const res = await fetch(API_BASE + path);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error("API 錯誤：" + res.status + " " + text);
      }
      return res.json();
    }

    function scrollToSection(id) {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth" });
    }

    /* =========================================================
      B) 商品資料與篩選狀態
    ========================================================= */
    let products = [];
    let currentCategory = "all";
    let currentKeyword = "";

    const productGrid = document.getElementById("productGrid");
    const productEmptyHint = document.getElementById("productEmptyHint");
    const heroSearchInput = document.getElementById("heroSearchInput");

    async function loadProducts() {
      try {
        const data = await apiGet("/api/products");
        const list = data.products || data.data || [];
        products = Array.isArray(list) ? list : [];
      } catch (err) {
        console.error("載入商品失敗", err);
        products = [];
        alert("載入商品失敗，請稍後再試一次，或確認後端 /api/products 是否有開啟。");
      }
    }

    /* =========================================================
      C) 分類切換
    ========================================================= */
    const categoryChips = document.querySelectorAll(".category-chip");
    categoryChips.forEach((chip) => {
      chip.addEventListener("click", () => {
        categoryChips.forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        currentCategory = chip.dataset.category || "all";
        renderProductGrid();
      });
    });

    /* =========================================================
      D) 搜尋
    ========================================================= */
    if (heroSearchInput) {
      heroSearchInput.addEventListener("input", () => {
        const value = heroSearchInput.value || "";
        currentKeyword = value;
        renderProductGrid();
      });

      heroSearchInput.addEventListener("focus", () => {
        scrollToSection("products");
      });
    }

    /* =========================================================
      E) 購物車狀態
    ========================================================= */
    let cartItems = [];
    let cartCount = 0;
    const cartBtnTop = document.querySelector(".nav-action .btn-primary");

    function updateCartBtnText() {
      if (cartBtnTop) cartBtnTop.textContent = `查看購物車（${cartCount}）`;
    }

    function calcCartTotal() {
      return cartItems.reduce((sum, it) => {
        const price = typeof it.price === "number" ? it.price : 0;
        return sum + price * it.qty;
      }, 0);
    }

    function addToCart(productId, specKey, qty) {
      const product = products.find((p) => p.id === productId);
      if (!product) return;

      const specList = product.specs || [];
      let useSpec = specList[0];

      if (specKey) {
        const found = specList.find((s) => s.key === specKey);
        if (found) useSpec = found;
      }

      if (!useSpec) useSpec = { key: "default", label: "預設款" };

      qty = Number(qty) || 1;
      if (qty < 1) qty = 1;

      if (typeof useSpec.stock === "number") {
        const currentInCartSpec = cartItems
          .filter((it) => it.productId === productId && it.specKey === useSpec.key)
          .reduce((sum, it) => sum + it.qty, 0);

        if (currentInCartSpec + qty > useSpec.stock) {
          const remain = useSpec.stock - currentInCartSpec;
          alert(
            `「${product.name} - ${useSpec.label}」庫存不足，` +
            `目前最多還能加 ${remain < 0 ? 0 : remain} 件。`
          );
          return;
        }
      }

      const exist = cartItems.find(
        (item) => item.productId === productId && item.specKey === useSpec.key
      );

      if (exist) {
        exist.qty += qty;
      } else {
        cartItems.push({
          productId,
          specKey: useSpec.key,
          name: product.name,
          specLabel: useSpec.label,
          price: product.price,
          qty,
        });
      }

      cartCount = cartItems.reduce((sum, it) => sum + it.qty, 0);
      updateCartBtnText();
      renderCart();
    }

    function removeCartItem(index) {
      if (index < 0 || index >= cartItems.length) return;
      cartItems.splice(index, 1);
      cartCount = cartItems.reduce((sum, it) => sum + it.qty, 0);
      updateCartBtnText();
      renderCart();
    }
    window.removeCartItem = removeCartItem;

    function renderCart() {
      const container = document.getElementById("cartList");
      if (!container) return;

      if (cartItems.length === 0) {
        container.innerHTML = "（你的購物車目前是空的）";
        updateCartSummary();
        return;
      }

      let html = '<ul style="padding-left:18px;">';

      cartItems.forEach((item, index) => {
        const lineTotal = item.price * item.qty;
        html += `
          <li style="margin-bottom:4px;">
            ${item.name}（${item.specLabel}） × ${item.qty}
            － NT$${lineTotal}
            <button type="button"
              onclick="removeCartItem(${index})"
              style="margin-left:6px;padding:2px 6px;font-size:11px;border-radius:6px;border:1px solid #e0c080;background:#fff9ec;cursor:pointer;">
              移除
            </button>
          </li>
        `;
      });

      html += "</ul>";
      container.innerHTML = html;

      updateCartSummary();
    }

    function updateCartSummary() {
      const summary = document.getElementById("cartSummary");
      if (!summary) return;

      const subtotalEl = document.getElementById("sumSubtotal");
      const shipEl = document.getElementById("sumShipping");
      const totalEl = document.getElementById("sumTotal");
      const hintEl = document.getElementById("shipHint");
      const shipMethodEl = document.getElementById("checkoutShip");

      const subtotal = calcCartTotal();
      const freeShipThreshold = 699;

      let shipping = 0;
      const shipMethod = shipMethodEl ? shipMethodEl.value : "711";
      if (subtotal === 0) shipping = 0;
      else if (subtotal >= freeShipThreshold) shipping = 0;
      else {
        shipping =
          shipMethod === "home" ? 100 :
          shipMethod === "family" ? 60 :
          60;
      }

      const total = subtotal + shipping;

      summary.style.display = subtotal > 0 ? "block" : "none";
      if (subtotalEl) subtotalEl.textContent = `NT$ ${subtotal}`;
      if (shipEl) shipEl.textContent = `NT$ ${shipping}`;
      if (totalEl) totalEl.textContent = `NT$ ${total}`;

      if (hintEl) {
        if (subtotal === 0) hintEl.textContent = "";
        else if (subtotal >= freeShipThreshold) hintEl.textContent = "已達免運門檻，太棒了～🥳";
        else hintEl.textContent = `再買 NT$ ${freeShipThreshold - subtotal} 即可免運 💛`;
      }
    }

    /* =========================================================
      G) 商品列表渲染
    ========================================================= */
    function renderProductGrid() {
      if (!productGrid) return;
      productGrid.innerHTML = "";

      const kw = (currentKeyword || "").trim().toLowerCase();

      const filtered = (products || []).filter((product) => {
        const cats = product.categories || [];
        if (currentCategory !== "all" && !cats.includes(currentCategory)) return false;
        if (!kw) return true;

        const text = [
          product.name || "",
          product.subtitle || "",
          (product.categories || []).join(" "),
          product.shortDesc || "",
          product.detailHtml || "",
          product.code || "",
        ].join(" ").toLowerCase();

        return text.includes(kw);
      });

      if (productEmptyHint) productEmptyHint.style.display = filtered.length === 0 ? "block" : "none";
      if (filtered.length === 0) return;

      filtered.forEach((product) => {
        const cats = product.categories || [];
        const specs = product.specs || [];
        const firstSpec = specs[0];

        const mainImgRaw =
          product.imageUrl ||
          (firstSpec && firstSpec.mainImg) ||
          (firstSpec && firstSpec.thumbs && firstSpec.thumbs[0]) ||
          "";

        const mainImg = resolveImgUrl(mainImgRaw);

        const article = document.createElement("article");
        article.className = "product-card";
        article.dataset.id = product.id;
        article.dataset.category = cats.join(" ");
        article.dataset.selectedSpec = firstSpec ? firstSpec.key : "";

        article.innerHTML = `
          ${product.tag ? `<div class="product-tag">${product.tag}</div>` : ""}
          <div class="product-img" data-click="open-detail">
            ${mainImg ? `<img src="${mainImg}" alt="${product.name}">` : ""}
          </div>
          <h4 class="product-name" data-click="open-detail">${product.name}</h4>

          <div class="product-bottom">
            <div class="product-price-row">
              <div class="product-price">NT$ ${product.price}</div>
              <button type="button" class="product-like-btn">♡</button>
            </div>

            <div class="card-spec-row">
              ${(specs || [])
                .map(
                  (spec, idx) => `
                    <button type="button"
                      class="card-spec-btn ${idx === 0 ? "active" : ""}"
                      data-spec-key="${spec.key}">
                      ${spec.label}
                    </button>
                  `
                )
                .join("")}
            </div>

            <div class="card-action-row">
              <div class="qty-control">
                <button type="button" class="qty-btn">−</button>
                <input type="text" class="qty-input" value="1">
                <button type="button" class="qty-btn">＋</button>
              </div>
              <button type="button" class="btn-cart">🛒 加入</button>
            </div>
          </div>
        `;

        article.querySelectorAll('[data-click="open-detail"]').forEach((el) => {
          el.addEventListener("click", () => openProduct(product.id));
        });

        const likeBtn = article.querySelector(".product-like-btn");
        likeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          likeBtn.classList.toggle("active");
          likeBtn.textContent = likeBtn.classList.contains("active") ? "❤" : "♡";
        });

        const specBtns = article.querySelectorAll(".card-spec-btn");
        specBtns.forEach((btn) => {
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            specBtns.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            article.dataset.selectedSpec = btn.dataset.specKey || "";
          });
        });

        const qtyInput = article.querySelector(".qty-input");
        const qtyBtns = article.querySelectorAll(".qty-btn");

        qtyBtns[0].addEventListener("click", (e) => {
          e.stopPropagation();
          let v = parseInt(qtyInput.value || "1", 10);
          if (isNaN(v) || v < 1) v = 1;
          qtyInput.value = Math.max(1, v - 1);
        });

        qtyBtns[1].addEventListener("click", (e) => {
          e.stopPropagation();
          let v = parseInt(qtyInput.value || "1", 10);
          if (isNaN(v) || v < 1) v = 1;
          qtyInput.value = v + 1;
        });

        const addBtn = article.querySelector(".btn-cart");
        addBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const specKey = article.dataset.selectedSpec || "";
          const qty = parseInt(qtyInput.value || "1", 10) || 1;
          addToCart(product.id, specKey, qty);
        });

        productGrid.appendChild(article);
      });
    }

    /* =========================================================
      H) 商品詳情
    ========================================================= */
    const productDetailSection = document.getElementById("productDetail");
    const detailTitleMain = document.getElementById("detailTitleMain");
    const detailSubtitle = document.getElementById("detailSubtitle");
    const detailName = document.getElementById("detailName");
    const detailSub = document.getElementById("detailSub");
    const detailPrice = document.getElementById("detailPrice");
    const detailPriceNote = document.getElementById("detailPriceNote");
    const detailMainImg = document.getElementById("detailMainImg");
    const detailThumbs = document.getElementById("detailThumbs");
    const detailSpecs = document.getElementById("detailSpecs");
    const detailDesc = document.getElementById("detailDesc");
    const detailQtyInput = document.getElementById("detailQtyInput");
    const detailQtyMinus = document.getElementById("detailQtyMinus");
    const detailQtyPlus = document.getElementById("detailQtyPlus");
    const detailAddBtn = document.getElementById("detailAddBtn");
    const detailLineBtn = document.getElementById("detailLineBtn");
    const heroSection = document.querySelector(".hero");

    let currentDetailProductId = null;
    let currentDetailSpecKey = null;

    function openProduct(productId) {
      const product = products.find((p) => p.id === productId);
      if (!product) return;

      currentDetailProductId = productId;

      detailTitleMain.textContent = product.name;
      detailSubtitle.textContent = product.subtitle ? product.subtitle : "";
      detailName.textContent = product.name;
      detailSub.textContent = product.subtitle || "";
      detailPrice.textContent = product.price;
      detailPriceNote.textContent = product.priceNote || "";
      detailDesc.innerHTML = product.detailHtml || "";

      detailSpecs.innerHTML = "";
      (product.specs || []).forEach((spec, idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pd-spec-btn" + (idx === 0 ? " active" : "");
        btn.textContent = spec.label;
        btn.dataset.specKey = spec.key;
        btn.addEventListener("click", () => setDetailSpec(productId, spec.key));
        detailSpecs.appendChild(btn);
      });

      if (product.specs && product.specs[0]) {
        setDetailSpec(productId, product.specs[0].key);
      }

      detailQtyInput.value = "1";
      productDetailSection.style.display = "block";

      if (heroSection) heroSection.style.display = "none";
      scrollToSection("productDetail");
    }

    function setDetailSpec(productId, specKey) {
      const product = products.find((p) => p.id === productId);
      if (!product) return;

      const specs = product.specs || [];
      const spec = specs.find((s) => s.key === specKey) || specs[0];
      if (!spec) return;

      currentDetailSpecKey = spec.key;

      const mainImgRaw =
        spec.mainImg ||
        product.imageUrl ||
        (spec.thumbs && spec.thumbs[0]) ||
        "";

      const mainImg = resolveImgUrl(mainImgRaw);
      detailMainImg.src = mainImg;
      detailMainImg.alt = `${product.name} ${spec.label}`;

      detailThumbs.innerHTML = "";
      const thumbList = spec.thumbs && spec.thumbs.length > 0 ? spec.thumbs : [mainImgRaw];

      thumbList.forEach((srcRaw, idx) => {
        if (!srcRaw) return;
        const src = resolveImgUrl(srcRaw);

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pd-thumb-btn" + (idx === 0 ? " active" : "");

        const img = document.createElement("img");
        img.src = src;
        img.alt = `${product.name} ${spec.label} 圖片`;

        btn.appendChild(img);
        btn.addEventListener("click", () => {
          detailMainImg.src = src;
          detailThumbs.querySelectorAll(".pd-thumb-btn").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
        });

        detailThumbs.appendChild(btn);
      });

      detailSpecs.querySelectorAll(".pd-spec-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.specKey === specKey);
      });
    }

    function backToProducts() {
      productDetailSection.style.display = "none";
      if (heroSection) heroSection.style.display = "block";
      scrollToSection("products");
    }
    window.backToProducts = backToProducts;

    detailQtyMinus.addEventListener("click", () => {
      let v = parseInt(detailQtyInput.value || "1", 10);
      if (isNaN(v) || v < 1) v = 1;
      detailQtyInput.value = Math.max(1, v - 1);
    });

    detailQtyPlus.addEventListener("click", () => {
      let v = parseInt(detailQtyInput.value || "1", 10);
      if (isNaN(v) || v < 1) v = 1;
      detailQtyInput.value = v + 1;
    });

    detailAddBtn.addEventListener("click", () => {
      if (!currentDetailProductId) return;
      const qty = parseInt(detailQtyInput.value || "1", 10) || 1;
      addToCart(currentDetailProductId, currentDetailSpecKey, qty);
    });

    detailLineBtn.addEventListener("click", () => {
      window.open("https://line.me/R/ti/p/@301gfuh", "_blank");
    });

    /* =========================================================
      I) 結帳：送出訂單
    ========================================================= */
    const checkoutForm = document.getElementById("checkoutForm");
    if (checkoutForm) {
      checkoutForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        if (cartItems.length === 0) {
          alert("購物車是空的，請先選幾樣小物再來結帳唷！");
          renderCart();
          updateCartSummary();
          scrollToSection("cart");
          return;
        }

        const name = document.getElementById("checkoutName").value.trim();
        const phone = document.getElementById("checkoutPhone").value.trim();
        const email = document.getElementById("checkoutEmail").value.trim();
        const lineId = document.getElementById("checkoutLine").value.trim();
        const address = document.getElementById("checkoutAddress").value.trim();
        const ship = document.getElementById("checkoutShip").value;
        const pay = document.getElementById("checkoutPay").value;
        const note = document.getElementById("checkoutNote").value.trim();

        // ✅ 基本必填
if (!name || !phone || !email) {
  alert("姓名、電話、Email 為必填欄位，請再確認一下唷～");
  return;
}

// ✅ 台灣手機：09 + 10 碼
const phoneDigits = phone.replace(/\D/g, "");
if (!/^09\d{8}$/.test(phoneDigits)) {
  alert("手機號碼格式不正確，請輸入 09 開頭的 10 碼手機號碼（例：0912345678）");
  document.getElementById("checkoutPhone").focus();
  return;
}

// ✅ Email 格式
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  alert("Email 格式不正確，請再確認一下（例：you@gmail.com）");
  document.getElementById("checkoutEmail").focus();
  return;
}

// ✅ 配送方式防呆：超商/宅配都必填地址（超商填門市）
const addressEl = document.getElementById("checkoutAddress");
const addr = (address || "").trim();
if (ship === "home") {
  if (addr.length < 6) {
    alert("宅配到府請填寫完整收件地址（至少 6 個字）。");
    addressEl.focus();
    return;
  }
} else if (ship === "711" || ship === "family") {
  if (addr.length < 2) {
    alert("超商取貨請填寫「門市名稱」（例如：高雄xx門市）。");
    addressEl.focus();
    return;
  }
}

        const payload = {
          items: cartItems.map((it) => ({
            productId: it.productId,
            specKey: it.specKey,
            specLabel: it.specLabel,
            name: it.name,
            price: it.price,
            qty: it.qty,
          })),
          customer: { name, phone, email, lineId, address, ship, pay, note },
        };

        try {
          const result = await apiPost("/api/orders", payload);

          const order = result.order || result.data || result;
          const orderId = result.orderId || order.id || order.orderId || "（請看後台）";
          const createdAt = order.createdAt || result.createdAt || "剛剛";
          const status = order.status || result.status || "new";

          const total =
            typeof result.totalAmount === "number"
              ? result.totalAmount
              : typeof order.totalAmount === "number"
              ? order.totalAmount
              : calcCartTotal();

          alert(
            "訂單已建立囉！\n\n" +
              "訂單編號：" + orderId + "\n" +
              "建立時間：" + createdAt + "\n" +
              "訂單狀態：" + status + "\n" +
              "總金額：NT$ " + total + "\n\n" +
              "之後可以用「電話 + 訂單編號」在下方訂單查詢區查看進度。\n\n" +
              "加入官方 LINE：@301gfuh，就可以追蹤訂單、詢問出貨進度喔！"
          );

          window.location.reload();
        } catch (err) {
          console.error("POST /api/orders error", err);
          alert(
            "建立訂單時發生錯誤，可能是網路或伺服器暫時有問題，\n" +
              "請稍後再試一次，或改用蝦皮 / Line 聯絡店主。\n\n" +
              err.message
          );
        }
      });
    }

    /* =========================================================
      J) Hero 產品圖輪播
    ========================================================= */
    let heroSlideIndex = 0;
    let heroSlideTimer = null;

    function pickHeroProducts(list){
      const arr = Array.isArray(list) ? list.slice() : [];
      const preferred = arr.filter(p => {
        const t = String(p.tag || "");
        return t.includes("主打") || t.includes("熱賣") || t.includes("新品");
      });
      return (preferred.length ? preferred : arr).slice(0, 6);
    }

    function buildHeroSlides(){
      const slidesEl = document.getElementById("heroBannerSlides");
      const dotsEl = document.getElementById("heroBannerDots");
      if (!slidesEl || !dotsEl) return;

      slidesEl.innerHTML = "";
      dotsEl.innerHTML = "";

      const picked = pickHeroProducts(products);

      if (!picked.length) {
        slidesEl.innerHTML = `
          <div class="hero-banner-slide active">
            <div class="hero-banner-top">
              <div>
                <div class="hero-banner-tag">主打商品</div>
                <div class="hero-banner-title">目前尚未載入商品</div>
                <div class="hero-banner-sub">請確認後端 /api/products 是否正常回傳。</div>
              </div>
            </div>
          </div>
        `;
        return;
      }

      picked.forEach((p, idx) => {
        const specs = p.specs || [];
        const firstSpec = specs[0];

        const imgRaw =
          p.imageUrl ||
          (firstSpec && firstSpec.mainImg) ||
          (firstSpec && firstSpec.thumbs && firstSpec.thumbs[0]) ||
          "";

        const title = p.name || "商品";
        const sub = p.subtitle || p.shortDesc || "點擊查看商品詳情";
        const tag = p.tag || "主打商品";

        const slide = document.createElement("div");
        slide.className = "hero-banner-slide" + (idx === 0 ? " active" : "");
        slide.innerHTML = `
          <div class="hero-banner-top">
            <div>
              <div class="hero-banner-tag">${tag}</div>
              <div class="hero-banner-title">${title}</div>
              <div class="hero-banner-sub">${sub}</div>
            </div>
          </div>

          <div class="hero-banner-media" role="button" aria-label="開啟商品詳情">
            ${imgRaw ? `<img src="${resolveImgUrl(imgRaw)}" alt="${title}">` : ""}
          </div>

          <div class="hero-banner-cta">
            <button type="button" class="cta-primary">查看商品</button>
            <button type="button" class="cta-secondary">加入購物車</button>
          </div>
        `;

        const media = slide.querySelector(".hero-banner-media");
        const ctaView = slide.querySelector(".cta-primary");
        if (media) media.addEventListener("click", () => openProduct(p.id));
        if (ctaView) ctaView.addEventListener("click", () => openProduct(p.id));

        const ctaAdd = slide.querySelector(".cta-secondary");
        if (ctaAdd) {
          ctaAdd.addEventListener("click", () => {
            const specKey = (p.specs && p.specs[0] && p.specs[0].key) ? p.specs[0].key : "";
            addToCart(p.id, specKey, 1);
            scrollToSection("cart");
          });
        }

        slidesEl.appendChild(slide);

        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "hero-dot" + (idx === 0 ? " active" : "");
        dot.setAttribute("aria-label", `第 ${idx + 1} 張 Banner`);
        dot.addEventListener("click", () => {
          showHeroSlide(idx);
          restartHeroTimer();
        });
        dotsEl.appendChild(dot);
      });
    }

    function showHeroSlide(i){
      const slides = document.querySelectorAll("#heroBannerSlides .hero-banner-slide");
      const dots = document.querySelectorAll("#heroBannerDots .hero-dot");
      if (!slides.length || !dots.length) return;

      const total = slides.length;
      heroSlideIndex = (i + total) % total;

      slides.forEach((s, idx) => s.classList.toggle("active", idx === heroSlideIndex));
      dots.forEach((d, idx) => d.classList.toggle("active", idx === heroSlideIndex));
    }

    function nextHeroSlide(){ showHeroSlide(heroSlideIndex + 1); }

    function restartHeroTimer(){
      if (heroSlideTimer) clearInterval(heroSlideTimer);
      heroSlideTimer = setInterval(nextHeroSlide, 6000);
    }

    function initHeroBanner(){
      buildHeroSlides();
      showHeroSlide(0);
      restartHeroTimer();

      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          if (heroSlideTimer) clearInterval(heroSlideTimer);
        } else {
          restartHeroTimer();
        }
      });
    }

    /* =========================================================
      Lightbox
    ========================================================= */
    const lb = document.getElementById("imgLightbox");
    const lbImg = document.getElementById("lbImg");
    const lbClose = document.getElementById("lbClose");
    const lbPrev = document.getElementById("lbPrev");
    const lbNext = document.getElementById("lbNext");
    const lbStage = document.getElementById("lbStage");

    let lbList = [];
    let lbIndex = 0;

    function openLightbox(list, startIndex = 0){
      lbList = Array.isArray(list) ? list.filter(Boolean) : [];
      lbIndex = Math.max(0, Math.min(startIndex, lbList.length - 1));
      if (!lbList.length) return;

      lbImg.src = resolveImgUrl(lbList[lbIndex]);
      lb.classList.add("open");
      lb.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
    }

    function closeLightbox(){
      lb.classList.remove("open");
      lb.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      lbImg.src = "";
    }

    function lightboxGo(delta){
      if (!lbList.length) return;
      lbIndex = (lbIndex + delta + lbList.length) % lbList.length;
      lbImg.src = resolveImgUrl(lbList[lbIndex]);
    }

    lbClose.addEventListener("click", closeLightbox);
    lb.addEventListener("click", (e) => { if (e.target === lb) closeLightbox(); });
    lbPrev.addEventListener("click", (e) => { e.stopPropagation(); lightboxGo(-1); });
    lbNext.addEventListener("click", (e) => { e.stopPropagation(); lightboxGo(1); });

    document.addEventListener("keydown", (e) => {
      if (!lb.classList.contains("open")) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") lightboxGo(-1);
      if (e.key === "ArrowRight") lightboxGo(1);
    });

    let touchStartX = 0;
    lbStage.addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
    lbStage.addEventListener("touchend", (e) => {
      const endX = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientX : touchStartX;
      const dx = endX - touchStartX;
      if (Math.abs(dx) > 40) dx > 0 ? lightboxGo(-1) : lightboxGo(1);
    }, { passive: true });

    if (detailMainImg) {
      detailMainImg.style.cursor = "zoom-in";
      detailMainImg.addEventListener("click", () => {
        const p = products.find(x => x.id === currentDetailProductId);
        if (!p) return;

        const spec = (p.specs || []).find(s => s.key === currentDetailSpecKey) || (p.specs || [])[0];
        const thumbs = (spec && spec.thumbs && spec.thumbs.length) ? spec.thumbs : [];

        const currentSrcRaw = (spec && spec.mainImg) ? spec.mainImg : (p.imageUrl || "");
        const list = thumbs.length ? thumbs : [currentSrcRaw];

        const currentResolved = resolveImgUrl(currentSrcRaw);
        let start = 0;
        for (let i = 0; i < list.length; i++){
          if (resolveImgUrl(list[i]) === currentResolved) { start = i; break; }
        }
        openLightbox(list, start);
      });
    }

    lbStage.addEventListener("wheel", (e) => {
      if (!lb.classList.contains("open")) return;
      e.preventDefault();
      if (e.deltaY > 0) lightboxGo(1);
      else lightboxGo(-1);
    }, { passive: false });

    /* =========================================================
      K) 初始化
    ========================================================= */
    async function initPage() {
      updateCartBtnText();
      await loadProducts();

      currentCategory = "all";
      currentKeyword = "";

      renderProductGrid();
      renderCart();
      updateCartSummary();

      const checkoutShipEl = document.getElementById("checkoutShip");
      if (checkoutShipEl) checkoutShipEl.addEventListener("change", () => updateCartSummary());

      initHeroBanner();
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initPage);
    } else {
      initPage();
    }



// ===== Lead time (10-15 days) reminder =====
function cartHasLeadtimeItem(cartItems) {
  return cartItems.some(it => it.tag === 'leadtime_10_15');
}

function updateLeadtimeWarning(cartItems) {
  const box = document.getElementById('leadtime-warning');
  if (!box) return;
  if (cartHasLeadtimeItem(cartItems)) box.style.display = 'block';
  else box.style.display = 'none';
}

// Hook into renderCart if exists
if (typeof renderCart === 'function') {
  const _renderCart = renderCart;
  renderCart = function(...args) {
    const res = _renderCart.apply(this, args);
    try {
      updateLeadtimeWarning(window.cart || []);
    } catch {}
    return res;
  }
}

// Hook before order submit
if (typeof submitOrder === 'function') {
  const _submitOrder = submitOrder;
  submitOrder = async function(...args) {
    try {
      if (cartHasLeadtimeItem(window.cart || [])) {
        const ok = confirm('本訂單包含較長備貨時間（10–15 天出貨）之商品，下單即表示同意等待備貨完成後出貨。');
        if (!ok) return;
      }
    } catch {}
    return _submitOrder.apply(this, args);
  }
}



// ===== Split order ids display helper =====
function formatOrderIds(resp) {
  if (!resp) return '';
  const ids = Array.isArray(resp.splitIds) ? resp.splitIds : (resp.id ? [resp.id] : []);
  if (ids.length <= 1) return ids[0] || '';
  return ids.join('、');
}


// ✅ 結帳欄位防呆：依配送方式提示地址/門市
function updateCheckoutAddressHint() {
  const shipEl = document.getElementById("checkoutShip");
  const addrLabel = document.querySelector('label[for="checkoutAddress"]');
  const hintEl = document.getElementById("checkoutAddressHint");
  const addrEl = document.getElementById("checkoutAddress");
  if (!shipEl || !addrLabel || !hintEl || !addrEl) return;

  const ship = shipEl.value;
  if (ship === "home") {
    addrLabel.textContent = "收件地址（宅配必填）";
    addrEl.placeholder = "例：高雄市○○區○○路○段○號○樓";
    hintEl.textContent = "宅配到府：請填完整地址（必填）。";
  } else if (ship === "711") {
    addrLabel.textContent = "7-11 門市名稱（必填）";
    addrEl.placeholder = "例：高雄○○門市（可加區域更好）";
    hintEl.textContent = "超商取貨：請填門市名稱（必填）。";
  } else if (ship === "family") {
    addrLabel.textContent = "全家 門市名稱（必填）";
    addrEl.placeholder = "例：高雄○○店／○○門市";
    hintEl.textContent = "超商取貨：請填門市名稱（必填）。";
  } else {
    addrLabel.textContent = "收件地址 / 超商門市（必填）";
    hintEl.textContent = "請填寫：超商（7-11/全家）請填「門市名稱」；宅配請填完整地址。";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const shipEl = document.getElementById("checkoutShip");
  if (shipEl) shipEl.addEventListener("change", updateCheckoutAddressHint);
  updateCheckoutAddressHint();
});
