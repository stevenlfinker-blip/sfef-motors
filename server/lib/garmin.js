const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => name === 'Placemark' || name === 'Data',
});

// Garmin inReach MapShare speed fields come through as "12.3 mph" — normalize to knots.
function toKnots(raw) {
  if (!raw) return null;
  const m = String(raw).match(/([\d.]+)\s*(mph|km\/h|kts|knots)?/i);
  if (!m) return null;
  const val = parseFloat(m[1]);
  if (!Number.isFinite(val)) return null;
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'mph') return val * 0.868976;
  if (unit === 'km/h') return val * 0.539957;
  return val;
}

function parseKml(xml) {
  const doc = parser.parse(xml);
  const folder = doc?.kml?.Document?.Folder;
  const raw = folder?.Placemark || doc?.kml?.Document?.Placemark || [];
  const list = Array.isArray(raw) ? raw : [raw];

  const points = [];
  for (const pm of list) {
    const coordStr = pm?.Point?.coordinates;
    if (!coordStr) continue;
    const [lonStr, latStr, eleStr] = String(coordStr).trim().split(',');
    const lat = parseFloat(latStr), lon = parseFloat(lonStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const dataArr = pm?.ExtendedData?.Data;
    const dataList = Array.isArray(dataArr) ? dataArr : dataArr ? [dataArr] : [];
    const dataMap = {};
    for (const d of dataList) {
      const name = d?.['@_name'];
      if (name) dataMap[name] = d.value ?? '';
    }

    let recordedAt = pm?.TimeStamp?.when || dataMap['Time UTC'] || dataMap['Time'];
    if (!recordedAt) continue;
    const iso = new Date(recordedAt).toISOString();
    if (iso === 'Invalid Date') continue;

    points.push({
      lat, lon,
      elevation_m: eleStr ? parseFloat(eleStr) : null,
      recorded_at: iso,
      speed_knots: toKnots(dataMap['Velocity']),
      course_deg: dataMap['Course'] ? parseFloat(dataMap['Course']) : null,
      event_label: dataMap['Event'] || pm?.name || '',
    });
  }
  return points;
}

// Fetches recent track points from a Garmin inReach MapShare feed.
// If the feed is password-protected, attempts the MapShare cookie-auth flow.
async function fetchMapShareKml(mapShareId, password, days = 7) {
  const d2 = new Date();
  const d1 = new Date(d2.getTime() - days * 86400000);
  const feedUrl = `https://share.garmin.com/Feed/Share/${encodeURIComponent(mapShareId)}?d1=${d1.toISOString()}&d2=${d2.toISOString()}`;

  let res = await fetch(feedUrl);
  let text = await res.text();

  const looksProtected = !res.ok || /password/i.test(text.slice(0, 500)) || /<html/i.test(text.slice(0, 200));
  if (looksProtected) {
    if (!password) {
      throw new Error(`MapShare feed "${mapShareId}" could not be read (HTTP ${res.status}). If this MapShare is password-protected, add the password to the vessel.`);
    }
    const authRes = await fetch(`https://share.garmin.com/Feed/Share/${encodeURIComponent(mapShareId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `Password=${encodeURIComponent(password)}`,
      redirect: 'manual',
    });
    const cookie = authRes.headers.get('set-cookie');
    if (!cookie) {
      throw new Error('MapShare authentication failed — check the MapShare ID and password.');
    }
    res = await fetch(feedUrl, { headers: { Cookie: cookie } });
    text = await res.text();
    if (!res.ok || /<html/i.test(text.slice(0, 200))) {
      throw new Error(`MapShare feed request failed after authentication (HTTP ${res.status}).`);
    }
  }

  return parseKml(text);
}

module.exports = { fetchMapShareKml, parseKml };
