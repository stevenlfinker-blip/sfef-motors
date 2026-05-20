const API = {
  async get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(url, data) {
    const isForm = data instanceof FormData;
    const r = await fetch(url, {
      method: 'POST',
      headers: isForm ? {} : { 'Content-Type': 'application/json' },
      body: isForm ? data : JSON.stringify(data),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async put(url, data) {
    const isForm = data instanceof FormData;
    const r = await fetch(url, {
      method: 'PUT',
      headers: isForm ? {} : { 'Content-Type': 'application/json' },
      body: isForm ? data : JSON.stringify(data),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async del(url) {
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
};

function fmt$(n) {
  return (parseFloat(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${m}/${day}/${y}`;
}
function today() {
  return new Date().toISOString().split('T')[0];
}
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr + 'T00:00:00') - new Date(today() + 'T00:00:00');
  return Math.round(diff / 86400000);
}
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
