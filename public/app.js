/**
 * app.js (Render FINAL)
 * - Friendly error handling
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
