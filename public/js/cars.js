const Cars = (() => {
  let _cars = [];

  const STATUS_OPTS = ['Active', 'Restoration', 'Storage', 'For Sale'];
  const OWNERSHIP_OPTS = ['Free and clear', 'Lease', 'Financed', 'Under Management', 'Other'];

  async function load() {
    try {
      _cars = await API.get('/api/cars');
      render();
    } catch (e) { Toast.show('Failed to load cars', 'error'); }
  }

  function render() {
    const grid = document.getElementById('cars-grid');
    if (_cars.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-state-icon">◉</div>
          <div class="empty-state-title">No cars in your fleet</div>
          <div class="empty-state-sub">Add your first vehicle to get started</div>
          <button class="btn btn-primary" onclick="Cars.openAdd()">+ Add Car</button>
        </div>`;
      return;
    }
    grid.innerHTML = _cars.map(c => carCard(c)).join('');
  }

  function statusClass(s) {
    return { Active: 'badge-active', Restoration: 'badge-restoration', Storage: 'badge-storage', 'For Sale': 'badge-for-sale' }[s] || 'badge-neutral';
  }

  function accentColor(s) {
    return { Active: 'var(--green)', Restoration: 'var(--orange)', Storage: 'var(--blue)', 'For Sale': 'var(--purple)' }[s] || 'var(--border-light)';
  }

  // Parse MM/DD/YYYY or YYYY-MM-DD
  function parseDate(s) {
    if (!s) return null;
    const md = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (md) return new Date(parseInt(md[3]), parseInt(md[1]) - 1, parseInt(md[2]));
    const yd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (yd) return new Date(parseInt(yd[1]), parseInt(yd[2]) - 1, parseInt(yd[3]));
    return null;
  }

  function expiryStatus(dateStr) {
    const d = parseDate(dateStr);
    if (!d) return null;
    const diff = Math.round((d - new Date()) / 86400000);
    if (diff < 0)  return { label: 'Expired',      color: 'var(--red)',    dim: 'var(--red-dim)' };
    if (diff <= 30) return { label: 'Exp. soon',    color: 'var(--orange)', dim: 'var(--orange-dim)' };
    return            { label: 'Valid',            color: 'var(--green)',  dim: 'var(--green-dim)' };
  }

  function expiryPill(label, dateStr) {
    if (!dateStr) return '';
    const st = expiryStatus(dateStr);
    const color = st ? st.color : 'var(--text-muted)';
    return `<div class="car-card-row">
      <span class="car-card-row-label">${label}</span>
      <span class="car-card-row-value" style="color:${color};font-size:11px">${escHtml(dateStr)}</span>
    </div>`;
  }

  function ownershipBadge(o) {
    if (!o) return '';
    const colors = {
      'Free and clear':   ['var(--green-dim)',  'var(--green)'],
      'Lease':            ['var(--blue-dim)',   'var(--blue)'],
      'Financed':         ['var(--orange-dim)', 'var(--orange)'],
      'Under Management': ['var(--purple-dim)', 'var(--purple)'],
    };
    const [bg, fg] = colors[o] || ['var(--elevated)', 'var(--text-muted)'];
    return `<span class="badge" style="background:${bg};color:${fg}">${escHtml(o)}</span>`;
  }

  function carCard(c) {
    return `
      <div class="car-card">
        <div class="car-card-header">
          <div class="car-accent-bar" style="background:${accentColor(c.status)}"></div>
          <div class="car-card-info">
            <div class="car-card-year">${escHtml(c.year)}</div>
            <div class="car-card-name">${escHtml(c.make)} ${escHtml(c.model)}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
            <span class="badge ${statusClass(c.status)}">${escHtml(c.status)}</span>
            ${c.ownership ? ownershipBadge(c.ownership) : ''}
          </div>
        </div>
        <div class="car-card-body">
          ${c.color ? `<div class="car-card-row"><span class="car-card-row-label">Color</span><span class="car-card-row-value">${escHtml(c.color)}</span></div>` : ''}
          <div class="car-card-row">
            <span class="car-card-row-label">Mileage</span>
            <span class="car-card-row-value">${escHtml(c.mileage) || '—'} mi</span>
          </div>
          ${c.vin ? `<div class="car-card-row"><span class="car-card-row-label">VIN</span><span class="car-card-row-value" style="font-size:10px;font-family:monospace">${escHtml(c.vin)}</span></div>` : ''}
          ${expiryPill('Registration', c.registration)}
          ${expiryPill('Insurance', c.insurance)}
          ${c.notes ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)">${escHtml(c.notes)}</div>` : ''}
        </div>
        <div class="car-card-footer">
          <button class="btn btn-secondary btn-sm" onclick="Cars.openEdit(${c.id})">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="Cars.del(${c.id})">Delete</button>
        </div>
      </div>`;
  }

  function formHtml(c = {}) {
    const statOpts = STATUS_OPTS.map(s => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${s}</option>`).join('');
    const ownOpts = OWNERSHIP_OPTS.map(s => `<option value="${s}" ${c.ownership === s ? 'selected' : ''}>${s}</option>`).join('');
    return `
      <div class="form-row-2">
        <div class="form-row">
          <label>Year</label>
          <input type="text" id="f-year" value="${escHtml(c.year || '')}" placeholder="2024" maxlength="4">
        </div>
        <div class="form-row">
          <label>Status</label>
          <select id="f-status">${statOpts}</select>
        </div>
      </div>
      <div class="form-row-2">
        <div class="form-row">
          <label>Make</label>
          <input type="text" id="f-make" value="${escHtml(c.make || '')}" placeholder="Porsche">
        </div>
        <div class="form-row">
          <label>Model</label>
          <input type="text" id="f-model" value="${escHtml(c.model || '')}" placeholder="911 GT3">
        </div>
      </div>
      <div class="form-row-2">
        <div class="form-row">
          <label>Color</label>
          <input type="text" id="f-color" value="${escHtml(c.color || '')}" placeholder="Guards Red">
        </div>
        <div class="form-row">
          <label>Mileage</label>
          <input type="text" id="f-mileage" value="${escHtml(c.mileage || '')}" placeholder="12,000">
        </div>
      </div>
      <div class="form-row">
        <label>VIN</label>
        <input type="text" id="f-vin" value="${escHtml(c.vin || '')}" placeholder="WP0AB2A98LS271234" style="font-family:monospace">
      </div>
      <div class="form-row">
        <label>Ownership</label>
        <select id="f-ownership"><option value="">— Select —</option>${ownOpts}</select>
      </div>
      <div class="form-row-2">
        <div class="form-row">
          <label>Registration Expiry</label>
          <input type="text" id="f-registration" value="${escHtml(c.registration || '')}" placeholder="MM/DD/YYYY">
        </div>
        <div class="form-row">
          <label>Insurance Expiry</label>
          <input type="text" id="f-insurance" value="${escHtml(c.insurance || '')}" placeholder="MM/DD/YYYY">
        </div>
      </div>
      <div class="form-row">
        <label>Estimated Value ($)</label>
        <input type="number" id="f-value" value="${c.value || ''}" placeholder="0" min="0" step="100">
      </div>
      <div class="form-row">
        <label>Notes</label>
        <textarea id="f-notes">${escHtml(c.notes || '')}</textarea>
      </div>`;
  }

  function collect() {
    return {
      year:         document.getElementById('f-year').value.trim(),
      make:         document.getElementById('f-make').value.trim(),
      model:        document.getElementById('f-model').value.trim(),
      color:        document.getElementById('f-color').value.trim(),
      mileage:      document.getElementById('f-mileage').value.trim(),
      status:       document.getElementById('f-status').value,
      vin:          document.getElementById('f-vin').value.trim(),
      ownership:    document.getElementById('f-ownership').value,
      registration: document.getElementById('f-registration').value.trim(),
      insurance:    document.getElementById('f-insurance').value.trim(),
      value:        parseFloat(document.getElementById('f-value').value) || 0,
      notes:        document.getElementById('f-notes').value.trim(),
    };
  }

  function openAdd() {
    Modal.show('Add Car', formHtml(), async () => {
      const data = collect();
      if (!data.make || !data.model) { Toast.show('Make and model are required', 'error'); return; }
      try {
        const car = await API.post('/api/cars', data);
        _cars.push(car);
        render();
        Modal.hide();
        App.refreshBadges();
        Toast.show(`${car.make} ${car.model} added`);
      } catch (e) { Toast.show('Failed to save', 'error'); }
    });
  }

  function openEdit(id) {
    const car = _cars.find(c => c.id === id);
    if (!car) return;
    Modal.show('Edit Car', formHtml(car), async () => {
      const data = collect();
      if (!data.make || !data.model) { Toast.show('Make and model are required', 'error'); return; }
      try {
        const updated = await API.put(`/api/cars/${id}`, data);
        const idx = _cars.findIndex(c => c.id === id);
        _cars[idx] = updated;
        render();
        Modal.hide();
        App.refreshBadges();
        Toast.show('Car updated');
      } catch (e) { Toast.show('Failed to update', 'error'); }
    });
  }

  async function del(id) {
    const car = _cars.find(c => c.id === id);
    if (!confirm(`Delete ${car?.make} ${car?.model}? This will also remove linked maintenance records.`)) return;
    try {
      await API.del(`/api/cars/${id}`);
      _cars = _cars.filter(c => c.id !== id);
      render();
      App.refreshBadges();
      Toast.show('Car deleted');
    } catch (e) { Toast.show('Failed to delete', 'error'); }
  }

  return { load, render, openAdd, openEdit, del, all: () => _cars };
})();
