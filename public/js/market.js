const Market = (() => {
  let _cars = [];
  let _valuations = {};   // keyed by car_id
  let _loading = new Set();

  async function load() {
    try {
      _cars = await API.get('/api/cars');
      const vals = await API.get('/api/market');
      _valuations = {};
      vals.forEach(v => { _valuations[v.car_id] = v; });
      render();
    } catch (e) { Toast.show('Failed to load market data', 'error'); }
  }

  function render() {
    _renderSummary();
    _renderGrid();
  }

  function _renderSummary() {
    const valued = _cars.filter(c => _valuations[c.id]);
    const totalStored = _cars.reduce((s, c) => s + (c.value || 0), 0);
    const totalAvg    = valued.reduce((s, c) => s + (_valuations[c.id]?.avg || 0), 0);
    const totalLow    = valued.reduce((s, c) => s + (_valuations[c.id]?.low || 0), 0);
    const totalHigh   = valued.reduce((s, c) => s + (_valuations[c.id]?.high || 0), 0);
    const delta = totalAvg - totalStored;
    const deltaColor = delta >= 0 ? 'var(--green)' : 'var(--red)';
    const deltaSign  = delta >= 0 ? '+' : '';

    const el = document.getElementById('market-summary-row');
    if (!el) return;
    el.innerHTML = `
      <div class="card" style="padding:12px 18px;min-width:160px">
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Stored Value</div>
        <div style="font-size:22px;font-weight:700;margin-top:4px">${fmt$(totalStored)}</div>
      </div>
      <div class="card" style="padding:12px 18px;min-width:160px">
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">AI Market Avg</div>
        <div style="font-size:22px;font-weight:700;margin-top:4px">${valued.length ? fmt$(totalAvg) : '—'}</div>
        <div style="font-size:10px;color:var(--text-muted)">${fmt$(totalLow)} – ${fmt$(totalHigh)}</div>
      </div>
      ${valued.length ? `<div class="card" style="padding:12px 18px;min-width:160px">
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">vs Stored</div>
        <div style="font-size:22px;font-weight:700;margin-top:4px;color:${deltaColor}">${deltaSign}${fmt$(delta)}</div>
      </div>` : ''}
      <div class="card" style="padding:12px 18px;min-width:160px">
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Valued</div>
        <div style="font-size:22px;font-weight:700;margin-top:4px">${valued.length} / ${_cars.length}</div>
        <div style="font-size:10px;color:var(--text-muted)">cars</div>
      </div>`;
  }

  function _trendBadge(trend) {
    const cfg = {
      Appreciating: ['var(--green-dim)',  'var(--green)',  '↑'],
      Stable:       ['var(--blue-dim)',   'var(--blue)',   '→'],
      Depreciating: ['var(--orange-dim)', 'var(--orange)', '↓'],
    }[trend] || ['var(--elevated)', 'var(--text-muted)', '?'];
    return `<span class="badge" style="background:${cfg[0]};color:${cfg[1]}">${cfg[2]} ${escHtml(trend || 'Unknown')}</span>`;
  }

  function _card(car) {
    const v = _valuations[car.id];
    const isLoading = _loading.has(car.id);
    const delta  = v ? (v.avg - (car.value || 0)) : null;
    const deltaColor = delta === null ? '' : delta >= 0 ? 'var(--green)' : 'var(--red)';
    const deltaSign  = delta !== null && delta >= 0 ? '+' : '';

    const valBlock = v ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 4px">
        <div style="flex:1;min-width:70px;background:var(--elevated);border-radius:6px;padding:6px 10px;text-align:center">
          <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase">Low</div>
          <div style="font-size:13px;font-weight:700">${fmt$(v.low)}</div>
        </div>
        <div style="flex:1;min-width:70px;background:var(--surface);border:1px solid var(--accent);border-radius:6px;padding:6px 10px;text-align:center">
          <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase">Avg</div>
          <div style="font-size:15px;font-weight:700;color:var(--accent)">${fmt$(v.avg)}</div>
        </div>
        <div style="flex:1;min-width:70px;background:var(--elevated);border-radius:6px;padding:6px 10px;text-align:center">
          <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase">High</div>
          <div style="font-size:13px;font-weight:700">${fmt$(v.high)}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">
        ${_trendBadge(v.trend)}
        ${delta !== null ? `<span style="font-size:12px;font-weight:600;color:${deltaColor}">${deltaSign}${fmt$(delta)} vs stored</span>` : ''}
      </div>
      ${v.market_note ? `<div style="margin-top:8px;font-size:11px;color:var(--text-muted);font-style:italic">${escHtml(v.market_note)}</div>` : ''}
      <div style="margin-top:6px;font-size:10px;color:var(--text-muted)">Updated ${_relTime(v.fetched_at)}</div>` :
      `<div style="padding:16px 0;text-align:center;color:var(--text-muted);font-size:12px">No valuation yet</div>`;

    return `<div class="car-card" id="market-card-${car.id}">
      <div class="car-card-header">
        <div class="car-card-info">
          <div class="car-card-year">${escHtml(car.year)}</div>
          <div class="car-card-name">${escHtml(car.make)} ${escHtml(car.model)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:10px;color:var(--text-muted)">Stored</div>
          <div style="font-weight:700">${fmt$(car.value || 0)}</div>
        </div>
      </div>
      <div class="car-card-body">
        ${isLoading
          ? `<div style="padding:16px 0;text-align:center;color:var(--text-muted)">⟳ Fetching valuation…</div>`
          : valBlock}
      </div>
      <div class="car-card-footer">
        <button class="btn btn-secondary btn-sm" onclick="Market.refresh(${car.id})" ${isLoading ? 'disabled' : ''}>
          ${isLoading ? '…' : v ? '⟳ Refresh' : '⟳ Get Value'}
        </button>
      </div>
    </div>`;
  }

  function _renderGrid() {
    const grid = document.getElementById('market-grid');
    if (!grid) return;
    if (_cars.length === 0) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <div class="empty-state-icon">◈</div>
        <div class="empty-state-title">No cars in fleet</div>
        <div class="empty-state-sub">Add cars under Fleet to get market valuations</div>
      </div>`;
      return;
    }
    grid.innerHTML = _cars.map(c => _card(c)).join('');
  }

  async function refresh(carId) {
    _loading.add(carId);
    _renderGrid();
    try {
      const val = await API.post(`/api/market/${carId}`, {});
      _valuations[carId] = { ...val, ..._cars.find(c => c.id === carId) };
      // Re-fetch to get the joined row with car fields
      const vals = await API.get('/api/market');
      _valuations = {};
      vals.forEach(v => { _valuations[v.car_id] = v; });
    } catch (e) {
      Toast.show('Valuation failed — try again', 'error');
    } finally {
      _loading.delete(carId);
      render();
    }
  }

  async function refreshAll() {
    const btn = document.getElementById('market-refresh-all-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⟳ Running…'; }
    for (const car of _cars) {
      await refresh(car.id);
    }
    if (btn) { btn.disabled = false; btn.textContent = '⟳ Refresh All'; }
    Toast.show('All valuations updated');
  }

  function _relTime(iso) {
    if (!iso) return 'never';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)   return 'just now';
    if (mins < 60)  return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)   return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  return { load, render, refresh, refreshAll };
})();
