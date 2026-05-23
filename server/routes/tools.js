const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM tools ORDER BY name ASC').all());
});

router.post('/', (req, res) => {
  const { name, brand, category, location, condition, notes } = req.body;
  const result = db.prepare(
    'INSERT INTO tools (name, brand, category, location, condition, notes) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, brand||'', category||'', location||'', condition||'Good', notes||'');
  res.status(201).json(db.prepare('SELECT * FROM tools WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { name, brand, category, location, condition, notes } = req.body;
  db.prepare(
    'UPDATE tools SET name=?, brand=?, category=?, location=?, condition=?, notes=? WHERE id=?'
  ).run(name, brand||'', category||'', location||'', condition||'Good', notes||'', req.params.id);
  res.json(db.prepare('SELECT * FROM tools WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM tools WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
