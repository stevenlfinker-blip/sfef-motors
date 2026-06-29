const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
const PARSEABLE_MIME = /^(image\/(jpeg|png|gif|webp)|application\/pdf)$/;
const parseUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

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
  SELECT ex.id, ex.car_id, ex.expense_type, ex.vendor, ex.category, ex.description, ex.amount, ex.date, ex.receipt_path, ex.notes,
         c.year || ' ' || c.make || ' ' || c.model AS car_name
  FROM expenses ex LEFT JOIN cars c ON ex.car_id = c.id
`;

router.get('/', (req, res) => {
  res.json(db.prepare(SELECT + 'ORDER BY ex.date DESC, ex.id DESC').all());
});

router.post('/parse-receipt', parseUpload.single('receipt'), async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (!PARSEABLE_MIME.test(req.file.mimetype)) {
    return res.status(400).json({ error: 'AI scanning supports JPG, PNG, GIF, WebP, and PDF only' });
  }

  const isPdf = req.file.mimetype === 'application/pdf';
  const sourceBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: req.file.buffer.toString('base64') } }
    : { type: 'image', source: { type: 'base64', media_type: req.file.mimetype, data: req.file.buffer.toString('base64') } };

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          sourceBlock,
          {
            type: 'text',
            text: 'Extract the following fields from this receipt/invoice and respond with ONLY a JSON object, no other text: ' +
              '{"vendor": string, "amount": number, "date": string in YYYY-MM-DD format, ' +
              '"description": short string summarizing what was purchased}. ' +
              'For "amount": use the TOTAL or GRAND TOTAL line (the full purchase amount before any payment method is applied). ' +
              'Do NOT use DEBIT, CASH, CREDIT, CHANGE, or TENDERED amounts — those are payment method lines, not the purchase total. ' +
              'Return the number only, no currency symbol. If a field cannot be determined, use null.',
          },
        ],
      }],
    });

    const text = message.content.find(b => b.type === 'text')?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Could not parse a receipt from the response');
    const parsed = JSON.parse(jsonMatch[0]);
    res.json(parsed);
  } catch (err) {
    console.error('Receipt parse error:', err.message);
    res.status(500).json({ error: 'Failed to read receipt. Try a clearer image or enter details manually.' });
  }
});

router.post('/', upload.single('receipt'), (req, res) => {
  const { car_id, expense_type, vendor, category, description, amount, date, notes } = req.body;
  const receipt_path = req.file ? `/uploads/${req.file.filename}` : '';
  const result = db.prepare(
    'INSERT INTO expenses (car_id, expense_type, vendor, category, description, amount, date, receipt_path, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(car_id||null, expense_type||'', vendor||'', category||'', description, parseFloat(amount)||0, date||null, receipt_path, notes||'');
  res.status(201).json(db.prepare(SELECT + 'WHERE ex.id = ?').get(result.lastInsertRowid));
});

router.put('/:id', upload.single('receipt'), (req, res) => {
  const { car_id, expense_type, vendor, category, description, amount, date, notes } = req.body;
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  let receipt_path = existing.receipt_path;
  if (req.file) {
    if (existing.receipt_path) {
      const oldFile = path.join(__dirname, '..', '..', 'data', existing.receipt_path.replace('/uploads/', 'uploads/'));
      fs.unlink(oldFile, () => {});
    }
    receipt_path = `/uploads/${req.file.filename}`;
  } else if (req.body.remove_receipt === '1' && existing.receipt_path) {
    const oldFile = path.join(__dirname, '..', '..', 'data', existing.receipt_path.replace('/uploads/', 'uploads/'));
    fs.unlink(oldFile, () => {});
    receipt_path = '';
  }

  db.prepare(
    'UPDATE expenses SET car_id=?, expense_type=?, vendor=?, category=?, description=?, amount=?, date=?, receipt_path=?, notes=? WHERE id=?'
  ).run(car_id||null, expense_type||'', vendor||'', category||'', description, parseFloat(amount)||0, date||null, receipt_path, notes||'', req.params.id);
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
