const express = require('express');
const router = express.Router();
const { pool } = require('../db');

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM cleaning ORDER BY product ASC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { product, brand, type, qty, unit, status } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO cleaning (product, brand, type, qty, unit, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [product, brand||'', type||'', qty||0, unit||'', status||'In Stock']
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { product, brand, type, qty, unit, status } = req.body;
    const { rows } = await pool.query(
      'UPDATE cleaning SET product=$1, brand=$2, type=$3, qty=$4, unit=$5, status=$6 WHERE id=$7 RETURNING *',
      [product, brand||'', type||'', qty||0, unit||'', status||'In Stock', req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM cleaning WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
