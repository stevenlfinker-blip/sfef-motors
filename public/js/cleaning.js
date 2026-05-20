const Cleaning = (() => {
  let _items = [];
  const TYPES = ['Wash', 'Detail', 'Polish', 'Wax', 'Interior', 'Glass', 'Tire/Wheel', 'Paint Prep', 'Protection', 'Other'];
  const STATUSES = ['In Stock', 'Low', 'Out of Stock'];
  const UNITS = ['Bottle', 'Gallon', 'Quart', 'Kit', 'Pad', 'Cloth', 'Spray', 'Bucket', 'Each'];

  async function load() {
    try {
      _items = await API.get('/api/cleaning');
      render();
    } catch (e) { Toast.show('Failed to load supplies', 'error'); }
  }

  function render() {
    const statusFilter = document.getElementById('cleaning-filter-status').value;
    const search = document.getElementById('cleaning-search').value.toLowerCase();
    let items = _items;
    if (statusFilter) items = items.filter(c => c.status === statusFilter);
    if (search) items = items.filter(c => (c.product + c.brand + c.type).toLowerCase().includes(search));

    const tbody = document.getElementById('cleaning-tbody');
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
        <div class="empty-state-icon">◎</div>
        <div class="empty-state-title">No cleaning supplies</div>
        <div class="empty-state-sub">Track your detailing and cleaning products</div>
      </div></td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(c => `<tr>
      <td><strong>${escHtml(c.product)}</strong></td>
      <td>${escHtml(c.brand) || '—'}</td>
      <td>${escHtml(c.type) || '—'}</td>
      <td><strong style="color:${c.qty <= 0 ? 'var(--red)' : 'var(--text)'}">${c.qty}</strong></td>
      <td>${escHtml(c.unit) || '—'}</td>
      <td>${App.cleaningBadge(c.status)}</td>
      <td><div class="td-actions">
        <button class="btn btn-ghost btn-sm" onclick="Cleaning.openEdit(${c.id})">Edit</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="Cleaning.del(${c.id})">✕</button>
      </div></td>
    </tr>`).join('');
  }

  function formHtml(c = {}) {
    const typeOpts = TYPES.map(t => `<option value="${t}" ${c.type === t ? 'selected':''}>${t}</option>`).join('');
    const statOpts = STATUSES.map(s => `<option value="${s}" ${(c.status || 'In Stock') === s ? 'selected':''}>${s}</option>`).join('');
    const unitOpts = UNITS.map(u => `<option value="${u}" ${c.unit === u ? 'selected':''}>${u}</option>`).join('');
    return `
      <div class="form-row">
        <label>Product Name *</label>
        <input type="text" id="f-product" value="${escHtml(c.product || '')}" placeholder="Car Shampoo, Detail Spray…">
      </div>
      <div class="form-row-2">
        <div class="form-row">
          <label>Brand</label>
          <input type="text" id="f-brand" value="${escHtml(c.brand || '')}" placeholder="Chemical Guys…">
        </div>
        <div class="form-row">
          <label>Type</label>
          <select id="f-type"><option value="">— Select —</option>${typeOpts}</select>
        </div>
      </div>
      <div class="form-row-3">
        <div class="form-row">
          <label>Quantity</label>
          <input type="number" id="f-qty" value="${c.qty ?? 0}" step="0.5" min="0">
        </div>
        <div class="form-row">
          <label>Unit</label>
          <select id="f-unit"><option value="">—</option>${unitOpts}</select>
        </div>
        <div class="form-row">
          <label>Status</label>
          <select id="f-status">${statOpts}</select>
        </div>
      </div>`;
  }

  function collect() {
    return {
      product: document.getElementById('f-product').value.trim(),
      brand:   document.getElementById('f-brand').value.trim(),
      type:    document.getElementById('f-type').value,
      qty:     parseFloat(document.getElementById('f-qty').value) || 0,
      unit:    document.getElementById('f-unit').value,
      status:  document.getElementById('f-status').value || 'In Stock',
    };
  }

  function openAdd() {
    Modal.show('Add Cleaning Product', formHtml(), async () => {
      const data = collect();
      if (!data.product) { Toast.show('Product name is required', 'error'); return; }
      try {
        const item = await API.post('/api/cleaning', data);
        _items.push(item);
        render();
        Modal.hide();
        App.refreshBadges();
        Toast.show('Product added');
      } catch (e) { Toast.show('Failed to save', 'error'); }
    });
  }

  function openEdit(id) {
    const c = _items.find(i => i.id === id);
    if (!c) return;
    Modal.show('Edit Cleaning Product', formHtml(c), async () => {
      const data = collect();
      if (!data.product) { Toast.show('Product name is required', 'error'); return; }
      try {
        const updated = await API.put(`/api/cleaning/${id}`, data);
        const idx = _items.findIndex(i => i.id === id);
        _items[idx] = updated;
        render();
        Modal.hide();
        Toast.show('Product updated');
      } catch (e) { Toast.show('Failed to update', 'error'); }
    });
  }

  async function del(id) {
    if (!confirm('Delete this product?')) return;
    try {
      await API.del(`/api/cleaning/${id}`);
      _items = _items.filter(i => i.id !== id);
      render();
      App.refreshBadges();
      Toast.show('Product deleted');
    } catch (e) { Toast.show('Failed to delete', 'error'); }
  }

  return { load, render, openAdd, openEdit, del };
})();
