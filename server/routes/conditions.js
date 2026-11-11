// Driving conditions: weather, flooding, heat, humidity and traffic, rolled
// up into one verdict — for the garage area (refreshed every 15 min) and for
// any place searched in the Driving Conditions tab.
//
// Sources: Open-Meteo forecast and National Weather Service alerts (free, no
// key); TomTom live traffic, incidents and place search (TOMTOM_API_KEY); and
// Google's Routes API to cross-check TomTom's traffic (GOOGLE_MAPS_SERVER_KEY).
// For the garage only rounded coordinates go out, never the street address.
const express = require('express');
const router = express.Router();
const google = require('../google-traffic');

const LAT = Number(process.env.GARAGE_LAT || 25.9);
const LON = Number(process.env.GARAGE_LON || -80.17);
const PLACE = process.env.GARAGE_PLACE || 'North Miami';
const TZ = 'America/New_York';
const REFRESH_MS = 15 * 60 * 1000; // 20 TomTom calls each → ~1,900/day
const RETRY_MS = 5 * 60 * 1000;     // after a failed update
const STALE_MS = 20 * 60 * 1000;    // older than this = flagged out of date
const TOMTOM_DAILY_CAP = Number(process.env.TOMTOM_DAILY_CAP || 2450); // free tier: 2,500/day
const SEARCH_TTL = 10 * 60 * 1000;
const VERIFY_TTL = 15 * 60 * 1000;

// Live traffic check points (~25 mile area), grouped into corridors.
// Positions come from OpenStreetMap road geometry (2026-11-11); the I-95 point
// at 125th St was also confirmed on Google Maps' traffic layer. I-95 is
// sampled in both directions — northbound lanes sit on the east side, so each
// point is nudged ~15 m outward to make TomTom snap to the right carriageway.
// `google` lists the stretch(es) Google drives to cross-check each corridor.
const NB = 0.00015, SB = -0.00015;
const CORRIDORS = [
  { name: 'I-95', points: [
    ['Downtown NB', 25.78993, -80.20423 + NB], ['Downtown SB', 25.79005, -80.20485 + SB],
    ['125th St NB', 25.89046, -80.20918 + NB], ['125th St SB', 25.89067, -80.20953 + SB],
    ['Aventura NB', 25.97902, -80.16585 + NB], ['Aventura SB', 25.97895, -80.16620 + SB],
    ['Hollywood NB', 26.08030, -80.16856 + NB], ['Hollywood SB', 26.07954, -80.16907 + SB],
    ['Ft Lauderdale NB', 26.19098, -80.15158 + NB], ['Ft Lauderdale SB', 26.19099, -80.15194 + SB],
  ], google: [
    ['Downtown → Aventura (NB)', [25.78993, -80.20423 + NB], [25.97902, -80.16585 + NB]],
    ['Aventura → Downtown (SB)', [25.97895, -80.16620 + SB], [25.79005, -80.20485 + SB]],
  ] },
  { name: 'Collins Ave', points: [
    ['Mid-Beach', 25.81495, -80.12272], ['Surfside', 25.87805, -80.12185],
    ['Bal Harbour', 25.88940, -80.12390], ['Haulover', 25.90498, -80.12321],
    ['Sunny Isles', 25.93508, -80.12162],
  ], google: [['Mid-Beach → Sunny Isles', [25.81495, -80.12272], [25.93508, -80.12162]]] },
  { name: '163rd St', points: [['163rd St EB', 25.92582, -80.16502], ['Sunny Isles Blvd WB', 25.92651, -80.13982]],
    google: [['163rd St → Sunny Isles Blvd', [25.92582, -80.16502], [25.92629, -80.14014]]] },
  { name: 'Bay Harbor', points: [['Broad Causeway', 25.88820, -80.14497]],
    google: [['Broad Causeway', [25.88936, -80.15120], [25.88657, -80.13917]]] },
  { name: 'Local', points: [['NE 125th St', 25.890, -80.189], ['Biscayne Blvd', 25.8905, -80.1635]],
    google: [['NE 125th St → Biscayne Blvd', [25.890, -80.189], [25.8905, -80.1635]]] },
];

let _cache = null; // { at, data } for the garage
let _lastError = null, _nextAt = null, _inflight = null;
let _verify = null; // { at, data } Google cross-check of the garage corridors
const _searchCache = new Map(); // "lat,lon" → { at, data }

