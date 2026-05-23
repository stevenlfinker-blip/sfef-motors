const express = require('express');
const router = express.Router();
const { pool } = require('../db');

const SELECT = `
  SELECT m.*, c.year || ' ' || c.make || ' ' || c.model AS car_name
  FROM maintenance m LEFT JOIN cars c ON m.car_id = c.id
`;

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(SELECT + 'ORDER BY m.completed ASC, m.due_date ASC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { car_id, title, description, due_date, due_mileage, cost, notes } = req.body;
    const ins = await pool.query(
      'INSERT INTO maintenance (car_id, title, description, due_date, due_mileage, cost, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [car_id||null, title, description||'', due_date||null, due_mileage||'', cost||0, notes||'']
    );
    const { rows } = await pool.query(SELECT + 'WHERE m.id = $1', [ins.rows[0].id]);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { car_id, title, description, due_date, due_mileage, completed, completed_date, cost, notes } = req.body;
    await pool.query(
      'UPDATE maintenance SET car_id=$1, title=$2, description=$3, due_date=$4, due_mileage=$5, completed=$6, completed_date=$7, cost=$8, notes=$9 WHERE id=$10',
      [car_id||null, title, description||'', due_date||null, due_mileage||'', completed?1:0, completed_date||'', cost||0, notes||'', req.params.id]
    );
    const { rows } = await pool.query(SELECT + 'WHERE m.id = $1', [req.params.id]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM maintenance WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
