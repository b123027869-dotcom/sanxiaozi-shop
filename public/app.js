/**
 * app.js - FINAL
 * 下單成功後顯示「Email 已寄送」明顯提醒
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
    alert('系統忙碌或庫存不足，請重新整理後再試 🙏');
    throw new Error(res.status);
  }
  return res.json();
}

// ✅ 下單成功提示（含 Email 提醒）
function showOrderSuccessNotice() {
  alert(
    "🎉 訂單成立成功！\n\n" +
    "📩【重要提醒】\n" +
    "您的訂單資訊已寄送至您的 Email，請記得查收。\n\n" +
    "若未在收件匣看到，請一併查看垃圾郵件匣，謝謝您 🤍"
  );
}