const RANK = { good: 0, fair: 1, poor: 2 };
const worst = (...lv) => lv.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'good');

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}

// Every TomTom call goes through here so the free daily allowance is never
// exceeded; searches are refused (with a message) before that happens.
let _ttDay = '', _ttUsed = 0;
function tomtomUsage() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== _ttDay) { _ttDay = today; _ttUsed = 0; }
  return { used: _ttUsed, cap: TOMTOM_DAILY_CAP };
}
function tomtom(path, params = {}) {
  const key = (process.env.TOMTOM_API_KEY || '').trim();
  if (!key) return Promise.reject(new Error('TomTom not set up'));
  if (tomtomUsage().used >= TOMTOM_DAILY_CAP) return Promise.reject(new Error('daily TomTom limit reached'));
  _ttUsed++;
  const qs = new URLSearchParams({ ...params, key });
  return getJson(`https://api.tomtom.com${path}?${qs}`);
}

function weatherText(code) {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code === 61 || code === 80) return 'Light rain';
  if (code === 63 || code === 81) return 'Rain';
  if (code === 65 || code === 82 || code === 66 || code === 67) return 'Heavy rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 95) return 'Thunderstorms';
  return 'Mixed';
}
const isRain = c => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;

function rateWeather(cur, hourly, alerts) {
  const code = cur.weather_code;
  const next3 = hourly.precipitation_probability.slice(0, 3);
  const rainChance = Math.max(0, ...next3);
  const stormSoon = hourly.weather_code.slice(0, 3).some(c => c >= 95);
  const tropical = alerts.find(a => /hurricane|tropical storm|tornado|severe thunderstorm/i.test(a.event));
  let level = 'good';
  if (tropical || code >= 95 || code === 65 || code === 82 || (stormSoon && rainChance >= 50)) level = 'poor';
  else if (isRain(code) || code === 45 || code === 48 || rainChance >= 40 || cur.wind_gusts_10m >= 30) level = 'fair';
  if (cur.wind_gusts_10m >= 45) level = 'poor';
  const bits = [`${rainChance}% rain chance next 3h`];
  if (cur.wind_gusts_10m >= 25) bits.push(`gusts ${Math.round(cur.wind_gusts_10m)} mph`);
  if (tropical) bits.unshift(tropical.event);
  return { key: 'weather', label: 'Weather', level, value: weatherText(code), detail: bits.join(' · ') };
}

function rateFlooding(cur, hourly, alerts) {
  const flood = alerts.filter(a => /flood/i.test(a.event));
  const warn = flood.find(a => /warning/i.test(a.event));
  const next6 = hourly.precipitation.slice(0, 6).reduce((s, v) => s + (v || 0), 0);
  let level = 'good', value = 'No flood alerts', detail = 'Roads should be clear';
  if (warn) { level = 'poor'; value = warn.event; detail = 'Avoid low-lying streets'; }
  else if (flood.length) { level = 'fair'; value = flood[0].event; detail = 'Watch for standing water'; }
  else if (cur.precipitation >= 0.25 || next6 >= 1) {
    level = 'fair'; value = 'Street flooding possible';
    detail = `${next6.toFixed(1)}" rain expected next 6h`;
  } else if (next6 >= 0.3) {
    detail = `${next6.toFixed(1)}" rain expected next 6h`;
  }
  return { key: 'flooding', label: 'Flooding', level, value, detail };
}

function rateHeat(cur, alerts) {
  const feels = Math.round(cur.apparent_temperature);
  const heatAlert = alerts.find(a => /heat/i.test(a.event));
  let level = 'good';
  if (feels >= 105 || (heatAlert && /warning/i.test(heatAlert.event))) level = 'poor';
  else if (feels >= 95 || heatAlert || cur.temperature_2m < 45) level = 'fair';
  const detail = heatAlert ? heatAlert.event
    : feels >= 95 ? 'Hard on engines, tires and people'
    : cur.temperature_2m < 45 ? 'Cold — let the engine warm up' : 'Comfortable';
  return { key: 'heat', label: 'Heat', level, value: `${Math.round(cur.temperature_2m)}°F · feels ${feels}°`, detail };
}

