const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM marinas ORDER BY name ASC').all());
});

router.post('/', (req, res) => {
  const { name, lat, lon, address, phone, website, vhf_channel, fuel_diesel, fuel_gas, transient_slips, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Marina name is required' });
  const result = db.prepare(`INSERT INTO marinas
    (name, lat, lon, address, phone, website, vhf_channel, fuel_diesel, fuel_gas, transient_slips, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(name, parseFloat(lat) || null, parseFloat(lon) || null, address || '', phone || '', website || '',
    vhf_channel || '', fuel_diesel ? 1 : 0, fuel_gas ? 1 : 0, transient_slips ? 1 : 0, notes || '');
  res.status(201).json(db.prepare('SELECT * FROM marinas WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { name, lat, lon, address, phone, website, vhf_channel, fuel_diesel, fuel_gas, transient_slips, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Marina name is required' });
  db.prepare(`UPDATE marinas SET name=?, lat=?, lon=?, address=?, phone=?, website=?, vhf_channel=?,
    fuel_diesel=?, fuel_gas=?, transient_slips=?, notes=? WHERE id=?`
  ).run(name, parseFloat(lat) || null, parseFloat(lon) || null, address || '', phone || '', website || '',
    vhf_channel || '', fuel_diesel ? 1 : 0, fuel_gas ? 1 : 0, transient_slips ? 1 : 0, notes || '', req.params.id);
  res.json(db.prepare('SELECT * FROM marinas WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM marinas WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
