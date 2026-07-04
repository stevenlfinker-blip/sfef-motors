const Weather = (() => {
  let _marinas = [];
  let _vessels = [];

  function _errMsg(e) {
    try { return JSON.parse(e.message).error || e.message; } catch (_) { return e.message; }
  }

  async function load() {
    try {
      [_marinas, _vessels] = await Promise.all([
        API.get('/api/marinas').catch(() => []),
        API.get('/api/vessels').catch(() => []),
      ]);
      populateSelects();
    } catch (e) { /* selects just stay empty */ }
  }

  function populateSelects() {
    const marinaSel = document.getElementById('weather-marina-select');
    marinaSel.innerHTML = '<option value="">— Choose a marina —</option>' +
      _marinas.filter(m => m.lat != null).map(m => `<option value="${m.id}">${escHtml(m.name)}</option>`).join('');
    const vesselSel = document.getElementById('weather-vessel-select');
    vesselSel.innerHTML = '<option value="">— Or a vessel\'s last position —</option>' +
      _vessels.filter(v => v.last_position).map(v => `<option value="${v.id}">${escHtml(v.name)}</option>`).join('');
  }

  function selectMarina() {
    const id = parseInt(document.getElementById('weather-marina-select').value);
    const m = _marinas.find(x => x.id === id);
    if (m) selectLocation(m.lat, m.lon, m.name);
  }

  function selectVessel() {
    const id = parseInt(document.getElementById('weather-vessel-select').value);
    const v = _vessels.find(x => x.id === id);
    if (v && v.last_position) selectLocation(v.last_position.lat, v.last_position.lon, v.name);
  }

  function selectLocation(lat, lon, label) {
    document.getElementById('weather-lat').value = lat;
    document.getElementById('weather-lon').value = lon;
    document.getElementById('weather-location-label').textContent = label ? `Selected: ${label}` : '';
    fetchForecast();
  }

  async function fetchForecast() {
    const lat = parseFloat(document.getElementById('weather-lat').value);
    const lon = parseFloat(document.getElementById('weather-lon').value);
    const content = document.getElementById('weather-content');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { Toast.show('Enter a valid latitude and longitude', 'error'); return; }
    content.innerHTML = '<div style="color:var(--text-muted);padding:20px 0">Loading forecast…</div>';
    try {
      const data = await API.get(`/api/weather/forecast?lat=${lat}&lon=${lon}`);
      renderForecast(data);
    } catch (e) {
      content.innerHTML = `<div style="color:var(--red);padding:20px 0">Failed to load forecast: ${escHtml(_errMsg(e))}</div>`;
    }
  }

  function renderForecast(data) {
    const content = document.getElementById('weather-content');
    if (!data.periods || !data.periods.length) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state-title">No forecast data</div></div>`;
      return;
    }
    const cards = data.periods.map(p => `
      <div class="weather-card">
        <div class="weather-card-name">${escHtml(p.name)}</div>
        <div class="weather-card-temp">${p.temperature}°${escHtml(p.temperatureUnit)}</div>
        <div class="weather-card-wind">💨 ${escHtml(p.windSpeed)} ${escHtml(p.windDirection)}</div>
        <div class="weather-card-desc">${escHtml(p.shortForecast)}</div>
      </div>`).join('');
    content.innerHTML = `<div class="weather-scroll">${cards}</div>`;
  }

  return { load, selectMarina, selectVessel, selectLocation, fetchForecast };
})();