function rateHumidity(cur) {
  const dew = Math.round(cur.dew_point_2m);
  const level = dew >= 75 ? 'poor' : dew >= 69 ? 'fair' : 'good';
  const detail = level === 'poor' ? 'Muggy — windows fog, A/C works hard'
    : level === 'fair' ? 'Sticky' : 'Dry and comfortable';
  return { key: 'humidity', label: 'Humidity', level, value: `${Math.round(cur.relative_humidity_2m)}% · dew pt ${dew}°`, detail };
}

// No TomTom key: typical Miami weekday rush hours.
function estimateTraffic(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]));
  const t = Number(parts.hour) + Number(parts.minute) / 60;
  const weekend = parts.weekday === 'Sat' || parts.weekday === 'Sun';
  // Checked against Google Maps live traffic: Miami daytime is rarely truly
  // light, so anything between 6am and 8pm counts as at least moderate.
  let level = 'good', value = 'Likely light';
  if (!weekend && ((t >= 7 && t < 9) || (t >= 16.5 && t < 18.5))) { level = 'poor'; value = 'Likely rush hour'; }
  else if (t >= 6 && t < 20) { level = 'fair'; value = 'Likely moderate'; }
  return { key: 'traffic', label: 'Traffic', level, value, detail: 'Estimate by time of day — not live', live: false };
}

const trafficLevel = r => (r >= 0.8 ? 'good' : r >= 0.55 ? 'fair' : 'poor');

async function flowAt(lat, lon) {
  const d = await tomtom('/traffic/services/4/flowSegmentData/absolute/10/json', { point: `${lat},${lon}`, unit: 'MPH' });
  const f = d.flowSegmentData;
  const coords = (f.coordinates?.coordinate || []).map(c => [c.latitude, c.longitude]);
  return {
    ratio: f.roadClosure ? 0 : Math.min(1, f.currentSpeed / f.freeFlowSpeed),
    speed: f.currentSpeed, free: f.freeFlowSpeed, closed: !!f.roadClosure,
    travel: f.currentTravelTime, freeTravel: f.freeFlowTravelTime, coords,
  };
}

async function corridorTraffic() {
  // 17 points per refresh; a few at a time to stay polite with the free tier.
  const jobs = CORRIDORS.flatMap(c => c.points.map(([label, lat, lon]) => ({ corridor: c.name, label, lat, lon })));
  const results = [];
  for (let i = 0; i < jobs.length; i += 5) {
    results.push(...await Promise.all(jobs.slice(i, i + 5).map(j =>
      flowAt(j.lat, j.lon).then(r => ({ ...j, ...r })).catch(e => ({ ...j, error: e.message })))));
  }
  const ok = results.filter(r => !r.error);
  if (ok.length < jobs.length / 2) throw new Error(results.find(r => r.error)?.error || 'no data');

  const corridors = CORRIDORS.map(c => {
    const pts = ok.filter(r => r.corridor === c.name);
    if (!pts.length) return null;
    const ratio = pts.reduce((s, p) => s + p.ratio, 0) / pts.length;
    const speed = Math.round(pts.reduce((s, p) => s + p.speed, 0) / pts.length);
    const slowest = pts.reduce((a, b) => (b.ratio < a.ratio ? b : a));
    return { name: c.name, level: trafficLevel(ratio), ratio: Math.round(ratio * 100) / 100, speed,
      slowest: slowest.ratio < 0.55 ? `${slowest.label} ${Math.round(slowest.speed)} mph` : null };
  }).filter(Boolean);

  // Every corridor counts equally, so 10 I-95 points don't drown out Collins.
  const avg = corridors.reduce((s, c) => s + c.ratio, 0) / corridors.length;
  let level = trafficLevel(avg);
  if (level === 'good' && corridors.some(c => c.level === 'poor')) level = 'fair';
  const value = level === 'good' ? 'Flowing' : level === 'fair' ? 'Slow in spots' : 'Heavy';
  const jams = corridors.filter(c => c.slowest).map(c => c.slowest);
  const detail = (jams.length ? `Slowest: ${jams.slice(0, 2).join(', ')}` : 'No major slowdowns') + ' · TomTom';
  const missing = results.length - ok.length;
  return { key: 'traffic', label: 'Traffic', level, value, detail, live: true, corridors,
    warning: missing ? `${missing} of ${results.length} traffic check points didn't respond` : null };
}

