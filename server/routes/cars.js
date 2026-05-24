const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM cars ORDER BY id').all());
});

router.get('/:id', (req, res) => {
  const car = db.prepare('SELECT * FROM cars WHERE id = ?').get(req.params.id);
  if (!car) return res.status(404).json({ error: 'Not found' });
  res.json(car);
});

router.post('/', (req, res) => {
  const { year, make, model, color, mileage, status, notes, vin, ownership, registration, insurance, value, category } = req.body;
  const result = db.prepare(
    'INSERT INTO cars (year, make, model, color, mileage, status, notes, vin, ownership, registration, insurance, value, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(year, make, model, color||'', mileage||'', status||'Active', notes||'', vin||'', ownership||'', registration||'', insurance||'', value||0, category||'Daily');
  res.status(201).json(db.prepare('SELECT * FROM cars WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { year, make, model, color, mileage, status, notes, vin, ownership, registration, insurance, value, category } = req.body;
  db.prepare(
    'UPDATE cars SET year=?, make=?, model=?, color=?, mileage=?, status=?, notes=?, vin=?, ownership=?, registration=?, insurance=?, value=?, category=? WHERE id=?'
  ).run(year, make, model, color||'', mileage||'', status||'Active', notes||'', vin||'', ownership||'', registration||'', insurance||'', value||0, category||'Daily', req.params.id);
  res.json(db.prepare('SELECT * FROM cars WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM cars WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
