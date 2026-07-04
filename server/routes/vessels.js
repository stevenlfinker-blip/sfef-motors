const express = require('express');
const router = express.Router();
const db = require('../db');
const { fetchMapShareKml } = require('../lib/garmin');

const lastPosStmt = db.prepare('SELECT * FROM vessel_positions WHERE vessel_id = ? ORDER BY recorded_at DESC LIMIT 1');

router.get('/', (req, res) => {
  const vessels = db.prepare('SELECT * FROM vessels ORDER BY name ASC').all();
  res.json(vessels.map(v => ({ ...v, last_position: lastPosStmt.get(v.id) || null })));
});

router.get('/:id', (req, res) => {
  const vessel = db.prepare('SELECT * FROM vessels WHERE id = ?').get(req.params.id);
  if (!vessel) return res.status(404).json({ error: 'Not found' });
  res.json({ ...vessel, last_position: lastPosStmt.get(vessel.id) || null });
});

router.post('/', (req, res) => {
  const { name, type, make, model, year, hull_id, registration_number, registration_expiry,
    insurance_expiry, home_marina_id, garmin_mapshare_id, garmin_mapshare_password, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Vessel name is required' });
  const result = db.prepare(`INSERT INTO vessels
    (name, type, make, model, year, hull_id, registration_number, registration_expiry, insurance_expiry, home_marina_id, garmin_mapshare_id, garmin_mapshare_password, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(name, type || 'Powerboat', make || '', model || '', year || '', hull_id || '', registration_number || '',
    registration_expiry || '', insurance_expiry || '', home_marina_id || null, garmin_mapshare_id || '', garmin_mapshare_password || '', notes || '');
  res.status(201).json(db.prepare('SELECT * FROM vessels WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { name, type, make, model, year, hull_id, registration_number, registration_expiry,
    insurance_expiry, home_marina_id, garmin_mapshare_id, garmin_mapshare_password, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Vessel name is required' });
  db.prepare(`UPDATE vessels SET name=?, type=?, make=?, model=?, year=?, hull_id=?, registration_number=?,
    registration_expiry=?, insurance_expiry=?, home_marina_id=?, garmin_mapshare_id=?, garmin_mapshare_password=?, notes=? WHERE id=?`
  ).run(name, type || 'Powerboat', make || '', model || '', year || '', hull_id || '', registration_number || '',
    registration_expiry || '', insurance_expiry || '', home_marina_id || null, garmin_mapshare_id || '', garmin_mapshare_password || '', notes || '', req.params.id);
  res.json(db.prepare('SELECT * FROM vessels WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM vessels WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.get('/:id/positions', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 2000);
  res.json(db.prepare('SELECT * FROM vessel_positions WHERE vessel_id = ? ORDER BY recorded_at DESC LIMIT ?').all(req.params.id, limit));
});

router.post('/:id/positions', (req, res) => {
  const vessel = db.prepare('SELECT id FROM vessels WHERE id = ?').get(req.params.id);
  if (!vessel) return res.status(404).json({ error: 'Vessel not found' });
  const lat = parseFloat(req.body.lat), lon = parseFloat(req.body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat and lon are required numbers' });
  const recordedAt = req.body.recorded_at ? new Date(req.body.recorded_at) : new Date();
  if (isNaN(recordedAt.getTime())) return res.status(400).json({ error: 'Invalid recorded_at date' });
  const speed = parseFloat(req.body.speed_knots);
  db.prepare(`INSERT OR IGNORE INTO vessel_positions (vessel_id, lat, lon, recorded_at, speed_knots, event_label, source)
    VALUES (?, ?, ?, ?, ?, ?, 'manual')`
  ).run(vessel.id, lat, lon, recordedAt.toISOString(), Number.isFinite(speed) ? speed : null, req.body.notes || '');
  res.status(201).json(lastPosStmt.get(vessel.id));
});

router.post('/:id/sync', async (req, res) => {
  const vessel = db.prepare('SELECT * FROM vessels WHERE id = ?').get(req.params.id);
  if (!vessel) return res.status(404).json({ error: 'Vessel not found' });
  if (!vessel.garmin_mapshare_id) return res.status(400).json({ error: 'No Garmin MapShare ID configured for this vessel' });

  try {
    const points = await fetchMapShareKml(vessel.garmin_mapshare_id, vessel.garmin_mapshare_password, 7);
    const insert = db.prepare(`INSERT OR IGNORE INTO vessel_positions
      (vessel_id, lat, lon, recorded_at, speed_knots, course_deg, elevation_m, event_label, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'garmin')`);
    let added = 0;
    for (const p of points) {
      const r = insert.run(vessel.id, p.lat, p.lon, p.recorded_at, p.speed_knots, p.course_deg, p.elevation_m, p.event_label);
      if (r.changes > 0) added++;
    }
    res.json({ added, total_fetched: points.length, latest: lastPosStmt.get(vessel.id) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