// TomTom incidents (accidents, closures, jams, roadwork) in a box around a point.
const INCIDENT_TYPES = { 1: 'Accident', 2: 'Fog', 3: 'Dangerous conditions', 4: 'Rain', 5: 'Ice', 6: 'Traffic jam',
  7: 'Lane closed', 8: 'Road closed', 9: 'Road work', 10: 'Wind', 11: 'Flooding', 14: 'Broken-down vehicle' };
async function incidentsNear(lat, lon, km = 5) {
  const dLat = km / 111, dLon = km / (111 * Math.cos(lat * Math.PI / 180));
  const d = await tomtom('/traffic/services/5/incidentDetails', {
    bbox: [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map(n => n.toFixed(5)).join(','),
    fields: '{incidents{type,properties{iconCategory,magnitudeOfDelay,events{description},from,to,delay,roadNumbers}}}',
    language: 'en-US', timeValidityFilter: 'present',
  });
  return (d.incidents || []).map(i => {
    const p = i.properties || {};
    return {
      type: INCIDENT_TYPES[p.iconCategory] || 'Incident',
      severity: p.magnitudeOfDelay || 0, // 0 unknown · 1 minor · 2 moderate · 3 major · 4 closed
      road: (p.roadNumbers || []).join(', ') || null,
      from: p.from || null, to: p.to || null,
      delayMin: p.delay ? Math.round(p.delay / 60) : 0,
      text: p.events?.[0]?.description || null,
    };
  }).sort((a, b) => b.severity - a.severity || b.delayMin - a.delayMin);
}

// Traffic at a searched place: the nearest road's live speed, plus incidents nearby.
async function pointTraffic(lat, lon, warnings) {
  const [flow, incidents] = await Promise.all([
    flowAt(lat, lon),
    incidentsNear(lat, lon).catch(e => { warnings.push(`Traffic incidents unavailable (${e.message})`); return []; }),
  ]);
  let level = trafficLevel(flow.ratio);
  const serious = incidents.filter(i => i.severity >= 3 || i.type === 'Road closed' || i.type === 'Accident');
  if (level === 'good' && serious.length) level = 'fair';
  const value = flow.closed ? 'Road closed' : level === 'good' ? 'Flowing' : level === 'fair' ? 'Slow' : 'Heavy';
  const detail = `Nearest road ${Math.round(flow.speed)} mph (usually ${Math.round(flow.free)})`
    + (incidents.length ? ` · ${incidents.length} incident${incidents.length > 1 ? 's' : ''} within 3 mi` : '') + ' · TomTom';
  return { key: 'traffic', label: 'Traffic', level, value, detail, live: true, flow, incidents: incidents.slice(0, 8) };
}

async function fetchWeather(lat, lon, warnings) {
  const om = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation,weather_code,wind_gusts_10m'
    + '&hourly=precipitation_probability,precipitation,weather_code&forecast_hours=6'
    + `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=${encodeURIComponent(TZ)}`;
  const [wx, nws] = await Promise.all([
    getJson(om),
    getJson(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, {
      'User-Agent': 'SFEF-Motors garage dashboard', Accept: 'application/geo+json',
    }).catch(e => { warnings.push(`Flood/heat alerts unavailable (${e.message})`); return null; }),
  ]);
  const alerts = (nws?.features || []).map(f => ({ event: f.properties.event, headline: f.properties.headline }));
  return { cur: wx.current, hourly: wx.hourly, alerts };
}

// Turns weather + traffic into the five factors, a verdict and the collectables call.
function summarize({ place, lat, lon }, { cur, hourly, alerts }, traffic, warnings) {
  const factors = [
    rateWeather(cur, hourly, alerts),
    rateFlooding(cur, hourly, alerts),
    rateHeat(cur, alerts),
    rateHumidity(cur),
    traffic,
  ];
  const by = Object.fromEntries(factors.map(f => [f.key, f]));
  // Humidity alone is a comfort issue — it can make a day "OK" but not "poor".
  const overall = worst(by.weather.level, by.flooding.level, by.heat.level, by.traffic.level,
    by.humidity.level === 'poor' ? 'fair' : by.humidity.level);
  const problems = factors.filter(f => f.level !== 'good').sort((a, b) => RANK[b.level] - RANK[a.level]);
  const headline = overall === 'good' ? 'Ideal day for a drive'
    : overall === 'fair' ? 'Decent — drive with care' : 'Not a good time to drive';
  const reason = problems.slice(0, 2).map(f => `${f.label.toLowerCase()} (${f.detail.split(' · ')[0].toLowerCase()})`).join(' and ');

  // Collectables are pickier: any rain, flooding or real heat keeps them home.
  const rainSoon = Math.max(0, ...hourly.precipitation_probability.slice(0, 6)) >= 25 || isRain(cur.weather_code);
  const keepHome = rainSoon ? 'rain in the forecast'
    : by.flooding.level !== 'good' ? 'flood risk'
    : cur.apparent_temperature >= 98 ? 'heat'
    : by.traffic.level === 'poor' ? 'heavy traffic' : null;

  return {
    updatedAt: new Date().toISOString(),
    place,
    overall: { level: overall, headline, detail: reason ? `Watch ${reason}` : 'All conditions look good' },
    collectables: keepHome
      ? { ok: false, text: `Keep the collectables in — ${keepHome}` }
      : { ok: true, text: 'Good day to take a collectable out' },
    factors,
    alerts,
    warnings,
    lat, lon,
  };
}

async function trafficOrEstimate(fn, warnings) {
  if (!process.env.TOMTOM_API_KEY) return estimateTraffic(new Date());
  try {
    const t = await fn();
    if (t.warning) warnings.push(t.warning);
    return t;
  } catch (e) {
    console.error('[conditions] TomTom failed:', e.message);
    warnings.push(`Live traffic unavailable (${e.message}) — showing a time-of-day estimate`);
    return { ...estimateTraffic(new Date()), detail: 'Live traffic failed — showing estimate' };
  }
}

async function build() {
  const warnings = [];
  const [wx, traffic] = await Promise.all([
    fetchWeather(LAT, LON, warnings),
    trafficOrEstimate(corridorTraffic, warnings),
  ]);
  return summarize({ place: PLACE, lat: LAT, lon: LON }, wx, traffic, warnings);
}

// Refreshes on its own every 15 minutes (whether or not anyone is looking),
// so the dashboard always shows data at most 15 minutes old. Page loads just
// read the latest result and never call the outside services themselves.
async function refresh() {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    let wait = REFRESH_MS;
    try {
      const data = await build();
      _cache = { at: Date.now(), data };
      _lastError = null;
    } catch (e) {
      _lastError = e.message;
      wait = RETRY_MS;
      console.error('[conditions] update failed:', e.message);
    }
    _nextAt = Date.now() + wait;
    setTimeout(refresh, wait).unref();
  })().finally(() => { _inflight = null; });
  return _inflight;
}
refresh();

