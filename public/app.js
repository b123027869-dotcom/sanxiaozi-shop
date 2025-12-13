/**
 * app.js - FINAL (Modal Version)
 * 下單成功後顯示「漂亮彈窗 Email 提醒」（非 alert）
 */

const API_BASE =
  location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : location.origin;

async function apiPost(path, data) {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    showModal(
      "發生錯誤 😢",
      "系統忙碌或庫存不足，請重新整理後再試。"
    );
    throw new Error(res.status);
  }
  return res.json();
}

// ===== Modal =====
function showModal(title, message) {
  let modal = document.getElementById("order-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "order-modal";
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-box">
        <h2 id="modal-title"></h2>
        <p id="modal-message"></p>
        <button id="modal-close">我知道了</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector(".modal-backdrop").onclick =
    modal.querySelector("#modal-close").onclick = () => {
      modal.remove();
    };
  }
  document.getElementById("modal-title").innerText = title;
  document.getElementById("modal-message").innerText = message;
}

// ✅ 下單成功呼叫
function showOrderSuccessNotice() {
  showModal(
    "🎉 訂單成立成功！",
    "📩 您的訂單資訊已寄送至您的 Email，請記得查收。\n\n若未在收件匣看到，請一併查看垃圾郵件匣，謝謝您 🤍"
  );
}
