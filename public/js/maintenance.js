const Maintenance = (() => {
  let _items = [];
  let _cars = [];

  async function load() {
    try {
      [_items, _cars] = await Promise.all([API.get('/api/maintenance'), API.get('/api/cars')]);
      _populateCarFilter();
      render();
    } catch (e) { Toast.show('Failed to load maintenance', 'error'); }
  }

  function _populateCarFilter() {
    const sel = document.getElementById('maint-filter-car');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All Cars</option>' +
      _cars.map(c => `<option value="${c.id}" ${cur == c.id ? 'selected':''}>${escHtml(c.year)} ${escHtml(c.make)} ${escHtml(c.model)}</option>`).join('');
  }

  function _status(m) {
    if (m.completed) return 'completed';
    const d = daysUntil(m.due_date);
    if (d === null) return 'upcoming';
    if (d < 0) return 'overdue';
    if (d <= 14) return 'due-soon';
    return 'upcoming';
  }

  function render() {
    const carFilter = document.getElementById('maint-filter-car').value;
    const statusFilter = document.getElementById('maint-filter-status').value;
    let items = _items;
    if (carFilter) items = items.filter(m => String(m.car_id) === carFilter);
    if (statusFilter) items = items.filter(m => _status(m) === statusFilter);

    const tbody = document.getElementById('maintenance-tbody');
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
        <div class="empty-state-icon">⚙</div>
        <div class="empty-state-title">No maintenance tasks</div>
        <div class="empty-state-sub">Add a maintenance schedule for your vehicles</div>
      </div></td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(m => {
      const st = _status(m);
      return `<tr>
        <td><strong>${escHtml(m.title)}</strong>${m.description ? `<br><span style="color:var(--text-muted);font-size:11px">${escHtml(m.description)}</span>` : ''}</td>
        <td>${escHtml(m.car_name || '—')}</td>
        <td>${fmtDate(m.due_date)}</td>
        <td>${escHtml(m.due_mileage) || '—'}</td>
        <td>${m.cost ? fmt$(m.cost) : '—'}</td>
        <td>${App.maintBadge(st)}</td>
        <td><div class="td-actions">
          ${!m.completed ? `<button class="btn btn-ghost btn-sm" onclick="Maintenance.markDone(${m.id})" title="Mark Complete">✓</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="Maintenance.openEdit(${m.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="Maintenance.del(${m.id})">✕</button>
        </div></td>
      </tr>`;
    }).join('');
  }

  function _carOpts(selectedId) {
    return _cars.map(c => `<option value="${c.id}" ${selectedId == c.id ? 'selected' : ''}>${escHtml(c.year)} ${escHtml(c.make)} ${escHtml(c.model)}</option>`).join('');
  }

  function formHtml(m = {}) {
    return `
      <div class="form-row">
        <label>Title *</label>
        <input type="text" id="f-title" value="${escHtml(m.title || '')}" placeholder="Oil Change, Brake Service…">
      </div>
      <div class="form-row">
        <label>Car</label>
        <select id="f-car"><option value="">— General / No specific car —</option>${_carOpts(m.car_id)}</select>
      </div>
      <div class="form-row">
        <label>Description</label>
        <textarea id="f-desc">${escHtml(m.description || '')}</textarea>
      </div>
      <div class="form-row-2">
        <div class="form-row">
          <label>Due Date</label>
          <input type="date" id="f-due-date" value="${m.due_date || ''}">
        </div>
        <div class="form-row">
          <label>Due Mileage</label>
          <input type="text" id="f-due-mileage" value="${escHtml(m.due_mileage || '')}" placeholder="15,000">
        </div>
      </div>
      <div class="form-row">
        <label>Estimated Cost ($)</label>
        <input type="number" id="f-cost" value="${m.cost || ''}" placeholder="0.00" step="0.01" min="0">
      </div>
      <div class="form-row">
        <label>Notes</label>
        <textarea id="f-notes">${escHtml(m.notes || '')}</textarea>
      </div>
      ${m.id ? `<div class="form-row"><label class="checkbox-row"><input type="checkbox" id="f-completed" ${m.completed ? 'checked' : ''}><span>Mark as completed</span></label></div>` : ''}
    `;
  }

  function collect() {
    return {
      car_id: document.getElementById('f-car').value || null,
      title: document.getElementById('f-title').value.trim(),
      description: document.getElementById('f-desc').value.trim(),
      due_date: document.getElementById('f-due-date').value || null,
      due_mileage: document.getElementById('f-due-mileage').value.trim(),
      cost: parseFloat(document.getElementById('f-cost').value) || 0,
      notes: document.getElementById('f-notes').value.trim(),
      completed: document.getElementById('f-completed')?.checked ? 1 : 0,
      completed_date: document.getElementById('f-completed')?.checked ? today() : '',
    };
  }

  function openAdd() {
    Modal.show('Add Maintenance Task', formHtml(), async () => {
      const data = collect();
      if (!data.title) { Toast.show('Title is required', 'error'); return; }
      try {
        const item = await API.post('/api/maintenance', data);
        _items.push(item);
        render();
        Modal.hide();
        App.refreshBadges();
        Toast.show('Task added');
      } catch (e) { Toast.show('Failed to save', 'error'); }
    });
  }

  function openEdit(id) {
    const m = _items.find(i => i.id === id);
    if (!m) return;
    Modal.show('Edit Maintenance Task', formHtml(m), async () => {
      const data = collect();
      if (!data.title) { Toast.show('Title is required', 'error'); return; }
      try {
        const updated = await API.put(`/api/maintenance/${id}`, data);
        const idx = _items.findIndex(i => i.id === id);
        _items[idx] = updated;
        render();
        Modal.hide();
        App.refreshBadges();
        Toast.show('Task updated');
      } catch (e) { Toast.show('Failed to update', 'error'); }
    });
  }

  async function markDone(id) {
    const m = _items.find(i => i.id === id);
    if (!m) return;
    try {
      const updated = await API.put(`/api/maintenance/${id}`, { ...m, completed: 1, completed_date: today() });
      const idx = _items.findIndex(i => i.id === id);
      _items[idx] = updated;
      render();
      App.refreshBadges();
      Toast.show('Marked complete');
    } catch (e) { Toast.show('Failed to update', 'error'); }
  }

  async function del(id) {
    if (!confirm('Delete this maintenance task?')) return;
    try {
      await API.del(`/api/maintenance/${id}`);
      _items = _items.filter(i => i.id !== id);
      render();
      App.refreshBadges();
      Toast.show('Task deleted');
    } catch (e) { Toast.show('Failed to delete', 'error'); }
  }

  return { load, render, openAdd, openEdit, markDone, del };
})();