// ── Google cross-check ────────────────────────────
// Agree = both put the road in the same band (flowing / slow / heavy).
// Close match = different bands but within 15 points of each other.
function compare(tomtomRatio, googleRatio) {
  const a = trafficLevel(tomtomRatio), b = trafficLevel(googleRatio);
  const way = googleRatio < tomtomRatio ? 'slower' : 'faster';
  if (a === b) return { agree: true, text: 'Google agrees' };
  if (Math.abs(tomtomRatio - googleRatio) <= 0.15) return { agree: true, text: `Close match (Google a bit ${way})` };
  return { agree: false, text: `Google shows it ${way}` };
}
const pct = r => Math.round(r * 100);

async function verifyGarage() {
  if (_verify && Date.now() - _verify.at < VERIFY_TTL) return _verify.data;
  const corridors = _cache?.data?.factors?.find(f => f.key === 'traffic')?.corridors || [];
  const rows = await Promise.all(CORRIDORS.map(async c => {
    const tt = corridors.find(x => x.name === c.name);
    try {
      const legs = await Promise.all(c.google.map(([label, from, to]) => google.routeRatio(from, to).then(r => ({ label, ...r }))));
      const gRatio = legs.reduce((s, l) => s + l.ratio, 0) / legs.length;
      return {
        name: c.name,
        tomtom: tt ? { level: tt.level, flowPct: pct(tt.ratio), speed: tt.speed } : null,
        google: { level: trafficLevel(gRatio), flowPct: pct(gRatio), legs },
        ...(tt ? compare(tt.ratio, gRatio) : { agree: null, text: 'No TomTom data to compare' }),
      };
    } catch (e) {
      return { name: c.name, tomtom: tt ? { level: tt.level, flowPct: pct(tt.ratio), speed: tt.speed } : null, google: null, agree: null, text: `Google check failed (${e.message})` };
    }
  }));
  const data = { checkedAt: new Date().toISOString(), rows };
  if (rows.some(r => r.google)) _verify = { at: Date.now(), data }; // don't cache a total failure
  return data;
}

