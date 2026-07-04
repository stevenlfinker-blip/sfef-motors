const Vessels = (() => {
  let _vessels = [];
  let _selectedId = null;
  let _map = null;

  const TYPE_OPTS = ['Powerboat', 'Sailboat', 'Center Console', 'Pontoon', 'Personal Watercraft', 'Other'];

  async function load() {
    try {
      _vessels = await API.get('/api/vessels');
      render();
    } catch (e) { Toast.show('Failed to load vessels', 'error'); }
  }

  function all() { return _vessels; }

  function _errMsg(e) {
    try { return JSON.parse(e.message).error || e.message; } catch (_) { return e.message; }
  }

  function _relTime(iso) {
    if (!iso) return null;
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function render() {
    const grid = document.getElementById('vessels-grid');
    if (_vessels.length === 0) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <div class="empty-state-icon">⛵</div>
        <div class="empty-state-title">No vessels yet</div>
        <div class="empty-state-sub">Add a vessel to start tracking its position</div>
        <button class="btn btn-primary" onclick="Vessels.openAdd()">+ Add Vessel</button>
      </div>`;
      return;
    }
    grid.innerHTML = _vessels.map(vesselCard).join('');
  }

  function vesselCard(v) {
    const pos = v.last_position;
    return `<div class="car-card">
      <div class="car-card-header">
        <div class="car-accent-bar" style="background:var(--accent)"></div>
        <div class="car-card-info">
          <div class="car-card-name">${escHtml(v.name)}</div>
          <div class="car-card-year">${escHtml(v.type || '')}${v.make ? ' · ' + escHtml(v.make) + ' ' + escHtml(v.model) : ''}</div>
        </div>
        ${v.garmin_mapshare_id ? '<span class="badge badge-active">Garmin Linked</span>' : ''}
      </div>
      <div class="car-card-body">
        ${pos ? `
          <div class="car-card-row"><span class="car-card-row-label">Last Position</span><span class="car-card-row-value">${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)}</span></div>
          <div class="car-card-row"><span class="car-card-row-label">Updated</span><span class="car-card-row-value">${_relTime(pos.recorded_at)}</span></div>
          ${pos.speed_knots != null ? `<div class="car-card-row"><span class="car-card-row-label">Speed</span><span class="car-card-row-value">${pos.speed_knots.toFixed(1)} kts</span></div>` : ''}
        ` : `<div style="color:var(--text-muted);font-size:12px">No position data yet</div>`}
        ${v.notes ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)">${escHtml(v.notes)}</div>` : ''}
      </div>
      <div class="car-card-footer">
        <button class="btn btn-secondary btn-sm" onclick="Vessels.viewTrack(${v.id})">Map</button>
        <button class="btn btn-secondary btn-sm" onclick="Vessels.sync(${v.id})">⟳ Sync</button>
        <button class="btn btn-secondary btn-sm" onclick="Vessels.openEdit(${v.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="Vessels.del(${v.id})">Delete</button>
      </div>
    </div>`;
  }

  // ── Add / Edit ─────────────────────────────────────
  async function formHtml(v = {}) {
    let marinas = [];
    try { marinas = await API.get('/api/marinas'); } catch (e) { /* ignore */ }
    const typeOpts = TYPE_OPTS.map(t => `<option value="${t}" ${v.type === t ? 'selected' : ''}>${t}</option>`).join('');
    const marinaOpts = marinas.map(m => `<option value="${m.id}" ${v.home_marina_id === m.id ? 'selected' : ''}>${escHtml(m.name)}</option>`).join('');
    return `
      <div class="form-row-2">
        <div class="form-row"><label>Vessel Name *</label><input type="text" id="f-name" value="${escHtml(v.name || '')}" placeholder="Reel Deal"></div>
        <div class="form-row"><label>Type</label><select id="f-type">${typeOpts}</select></div>
      </div>
      <div class="form-row-2">
        <div class="form-row"><label>Make</label><input type="text" id="f-make" value="${escHtml(v.make || '')}" placeholder="Boston Whaler"></div>
        <div class="form-row"><label>Model</label><input type="text" id="f-model" value="${escHtml(v.model || '')}" placeholder="Outrage 280"></div>
      </div>
      <div class="form-row-2">
        <div class="form-row"><label>Year</label><input type="text" id="f-year" value="${escHtml(v.year || '')}" placeholder="2024" maxlength="4"></div>
        <div class="form-row"><label>Home Marina</label><select id="f-home-marina"><option value="">— None —</option>${marinaOpts}</select></div>
      </div>
      <div class="form-row-2">
        <div class="form-row"><label>Hull ID (HIN)</label><input type="text" id="f-hull-id" value="${escHtml(v.hull_id || '')}"></div>
        <div class="form-row"><label>Registration #</label><input type="text" id="f-registration-number" value="${escHtml(v.registration_number || '')}"></div>
      </div>
      <div class="form-row-2">
        <div class="form-row"><label>Registration Expiry</label><input type="text" id="f-registration-expiry" value="${escHtml(v.registration_expiry || '')}" placeholder="MM/DD/YYYY"></div>
        <div class="form-row"><label>Insurance Expiry</label><input type="text" id="f-insurance-expiry" value="${escHtml(v.insurance_expiry || '')}" placeholder="MM/DD/YYYY"></div>
      </div>
      <div class="form-row" style="padding:10px;background:var(--elevated);border-radius:var(--radius)">
        <label style="margin-bottom:8px">Garmin inReach MapShare (for GPS sync)</label>
        <div class="form-row-2" style="margin-bottom:0">
          <div class="form-row"><label>MapShare ID</label><input type="text" id="f-garmin-id" value="${escHtml(v.garmin_mapshare_id || '')}" placeholder="e.g. the-crew"></div>
          <div class="form-row"><label>Password (if protected)</label><input type="text" id="f-garmin-password" value="${escHtml(v.garmin_mapshare_password || '')}"></div>
        </div>
      </div>
      <div class="form-row">
        <label>Notes</label>
        <textarea id="f-notes">${escHtml(v.notes || '')}</textarea>
      </div>`;
  }

  function collect() {
    return {
      name: document.getElementById('f-name').value.trim(),
      type: document.getElementById('f-type').value,
      make: document.getElementById('f-make').value.trim(),
      model: document.getElementById('f-model').value.trim(),
      year: document.getElementById('f-year').value.trim(),
      home_marina_id: document.getElementById('f-home-marina').value ? parseInt(document.getElementById('f-home-marina').value) : null,
      hull_id: document.getElementById('f-hull-id').value.trim(),
      registration_number: document.getElementById('f-registration-number').value.trim(),
      registration_expiry: document.getElementById('f-registration-expiry').value.trim(),
      insurance_expiry: document.getElementById('f-insurance-expiry').value.trim(),
      garmin_mapshare_id: document.getElementById('f-garmin-id').value.trim(),
      garmin_mapshare_password: document.getElementById('f-garmin-password').value.trim(),
      notes: document.getElementById('f-notes').value.trim(),
    };
  }

  async function openAdd() {
    Modal.show('Add Vessel', await formHtml(), async () => {
      const data = collect();
      if (!data.name) { Toast.show('Vessel name is required', 'error'); return; }
      try {
        const v = await API.post('/api/vessels', data);
        _vessels.push(v);
        render();
        Modal.hide();
        App.refreshBadges();
        Toast.show(`${v.name} added`);
      } catch (e) { Toast.show('Failed to save', 'error'); }
    });
  }

  async function openEdit(id) {
    const v = _vessels.find(x => x.id === id);
    if (!v) return;
    Modal.show('Edit Vessel', await formHtml(v), async () => {
      const data = collect();
      if (!data.name) { Toast.show('Vessel name is required', 'error'); return; }
      try {
        const updated = await API.put(`/api/vessels/${id}`, data);
        const idx = _vessels.findIndex(x => x.id === id);
        _vessels[idx] = { ...updated, last_position: v.last_position };
        render();
        Modal.hide();
        Toast.show('Vessel updated');
      } catch (e) { Toast.show('Failed to update', 'error'); }
    });
  }

  async function del(id) {
    const v = _vessels.find(x => x.id === id);
    if (!confirm(`Delete ${v?.name}? This also removes its position history.`)) return;
    try {
      await API.del(`/api/vessels/${id}`);
      _vessels = _vessels.filter(x => x.id !== id);
      if (_selectedId === id) closeTrack();
      render();
      App.refreshBadges();
      Toast.show('Vessel deleted');
    } catch (e) { Toast.show('Failed to delete', 'error'); }
  }

  // ── GPS sync ───────────────────────────────────────
  async function sync(id) {
    Toast.show('Syncing position from Garmin MapShare…', 'info');
    try {
      const result = await API.post(`/api/vessels/${id}/sync`, {});
      const v = _vessels.find(x => x.id === id);
      if (v) v.last_position = result.latest;
      render();
      Toast.show(`Synced — ${result.added} new position${result.added !== 1 ? 's' : ''}`);
      if (_selectedId === id) viewTrack(id);
    } catch (e) { Toast.show('Sync failed: ' + _errMsg(e), 'error'); }
  }

  // ── Track / map detail panel ───────────────────────
  async function viewTrack(id) {
    _selectedId = id;
    const v = _vessels.find(x => x.id === id);
    if (!v) return;
    let positions = [];
    try { positions = await API.get(`/api/vessels/${id}/positions?limit=500`); }
    catch (e) { Toast.show('Failed to load position history', 'error'); }

    const panel = document.getElementById('vessel-detail');
    panel.classList.remove('hidden');
    panel.innerHTML = `<div class="card">
      <div class="section-header" style="margin-bottom:12px">
        <div class="section-title" style="font-size:15px">${escHtml(v.name)} <span>/ Track</span></div>
        <div class="section-actions">
          <button class="btn btn-secondary btn-sm" onclick="Vessels.openLogPosition(${v.id})">+ Log Position</button>
          <button class="btn btn-ghost btn-sm" onclick="Vessels.closeTrack()">✕ Close</button>
        </div>
      </div>
      <div id="vessel-map" class="map-container" style="height:360px;margin-bottom:12px"></div>
      <div class="table-wrap" style="max-height:220px;overflow-y:auto">
        <table>
          <thead><tr><th>Time</th><th>Lat</th><th>Lon</th><th>Speed</th><th>Source</th></tr></thead>
          <tbody>${positions.length ? positions.map(p => `<tr>
            <td>${new Date(p.recorded_at).toLocaleString()}</td>
            <td>${p.lat.toFixed(4)}</td>
            <td>${p.lon.toFixed(4)}</td>
            <td>${p.speed_knots != null ? p.speed_knots.toFixed(1) + ' kts' : '—'}</td>
            <td>${escHtml(p.source)}</td>
          </tr>`).join('') : `<tr><td colspan="5"><div class="empty-state" style="padding:24px 0">
            <div class="empty-state-sub">No position history yet — sync from Garmin or log a position manually.</div>
          </div></td></tr>`}</tbody>
        </table>
      </div>
    </div>`;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (_map) { _map.remove(); _map = null; }
    _map = MarineMap.create('vessel-map');
    if (positions.length) {
      const chrono = [...positions].reverse();
      const latlngs = chrono.map(p => [p.lat, p.lon]);
      L.polyline(latlngs, { color: '#00d4ff', weight: 3, opacity: 0.85 }).addTo(_map);
      const latest = chrono[chrono.length - 1];
      L.marker([latest.lat, latest.lon]).addTo(_map)
        .bindPopup(`<strong>${escHtml(v.name)}</strong><br>${new Date(latest.recorded_at).toLocaleString()}`);
      MarineMap.fitToPoints(_map, latlngs);
    }
  }

  function closeTrack() {
    _selectedId = null;
    if (_map) { _map.remove(); _map = null; }
    const panel = document.getElementById('vessel-detail');
    panel.classList.add('hidden');
    panel.innerHTML = '';
  }

  function openLogPosition(id) {
    Modal.show('Log Position', `
      <div class="form-row-2">
        <div class="form-row"><label>Latitude *</label><input type="text" id="f-pos-lat" placeholder="27.9506"></div>
        <div class="form-row"><label>Longitude *</label><input type="text" id="f-pos-lon" placeholder="-82.4572"></div>
      </div>
      <div class="form-row-2">
        <div class="form-row"><label>Speed (knots)</label><input type="number" id="f-pos-speed" step="0.1"></div>
        <div class="form-row"><label>Time</label><input type="text" id="f-pos-time" placeholder="Leave blank for now"></div>
      </div>
      <div class="form-row"><label>Notes</label><input type="text" id="f-pos-notes" placeholder="e.g. Departed marina"></div>
    `, async () => {
      const lat = parseFloat(document.getElementById('f-pos-lat').value);
      const lon = parseFloat(document.getElementById('f-pos-lon').value);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) { Toast.show('Valid latitude and longitude are required', 'error'); return; }
      try {
        const latest = await API.post(`/api/vessels/${id}/positions`, {
          lat, lon,
          speed_knots: document.getElementById('f-pos-speed').value || null,
          recorded_at: document.getElementById('f-pos-time').value.trim() || null,
          notes: document.getElementById('f-pos-notes').value.trim(),
        });
        const v = _vessels.find(x => x.id === id);
        if (v) v.last_position = latest;
        render();
        Modal.hide();
        Toast.show('Position logged');
        if (_selectedId === id) viewTrack(id);
      } catch (e) { Toast.show('Failed to log position: ' + _errMsg(e), 'error'); }
    });
  }

  return { load, render, all, openAdd, openEdit, del, sync, viewTrack, closeTrack, openLogPosition };
})();
