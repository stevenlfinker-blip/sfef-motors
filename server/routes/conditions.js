// Ideal driving conditions for the dashboard: weather, flooding, heat,
// humidity and traffic near the garage, rolled up into one verdict.
//
// Sources (all free): Open-Meteo forecast (no key), National Weather Service
// alerts for flood/heat/storm warnings (US only, no key), and TomTom live
// traffic when TOMTOM_API_KEY is set — otherwise a Miami rush-hour estimate.
//
// Only rounded coordinates (~1 km) are sent out, never the street address.
const express = require('express');
const router = express.Router();

const LAT = Number(process.env.GARAGE_LAT || 25.9);
const LON = Number(process.env.GARAGE_LON || -80.17);
const PLACE = process.env.GARAGE_PLACE || 'North Miami';
const TZ = 'America/New_York';
const REFRESH_MS = 15 * 60 * 1000; // 20 TomTom calls each → ~1,900/day (free tier: 2,500)
const RETRY_MS = 5 * 60 * 1000;     // after a failed update
const STALE_MS = 20 * 60 * 1000;    // older than this = flagged out of date

// Live traffic check points (~25 mile area), grouped into corridors.
// Positions come from OpenStreetMap road geometry (2026-11-11); the I-95 point
// at 125th St was also confirmed on Google Maps' traffic layer. I-95 is
// sampled in both directions — northbound lanes sit on the east side, so each
// point is nudged ~15 m outward to make TomTom snap to the right carriageway.
const NB = 0.00015, SB = -0.00015;
const CORRIDORS = [
  { name: 'I-95', points: [
    ['Downtown NB', 25.78993, -80.20423 + NB], ['Downtown SB', 25.79005, -80.20485 + SB],
    ['125th St NB', 25.89046, -80.20918 + NB], ['125th St SB', 25.89067, -80.20953 + SB],
    ['Aventura NB', 25.97902, -80.16585 + NB], ['Aventura SB', 25.97895, -80.16620 + SB],
    ['Hollywood NB', 26.08030, -80.16856 + NB], ['Hollywood SB', 26.07954, -80.16907 + SB],
    ['Ft Lauderdale NB', 26.19098, -80.15158 + NB], ['Ft Lauderdale SB', 26.19099, -80.15194 + SB],
  ] },
  { name: 'Collins Ave', points: [
    ['Mid-Beach', 25.81495, -80.12272], ['Surfside', 25.87805, -80.12185],
    ['Bal Harbour', 25.88940, -80.12390], ['Haulover', 25.90498, -80.12321],
    ['Sunny Isles', 25.93508, -80.12162],
  ] },
  { name: '163rd St', points: [['163rd St EB', 25.92582, -80.16502], ['Sunny Isles Blvd WB', 25.92651, -80.13982]] },
  { name: 'Bay Harbor', points: [['Broad Causeway', 25.88820, -80.14497]] },
  { name: 'Local', points: [['NE 125th St', 25.890, -80.189], ['Biscayne Blvd', 25.8905, -80.1635]] },
];

let _cache = null; // { at, data }
let _lastError = null, _nextAt = null, _inflight = null;

const RANK = { good: 0, fair: 1, poor: 2 };
const worst = (...lv) => lv.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'good');

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
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

async function flowAt(key, lat, lon) {
  const d = await getJson(`https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${lat},${lon}&unit=MPH&key=${encodeURIComponent(key)}`);
  const f = d.flowSegmentData;
  return { ratio: f.roadClosure ? 0 : Math.min(1, f.currentSpeed / f.freeFlowSpeed), speed: f.currentSpeed, free: f.freeFlowSpeed, closed: !!f.roadClosure };
}

async function liveTraffic(key) {
  // 17 points per refresh; a few at a time to stay polite with the free tier.
  const jobs = CORRIDORS.flatMap(c => c.points.map(([label, lat, lon]) => ({ corridor: c.name, label, lat, lon })));
  const results = [];
  for (let i = 0; i < jobs.length; i += 5) {
    results.push(...await Promise.all(jobs.slice(i, i + 5).map(j =>
      flowAt(key, j.lat, j.lon).then(r => ({ ...j, ...r })).catch(e => ({ ...j, error: e.message })))));
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

async function build() {
  const om = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}`
    + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation,weather_code,wind_gusts_10m'
    + '&hourly=precipitation_probability,precipitation,weather_code&forecast_hours=6'
    + `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=${encodeURIComponent(TZ)}`;
  const warnings = [];
  const [wx, nws, traffic] = await Promise.all([
    getJson(om),
    getJson(`https://api.weather.gov/alerts/active?point=${LAT},${LON}`, {
      'User-Agent': 'SFEF-Motors garage dashboard', Accept: 'application/geo+json',
    }).catch(e => { warnings.push(`Flood/heat alerts unavailable (${e.message})`); return null; }),
    process.env.TOMTOM_API_KEY
      ? liveTraffic(process.env.TOMTOM_API_KEY.trim()).catch(e => {
          console.error('[conditions] TomTom failed:', e.message);
          warnings.push(`Live traffic unavailable (${e.message}) — showing a time-of-day estimate`);
          const est = estimateTraffic(new Date());
          return { ...est, detail: 'Live traffic failed — showing estimate' };
        })
      : estimateTraffic(new Date()),
  ]);
  if (traffic.warning) warnings.push(traffic.warning);
  const alerts = (nws?.features || []).map(f => ({ event: f.properties.event, headline: f.properties.headline }));
  const cur = wx.current, hourly = wx.hourly;

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
    place: PLACE,
    overall: { level: overall, headline, detail: reason ? `Watch ${reason}` : 'All conditions look good' },
    collectables: keepHome
      ? { ok: false, text: `Keep the collectables in — ${keepHome}` }
      : { ok: true, text: 'Good day to take a collectable out' },
    factors,
    alerts,
    warnings,
  };
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

router.refresh = refresh; // for tests
module.exports = router;
