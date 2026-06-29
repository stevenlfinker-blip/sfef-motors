const Other = (() => {
  let _items = [];

  async function load() {
    try {
      _items = await API.get('/api/other');
      render();
    } catch (e) { Toast.show('Failed to load items', 'error'); }
  }

  function render() {
    const search = document.getElementById('other-search').value.toLowerCase();
    let items = _items;
    if (search) items = items.filter(i => (i.name + i.notes).toLowerCase().includes(search));

    const tbody = document.getElementById('other-tbody');
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3"><div class="empty-state">
        <div class="empty-state-icon">◇</div>
        <div class="empty-state-title">No items in Other</div>
        <div class="empty-state-sub">Add miscellaneous garage items here</div>
      </div></td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(i => `<tr>
      <td><strong>${escHtml(i.name)}</strong></td>
      <td style="color:var(--text-muted);font-size:11px">${escHtml(i.notes) || '—'}</td>
      <td><div class="td-actions">
        <button class="btn btn-ghost btn-sm" onclick="Other.openEdit(${i.id})">Edit</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="Other.del(${i.id})">✕</button>
      </div></td>
    </tr>`).join('');
  }

  function formHtml(item = {}) {
    return `
      <div class="form-row">
        <label>Item Name *</label>
        <input type="text" id="f-name" value="${escHtml(item.name || '')}" placeholder="e.g. Segway, Racing Simulator…">
      </div>
      <div class="form-row">
        <label>Notes</label>
        <textarea id="f-notes">${escHtml(item.notes || '')}</textarea>
      </div>`;
  }

  function collect() {
    return {
      name:  document.getElementById('f-name').value.trim(),
      notes: document.getElementById('f-notes').value.trim(),
    };
  }

  function openAdd() {
    Modal.show('Add Item', formHtml(), async () => {
      const data = collect();
      if (!data.name) { Toast.show('Item name is required', 'error'); return; }
      try {
        const item = await API.post('/api/other', data);
        _items.push(item);
        render();
        Modal.hide();
        App.refreshBadges();
        Toast.show('Item added');
      } catch (e) { Toast.show('Failed to save', 'error'); }
    });
  }

  function openEdit(id) {
    const item = _items.find(i => i.id === id);
    if (!item) return;
    Modal.show('Edit Item', formHtml(item), async () => {
      const data = collect();
      if (!data.name) { Toast.show('Item name is required', 'error'); return; }
      try {
        const updated = await API.put(`/api/other/${id}`, data);
        const idx = _items.findIndex(i => i.id === id);
        _items[idx] = updated;
        render();
        Modal.hide();
        Toast.show('Item updated');
      } catch (e) { Toast.show('Failed to update', 'error'); }
    });
  }

  async function del(id) {
    if (!confirm('Delete this item?')) return;
    try {
      await API.del(`/api/other/${id}`);
      _items = _items.filter(i => i.id !== id);
      render();
      App.refreshBadges();
      Toast.show('Item deleted');
    } catch (e) { Toast.show('Failed to delete', 'error'); }
  }

  return { load, render, openAdd, openEdit, del };
})();
