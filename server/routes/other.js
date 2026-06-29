const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM other_items ORDER BY name ASC').all());
});

router.post('/', (req, res) => {
  const { name, notes } = req.body;
  const result = db.prepare(
    'INSERT INTO other_items (name, notes) VALUES (?, ?)'
  ).run(name, notes || '');
  res.status(201).json(db.prepare('SELECT * FROM other_items WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { name, notes } = req.body;
  db.prepare(
    'UPDATE other_items SET name=?, notes=? WHERE id=?'
  ).run(name, notes || '', req.params.id);
  res.json(db.prepare('SELECT * FROM other_items WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM other_items WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
