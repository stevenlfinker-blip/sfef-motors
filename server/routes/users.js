const express = require('express');
const router = express.Router();
const db = require('../db');
const { hashPassword, verifyPassword, handleOf } = require('../auth');
const { testEmail } = require('../mailer');

const PUBLIC = 'id, name, is_admin, notify_email';
const FULL = 'id, name, email, is_admin, notify_email, notify_push, push_previews, created_at';
const MIN_PASSWORD = 8;

function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admins only' });
  next();
}

// @mentions match on the first word of a name, so two people can't share one.
function handleTaken(name, exceptId) {
  const h = handleOf(name);
  return !h || db.prepare('SELECT id, name FROM users').all()
    .some(u => u.id !== exceptId && handleOf(u.name) === h);
}

function validate({ name, email, password }, { passwordRequired }) {
  if (!name?.trim()) return 'Name is required';
  if (!/^\S+@\S+\.\S+$/.test(email || '')) return 'A valid email is required';
  if (password || passwordRequired) {
    if (!password || password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`;
  }
  return null;
}

router.get('/', (req, res) => {
  res.json(db.prepare(`SELECT ${req.user?.isAdmin ? FULL : PUBLIC} FROM users ORDER BY name`).all());
});

router.get('/me', (req, res) => {
  const me = req.user.id ? db.prepare(`SELECT ${FULL} FROM users WHERE id = ?`).get(req.user.id) : null;
  res.json({
    id: req.user.id, name: req.user.name, isAdmin: req.user.isAdmin, email: me?.email || '',
    notify_email: me ? me.notify_email : 0, notify_push: me ? me.notify_push : 0, push_previews: me ? me.push_previews : 1,
  });
});

router.put('/me', (req, res) => {
  if (!req.user.id) return res.status(400).json({ error: 'Shared-password sessions have no profile' });
  const { notify_email, notify_push, push_previews, password, current_password } = req.body;
  for (const [col, val] of [['notify_email', notify_email], ['notify_push', notify_push], ['push_previews', push_previews]]) {
    if (val !== undefined) db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).run(val ? 1 : 0, req.user.id);
  }
  if (password) {
    if (password.length < MIN_PASSWORD) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(current_password || '', row.password_hash)) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), req.user.id);
  }
  res.json({ success: true });
});

router.post('/test-email', requireAdmin, async (req, res) => {
  const to = String(req.body.to || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(to)) return res.status(400).json({ error: 'Enter a valid email address' });
  res.json(await testEmail(to));
});

router.post('/', requireAdmin, (req, res) => {
  const err = validate(req.body, { passwordRequired: true });
  if (err) return res.status(400).json({ error: err });
  const { name, email, password, is_admin, notify_email } = req.body;
  if (handleTaken(name)) return res.status(400).json({ error: 'Another member already has that first name — @mentions need it to be unique' });
  try {
    const r = db.prepare(
      'INSERT INTO users (name, email, password_hash, is_admin, notify_email, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name.trim(), email.trim().toLowerCase(), hashPassword(password), is_admin ? 1 : 0, notify_email === 0 ? 0 : 1, new Date().toISOString());
    res.status(201).json(db.prepare(`SELECT ${FULL} FROM users WHERE id = ?`).get(r.lastInsertRowid));
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return res.status(400).json({ error: 'That email is already in use' });
    throw e;
  }
});

router.put('/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const err = validate(req.body, { passwordRequired: false });
  if (err) return res.status(400).json({ error: err });
  const { name, email, password, is_admin, notify_email } = req.body;
  if (id === req.user.id && !is_admin) return res.status(400).json({ error: "You can't remove your own admin access" });
  if (handleTaken(name, id)) return res.status(400).json({ error: 'Another member already has that first name — @mentions need it to be unique' });
  try {
    db.prepare('UPDATE users SET name=?, email=?, is_admin=?, notify_email=?, password_hash=? WHERE id=?').run(
      name.trim(), email.trim().toLowerCase(), is_admin ? 1 : 0, notify_email === 0 ? 0 : 1,
      password ? hashPassword(password) : existing.password_hash, id
    );
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return res.status(400).json({ error: 'That email is already in use' });
    throw e;
  }
  res.json(db.prepare(`SELECT ${FULL} FROM users WHERE id = ?`).get(id));
});

router.delete('/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: "You can't delete yourself" });
  db.prepare('UPDATE maintenance SET assigned_to = NULL WHERE assigned_to = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ success: true });
});

module.exports = router;
