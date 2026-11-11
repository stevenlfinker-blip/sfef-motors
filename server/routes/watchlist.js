const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { readListing, downloadImage, IMAGE_TYPES } = require('../listing');

// Listing link, photo and details pulled from the link.
for (const col of ["url TEXT DEFAULT ''", "photo_path TEXT DEFAULT ''", "mileage TEXT DEFAULT ''",
  "location TEXT DEFAULT ''", "summary TEXT DEFAULT ''", "last_checked TEXT DEFAULT ''"]) {
  try { db.exec(`ALTER TABLE watchlist ADD COLUMN ${col}`); } catch (e) { /* already exists */ }
}

const PHOTO_DIR = path.join(__dirname, '..', '..', 'data', 'uploads', 'watchlist');
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(IMAGE_TYPES[file.mimetype] || /heic|heif/.test(file.mimetype) ? null : new Error('Photos only (JPG, PNG, WEBP, GIF, HEIC)'), true),
});

const get = id => db.prepare('SELECT * FROM watchlist WHERE id = ?').get(id);

function removePhotoFile(p) {
  if (p && p.startsWith('/uploads/watchlist/')) fs.unlink(path.join(PHOTO_DIR, path.basename(p)), () => {});
}
function savePhoto(id, buf, ext) {
  const name = `${id}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(PHOTO_DIR, name), buf);
  const old = get(id)?.photo_path;
  db.prepare('UPDATE watchlist SET photo_path = ? WHERE id = ?').run(`/uploads/watchlist/${name}`, id);
  removePhotoFile(old);
}

const cleanUrl = u => {
  const s = String(u || '').trim();
  return /^https?:\/\//i.test(s) ? s.slice(0, 1000) : '';
};

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM watchlist ORDER BY priority DESC, id DESC').all());
});

// Read a listing link and return what it says (nothing is saved yet).
router.post('/lookup', async (req, res) => {
  const url = cleanUrl(req.body.url);
  if (!url) return res.status(400).json({ error: 'Paste a full link starting with http:// or https://' });
  try { res.json(await readListing(url)); }
  catch (e) { res.status(502).json({ error: `Couldn't read that listing: ${e.message}` }); }
});

const FIELDS = ['year', 'make', 'model', 'asking_price', 'source', 'priority', 'notes', 'added_date', 'url', 'mileage', 'location', 'summary'];
function values(b) {
  return {
    year: b.year || '', make: b.make, model: b.model, asking_price: b.asking_price || 0, source: b.source || '',
    priority: b.priority || 'Medium', notes: b.notes || '', added_date: b.added_date || '',
    url: cleanUrl(b.url), mileage: String(b.mileage || ''), location: b.location || '', summary: b.summary || '',
  };
}

router.post('/', (req, res) => {
  const v = values(req.body);
  if (!v.make || !v.model) return res.status(400).json({ error: 'Make and model are required' });
  const result = db.prepare(`INSERT INTO watchlist (${FIELDS.join(', ')}) VALUES (${FIELDS.map(() => '?').join(', ')})`)
    .run(...FIELDS.map(f => v[f]));
  res.status(201).json(get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const v = values(req.body);
  if (!v.make || !v.model) return res.status(400).json({ error: 'Make and model are required' });
  db.prepare(`UPDATE watchlist SET ${FIELDS.map(f => `${f}=?`).join(', ')} WHERE id=?`).run(...FIELDS.map(f => v[f]), req.params.id);
  res.json(get(req.params.id));
});

// Your own photo
const photoUpload = (req, res, next) => upload.single('photo')(req, res, err => (err ? res.status(400).json({ error: err.message }) : next()));
router.post('/:id/photo', photoUpload, (req, res) => {
  if (!get(req.params.id)) return res.status(404).json({ error: 'Not found' });
  if (!req.file) return res.status(400).json({ error: 'Choose a photo' });
  const ext = IMAGE_TYPES[req.file.mimetype] || '.heic';
  savePhoto(req.params.id, req.file.buffer, ext);
  res.json(get(req.params.id));
});

// Photo taken from the listing (downloaded so it survives the listing going away)
router.post('/:id/photo-from-url', async (req, res) => {
  if (!get(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const url = cleanUrl(req.body.url);
  if (!url) return res.status(400).json({ error: 'No photo link' });
  try {
    const { buf, ext } = await downloadImage(url);
    savePhoto(req.params.id, buf, ext);
    res.json(get(req.params.id));
  } catch (e) { res.status(502).json({ error: `Couldn't get the photo: ${e.message}` }); }
});

router.delete('/:id/photo', (req, res) => {
  const w = get(req.params.id);
  if (!w) return res.status(404).json({ error: 'Not found' });
  removePhotoFile(w.photo_path);
  db.prepare("UPDATE watchlist SET photo_path = '' WHERE id = ?").run(req.params.id);
  res.json(get(req.params.id));
});

// Re-read the saved link: updates price/mileage/location (keeps your edits to
// make/model/notes), and grabs a photo if there isn't one yet.
router.post('/:id/refresh', async (req, res) => {
  const w = get(req.params.id);
  if (!w) return res.status(404).json({ error: 'Not found' });
  if (!w.url) return res.status(400).json({ error: 'No listing link saved for this car' });
  try {
    const d = await readListing(w.url);
    db.prepare('UPDATE watchlist SET asking_price = ?, mileage = ?, location = ?, summary = ?, last_checked = ? WHERE id = ?').run(
      d.price || w.asking_price, d.mileage ? String(d.mileage) : w.mileage, d.location || w.location,
      d.summary || w.summary, new Date().toISOString(), w.id);
    if (!w.photo_path && d.image) { try { const { buf, ext } = await downloadImage(d.image); savePhoto(w.id, buf, ext); } catch (_) {} }
    res.json({ item: get(w.id), priceChanged: d.price && d.price !== w.asking_price ? { from: w.asking_price, to: d.price } : null });
  } catch (e) { res.status(502).json({ error: `Couldn't read the listing: ${e.message}` }); }
});

router.delete('/:id', (req, res) => {
  removePhotoFile(get(req.params.id)?.photo_path);
  db.prepare('DELETE FROM watchlist WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
