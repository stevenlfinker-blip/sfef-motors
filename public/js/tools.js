const Tools = (() => {
  let _items = [];
  const CATEGORIES = ['Lifting', 'Hand Tools', 'Power Tools', 'Diagnostics', 'Measuring', 'Safety', 'Storage', 'Other'];
  const CONDITIONS = ['Excellent', 'Good', 'Fair', 'Poor'];

  async function load() {
    try {
      _items = await API.get('/api/tools');
      _populateCatFilter();
      render();
    } catch (e) { Toast.show('Failed to load tools', 'error'); }
  }

  function _populateCatFilter() {
    const cats = [...new Set(_items.map(t => t.category).filter(Boolean))].sort();
    const sel = document.getElementById('tools-filter-cat');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All Categories</option>' +
      cats.map(c => `<option value="${c}" ${cur === c ? 'selected':''}>${escHtml(c)}</option>`).join('');
  }

  function render() {
    const catFilter = document.getElementById('tools-filter-cat').value;
    const search = document.getElementById('tools-search').value.toLowerCase();
    let items = _items;
    if (catFilter) items = items.filter(t => t.category === catFilter);
    if (search) items = items.filter(t => (t.name + t.brand + t.location).toLowerCase().includes(search));

    const tbody = document.getElementById('tools-tbody');
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
        <div class="empty-state-icon">⊕</div>
        <div class="empty-state-title">No tools in inventory</div>
        <div class="empty-state-sub">Track your garage tool collection</div>
      </div></td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(t => {
      const condColor = { Excellent: 'var(--green)', Good: 'var(--green)', Fair: 'var(--orange)', Poor: 'var(--red)' }[t.condition] || 'var(--text-muted)';
      return `<tr>
        <td><strong>${escHtml(t.name)}</strong></td>
        <td>${escHtml(t.brand) || '—'}</td>
        <td>${escHtml(t.category) || '—'}</td>
        <td>${escHtml(t.location) || '—'}</td>
        <td><span style="color:${condColor};font-weight:600;font-size:11px">${escHtml(t.condition)}</span></td>
        <td style="color:var(--text-muted);font-size:11px">${escHtml(t.notes) || '—'}</td>
        <td><div class="td-actions">
          <button class="btn btn-ghost btn-sm" onclick="Tools.openEdit(${t.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="Tools.del(${t.id})">✕</button>
        </div></td>
      </tr>`;
    }).join('');
  }

  function formHtml(t = {}) {
    const catOpts = CATEGORIES.map(c => `<option value="${c}" ${t.category === c ? 'selected':''}>${c}</option>`).join('');
    const condOpts = CONDITIONS.map(c => `<option value="${c}" ${(t.condition || 'Good') === c ? 'selected':''}>${c}</option>`).join('');
    return `
      <div class="form-row">
        <label>Tool Name *</label>
        <input type="text" id="f-name" value="${escHtml(t.name || '')}" placeholder="Floor Jack, Torque Wrench…">
      </div>
      <div class="form-row-2">
        <div class="form-row">
          <label>Brand</label>
          <input type="text" id="f-brand" value="${escHtml(t.brand || '')}" placeholder="Snap-on, Matco…">
        </div>
        <div class="form-row">
          <label>Category</label>
          <select id="f-category"><option value="">— Select —</option>${catOpts}</select>
        </div>
      </div>
      <div class="form-row-2">
        <div class="form-row">
          <label>Location</label>
          <input type="text" id="f-location" value="${escHtml(t.location || '')}" placeholder="Bay 1, Tool Chest…">
        </div>
        <div class="form-row">
          <label>Condition</label>
          <select id="f-condition">${condOpts}</select>
        </div>
      </div>
      <div class="form-row">
        <label>Notes</label>
        <textarea id="f-notes">${escHtml(t.notes || '')}</textarea>
      </div>`;
  }

  function collect() {
    return {
      name:      document.getElementById('f-name').value.trim(),
      brand:     document.getElementById('f-brand').value.trim(),
      category:  document.getElementById('f-category').value,
      location:  document.getElementById('f-location').value.trim(),
      condition: document.getElementById('f-condition').value,
      notes:     document.getElementById('f-notes').value.trim(),
    };
  }

  function openAdd() {
    Modal.show('Add Tool', formHtml(), async () => {
      const data = collect();
      if (!data.name) { Toast.show('Tool name is required', 'error'); return; }
      try {
        const item = await API.post('/api/tools', data);
        _items.push(item);
        _populateCatFilter();
        render();
        Modal.hide();
        App.refreshBadges();
        Toast.show('Tool added');
      } catch (e) { Toast.show('Failed to save', 'error'); }
    });
  }

  function openEdit(id) {
    const t = _items.find(i => i.id === id);
    if (!t) return;
    Modal.show('Edit Tool', formHtml(t), async () => {
      const data = collect();
      if (!data.name) { Toast.show('Tool name is required', 'error'); return; }
      try {
        const updated = await API.put(`/api/tools/${id}`, data);
        const idx = _items.findIndex(i => i.id === id);
        _items[idx] = updated;
        _populateCatFilter();
        render();
        Modal.hide();
        Toast.show('Tool updated');
      } catch (e) { Toast.show('Failed to update', 'error'); }
    });
  }

  async function del(id) {
    if (!confirm('Delete this tool?')) return;
    try {
      await API.del(`/api/tools/${id}`);
      _items = _items.filter(i => i.id !== id);
      _populateCatFilter();
      render();
      App.refreshBadges();
      Toast.show('Tool deleted');
    } catch (e) { Toast.show('Failed to delete', 'error'); }
  }

  return { load, render, openAdd, openEdit, del };
})();
