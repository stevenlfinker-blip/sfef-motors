const express = require('express');
const router = express.Router();
const { pool } = require('../db');

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM watchlist ORDER BY priority DESC, id DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { year, make, model, asking_price, source, priority, notes, added_date } = req.body;
    if (!make || !model) return res.status(400).json({ error: 'Make and model are required' });
    const { rows } = await pool.query(
      'INSERT INTO watchlist (year, make, model, asking_price, source, priority, notes, added_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [year||'', make, model, asking_price||0, source||'', priority||'Medium', notes||'', added_date||'']
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { year, make, model, asking_price, source, priority, notes, added_date } = req.body;
    const { rows } = await pool.query(
      'UPDATE watchlist SET year=$1, make=$2, model=$3, asking_price=$4, source=$5, priority=$6, notes=$7, added_date=$8 WHERE id=$9 RETURNING *',
      [year||'', make, model, asking_price||0, source||'', priority||'Medium', notes||'', added_date||'', req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM watchlist WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
