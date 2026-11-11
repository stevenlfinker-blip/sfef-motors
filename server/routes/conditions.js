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
const CACHE_MS = 15 * 60 * 1000;

// Main roads near the garage for live traffic, all at ~125th St. Positions
// checked against Google Maps' traffic layer on 2026-11-11.
const TRAFFIC_POINTS = [
  { name: 'I-95', lat: 25.890, lon: -80.2095 },
  { name: 'NE 125th St', lat: 25.890, lon: -80.189 },
  { name: 'Biscayne Blvd', lat: 25.8905, lon: -80.1635 },
];

let _cache = null; // { at, data }

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

async function liveTraffic(key) {
  const segs = await Promise.all(TRAFFIC_POINTS.map(async p => {
    const d = await getJson(`https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${p.lat},${p.lon}&unit=MPH&key=${encodeURIComponent(key)}`);
    const f = d.flowSegmentData;
    return { name: p.name, ratio: f.roadClosure ? 0 : f.currentSpeed / f.freeFlowSpeed, speed: f.currentSpeed };
  }));
  // Average across the three roads; one jammed road makes it at least "fair".
  const avg = segs.reduce((s, x) => s + x.ratio, 0) / segs.length;
  const slowest = segs.reduce((a, b) => (b.ratio < a.ratio ? b : a));
  let level = avg >= 0.8 ? 'good' : avg >= 0.55 ? 'fair' : 'poor';
  if (level === 'good' && slowest.ratio < 0.5) level = 'fair';
  const value = level === 'good' ? 'Flowing' : level === 'fair' ? 'Slow' : 'Heavy';
  const detail = segs.map(s => `${s.name} ${Math.round(s.speed)} mph`).join(' · ') + ' · TomTom';
  return { key: 'traffic', label: 'Traffic', level, value, detail, live: true };
}

async function build() {
  const om = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}`
    + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation,weather_code,wind_gusts_10m'
    + '&hourly=precipitation_probability,precipitation,weather_code&forecast_hours=6'
    + `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=${encodeURIComponent(TZ)}`;
  const [wx, nws, traffic] = await Promise.all([
    getJson(om),
    getJson(`https://api.weather.gov/alerts/active?point=${LAT},${LON}`, {
      'User-Agent': 'SFEF-Motors garage dashboard', Accept: 'application/geo+json',
    }).catch(() => null), // alerts are a bonus; never fail the whole card
    process.env.TOMTOM_API_KEY
      ? liveTraffic(process.env.TOMTOM_API_KEY.trim()).catch(e => {
          console.error('[conditions] TomTom failed:', e.message);
          const est = estimateTraffic(new Date());
          return { ...est, detail: `Live traffic failed (${e.message}) — showing estimate` };
        })
      : estimateTraffic(new Date()),
  ]);
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
  };
}

router.get('/', async (req, res) => {
  if (_cache && Date.now() - _cache.at < CACHE_MS) return res.json(_cache.data);
  try {
    const data = await build();
    _cache = { at: Date.now(), data };
    res.json(data);
  } catch (e) {
    console.error('[conditions]', e.message);
    if (_cache) return res.json({ ..._cache.data, stale: true }); // better old than nothing
    res.status(502).json({ error: 'Weather service unavailable' });
  }
});

module.exports = router;
