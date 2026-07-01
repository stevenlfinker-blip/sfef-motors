const Events = (() => {
  let _items = [];
  let _cars = [];
  const TYPES = ['Car Show', 'Track Day', 'Service', 'Rally', 'Storage', 'Gathering', 'Other'];

  async function load() {
    try {
      [_items, _cars] = await Promise.all([API.get('/api/events'), API.get('/api/cars')]);
      _populateCarFilter();
      render();
    } catch (e) { Toast.show('Failed to load events', 'error'); }
  }

  function _populateCarFilter() {
    const sel = document.getElementById('events-filter-car');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All Cars</option>' +
      _cars.map(c => `<option value="${c.id}" ${cur == c.id ? 'selected':''}>${carLabel(c)}</option>`).join('');
  }

  function _dateGroup(dateStr) {
    if (!dateStr) return 'No Date';
    const d = daysUntil(dateStr);
    if (d === null) return 'No Date';
    if (d < 0) return 'Past';
    if (d === 0) return 'Today';
    if (d <= 7) return 'This Week';
    if (d <= 30) return 'This Month';
    return 'Upcoming';
  }

  function render() {
    const typeFilter = document.getElementById('events-filter-type').value;
    const carFilter = document.getElementById('events-filter-car').value;
    let items = _items;
    if (typeFilter) items = items.filter(e => e.type === typeFilter);
    if (carFilter) items = items.filter(e => String(e.car_id) === carFilter);

    const container = document.getElementById('events-list');
    if (items.length === 0) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">◷</div>
        <div class="empty-state-title">No events scheduled</div>
        <div class="empty-state-sub">Add car shows, track days, and service appointments</div>
        <button class="btn btn-primary" onclick="Events.openAdd()">+ Add Event</button>
      </div>`;
      return;
    }

    // Group by time bucket
    const groups = {};
    const ORDER = ['Today', 'This Week', 'This Month', 'Upcoming', 'Past', 'No Date'];
    for (const e of items) {
      const g = _dateGroup(e.date);
      if (!groups[g]) groups[g] = [];
      groups[g].push(e);
    }

    let html = '';
    for (const group of ORDER) {
      if (!groups[group]) continue;
      html += `<div style="margin-bottom:24px">
        <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted);margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border)">${group}</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${groups[group].map(e => eventCard(e)).join('')}
        </div>
      </div>`;
    }
    container.innerHTML = html;
  }

  function typeColor(type) {
    return { 'Car Show': 'var(--accent)', 'Track Day': 'var(--red)', 'Service': 'var(--blue)', 'Rally': 'var(--orange)', 'Storage': 'var(--purple)' }[type] || 'var(--border-light)';
  }

  function eventCard(e) {
    const d = daysUntil(e.date);
    const isPast = d !== null && d < 0;
    return `
      <div class="card" style="display:flex;gap:16px;align-items:flex-start;opacity:${isPast ? '.6' : '1'}">
        <div style="width:3px;border-radius:2px;background:${typeColor(e.type)};align-self:stretch;flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-weight:700;font-size:14px">${escHtml(e.title)}</span>
            ${e.type ? `<span class="badge badge-neutral">${escHtml(e.type)}</span>` : ''}
            ${e.registered ? '<span class="badge badge-registered">Registered</span>' : '<span class="badge badge-pending">Pending</span>'}
          </div>
          <div style="display:flex;gap:16px;margin-top:6px;flex-wrap:wrap">
            ${e.car_name ? `<span style="font-size:11px;color:var(--text-muted)">◉ ${escHtml(e.car_name)}</span>` : ''}
            ${e.location ? `<span style="font-size:11px;color:var(--text-muted)">⊙ ${escHtml(e.location)}</span>` : ''}
            ${e.date ? `<span style="font-size:11px;color:var(--text-muted)">◷ ${fmtDate(e.date)}</span>` : ''}
          </div>
          ${e.notes ? `<div style="margin-top:6px;font-size:11px;color:var(--text-muted)">${escHtml(e.notes)}</div>` : ''}
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          ${!e.registered && !isPast ? `<button class="btn btn-ghost btn-sm" onclick="Events.toggleReg(${e.id})" title="Mark Registered" style="color:var(--green)">✓</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="Events.openEdit(${e.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="Events.del(${e.id})">✕</button>
        </div>
      </div>`;
  }

  function _carOpts(selectedId) {
    return _cars.map(c => `<option value="${c.id}" ${selectedId == c.id ? 'selected':''}>${carLabel(c)}</option>`).join('');
  }

  function formHtml(e = {}) {
    const typeOpts = TYPES.map(t => `<option value="${t}" ${e.type === t ? 'selected':''}>${t}</option>`).join('');
    return `
      <div class="form-row">
        <label>Event Title *</label>
        <input type="text" id="f-title" value="${escHtml(e.title || '')}" placeholder="Porsche Club Show, Laguna Seca…">
      </div>
      <div class="form-row-2">
        <div class="form-row">
          <label>Type</label>
          <select id="f-type"><option value="">— Select —</option>${typeOpts}</select>
        </div>
        <div class="form-row">
          <label>Date</label>
          <input type="date" id="f-date" value="${e.date || ''}">
        </div>
      </div>
      <div class="form-row-2">
        <div class="form-row">
          <label>Car</label>
          <select id="f-car"><option value="">— No specific car —</option>${_carOpts(e.car_id)}</select>
        </div>
        <div class="form-row">
          <label>Location</label>
          <input type="text" id="f-location" value="${escHtml(e.location || '')}" placeholder="Monterey, CA">
        </div>
      </div>
      <div class="form-row">
        <label class="checkbox-row">
          <input type="checkbox" id="f-registered" ${e.registered ? 'checked' : ''}>
          <span>Registered / Confirmed</span>
        </label>
      </div>
      <div class="form-row">
        <label>Notes</label>
        <textarea id="f-notes">${escHtml(e.notes || '')}</textarea>
      </div>`;
  }

  function collect() {
    return {
      title:      document.getElementById('f-title').value.trim(),
      type:       document.getElementById('f-type').value,
      date:       document.getElementById('f-date').value || null,
      car_id:     document.getElementById('f-car').value || null,
      location:   document.getElementById('f-location').value.trim(),
      registered: document.getElementById('f-registered').checked ? 1 : 0,
      notes:      document.getElementById('f-notes').value.trim(),
    };
  }

  function openAdd() {
    Modal.show('Add Event', formHtml(), async () => {
      const data = collect();
      if (!data.title) { Toast.show('Title is required', 'error'); return; }
      try {
        const item = await API.post('/api/events', data);
        _items.push(item);
        _items.sort((a,b) => (a.date||'') < (b.date||'') ? -1 : 1);
        render();
        Modal.hide();
        App.refreshBadges();
        Toast.show('Event added');
      } catch (e) { Toast.show('Failed to save', 'error'); }
    });
  }

  function openEdit(id) {
    const e = _items.find(i => i.id === id);
    if (!e) return;
    Modal.show('Edit Event', formHtml(e), async () => {
      const data = collect();
      if (!data.title) { Toast.show('Title is required', 'error'); return; }
      try {
        const updated = await API.put(`/api/events/${id}`, data);
        const idx = _items.findIndex(i => i.id === id);
        _items[idx] = updated;
        _items.sort((a,b) => (a.date||'') < (b.date||'') ? -1 : 1);
        render();
        Modal.hide();
        App.refreshBadges();
        Toast.show('Event updated');
      } catch (e) { Toast.show('Failed to update', 'error'); }
    });
  }

  async function toggleReg(id) {
    const e = _items.find(i => i.id === id);
    if (!e) return;
    try {
      const updated = await API.put(`/api/events/${id}`, { ...e, registered: e.registered ? 0 : 1 });
      const idx = _items.findIndex(i => i.id === id);
      _items[idx] = updated;
      render();
      Toast.show(updated.registered ? 'Marked as registered' : 'Registration removed');
    } catch (e) { Toast.show('Failed to update', 'error'); }
  }

  async function del(id) {
    if (!confirm('Delete this event?')) return;
    try {
      await API.del(`/api/events/${id}`);
      _items = _items.filter(i => i.id !== id);
      render();
      App.refreshBadges();
      Toast.show('Event deleted');
    } catch (e) { Toast.show('Failed to delete', 'error'); }
  }

  return { load, render, openAdd, openEdit, toggleReg, del };
})();
