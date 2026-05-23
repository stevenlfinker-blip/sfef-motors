const express = require('express');
const router = express.Router();
const { pool } = require('../db');

const SELECT = `
  SELECT e.*, c.year || ' ' || c.make || ' ' || c.model AS car_name
  FROM events e LEFT JOIN cars c ON e.car_id = c.id
`;

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(SELECT + 'ORDER BY e.date ASC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { car_id, title, type, location, date, notes, registered } = req.body;
    const ins = await pool.query(
      'INSERT INTO events (car_id, title, type, location, date, notes, registered) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [car_id||null, title, type||'', location||'', date||null, notes||'', registered?1:0]
    );
    const { rows } = await pool.query(SELECT + 'WHERE e.id = $1', [ins.rows[0].id]);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { car_id, title, type, location, date, notes, registered } = req.body;
    await pool.query(
      'UPDATE events SET car_id=$1, title=$2, type=$3, location=$4, date=$5, notes=$6, registered=$7 WHERE id=$8',
      [car_id||null, title, type||'', location||'', date||null, notes||'', registered?1:0, req.params.id]
    );
    const { rows } = await pool.query(SELECT + 'WHERE e.id = $1', [req.params.id]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM events WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
