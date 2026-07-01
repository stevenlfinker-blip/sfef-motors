const express = require('express');
const router = express.Router();
const db = require('../db');

const SELECT = `
  SELECT e.*, c.make || ' ' || c.model || ' ' || c.year AS car_name
  FROM events e LEFT JOIN cars c ON e.car_id = c.id
`;

router.get('/', (req, res) => {
  res.json(db.prepare(SELECT + 'ORDER BY e.date ASC').all());
});

router.post('/', (req, res) => {
  const { car_id, title, type, location, date, notes, registered } = req.body;
  const result = db.prepare(
    'INSERT INTO events (car_id, title, type, location, date, notes, registered) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(car_id||null, title, type||'', location||'', date||null, notes||'', registered?1:0);
  res.status(201).json(db.prepare(SELECT + 'WHERE e.id = ?').get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { car_id, title, type, location, date, notes, registered } = req.body;
  db.prepare(
    'UPDATE events SET car_id=?, title=?, type=?, location=?, date=?, notes=?, registered=? WHERE id=?'
  ).run(car_id||null, title, type||'', location||'', date||null, notes||'', registered?1:0, req.params.id);
  res.json(db.prepare(SELECT + 'WHERE e.id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
