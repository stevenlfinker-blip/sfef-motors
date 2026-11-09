const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const db = require('../db');
const { MESSAGE_SELECT, postMessage, withFiles } = require('../chat');
const { notifyUsers } = require('../mailer');
const { handleOf } = require('../auth');

const MAX_LEN = 2000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 10;
const CHAT_DIR = path.join(__dirname, '..', '..', 'data', 'uploads', 'chat');
fs.mkdirSync(CHAT_DIR, { recursive: true });

// SVG/HTML are deliberately absent: served from our own origin they could run
// script. Only raster images are ever displayed inline; the rest download.
const INLINE_IMAGE = /\.(jpe?g|png|gif|webp)$/i;
const ALLOWED_EXT = /\.(jpe?g|png|gif|webp|heic|pdf|docx?|xlsx?|pptx?|txt|csv|zip|mp4|mov)$/i;

const upload = multer({
  storage: multer.diskStorage({
    destination: CHAT_DIR,
    filename: (req, file, cb) =>
      cb(null, Date.now() + '-' + Math.random().toString(36).slice(2) + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
  fileFilter: (req, file, cb) =>
    ALLOWED_EXT.test(path.extname(file.originalname))
      ? cb(null, true)
      : cb(new Error('That file type is not allowed (images, PDF, Office docs, text/CSV, zip and video are)')),
});

// multer decodes filenames as latin1; recover the real UTF-8 name for display.
const displayName = n => Buffer.from(n, 'latin1').toString('utf8').replace(/[\r\n"\\/]/g, '_').slice(0, 150);

function runUpload(req, res, next) {
  upload.array('files', MAX_FILES)(req, res, err => {
    if (!err) return next();
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `A file is too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB each)`
      : err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT' ? `Too many files (max ${MAX_FILES} per message)`
      : err.message;
    res.status(400).json({ error: msg });
  });
}

function requireMember(req, res, next) {
  if (!req.user?.id) {
    return res.status(403).json({ error: 'Sign in with your own account to use chat.' });
  }
  next();
}

// Conversation filter. peer null = the team room (never includes private
// messages); otherwise only the two-person thread between me and peer.
function convoWhere(me, peer) {
  return peer
    ? { sql: '((m.user_id = ? AND m.recipient_id = ?) OR (m.user_id = ? AND m.recipient_id = ?))', args: [me, peer, peer, me] }
    : { sql: 'm.recipient_id IS NULL', args: [] };
}

function parsePeer(raw, req, res) {
  const peer = Number(raw) || null;
  if (!peer) return { peer: null };
  if (!req.user.id) { res.status(403).json({ error: 'Sign in with your own account to use private chats.' }); return { bad: true }; }
  if (peer === req.user.id || !db.prepare('SELECT id FROM users WHERE id = ?').get(peer)) {
    res.status(400).json({ error: 'Unknown member' }); return { bad: true };
  }
  return { peer };
}

// ?with=<userId> selects a private chat (default: team room).
// Without ?after: the latest 100 messages. With ?after=<id>: anything newer.
router.get('/', (req, res) => {
  const { peer, bad } = parsePeer(req.query.with, req, res);
  if (bad) return;
  const w = convoWhere(req.user.id, peer);
  const after = parseInt(req.query.after, 10);
  if (after > 0) {
    return res.json(withFiles(db.prepare(MESSAGE_SELECT + `WHERE m.id > ? AND ${w.sql} ORDER BY m.id ASC LIMIT 200`).all(after, ...w.args)));
  }
  const rows = db.prepare(MESSAGE_SELECT + `WHERE ${w.sql} ORDER BY m.id DESC LIMIT 100`).all(...w.args);
  res.json(withFiles(rows.reverse()));
});

// { total, team, dms: { <peerId>: count } }
router.get('/unread', (req, res) => {
  const empty = { total: 0, team: 0, dms: {} };
  if (!req.user?.id) return res.json(empty);
  const me = req.user.id;
  const read = peer => db.prepare('SELECT last_read_id FROM chat_reads WHERE user_id = ? AND peer_id = ?').get(me, peer)?.last_read_id || 0;
  const team = db.prepare(
    'SELECT COUNT(*) AS n FROM messages WHERE recipient_id IS NULL AND id > ? AND (user_id IS NULL OR user_id != ?)'
  ).get(read(0), me).n;
  const dms = {};
  const rows = db.prepare(`
    SELECT m.user_id AS peer, COUNT(*) AS n FROM messages m
    LEFT JOIN chat_reads r ON r.user_id = ? AND r.peer_id = m.user_id
    WHERE m.recipient_id = ? AND m.id > COALESCE(r.last_read_id, 0)
    GROUP BY m.user_id`).all(me, me);
  let total = team;
  for (const r of rows) { dms[r.peer] = r.n; total += r.n; }
  res.json({ total, team, dms });
});

router.post('/read', requireMember, (req, res) => {
  const { peer, bad } = parsePeer(req.body.with, req, res);
  if (bad) return;
  const w = convoWhere(req.user.id, peer);
  const { maxId } = db.prepare(`SELECT COALESCE(MAX(m.id), 0) AS maxId FROM messages m WHERE ${w.sql}`).get(...w.args);
  db.prepare(
    `INSERT INTO chat_reads (user_id, peer_id, last_read_id) VALUES (?, ?, ?)
     ON CONFLICT(user_id, peer_id) DO UPDATE SET last_read_id = excluded.last_read_id`
  ).run(req.user.id, peer || 0, maxId);
  res.json({ success: true });
});

// Authenticated download by message id (no client-supplied paths).
router.get('/file/:id', (req, res) => {
  const m = db.prepare(`
    SELECT f.file_path, f.file_name, g.user_id, g.recipient_id
    FROM message_files f JOIN messages g ON g.id = f.message_id WHERE f.id = ?`).get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  // Files in a private chat are only for its two participants.
  if (m.recipient_id && req.user.id !== m.user_id && req.user.id !== m.recipient_id) {
    return res.status(404).json({ error: 'Not found' });
  }
  const full = path.join(CHAT_DIR, path.basename(m.file_path));
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'File is gone' });
  if (INLINE_IMAGE.test(m.file_path)) return res.sendFile(full);
  res.download(full, m.file_name);
});

router.post('/', requireMember, runUpload, (req, res) => {
  const body = String(req.body.body || '').trim();
  const uploaded = req.files || [];
  const discard = () => uploaded.forEach(f => fs.unlink(f.path, () => {}));
  const fail = (code, error) => { discard(); return res.status(code).json({ error }); };
  if (!body && !uploaded.length) return fail(400, 'Message is empty');
  if (body.length > MAX_LEN) return fail(400, `Message too long (max ${MAX_LEN})`);

  // `to` = private message to that member; absent = the team room
  const recipient = Number(req.body.to) || null;
  if (recipient && (recipient === req.user.id || !db.prepare('SELECT id FROM users WHERE id = ?').get(recipient))) {
    return fail(400, 'Unknown member');
  }

  // multipart fields arrive as strings, so "0"/"false" must not count as true
  const isAlert = req.body.alert === true || req.body.alert === '1' || req.body.alert === 'true';
  const files = uploaded.map(f => ({
    path: f.filename, name: displayName(f.originalname), type: f.mimetype, size: f.size,
  }));
  const message = postMessage({ userId: req.user.id, recipientId: recipient, body, kind: isAlert ? 'alert' : 'chat', files });
  const emailBody = body + (files.length ? `${body ? '\n\n' : ''}[Attachments: ${files.map(f => f.name).join(', ')}]` : '');

  if (recipient) {
    // Private messages always email the recipient (unless they've turned
    // email alerts off); the alert flag just marks it urgent.
    const to = db.prepare('SELECT * FROM users WHERE id = ?').get(recipient);
    notifyUsers([to],
      `${isAlert ? '[URGENT] ' : ''}Private message from ${req.user.name}`,
      `${req.user.name} sent you a private message:\n\n${emailBody}`);
    return res.status(201).json(message);
  }

  const others = db.prepare('SELECT * FROM users WHERE id != ?').all(req.user.id);
  if (isAlert) {
    notifyUsers(others, `[ALERT] ${req.user.name}`, `${req.user.name} sent a team alert:\n\n${emailBody}`);
  } else {
    const handles = new Set([...body.matchAll(/@([a-z0-9]+)/gi)].map(m => m[1].toLowerCase()));
    const mentioned = others.filter(u => handles.has(handleOf(u.name)));
    notifyUsers(mentioned, `${req.user.name} mentioned you in SFEF chat`, `${req.user.name} wrote:\n\n${emailBody}`);
  }
  res.status(201).json(message);
});

module.exports = router;
