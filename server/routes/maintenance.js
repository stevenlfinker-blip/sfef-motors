const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT m.*, c.year || ' ' || c.make || ' ' || c.model AS car_name
    FROM maintenance m
    LEFT JOIN cars c ON m.car_id = c.id
    ORDER BY m.completed ASC, m.due_date ASC
  `).all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { car_id, title, description, due_date, due_mileage, cost, notes } = req.body;
  const result = db.prepare(
    'INSERT INTO maintenance (car_id, title, description, due_date, due_mileage, cost, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(car_id || null, title, description || '', due_date || null, due_mileage || '', cost || 0, notes || '');
  const row = db.prepare(`
    SELECT m.*, c.year || ' ' || c.make || ' ' || c.model AS car_name
    FROM maintenance m LEFT JOIN cars c ON m.car_id = c.id WHERE m.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json(row);
});

router.put('/:id', (req, res) => {
  const { car_id, title, description, due_date, due_mileage, completed, completed_date, cost, notes } = req.body;
  db.prepare(
    'UPDATE maintenance SET car_id=?, title=?, description=?, due_date=?, due_mileage=?, completed=?, completed_date=?, cost=?, notes=? WHERE id=?'
  ).run(car_id || null, title, description || '', due_date || null, due_mileage || '', completed ? 1 : 0, completed_date || '', cost || 0, notes || '', req.params.id);
  const row = db.prepare(`
    SELECT m.*, c.year || ' ' || c.make || ' ' || c.model AS car_name
    FROM maintenance m LEFT JOIN cars c ON m.car_id = c.id WHERE m.id = ?
  `).get(req.params.id);
  res.json(row);
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM maintenance WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
