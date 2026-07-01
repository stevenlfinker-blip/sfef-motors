const Parts = (() => {
  let _items = [];
  let _cars = [];

  async function load() {
    try {
      [_items, _cars] = await Promise.all([API.get('/api/parts'), API.get('/api/cars')]);
      _populateCarFilter();
      render();
    } catch (e) { Toast.show('Failed to load parts', 'error'); }
  }

  function _populateCarFilter() {
    const sel = document.getElementById('parts-filter-car');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All Cars</option>' +
      _cars.map(c => `<option value="${c.id}" ${cur == c.id ? 'selected':''}>${carLabel(c)}</option>`).join('');
  }

  function render() {
    const carFilter = document.getElementById('parts-filter-car').value;
    const search = document.getElementById('parts-search').value.toLowerCase();
    let items = _items;
    if (carFilter) items = items.filter(p => String(p.car_id) === carFilter);
    if (search) items = items.filter(p => (p.name + p.part_number + p.supplier).toLowerCase().includes(search));

    const tbody = document.getElementById('parts-tbody');
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">
        <div class="empty-state-icon">⊞</div>
        <div class="empty-state-title">No parts in inventory</div>
        <div class="empty-state-sub">Track spare parts and consumables</div>
      </div></td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(p => `<tr>
      <td><strong>${escHtml(p.name)}</strong>${p.notes ? `<br><span style="color:var(--text-muted);font-size:11px">${escHtml(p.notes)}</span>` : ''}</td>
      <td><span style="font-family:monospace;font-size:11px">${escHtml(p.part_number) || '—'}</span></td>
      <td>${escHtml(p.car_name || '—')}</td>
      <td><strong style="color:${p.quantity <= 0 ? 'var(--red)' : 'var(--text)'}">${p.quantity}</strong></td>
      <td>${escHtml(p.location) || '—'}</td>
      <td>${p.cost_each ? fmt$(p.cost_each) : '—'}</td>
      <td>${escHtml(p.supplier) || '—'}</td>
      <td><div class="td-actions">
        <button class="btn btn-ghost btn-sm" onclick="Parts.openEdit(${p.id})">Edit</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="Parts.del(${p.id})">✕</button>
      </div></td>
    </tr>`).join('');
  }

  function _carOpts(selectedId) {
    return _cars.map(c => `<option value="${c.id}" ${selectedId == c.id ? 'selected' : ''}>${carLabel(c)}</option>`).join('');
  }

  function formHtml(p = {}) {
    return `
      <div class="form-row">
        <label>Part Name *</label>
        <input type="text" id="f-name" value="${escHtml(p.name || '')}" placeholder="Brake Pads, Oil Filter…">
      </div>
      <div class="form-row-2">
        <div class="form-row">
          <label>Part Number</label>
          <input type="text" id="f-partnum" value="${escHtml(p.part_number || '')}" placeholder="OEM-12345" style="font-family:monospace">
        </div>
        <div class="form-row">
          <label>Car</label>
          <select id="f-car"><option value="">— No specific car —</option>${_carOpts(p.car_id)}</select>
        </div>
      </div>
      <div class="form-row-3">
        <div class="form-row">
          <label>Quantity</label>
          <input type="number" id="f-qty" value="${p.quantity ?? 0}" min="0">
        </div>
        <div class="form-row">
          <label>Cost Each ($)</label>
          <input type="number" id="f-cost" value="${p.cost_each || ''}" placeholder="0.00" step="0.01" min="0">
        </div>
        <div class="form-row">
          <label>Location</label>
          <input type="text" id="f-location" value="${escHtml(p.location || '')}" placeholder="Shelf A3">
        </div>
      </div>
      <div class="form-row">
        <label>Supplier</label>
        <input type="text" id="f-supplier" value="${escHtml(p.supplier || '')}" placeholder="FCP Euro, Pelican…">
      </div>
      <div class="form-row">
        <label>Notes</label>
        <textarea id="f-notes">${escHtml(p.notes || '')}</textarea>
      </div>`;
  }

  function collect() {
    return {
      car_id: document.getElementById('f-car').value || null,
      name: document.getElementById('f-name').value.trim(),
      part_number: document.getElementById('f-partnum').value.trim(),
      quantity: parseInt(document.getElementById('f-qty').value) || 0,
      cost_each: parseFloat(document.getElementById('f-cost').value) || 0,
      location: document.getElementById('f-location').value.trim(),
      supplier: document.getElementById('f-supplier').value.trim(),
      notes: document.getElementById('f-notes').value.trim(),
    };
  }

  function openAdd() {
    Modal.show('Add Part', formHtml(), async () => {
      const data = collect();
      if (!data.name) { Toast.show('Part name is required', 'error'); return; }
      try {
        const item = await API.post('/api/parts', data);
        _items.push(item);
        render();
        Modal.hide();
        App.refreshBadges();
        Toast.show('Part added');
      } catch (e) { Toast.show('Failed to save', 'error'); }
    });
  }

  function openEdit(id) {
    const p = _items.find(i => i.id === id);
    if (!p) return;
    Modal.show('Edit Part', formHtml(p), async () => {
      const data = collect();
      if (!data.name) { Toast.show('Part name is required', 'error'); return; }
      try {
        const updated = await API.put(`/api/parts/${id}`, data);
        const idx = _items.findIndex(i => i.id === id);
        _items[idx] = updated;
        render();
        Modal.hide();
        Toast.show('Part updated');
      } catch (e) { Toast.show('Failed to update', 'error'); }
    });
  }

  async function del(id) {
    if (!confirm('Delete this part?')) return;
    try {
      await API.del(`/api/parts/${id}`);
      _items = _items.filter(i => i.id !== id);
      render();
      App.refreshBadges();
      Toast.show('Part deleted');
    } catch (e) { Toast.show('Failed to delete', 'error'); }
  }

  return { load, render, openAdd, openEdit, del };
})();
