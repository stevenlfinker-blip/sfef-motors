const express = require('express');
const router = express.Router();

const USER_AGENT = 'sfef-motors-marine/1.0 (personal fleet app)';

// NWS marine/point forecast — free, no API key, US coverage only.
router.get('/forecast', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat and lon query params are required' });
  }

  try {
    const pointRes = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
    });
    if (!pointRes.ok) {
      throw new Error(`Location lookup failed (HTTP ${pointRes.status}) — NWS only covers US waters/coastline.`);
    }
    const point = await pointRes.json();
    const forecastUrl = point?.properties?.forecast;
    if (!forecastUrl) throw new Error('No forecast available for this location.');

    const fcRes = await fetch(forecastUrl, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' } });
    if (!fcRes.ok) throw new Error(`Forecast fetch failed (HTTP ${fcRes.status}).`);
    const fc = await fcRes.json();

    const periods = (fc?.properties?.periods || []).map(p => ({
      name: p.name,
      startTime: p.startTime,
      isDaytime: p.isDaytime,
      temperature: p.temperature,
      temperatureUnit: p.temperatureUnit,
      windSpeed: p.windSpeed,
      windDirection: p.windDirection,
      shortForecast: p.shortForecast,
      detailedForecast: p.detailedForecast,
    }));

    res.json({
      location: point?.properties?.relativeLocation?.properties || null,
      periods,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
