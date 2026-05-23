const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');

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
const ALLOWED_EXT = /\.(jpg|jpeg|png|gif|webp|heic|pdf)$/i;
const ALLOWED_MIME = /^(image\/(jpeg|png|gif|webp|heic)|application\/pdf)$/;

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_EXT.test(path.extname(file.originalname)) && ALLOWED_MIME.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only images (JPG, PNG, GIF, WebP, HEIC) and PDFs are allowed'));
    }
  },
});

const SELECT = `
  SELECT ex.*, c.year || ' ' || c.make || ' ' || c.model AS car_name
  FROM expenses ex LEFT JOIN cars c ON ex.car_id = c.id
`;

router.get('/', (req, res) => {
  res.json(db.prepare(SELECT + 'ORDER BY ex.date DESC, ex.id DESC').all());
});

router.post('/', upload.single('receipt'), (req, res) => {
  const { car_id, category, description, amount, date, notes } = req.body;
  const receipt_path = req.file ? `/uploads/${req.file.filename}` : '';
  const result = db.prepare(
    'INSERT INTO expenses (car_id, category, description, amount, date, receipt_path, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(car_id||null, category||'', description, parseFloat(amount)||0, date||null, receipt_path, notes||'');
  res.status(201).json(db.prepare(SELECT + 'WHERE ex.id = ?').get(result.lastInsertRowid));
});

router.put('/:id', upload.single('receipt'), (req, res) => {
  const { car_id, category, description, amount, date, notes } = req.body;
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  let receipt_path = existing.receipt_path;
  if (req.file) {
    if (existing.receipt_path) {
      const oldFile = path.join(__dirname, '..', '..', 'data', existing.receipt_path.replace('/uploads/', 'uploads/'));
      fs.unlink(oldFile, () => {});
    }
    receipt_path = `/uploads/${req.file.filename}`;
  }

  db.prepare(
    'UPDATE expenses SET car_id=?, category=?, description=?, amount=?, date=?, receipt_path=?, notes=? WHERE id=?'
  ).run(car_id||null, category||'', description, parseFloat(amount)||0, date||null, receipt_path, notes||'', req.params.id);
  res.json(db.prepare(SELECT + 'WHERE ex.id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (row?.receipt_path) {
    const file = path.join(__dirname, '..', '..', 'data', row.receipt_path.replace('/uploads/', 'uploads/'));
    fs.unlink(file, () => {});
  }
  db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
