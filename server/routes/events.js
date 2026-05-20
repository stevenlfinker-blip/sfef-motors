const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT e.*, c.year || ' ' || c.make || ' ' || c.model AS car_name
    FROM events e
    LEFT JOIN cars c ON e.car_id = c.id
    ORDER BY e.date ASC
  `).all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { car_id, title, type, location, date, notes, registered } = req.body;
  const result = db.prepare(
    'INSERT INTO events (car_id, title, type, location, date, notes, registered) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(car_id || null, title, type || '', location || '', date || null, notes || '', registered ? 1 : 0);
  const row = db.prepare(`
    SELECT e.*, c.year || ' ' || c.make || ' ' || c.model AS car_name
    FROM events e LEFT JOIN cars c ON e.car_id = c.id WHERE e.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json(row);
});

router.put('/:id', (req, res) => {
  const { car_id, title, type, location, date, notes, registered } = req.body;
  db.prepare(
    'UPDATE events SET car_id=?, title=?, type=?, location=?, date=?, notes=?, registered=? WHERE id=?'
  ).run(car_id || null, title, type || '', location || '', date || null, notes || '', registered ? 1 : 0, req.params.id);
  const row = db.prepare(`
    SELECT e.*, c.year || ' ' || c.make || ' ' || c.model AS car_name
    FROM events e LEFT JOIN cars c ON e.car_id = c.id WHERE e.id = ?
  `).get(req.params.id);
  res.json(row);
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
