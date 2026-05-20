const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, c.year || ' ' || c.make || ' ' || c.model AS car_name
    FROM parts p
    LEFT JOIN cars c ON p.car_id = c.id
    ORDER BY p.name ASC
  `).all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { car_id, name, part_number, quantity, location, cost_each, supplier, notes } = req.body;
  const result = db.prepare(
    'INSERT INTO parts (car_id, name, part_number, quantity, location, cost_each, supplier, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(car_id || null, name, part_number || '', quantity || 0, location || '', cost_each || 0, supplier || '', notes || '');
  const row = db.prepare(`
    SELECT p.*, c.year || ' ' || c.make || ' ' || c.model AS car_name
    FROM parts p LEFT JOIN cars c ON p.car_id = c.id WHERE p.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json(row);
});

router.put('/:id', (req, res) => {
  const { car_id, name, part_number, quantity, location, cost_each, supplier, notes } = req.body;
  db.prepare(
    'UPDATE parts SET car_id=?, name=?, part_number=?, quantity=?, location=?, cost_each=?, supplier=?, notes=? WHERE id=?'
  ).run(car_id || null, name, part_number || '', quantity || 0, location || '', cost_each || 0, supplier || '', notes || '', req.params.id);
  const row = db.prepare(`
    SELECT p.*, c.year || ' ' || c.make || ' ' || c.model AS car_name
    FROM parts p LEFT JOIN cars c ON p.car_id = c.id WHERE p.id = ?
  `).get(req.params.id);
  res.json(row);
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM parts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
