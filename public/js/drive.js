// Driving Conditions tab: the garage area by default, or any searched place.
// Traffic comes from TomTom and is cross-checked against Google (Routes API),
// with a live Google traffic map to compare by eye.
const Drive = (() => {
  const ICONS = { weather: '☁️', flooding: '🌊', heat: '🌡️', humidity: '💧', traffic: '🚗' };
  const WORD = { good: 'GOOD', fair: 'FAIR', poor: 'POOR' };
  const RECENT_KEY = 'drive-recent';

  let _cfg = null;
  let _garage = null;       // last good garage-area data
  let _place = null;        // null = garage; else { name, address, lat, lon }
  let _data = null;         // data currently on screen
  let _verify = null;       // garage corridor cross-check
  let _wx = null;           // weather cross-check for what's on screen
  let _timer = null;
  let _mapsP = null, _map = null, _marker = null;

  const time = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const errText = e => {
    let m = e?.message || 'network error';
    try { m = JSON.parse(m).error || m; } catch (_) {}
    if (/^\s*</.test(m)) m = 'server unavailable';
    if (m === 'Failed to fetch') m = 'no connection';
    return m.slice(0, 160);
  };
  const gmapsUrl = (lat, lon, z = 14) => `https://www.google.com/maps/@${lat},${lon},${z}z/data=!5m1!1e1`;

  function recent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (_) { return []; } }
  function remember(p) {
    try {
      const list = [p, ...recent().filter(r => r.name !== p.name)].slice(0, 5);
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch (_) {}
  }

  // ── Shared: verdict + five tiles (also used for the garage) ──
  function conditionsHtml(d, fetchError) {
    const t = time(d.updatedAt);
    const tiles = d.factors.map(f => `
      <div class="drive-tile lvl-${f.level}">
        <div class="drive-tile-top"><span>${ICONS[f.key] || ''} ${escHtml(f.label)}</span><span class="drive-pill">${WORD[f.level]}</span></div>
        <div class="drive-tile-value">${escHtml(f.value)}</div>
        ${f.corridors ? `<div class="drive-corridors">${f.corridors.map(c => `
          <div class="drive-corridor lvl-${c.level}"><span class="drive-dot"></span><span>${escHtml(c.name)}</span><span class="drive-corridor-mph">${c.speed} mph</span></div>`).join('')}</div>` : ''}
        <div class="drive-tile-detail">${escHtml(f.detail)}</div>
      </div>`).join('');
    const alerts = d.alerts.length ? `<div class="drive-alerts">⚠️ ${d.alerts.map(a => escHtml(a.event)).join(' · ')}</div>` : '';
    const next = d.nextUpdateAt ? time(d.nextUpdateAt) : null;
    const problems = [];
    if (fetchError) problems.push(`Couldn't reach the server (${fetchError}). Showing the last conditions from ${t}.`);
    else if (d.stale) problems.push(`Update failed${d.lastError ? ` (${d.lastError})` : ''}. Showing conditions from ${t}${next ? ` — trying again at ${next}` : ''}.`);
    for (const w of d.warnings || []) problems.push(w);
    const problemHtml = problems.length ? `<div class="drive-problem">⚠️ ${problems.map(escHtml).join('<br>⚠️ ')}
      <button type="button" class="btn btn-ghost btn-sm" onclick="Drive.reload()">Retry</button></div>` : '';
    return `
      <div class="drive-cond">
        <div class="drive-verdict lvl-${d.overall.level}">
          <div class="drive-kicker">DRIVING CONDITIONS · ${escHtml(String(d.place).toUpperCase())}</div>
          <div class="drive-headline">${escHtml(d.overall.headline)}</div>
          <div class="drive-detail">${escHtml(d.overall.detail)}</div>
          <div class="drive-collect ${d.collectables.ok ? 'ok' : 'no'}">${d.collectables.ok ? '⭐' : '🏠'} ${escHtml(d.collectables.text)}</div>
          <div class="drive-updated">Updated ${escHtml(t)}${next && !d.stale && !fetchError ? ` · next update ${escHtml(next)}` : ''}</div>
        </div>
        <div class="drive-tiles">${tiles}</div>
        ${alerts}${problemHtml}
      </div>`;
  }

  // ── Google cross-check panels ──
  const lvlCell = (x, extra = '') => x
    ? `<span class="drive-corridor lvl-${x.level}" style="display:inline-flex"><span class="drive-dot"></span>${x.flowPct}% of normal speed${extra}</span>`
    : '<span class="muted">—</span>';
  const verdictCell = r => r.agree === true ? `<span class="v-ok">✅ ${escHtml(r.text)}</span>`
    : r.agree === false ? `<span class="v-diff">⚠️ ${escHtml(r.text)}</span>` : `<span class="muted">${escHtml(r.text || '—')}</span>`;

  function verifyIntro() {
    return `<div class="drive-panel-note">“% of normal speed” = how fast traffic is moving compared with an empty road (100% = no delays).
      Both services time the same drive with and without today's traffic.</div>`;
  }

  function garageVerifyHtml() {
    if (!_cfg?.googleVerify) return notSetUp();
    if (!_verify) return `<div class="drive-panel-note">Checking with Google…</div>`;
    if (_verify.error) return `<div class="drive-problem">⚠️ Google check failed (${escHtml(_verify.error)}) <button type="button" class="btn btn-ghost btn-sm" onclick="Drive.reverify()">Retry</button></div>`;
    const agree = _verify.rows.filter(r => r.agree === true).length, compared = _verify.rows.filter(r => r.agree !== null).length;
    return `${verifyIntro()}
      <div class="drive-verify-sum ${agree === compared ? 'v-ok' : 'v-diff'}">${agree === compared ? '✅' : '⚠️'} Google agrees on ${agree} of ${compared} routes · checked ${escHtml(time(_verify.checkedAt))}</div>
      <div class="table-wrap"><table class="drive-table">
        <thead><tr><th>Route</th><th>TomTom</th><th>Google</th><th>Result</th></tr></thead>
        <tbody>${_verify.rows.map(r => `<tr>
          <td><strong>${escHtml(r.name)}</strong>${r.legs.map(l => `<div class="muted small">${escHtml(l.label)}</div>`).join('')}</td>
          <td>${lvlCell(r.tomtom)}${r.legs.map(l => `<div class="muted small">${l.tomtom.error ? '—' : `${l.tomtom.minutes} min (normally ${l.tomtom.normalMinutes})`}</div>`).join('')}</td>
          <td>${lvlCell(r.google)}${r.legs.map(l => `<div class="muted small">${l.google.error ? '—' : `${l.google.minutes} min (normally ${l.google.normalMinutes})`}</div>`).join('')}</td>
          <td>${verdictCell(r)}</td></tr>`).join('')}</tbody>
      </table></div>`;
  }

  function pointVerifyHtml(d) {
    const v = d.verify;
    if (!_cfg?.googleVerify) return notSetUp();
    if (!v) return `<div class="drive-panel-note">No live road reading here to cross-check.</div>`;
    if (!v.google) return `<div class="drive-problem">⚠️ ${escHtml(v.text)}</div>`;
    return `${verifyIntro()}
      <div class="table-wrap"><table class="drive-table">
        <thead><tr><th>Nearest road</th><th>TomTom</th><th>Google</th><th>Result</th></tr></thead>
        <tbody><tr><td>Drive time over this stretch</td>
          <td>${lvlCell(v.tomtom)}<div class="muted small">${v.tomtom.minutes} min (normally ${v.tomtom.normalMinutes})</div></td>
          <td>${lvlCell(v.google)}<div class="muted small">${v.google.minutes} min (normally ${v.google.normalMinutes})</div></td>
          <td>${verdictCell(v)}</td></tr></tbody>
      </table></div>`;
  }

  function notSetUp() {
    return `<div class="drive-panel-note">Automatic Google cross-check isn't switched on yet (needs <code>GOOGLE_MAPS_SERVER_KEY</code> in Render).
      Meanwhile, compare by eye with the live Google traffic map below.</div>`;
  }

  function incidentsHtml(d) {
    const t = d.factors.find(f => f.key === 'traffic'), list = t?.incidents;
    if (!list) return '';
    const closed = t.closures ? `<div class="drive-panel-note" style="margin:8px 0 0">Plus ${t.closures} street closure${t.closures > 1 ? 's' : ''} with no delay reported (roadwork, events).</div>` : '';
    if (!list.length) return `<div class="drive-panel"><div class="drive-panel-title">Slowdowns & accidents within 3 miles</div><div class="drive-panel-note" style="margin:0">None reported right now.</div>${closed}</div>`;
    return `<div class="drive-panel"><div class="drive-panel-title">Slowdowns & accidents within 3 miles · TomTom</div>
      ${list.map(i => `<div class="drive-incident sev-${Math.min(i.severity, 4)}">
        <strong>${escHtml(i.type)}</strong>${i.road ? ` · ${escHtml(i.road)}` : ''}${i.delayMin ? ` · +${i.delayMin} min` : ''}
        <div class="muted small">${escHtml([i.from && i.to ? `${i.from} → ${i.to}` : i.from || i.to, i.text].filter(Boolean).join(' · '))}</div>
      </div>`).join('')}${closed}</div>`;
  }

  // ── Weather: measured station vs forecast model vs Google ──
  const fmtV = (v, unit) => (v == null || v === '' ? '<span class="muted">—</span>' : `${escHtml(String(typeof v === 'number' ? Math.round(v) : v))}${unit}`);
  function wxHtml() {
    if (!_wx) return '<div class="drive-panel-note">Checking weather sources…</div>';
    if (_wx.error) return `<div class="drive-problem">⚠️ Weather check failed (${escHtml(_wx.error)}) <button type="button" class="btn btn-ghost btn-sm" onclick="Drive.loadWx()">Retry</button></div>`;
    const st = _wx.station;
    const gNote = _wx.googleError
      ? `<div class="drive-panel-note">Google Weather: ${escHtml(_wx.googleError)}${/not allowed/.test(_wx.googleError) ? ' — turn on “Weather API” in Google Cloud and allow it on your server key.' : ''}</div>` : '';
    return `
      <div class="drive-panel-note">${st
        ? `Measured at <strong>${escHtml(st.name)}</strong> (${escHtml(st.id)}), ${st.miles} mi away, ${st.ageMin} min ago ·
           <a href="${escHtml(st.url)}" target="_blank" rel="noopener">verify on weather.gov ↗</a>`
        : 'No weather station report nearby — the tiles are using the forecast model.'}</div>
      ${gNote}
      <div class="table-wrap"><table class="drive-table">
        <thead><tr><th>Reading</th><th>Station<br><span class="muted small">measured</span></th><th>Forecast<br><span class="muted small">model</span></th><th>Google</th><th>Result</th></tr></thead>
        <tbody>${_wx.rows.map(r => `<tr>
          <td><strong>${escHtml(r.label)}</strong></td>
          <td>${fmtV(r.station, r.unit)}</td><td>${fmtV(r.model, r.unit)}</td><td>${fmtV(r.google, r.unit)}</td>
          <td>${r.agree === true ? `<span class="v-ok">✅ ${escHtml(r.text)}</span>` : r.agree === false ? `<span class="v-diff">⚠️ ${escHtml(r.text)}</span>` : `<span class="muted">${escHtml(r.text)}</span>`}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
  }

  async function loadWx() {
    _wx = null;
    const el = () => document.getElementById('drive-wx');
    if (el()) el().innerHTML = wxHtml();
    try {
      _wx = await API.get(_place ? `/api/conditions/weather-check?lat=${_place.lat}&lon=${_place.lon}` : '/api/conditions/weather-check');
    } catch (e) { _wx = { error: errText(e) }; }
    if (el()) el().innerHTML = wxHtml();
  }

  // ── Flooding: NOAA tide gauge + alerts + rain ──
  function floodHtml(d) {
    const t = d.tide, tz = { hour: 'numeric', minute: '2-digit' };
    const floodAlerts = d.alerts.filter(a => /flood/i.test(a.event));
    const meter = ft => {
      // 0 ft below = at flood level; show up to 3 ft of headroom.
      const pctFull = Math.max(0, Math.min(100, 100 - (ft / 3) * 100));
      const lvl = ft <= 0 ? 'poor' : ft <= 0.3 ? 'fair' : 'good';
      return `<div class="drive-meter lvl-${lvl}"><span style="width:${pctFull}%"></span></div>`;
    };
    return `
      ${t ? `
        <div class="drive-flood-row"><div><strong>Water now</strong> · ${t.belowMinorFt > 0 ? `${t.belowMinorFt} ft below` : `${Math.abs(t.belowMinorFt)} ft above`} flood level</div>${meter(t.belowMinorFt)}</div>
        ${t.nextHigh ? `<div class="drive-flood-row"><div><strong>Next high tide</strong> ${escHtml(new Date(t.nextHigh.time).toLocaleTimeString([], tz))} · ${t.nextHigh.belowMinorFt > 0 ? `${t.nextHigh.belowMinorFt} ft below` : `${Math.abs(t.nextHigh.belowMinorFt)} ft above`} flood level</div>${meter(t.nextHigh.belowMinorFt)}</div>` : ''}
        <div class="drive-panel-note">NOAA tide gauge at <strong>${escHtml(t.name)}</strong>, ${t.miles} mi away, read ${escHtml(new Date(t.time).toLocaleTimeString([], tz))} ·
          <a href="${escHtml(t.url)}" target="_blank" rel="noopener">verify on NOAA ↗</a></div>`
      : '<div class="drive-panel-note">No tide gauge within 30 miles (inland) — flooding is judged from rain and official alerts.</div>'}
      <div class="drive-flood-row"><div><strong>Flood alerts</strong> · ${floodAlerts.length ? floodAlerts.map(a => escHtml(a.event)).join(', ') : 'none from the National Weather Service'}</div></div>
      ${d.rain ? `<div class="drive-flood-row"><div><strong>Rain</strong> · ${d.rain.chance3h}% chance next 3h · ${d.rain.next6In}" expected next 6h${d.station?.rainLastHourIn ? ` · ${d.station.rainLastHourIn}" fell last hour` : ''}</div></div>` : ''}`;
  }

  // ── Google map with live traffic ──
  function loadMaps(key) {
    if (window.google?.maps?.Map) return Promise.resolve();
    if (_mapsP) return _mapsP;
    _mapsP = new Promise((resolve, reject) => {
      window.__sfefMapsReady = resolve;
      window.gm_authFailure = () => {
        const el = document.getElementById('drive-map');
        if (el) el.innerHTML = `<div class="drive-map-msg">⚠️ Google rejected the map key (check GOOGLE_MAPS_BROWSER_KEY and its website restriction).</div>`;
      };
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__sfefMapsReady&loading=async`;
      s.async = true;
      s.onerror = () => { _mapsP = null; reject(new Error('Google Maps failed to load')); };
      document.head.appendChild(s);
    });
    return _mapsP;
  }

  const DARK = [
    { elementType: 'geometry', stylers: [{ color: '#0b1820' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#7fa6b8' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#05090c' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1c2f3a' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#04263a' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  ];

  async function showMap(lat, lon, zoom) {
    const el = document.getElementById('drive-map');
    if (!el) return;
    if (!_cfg?.mapsKey) {
      el.innerHTML = `<div class="drive-map-msg">The live Google traffic map appears here once <code>GOOGLE_MAPS_BROWSER_KEY</code> is added in Render.<br>
        <a href="${gmapsUrl(lat, lon)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="margin-top:10px">Open live traffic in Google Maps ↗</a></div>`;
      return;
    }
    try {
      await loadMaps(_cfg.mapsKey);
      const center = { lat, lng: lon };
      _map = new google.maps.Map(el, { center, zoom, styles: DARK, disableDefaultUI: true, zoomControl: true, fullscreenControl: true });
      new google.maps.TrafficLayer().setMap(_map);
      _marker = new google.maps.Marker({ position: center, map: _map });
    } catch (e) {
      el.innerHTML = `<div class="drive-map-msg">⚠️ ${escHtml(e.message)}. <a href="${gmapsUrl(lat, lon)}" target="_blank" rel="noopener">Open in Google Maps ↗</a></div>`;
    }
  }

  // ── Page ──
  function shell() {
    const rec = recent();
    return `
      <form class="drive-search" onsubmit="event.preventDefault(); Drive.search()">
        <input type="search" id="drive-q" placeholder="Search a place or address" autocomplete="off" enterkeyhint="search">
        <button type="submit" class="btn btn-primary">Search</button>
      </form>
      <div class="drive-chips">
        <button type="button" class="drive-chip ${_place ? '' : 'active'}" onclick="Drive.garage()">🏠 Garage area</button>
        ${rec.map((r, i) => `<button type="button" class="drive-chip ${_place?.name === r.name ? 'active' : ''}" onclick="Drive.pickRecent(${i})">${escHtml(r.name)}</button>`).join('')}
      </div>
      <div id="drive-results"></div>
      <div id="drive-body"></div>`;
  }

  function render(fetchError) {
    const body = document.getElementById('drive-body');
    if (!body || !_data) return;
    const d = _data;
    const lat = _place ? _place.lat : _cfg?.garage?.lat, lon = _place ? _place.lon : _cfg?.garage?.lon;
    body.innerHTML = `
      ${_place ? `<div class="drive-place"><strong>${escHtml(_place.name)}</strong>${_place.address && _place.address !== _place.name ? ` · <span class="muted">${escHtml(_place.address)}</span>` : ''}</div>` : ''}
      ${conditionsHtml(d, fetchError)}
      <div class="drive-grid">
        <div class="drive-panel">
          <div class="drive-panel-title">Traffic check · TomTom vs Google</div>
          <div id="drive-verify">${_place ? pointVerifyHtml(d) : garageVerifyHtml()}</div>
        </div>
        <div class="drive-panel drive-map-panel">
          <div class="drive-panel-title">Live traffic · Google Maps
            <a href="${gmapsUrl(lat, lon)}" target="_blank" rel="noopener" class="drive-panel-link">Open ↗</a></div>
          <div id="drive-map" class="drive-map"></div>
        </div>
      </div>
      <div class="drive-grid">
        <div class="drive-panel">
          <div class="drive-panel-title">Weather check · measured vs forecast vs Google</div>
          <div id="drive-wx">${wxHtml()}</div>
        </div>
        <div class="drive-panel">
          <div class="drive-panel-title">Flooding · tide, alerts & rain</div>
          ${floodHtml(d)}
        </div>
      </div>
      ${incidentsHtml(d)}`;
    if (lat != null) showMap(lat, lon, _place ? 13 : 11);
  }

  async function fetchCurrent() {
    return _place
      ? API.get(`/api/conditions/at?lat=${_place.lat}&lon=${_place.lon}&name=${encodeURIComponent(_place.name)}`)
      : API.get('/api/conditions');
  }

  async function reload() {
    const body = document.getElementById('drive-body');
    if (!body) return;
    if (!_data) body.innerHTML = `<div class="drive-cond-loading">Checking conditions${_place ? ` at ${escHtml(_place.name)}` : ''}…</div>`;
    try {
      _data = await fetchCurrent();
      if (!_place) _garage = _data;
      render();
      if (!_place && _cfg?.googleVerify) reverify(true);
      loadWx();
    } catch (e) {
      if (_data) render(errText(e));
      else body.innerHTML = `<div class="drive-cond-loading drive-cond-error">⚠️ ${escHtml(errText(e))}
        <button type="button" class="btn btn-ghost btn-sm" onclick="Drive.reload()">Retry</button></div>`;
    }
    schedule();
  }

  // Garage data refreshes on the server every 15 min; a searched place every 10.
  function schedule() {
    clearTimeout(_timer);
    _timer = setTimeout(() => {
      if (App.currentSection === 'drive' && document.visibilityState === 'visible') reload();
      else _timer = null;
    }, (_place ? 10 : 5) * 60 * 1000);
  }

  async function reverify(quiet) {
    if (!quiet) { _verify = null; const v = document.getElementById('drive-verify'); if (v) v.innerHTML = garageVerifyHtml(); }
    try {
      const r = await API.get('/api/conditions/verify');
      _verify = r.disabled ? null : r;
    } catch (e) { _verify = { error: errText(e) }; }
    const v = document.getElementById('drive-verify');
    if (v && !_place) v.innerHTML = garageVerifyHtml();
  }

  async function search() {
    const q = document.getElementById('drive-q').value.trim();
    const out = document.getElementById('drive-results');
    if (q.length < 2) { out.innerHTML = '<div class="drive-panel-note">Type a place or address.</div>'; return; }
    out.innerHTML = '<div class="drive-panel-note">Searching…</div>';
    try {
      const results = await API.get(`/api/conditions/search?q=${encodeURIComponent(q)}`);
      if (!results.length) { out.innerHTML = `<div class="drive-panel-note">No places found for “${escHtml(q)}”.</div>`; return; }
      if (results.length === 1) { out.innerHTML = ''; return select(results[0]); }
      Drive._results = results;
      out.innerHTML = `<div class="drive-results">${results.map((r, i) => `
        <button type="button" class="drive-result" onclick="Drive.pick(${i})"><strong>${escHtml(r.name)}</strong>
        ${r.address && r.address !== r.name ? `<span class="muted">${escHtml(r.address)}</span>` : ''}</button>`).join('')}</div>`;
    } catch (e) {
      out.innerHTML = `<div class="drive-problem">⚠️ ${escHtml(errText(e))}</div>`;
    }
  }

  function select(p) {
    _place = { name: p.name, address: p.address, lat: p.lat, lon: p.lon };
    remember(_place);
    _data = null;
    document.getElementById('section-drive-content').innerHTML = shell();
    reload();
  }

  function garage() {
    _place = null;
    _data = _garage;
    document.getElementById('section-drive-content').innerHTML = shell();
    if (_data) render();
    reload();
  }

  async function load() {
    const el = document.getElementById('section-drive-content');
    if (!el) return;
    if (!_cfg) { try { _cfg = await API.get('/api/conditions/config'); } catch (_) { _cfg = {}; } }
    el.innerHTML = shell();
    _data = _place ? null : _garage;
    if (_data) render();
    reload();
  }

  // ── Slim bar on the Dashboard ──
  async function summaryBar() {
    const el = document.getElementById('drive-summary');
    if (!el) return;
    try {
      const d = await API.get('/api/conditions');
      _garage = d;
      const traffic = d.factors.find(f => f.key === 'traffic'), heat = d.factors.find(f => f.key === 'heat');
      const problem = d.stale || (d.warnings || []).length;
      el.className = `drive-summary lvl-${d.overall.level}`;
      el.innerHTML = `<span class="drive-dot"></span>
        <strong>${escHtml(d.overall.headline)}</strong>
        <span class="drive-summary-bits">Traffic: ${escHtml(traffic.value)} · ${escHtml(heat.value.split(' · ')[0])} · ${d.collectables.ok ? '⭐ Collectables OK' : '🏠 Collectables in'}</span>
        ${problem ? '<span class="drive-summary-warn">⚠️ update problem</span>' : ''}
        <span class="drive-summary-go">${escHtml(time(d.updatedAt))} ›</span>`;
    } catch (e) {
      el.className = 'drive-summary drive-cond-error';
      el.innerHTML = `⚠️ Driving conditions unavailable (${escHtml(errText(e))}) <span class="drive-summary-go">›</span>`;
    }
  }

  return {
    load, reload, reverify, loadWx, search, garage, summaryBar,
    pick: i => { document.getElementById('drive-results').innerHTML = ''; select(Drive._results[i]); },
    pickRecent: i => select(recent()[i]),
    _results: [],
  };
})();
