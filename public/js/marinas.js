const Marinas = (() => {
  let _marinas = [];
  let _map = null;

  async function load() {
    try {
      _marinas = await API.get('/api/marinas');
      render();
      renderMap();
    } catch (e) { Toast.show('Failed to load marinas', 'error'); }
  }

  function all() { return _marinas; }

  function renderMap() {
    if (_map) { _map.remove(); _map = null; }
    _map = MarineMap.create('marinas-map');
    const points = [];
    for (const m of _marinas) {
      if (m.lat == null || m.lon == null) continue;
      points.push([m.lat, m.lon]);
      L.marker([m.lat, m.lon]).addTo(_map).bindPopup(`
        <strong>${escHtml(m.name)}</strong><br>
        ${m.address ? escHtml(m.address) + '<br>' : ''}
        ${m.vhf_channel ? 'VHF Ch. ' + escHtml(m.vhf_channel) : ''}
      `);
    }
    MarineMap.fitToPoints(_map, points);
  }

  function render() {
    const search = document.getElementById('marinas-search').value.toLowerCase();
    let marinas = _marinas;
    if (search) marinas = marinas.filter(m => (m.name + m.address).toLowerCase().includes(search));

    const grid = document.getElementById('marinas-grid');
    if (marinas.length === 0) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <div class="empty-state-icon">⚓</div>
        <div class="empty-state-title">No marinas found</div>
        <div class="empty-state-sub">Add a marina to start building your directory</div>
      </div>`;
      return;
    }
    grid.innerHTML = marinas.map(marinaCard).join('');
  }

  function amenityBadges(m) {
    const badges = [];
    if (m.fuel_diesel) badges.push('<span class="badge badge-neutral">Diesel</span>');
    if (m.fuel_gas) badges.push('<span class="badge badge-neutral">Gas</span>');
    if (m.transient_slips) badges.push('<span class="badge badge-active">Transient Slips</span>');
    return badges.join(' ');
  }

  function marinaCard(m) {
    return `<div class="car-card">
      <div class="car-card-header">
        <div class="car-accent-bar" style="background:var(--blue)"></div>
        <div class="car-card-info">
          <div class="car-card-name">${escHtml(m.name)}</div>
          <div class="car-card-year">${escHtml(m.address || '')}</div>
        </div>
      </div>
      <div class="car-card-body">
        ${m.phone ? `<div class="car-card-row"><span class="car-card-row-label">Phone</span><span class="car-card-row-value"><a href="tel:${escHtml(m.phone)}">${escHtml(m.phone)}</a></span></div>` : ''}
        ${m.website ? `<div class="car-card-row"><span class="car-card-row-label">Website</span><span class="car-card-row-value"><a href="${escHtml(m.website)}" target="_blank" rel="noopener">Visit ↗</a></span></div>` : ''}
        ${m.vhf_channel ? `<div class="car-card-row"><span class="car-card-row-label">VHF Channel</span><span class="car-card-row-value">${escHtml(m.vhf_channel)}</span></div>` : ''}
        ${m.lat != null ? `<div class="car-card-row"><span class="car-card-row-label">Coordinates</span><span class="car-card-row-value">${m.lat.toFixed(4)}, ${m.lon.toFixed(4)}</span></div>` : ''}
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${amenityBadges(m)}</div>
        ${m.notes ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)">${escHtml(m.notes)}</div>` : ''}
      </div>
      <div class="car-card-footer">
        ${m.lat != null ? `<button class="btn btn-secondary btn-sm" onclick="Marinas.checkWeather(${m.id})">☁ Weather</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="Marinas.openEdit(${m.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="Marinas.del(${m.id})">Delete</button>
      </div>
    </div>`;
  }

  function formHtml(m = {}) {
    return `
      <div class="form-row"><label>Marina Name *</label><input type="text" id="f-name" value="${escHtml(m.name || '')}" placeholder="Miami Beach Marina"></div>
      <div class="form-row-2">
        <div class="form-row"><label>Latitude</label><input type="text" id="f-lat" value="${m.lat != null ? m.lat : ''}" placeholder="25.7702"></div>
        <div class="form-row"><label>Longitude</label><input type="text" id="f-lon" value="${m.lon != null ? m.lon : ''}" placeholder="-80.1386"></div>
      </div>
      <div class="form-row"><label>Address</label><input type="text" id="f-address" value="${escHtml(m.address || '')}"></div>
      <div class="form-row-2">
        <div class="form-row"><label>Phone</label><input type="text" id="f-phone" value="${escHtml(m.phone || '')}"></div>
        <div class="form-row"><label>VHF Channel</label><input type="text" id="f-vhf" value="${escHtml(m.vhf_channel || '')}" placeholder="16"></div>
      </div>
      <div class="form-row"><label>Website</label><input type="text" id="f-website" value="${escHtml(m.website || '')}" placeholder="https://…"></div>
      <div class="form-row" style="display:flex;gap:16px;flex-wrap:wrap">
        <label class="checkbox-row"><input type="checkbox" id="f-fuel-diesel" ${m.fuel_diesel ? 'checked' : ''}><span>Diesel Fuel</span></label>
        <label class="checkbox-row"><input type="checkbox" id="f-fuel-gas" ${m.fuel_gas ? 'checked' : ''}><span>Gas Fuel</span></label>
        <label class="checkbox-row"><input type="checkbox" id="f-transient" ${m.transient_slips ? 'checked' : ''}><span>Transient Slips</span></label>
      </div>
      <div class="form-row"><label>Notes</label><textarea id="f-notes">${escHtml(m.notes || '')}</textarea></div>`;
  }

  function collect() {
    return {
      name: document.getElementById('f-name').value.trim(),
      lat: document.getElementById('f-lat').value.trim(),
      lon: document.getElementById('f-lon').value.trim(),
      address: document.getElementById('f-address').value.trim(),
      phone: document.getElementById('f-phone').value.trim(),
      vhf_channel: document.getElementById('f-vhf').value.trim(),
      website: document.getElementById('f-website').value.trim(),
      fuel_diesel: document.getElementById('f-fuel-diesel').checked,
      fuel_gas: document.getElementById('f-fuel-gas').checked,
      transient_slips: document.getElementById('f-transient').checked,
      notes: document.getElementById('f-notes').value.trim(),
    };
  }

  function openAdd() {
    Modal.show('Add Marina', formHtml(), async () => {
      const data = collect();
      if (!data.name) { Toast.show('Marina name is required', 'error'); return; }
      try {
        const m = await API.post('/api/marinas', data);
        _marinas.push(m);
        render();
        renderMap();
        Modal.hide();
        App.refreshBadges();
        Toast.show(`${m.name} added`);
      } catch (e) { Toast.show('Failed to save', 'error'); }
    });
  }

  function openEdit(id) {
    const m = _marinas.find(x => x.id === id);
    if (!m) return;
    Modal.show('Edit Marina', formHtml(m), async () => {
      const data = collect();
      if (!data.name) { Toast.show('Marina name is required', 'error'); return; }
      try {
        const updated = await API.put(`/api/marinas/${id}`, data);
        const idx = _marinas.findIndex(x => x.id === id);
        _marinas[idx] = updated;
        render();
        renderMap();
        Modal.hide();
        Toast.show('Marina updated');
      } catch (e) { Toast.show('Failed to update', 'error'); }
    });
  }

  async function del(id) {
    const m = _marinas.find(x => x.id === id);
    if (!confirm(`Delete ${m?.name}?`)) return;
    try {
      await API.del(`/api/marinas/${id}`);
      _marinas = _marinas.filter(x => x.id !== id);
      render();
      renderMap();
      App.refreshBadges();
      Toast.show('Marina deleted');
    } catch (e) { Toast.show('Failed to delete', 'error'); }
  }

  function checkWeather(id) {
    const m = _marinas.find(x => x.id === id);
    if (!m) return;
    App.navigate('weather');
    Weather.selectLocation(m.lat, m.lon, m.name);
  }

  return { load, render, all, openAdd, openEdit, del, checkWeather };
})();
