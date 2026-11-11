// Real-time weather sources, all free:
//  • National Weather Service station observations — measured temperature,
//    humidity, dew point, heat index, wind and rain (stations report ~hourly,
//    often every 20 min). The nearest station is found via api.weather.gov.
//  • NOAA tide gauges — measured water level every 6 minutes, compared with
//    NOAA's official minor-flood level, plus the next high tide.
//  • Google Weather API (GOOGLE_MAPS_SERVER_KEY with the Weather API enabled)
//    — a third opinion used only to cross-check.
const google = require('./google-traffic');

const UA = { 'User-Agent': 'SFEF-Motors garage dashboard', Accept: 'application/geo+json' };
const DAY = 24 * 60 * 60 * 1000;

async function getJson(url, headers = UA) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}

const cToF = c => (c == null ? null : c * 9 / 5 + 32);
const kmhToMph = k => (k == null ? null : k / 1.609);
const mmToIn = m => (m == null ? null : m / 25.4);
const val = q => (q && q.value != null ? q.value : null);
const round1 = n => (n == null ? null : Math.round(n * 10) / 10);

// ── NWS station observations ──
const _stations = new Map(); // "lat,lon" (0.1°) → { at, list: [{ id, name, lat, lon }] }
async function stationsNear(lat, lon) {
  const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
  const hit = _stations.get(key);
  if (hit && Date.now() - hit.at < DAY) return hit.list;
  const pt = (await getJson(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`)).properties;
  const st = await getJson(`${pt.observationStations}?limit=4`);
  const list = st.features.map(f => ({
    id: f.properties.stationIdentifier, name: f.properties.name,
    lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
  }));
  _stations.set(key, { at: Date.now(), list });
  return list;
}

function milesBetween(a, b) {
  const dLat = (b.lat - a.lat) * 69, dLon = (b.lon - a.lon) * 69 * Math.cos(a.lat * Math.PI / 180);
  return Math.round(Math.hypot(dLat, dLon));
}

// Latest measured conditions from the nearest station that has a fresh report.
async function observation(lat, lon) {
  const list = await stationsNear(lat, lon);
  for (const s of list) {
    try {
      const o = (await getJson(`https://api.weather.gov/stations/${s.id}/observations/latest`)).properties;
      const ageMin = Math.round((Date.now() - new Date(o.timestamp)) / 60000);
      const tempF = cToF(val(o.temperature));
      if (tempF == null || ageMin > 120) continue; // stale or broken — try the next station
      const heat = cToF(val(o.heatIndex)), chill = cToF(val(o.windChill));
      return {
        station: s.id, name: s.name.replace(/^Miami, /, ''), miles: milesBetween({ lat, lon }, s),
        time: o.timestamp, ageMin,
        tempF: round1(tempF),
        feelsF: round1(heat ?? chill ?? tempF),
        dewF: round1(cToF(val(o.dewpoint))),
        humidity: val(o.relativeHumidity) == null ? null : Math.round(val(o.relativeHumidity)),
        windMph: round1(kmhToMph(val(o.windSpeed))),
        gustMph: round1(kmhToMph(val(o.windGust))),
        rainLastHourIn: round1(mmToIn(val(o.precipitationLastHour))),
        text: o.textDescription || '',
        url: `https://www.weather.gov/wrh/timeseries?site=${s.id}`,
      };
    } catch (_) { /* try the next station */ }
  }
  throw new Error('no recent station report nearby');
}

// ── NOAA tide gauges (coastal flooding) ──
let _tideStations = null; // { at, list }
async function tideStationNear(lat, lon) {
  if (!_tideStations || Date.now() - _tideStations.at > 7 * DAY) {
    const md = await getJson('https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels', {});
    _tideStations = { at: Date.now(), list: md.stations.map(s => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lng })) };
  }
  const near = _tideStations.list
    .map(s => ({ ...s, miles: milesBetween({ lat, lon }, s) }))
    .sort((a, b) => a.miles - b.miles)[0];
  return near && near.miles <= 30 ? near : null;
}

const _floodLevels = new Map();
async function tide(lat, lon) {
  const s = await tideStationNear(lat, lon);
  if (!s) return null; // inland — no gauge close enough to matter
  if (!_floodLevels.has(s.id)) {
    _floodLevels.set(s.id, await getJson(`https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/${s.id}/floodlevels.json`, {}));
  }
  const fl = _floodLevels.get(s.id);
  const minor = fl.nws_minor ?? fl.nos_minor, moderate = fl.nws_moderate ?? fl.nos_moderate;
  if (minor == null) return null;
  // Water level and flood levels on the same reference (station datum).
  const base = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?application=SFEF-Motors&format=json&units=english&time_zone=gmt&datum=STND';
  const [wl, hl] = await Promise.all([
    getJson(`${base}&station=${s.id}&product=water_level&date=latest`, {}),
    getJson(`${base}&station=${s.id}&product=predictions&interval=hilo&range=30&begin_date=${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`, {}),
  ]);
  const now = wl.data?.[0];
  if (!now) throw new Error('tide gauge has no recent reading');
  const level = Number(now.v);
  const nextHigh = (hl.predictions || [])
    .filter(p => p.type === 'H' && new Date(p.t.replace(' ', 'T') + 'Z') > Date.now())
    .map(p => ({ time: new Date(p.t.replace(' ', 'T') + 'Z').toISOString(), level: Number(p.v) }))[0] || null;
  return {
    station: s.id, name: s.name, miles: s.miles,
    time: new Date(now.t.replace(' ', 'T') + 'Z').toISOString(),
    belowMinorFt: Math.round((minor - level) * 10) / 10,          // positive = below flood level
    nextHigh: nextHigh && { time: nextHigh.time, belowMinorFt: Math.round((minor - nextHigh.level) * 10) / 10 },
    aboveModerate: moderate != null && level >= moderate,
    url: `https://tidesandcurrents.noaa.gov/stationhome.html?id=${s.id}`,
  };
}

// ── Google Weather (cross-check only) ──
async function googleWeather(lat, lon) {
  if (!google.enabled()) throw new Error('Google not set up');
  google.take();
  const qs = new URLSearchParams({
    key: process.env.GOOGLE_MAPS_SERVER_KEY.trim(), 'location.latitude': lat, 'location.longitude': lon, unitsSystem: 'IMPERIAL',
  });
  const r = await fetch(`https://weather.googleapis.com/v1/currentConditions:lookup?${qs}`, { signal: AbortSignal.timeout(8000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const why = d.error?.status === 'PERMISSION_DENIED' ? 'Weather API not enabled on the Google key' : `Google ${r.status}`;
    throw new Error(why);
  }
  return {
    time: d.currentTime,
    tempF: round1(d.temperature?.degrees),
    feelsF: round1(d.feelsLikeTemperature?.degrees),
    dewF: round1(d.dewPoint?.degrees),
    humidity: d.relativeHumidity ?? null,
    windMph: round1(d.wind?.speed?.value),
    gustMph: round1(d.wind?.gust?.value),
    rainChance: d.precipitation?.probability?.percent ?? null,
    text: d.weatherCondition?.description?.text || '',
  };
}

module.exports = { observation, tide, googleWeather };
