const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM watchlist ORDER BY priority DESC, id DESC').all());
});

router.post('/', (req, res) => {
  const { year, make, model, asking_price, source, priority, notes, added_date } = req.body;
  if (!make || !model) return res.status(400).json({ error: 'Make and model are required' });
  const result = db.prepare(
    'INSERT INTO watchlist (year, make, model, asking_price, source, priority, notes, added_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(year || '', make, model, asking_price || 0, source || '', priority || 'Medium', notes || '', added_date || '');
  res.status(201).json(db.prepare('SELECT * FROM watchlist WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { year, make, model, asking_price, source, priority, notes, added_date } = req.body;
  db.prepare(
    'UPDATE watchlist SET year=?, make=?, model=?, asking_price=?, source=?, priority=?, notes=?, added_date=? WHERE id=?'
  ).run(year || '', make, model, asking_price || 0, source || '', priority || 'Medium', notes || '', added_date || '', req.params.id);
  res.json(db.prepare('SELECT * FROM watchlist WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM watchlist WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
