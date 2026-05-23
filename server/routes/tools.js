const express = require('express');
const router = express.Router();
const { pool } = require('../db');

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tools ORDER BY name ASC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, brand, category, location, condition, notes } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO tools (name, brand, category, location, condition, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [name, brand||'', category||'', location||'', condition||'Good', notes||'']
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, brand, category, location, condition, notes } = req.body;
    const { rows } = await pool.query(
      'UPDATE tools SET name=$1, brand=$2, category=$3, location=$4, condition=$5, notes=$6 WHERE id=$7 RETURNING *',
      [name, brand||'', category||'', location||'', condition||'Good', notes||'', req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM tools WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
