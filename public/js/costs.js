const Costs = (() => {
  let _items = [];
  let _cars = [];
  const CATEGORIES = ['Fuel', 'Maintenance', 'Parts', 'Tires', 'Insurance', 'Registration', 'Events', 'Storage', 'Detailing', 'Other'];

  async function load() {
    try {
      [_items, _cars] = await Promise.all([API.get('/api/costs'), API.get('/api/cars')]);
      _populateFilters();
      renderSummary();
      render();
    } catch (e) { Toast.show('Failed to load costs', 'error'); }
  }

  function _populateFilters() {
    const carSel = document.getElementById('costs-filter-car');
    const curCar = carSel.value;
    carSel.innerHTML = '<option value="">All Cars</option><option value="0">General (No Car)</option>' +
      _cars.map(c => `<option value="${c.id}" ${curCar == c.id ? 'selected':''}>${escHtml(c.year)} ${escHtml(c.make)} ${escHtml(c.model)}</option>`).join('');

    const catSel = document.getElementById('costs-filter-cat');
    const curCat = catSel.value;
    catSel.innerHTML = '<option value="">All Categories</option>' +
      CATEGORIES.map(c => `<option value="${c}" ${curCat === c ? 'selected':''}>${c}</option>`).join('');
  }

  function renderSummary() {
    const total = _items.reduce((s, c) => s + (c.amount || 0), 0);
    const byCategory = {};
    for (const c of _items) {
      byCategory[c.category || 'Other'] = (byCategory[c.category || 'Other'] || 0) + (c.amount || 0);
    }
    const topCats = Object.entries(byCategory).sort((a,b) => b[1]-a[1]).slice(0, 5);

    document.getElementById('cost-summary-row').innerHTML = `
      <div class="cost-summary">
        <div class="cost-cat-card" style="border-left:2px solid var(--accent)">
          <div class="cost-cat-label">Total Spend</div>
          <div class="cost-cat-value" style="color:var(--accent)">${fmt$(total)}</div>
        </div>
        ${topCats.map(([cat, amt]) => `
        <div class="cost-cat-card">
          <div class="cost-cat-label">${escHtml(cat)}</div>
          <div class="cost-cat-value">${fmt$(amt)}</div>
        </div>`).join('')}
      </div>`;
  }

  function render() {
    const carFilter = document.getElementById('costs-filter-car').value;
    const catFilter = document.getElementById('costs-filter-cat').value;
    let items = _items;
    if (carFilter === '0') items = items.filter(c => !c.car_id);
    else if (carFilter) items = items.filter(c => String(c.car_id) === carFilter);
    if (catFilter) items = items.filter(c => c.category === catFilter);

    const tbody = document.getElementById('costs-tbody');
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
        <div class="empty-state-icon">$</div>
        <div class="empty-state-title">No cost entries</div>
        <div class="empty-state-sub">Track expenses, receipts, and invoices</div>
      </div></td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(c => `<tr>
      <td style="white-space:nowrap">${fmtDate(c.date)}</td>
      <td><strong>${escHtml(c.description)}</strong>${c.notes ? `<br><span style="color:var(--text-muted);font-size:11px">${escHtml(c.notes)}</span>` : ''}</td>
      <td>${escHtml(c.car_name || '—')}</td>
      <td><span class="badge badge-neutral">${escHtml(c.category || '—')}</span></td>
      <td style="font-weight:700;color:var(--accent)">${fmt$(c.amount)}</td>
      <td>${c.receipt_path ? `<a href="${escHtml(c.receipt_path)}" target="_blank" class="receipt-link">View ↗</a>` : '—'}</td>
      <td><div class="td-actions">
        <button class="btn btn-ghost btn-sm" onclick="Costs.openEdit(${c.id})">Edit</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="Costs.del(${c.id})">✕</button>
      </div></td>
    </tr>`).join('');
  }

  function _carOpts(selectedId) {
    return _cars.map(c => `<option value="${c.id}" ${selectedId == c.id ? 'selected':''}>${escHtml(c.year)} ${escHtml(c.make)} ${escHtml(c.model)}</option>`).join('');
  }

  function formHtml(c = {}) {
    const catOpts = CATEGORIES.map(k => `<option value="${k}" ${c.category === k ? 'selected':''}>${k}</option>`).join('');
    return `
      <div class="form-row">
        <label>Description *</label>
        <input type="text" id="f-desc" value="${escHtml(c.description || '')}" placeholder="Oil change, Tire purchase…">
      </div>
      <div class="form-row-2">
        <div class="form-row">
          <label>Amount ($) *</label>
          <input type="number" id="f-amount" value="${c.amount || ''}" placeholder="0.00" step="0.01" min="0">
        </div>
        <div class="form-row">
          <label>Date</label>
          <input type="date" id="f-date" value="${c.date || today()}">
        </div>
      </div>
      <div class="form-row-2">
        <div class="form-row">
          <label>Category</label>
          <select id="f-category"><option value="">— Select —</option>${catOpts}</select>
        </div>
        <div class="form-row">
          <label>Car</label>
          <select id="f-car"><option value="">— General —</option>${_carOpts(c.car_id)}</select>
        </div>
      </div>
      <div class="form-row">
        <label>Receipt / Invoice</label>
        <input type="file" id="f-receipt" accept="image/*,.pdf">
        ${c.receipt_path ? `<div style="margin-top:4px;font-size:11px;color:var(--text-muted)">Current: <a href="${escHtml(c.receipt_path)}" target="_blank" class="receipt-link">View existing ↗</a></div>` : ''}
      </div>
      <div class="form-row">
        <label>Notes</label>
        <textarea id="f-notes">${escHtml(c.notes || '')}</textarea>
      </div>`;
  }

  function collectFormData(existingId) {
    const fd = new FormData();
    fd.append('description', document.getElementById('f-desc').value.trim());
    fd.append('amount', document.getElementById('f-amount').value);
    fd.append('date', document.getElementById('f-date').value);
    fd.append('category', document.getElementById('f-category').value);
    fd.append('car_id', document.getElementById('f-car').value || '');
    fd.append('notes', document.getElementById('f-notes').value.trim());
    const file = document.getElementById('f-receipt').files[0];
    if (file) fd.append('receipt', file);
    return fd;
  }

  function openAdd() {
    Modal.show('Add Cost Entry', formHtml(), async () => {
      const desc = document.getElementById('f-desc').value.trim();
      const amount = document.getElementById('f-amount').value;
      if (!desc || !amount) { Toast.show('Description and amount are required', 'error'); return; }
      try {
        const item = await API.post('/api/costs', collectFormData());
        _items.unshift(item);
        renderSummary();
        render();
        Modal.hide();
        Toast.show('Cost entry added');
      } catch (e) { Toast.show('Failed to save', 'error'); }
    });
  }

  function openEdit(id) {
    const c = _items.find(i => i.id === id);
    if (!c) return;
    Modal.show('Edit Cost Entry', formHtml(c), async () => {
      const desc = document.getElementById('f-desc').value.trim();
      const amount = document.getElementById('f-amount').value;
      if (!desc || !amount) { Toast.show('Description and amount are required', 'error'); return; }
      try {
        const updated = await API.put(`/api/costs/${id}`, collectFormData(id));
        const idx = _items.findIndex(i => i.id === id);
        _items[idx] = updated;
        renderSummary();
        render();
        Modal.hide();
        Toast.show('Entry updated');
      } catch (e) { Toast.show('Failed to update', 'error'); }
    });
  }

  async function del(id) {
    if (!confirm('Delete this cost entry?')) return;
    try {
      await API.del(`/api/costs/${id}`);
      _items = _items.filter(i => i.id !== id);
      renderSummary();
      render();
      Toast.show('Entry deleted');
    } catch (e) { Toast.show('Failed to delete', 'error'); }
  }

  return { load, render, openAdd, openEdit, del };
})();
