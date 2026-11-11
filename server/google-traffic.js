// Google cross-check for TomTom traffic: asks Google's Routes API for the
// drive time over the same stretch of road with and without traffic, so both
// services' "how much slower than normal" can be compared side by side.
//
// GOOGLE_MAPS_SERVER_KEY must have the Routes API enabled. Google bills past
// its free monthly allowance, so calls are capped per day (GOOGLE_DAILY_CAP).
const DAILY_CAP = Number(process.env.GOOGLE_DAILY_CAP || 300);
let _day = '', _used = 0;

function enabled() { return !!process.env.GOOGLE_MAPS_SERVER_KEY; }

function _take() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== _day) { _day = today; _used = 0; }
  if (_used >= DAILY_CAP) throw new Error(`daily Google limit of ${DAILY_CAP} checks reached`);
  _used++;
}

function usage() { return { used: _day === new Date().toISOString().slice(0, 10) ? _used : 0, cap: DAILY_CAP }; }

const secs = s => Number(String(s || '0').replace('s', ''));

// from/to: [lat, lon]. Returns { ratio, minutes, normalMinutes, miles }
// where ratio = normal time ÷ time with traffic (1 = no delay, 0.5 = twice as long).
async function routeRatio(from, to) {
  if (!enabled()) throw new Error('Google check not set up');
  _take();
  const ll = ([latitude, longitude]) => ({ location: { latLng: { latitude, longitude } } });
  const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_MAPS_SERVER_KEY.trim(),
      'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters',
    },
    body: JSON.stringify({ origin: ll(from), destination: ll(to), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE' }),
    signal: AbortSignal.timeout(8000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google ${r.status}${d.error?.status ? ` ${d.error.status}` : ''}`);
  const route = d.routes?.[0];
  if (!route) throw new Error('Google found no route');
  const withTraffic = secs(route.duration), normal = secs(route.staticDuration);
  return {
    ratio: withTraffic > 0 ? Math.min(1, normal / withTraffic) : 1,
    minutes: Math.round(withTraffic / 6) / 10,
    normalMinutes: Math.round(normal / 6) / 10,
    miles: Math.round((route.distanceMeters || 0) / 160.934) / 10,
  };
}

module.exports = { enabled, routeRatio, usage };
