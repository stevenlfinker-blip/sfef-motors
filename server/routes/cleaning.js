const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM cleaning ORDER BY product ASC').all());
});

router.post('/', (req, res) => {
  const { product, brand, type, qty, unit, status } = req.body;
  const result = db.prepare(
    'INSERT INTO cleaning (product, brand, type, qty, unit, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(product, brand || '', type || '', qty || 0, unit || '', status || 'In Stock');
  res.status(201).json(db.prepare('SELECT * FROM cleaning WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { product, brand, type, qty, unit, status } = req.body;
  db.prepare(
    'UPDATE cleaning SET product=?, brand=?, type=?, qty=?, unit=?, status=? WHERE id=?'
  ).run(product, brand || '', type || '', qty || 0, unit || '', status || 'In Stock', req.params.id);
  res.json(db.prepare('SELECT * FROM cleaning WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM cleaning WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