async function verifyPoint(flow) {
  if (!flow?.coords || flow.coords.length < 2) throw new Error('no road segment to check');
  const from = flow.coords[0], to = flow.coords[flow.coords.length - 1];
  const g = await google.routeRatio(from, to);
  const ttRatio = flow.freeTravel && flow.travel ? Math.min(1, flow.freeTravel / flow.travel) : flow.ratio;
  return {
    tomtom: { level: trafficLevel(ttRatio), flowPct: pct(ttRatio), minutes: Math.round(flow.travel / 6) / 10, normalMinutes: Math.round(flow.freeTravel / 6) / 10 },
    google: { level: trafficLevel(g.ratio), flowPct: pct(g.ratio), minutes: g.minutes, normalMinutes: g.normalMinutes, miles: g.miles },
    ...compare(ttRatio, g.ratio),
  };
}

// ── Routes ────────────────────────────────────────
router.get('/', async (req, res) => {
  if (!_cache) await refresh(); // first request right after a restart
  if (!_cache) {
    return res.status(502).json({ error: `Couldn't get driving conditions (${_lastError || 'no data yet'}). Trying again in 5 minutes.` });
  }
  const age = Date.now() - _cache.at;
  res.json({
    ..._cache.data,
    stale: age > STALE_MS || !!_lastError,
    lastError: _lastError,
    nextUpdateAt: _nextAt ? new Date(_nextAt).toISOString() : null,
  });
});

// What's switched on — the tab uses this to explain anything missing.
router.get('/config', (req, res) => res.json({
  tomtom: !!process.env.TOMTOM_API_KEY,
  googleVerify: google.enabled(),
  mapsKey: process.env.GOOGLE_MAPS_BROWSER_KEY || null,
  garage: { place: PLACE, lat: LAT, lon: LON },
  usage: { tomtom: tomtomUsage(), google: google.usage() },
}));

// Google cross-check of the garage-area corridors (only when the tab asks).
router.get('/verify', async (req, res) => {
  if (!google.enabled()) return res.json({ disabled: true });
  try { res.json(await verifyGarage()); } catch (e) { res.status(502).json({ error: e.message }); }
});

// Place search → up to 5 matches (Florida-biased, US only).
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (q.length < 2) return res.status(400).json({ error: 'Type a place or address' });
  try {
    const d = await tomtom(`/search/2/search/${encodeURIComponent(q)}.json`, {
      limit: 5, countrySet: 'US', lat: LAT, lon: LON, typeahead: false,
    });
    res.json((d.results || []).map(r => ({
      name: r.poi?.name || r.address?.freeformAddress || q,
      address: r.address?.freeformAddress || '',
      lat: r.position.lat, lon: r.position.lon,
    })));
  } catch (e) {
    res.status(502).json({ error: `Search failed (${e.message})` });
  }
});

// Full conditions at a chosen place, with Google's cross-check of the traffic.
router.get('/at', async (req, res) => {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'Bad location' });
  }
  const place = String(req.query.name || 'Searched place').slice(0, 120);
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = _searchCache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_TTL) return res.json({ ...hit.data, place });
  try {
    const warnings = [];
    const [wx, traffic] = await Promise.all([
      fetchWeather(lat, lon, warnings),
      trafficOrEstimate(() => pointTraffic(lat, lon, warnings), warnings),
    ]);
    const data = summarize({ place, lat, lon }, wx, traffic, warnings);
    if (google.enabled() && traffic.flow) {
      try { data.verify = await verifyPoint(traffic.flow); }
      catch (e) { data.verify = { agree: null, text: `Google check failed (${e.message})` }; }
    }
    if (traffic.flow) delete traffic.flow.coords; // not needed by the page
    _searchCache.set(key, { at: Date.now(), data });
    if (_searchCache.size > 200) _searchCache.delete(_searchCache.keys().next().value);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: `Couldn't get conditions there (${e.message})` });
  }
});

router.refresh = refresh; // for tests
module.exports = router;
