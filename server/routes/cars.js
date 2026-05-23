const express = require('express');
const router = express.Router();
const { pool } = require('../db');

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM cars ORDER BY id');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM cars WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { year, make, model, color, mileage, status, notes, vin, ownership, registration, insurance, value } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO cars (year, make, model, color, mileage, status, notes, vin, ownership, registration, insurance, value) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',
      [year, make, model, color||'', mileage||'', status||'Active', notes||'', vin||'', ownership||'', registration||'', insurance||'', value||0]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { year, make, model, color, mileage, status, notes, vin, ownership, registration, insurance, value } = req.body;
    const { rows } = await pool.query(
      'UPDATE cars SET year=$1, make=$2, model=$3, color=$4, mileage=$5, status=$6, notes=$7, vin=$8, ownership=$9, registration=$10, insurance=$11, value=$12 WHERE id=$13 RETURNING *',
      [year, make, model, color||'', mileage||'', status||'Active', notes||'', vin||'', ownership||'', registration||'', insurance||'', value||0, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM cars WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
