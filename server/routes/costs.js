const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'data', 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.random().toString(36).slice(2);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

const SELECT = `
  SELECT co.*, c.year || ' ' || c.make || ' ' || c.model AS car_name
  FROM costs co LEFT JOIN cars c ON co.car_id = c.id
`;

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(SELECT + 'ORDER BY co.date DESC, co.id DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', upload.single('receipt'), async (req, res) => {
  try {
    const { car_id, category, description, amount, date, notes } = req.body;
    const receipt_path = req.file ? `/uploads/${req.file.filename}` : '';
    const ins = await pool.query(
      'INSERT INTO costs (car_id, category, description, amount, date, receipt_path, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [car_id||null, category||'', description, parseFloat(amount)||0, date||null, receipt_path, notes||'']
    );
    const { rows } = await pool.query(SELECT + 'WHERE co.id = $1', [ins.rows[0].id]);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', upload.single('receipt'), async (req, res) => {
  try {
    const { car_id, category, description, amount, date, notes } = req.body;
    const { rows: existing } = await pool.query('SELECT * FROM costs WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Not found' });

    let receipt_path = existing[0].receipt_path;
    if (req.file) {
      if (existing[0].receipt_path) {
        const oldFile = path.join(__dirname, '..', '..', 'data', existing[0].receipt_path.replace('/uploads/', 'uploads/'));
        fs.unlink(oldFile, () => {});
      }
      receipt_path = `/uploads/${req.file.filename}`;
    }

    await pool.query(
      'UPDATE costs SET car_id=$1, category=$2, description=$3, amount=$4, date=$5, receipt_path=$6, notes=$7 WHERE id=$8',
      [car_id||null, category||'', description, parseFloat(amount)||0, date||null, receipt_path, notes||'', req.params.id]
    );
    const { rows } = await pool.query(SELECT + 'WHERE co.id = $1', [req.params.id]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM costs WHERE id = $1', [req.params.id]);
    if (rows[0]?.receipt_path) {
      const file = path.join(__dirname, '..', '..', 'data', rows[0].receipt_path.replace('/uploads/', 'uploads/'));
      fs.unlink(file, () => {});
    }
    await pool.query('DELETE FROM costs WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
