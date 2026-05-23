const express = require('express');
const router = express.Router();
const { pool } = require('../db');

const SELECT = `
  SELECT p.*, c.year || ' ' || c.make || ' ' || c.model AS car_name
  FROM parts p LEFT JOIN cars c ON p.car_id = c.id
`;

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(SELECT + 'ORDER BY p.name ASC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { car_id, name, part_number, quantity, location, cost_each, supplier, notes } = req.body;
    const ins = await pool.query(
      'INSERT INTO parts (car_id, name, part_number, quantity, location, cost_each, supplier, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [car_id||null, name, part_number||'', quantity||0, location||'', cost_each||0, supplier||'', notes||'']
    );
    const { rows } = await pool.query(SELECT + 'WHERE p.id = $1', [ins.rows[0].id]);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { car_id, name, part_number, quantity, location, cost_each, supplier, notes } = req.body;
    await pool.query(
      'UPDATE parts SET car_id=$1, name=$2, part_number=$3, quantity=$4, location=$5, cost_each=$6, supplier=$7, notes=$8 WHERE id=$9',
      [car_id||null, name, part_number||'', quantity||0, location||'', cost_each||0, supplier||'', notes||'', req.params.id]
    );
    const { rows } = await pool.query(SELECT + 'WHERE p.id = $1', [req.params.id]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM parts WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
