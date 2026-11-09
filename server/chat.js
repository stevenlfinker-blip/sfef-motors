const path = require('path');
const fs = require('fs');
const db = require('./db');
const { notifyUsers } = require('./mailer');
const { handleOf } = require('./auth');

const MAX_LEN = 2000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 10;
const CHAT_DIR = path.join(__dirname, '..', 'data', 'uploads', 'chat');
fs.mkdirSync(CHAT_DIR, { recursive: true });
// SVG/HTML are deliberately absent: served from our own origin they could run
// script. Only raster images are ever displayed inline; the rest download.
const ALLOWED_EXT = /\.(jpe?g|png|gif|webp|heic|pdf|docx?|xlsx?|pptx?|txt|csv|zip|mp4|mov)$/i;

const MESSAGE_SELECT = `
  SELECT m.id, m.user_id, m.recipient_id, m.body, m.kind, m.work_order_id, m.created_at,
         COALESCE(u.name, 'Former member') AS name
  FROM messages m LEFT JOIN users u ON m.user_id = u.id
`;

// Attaches a `files` array ([{ id, name, type, size }]) to each message row
// with one query for the whole batch.
function withFiles(rows) {
  if (!rows.length) return rows;
  const files = db.prepare(
    `SELECT id, message_id, file_name AS name, file_type AS type, file_size AS size
     FROM message_files WHERE message_id IN (${rows.map(() => '?').join(',')}) ORDER BY id`
  ).all(...rows.map(r => r.id));
  const byMessage = new Map();
  for (const f of files) {
    if (!byMessage.has(f.message_id)) byMessage.set(f.message_id, []);
    byMessage.get(f.message_id).push({ id: f.id, name: f.name, type: f.type, size: f.size });
  }
  for (const r of rows) r.files = byMessage.get(r.id) || [];
  return rows;
}

// files: [{ path, name, type, size }]
function postMessage({ userId = null, recipientId = null, body, kind = 'chat', workOrderId = null, files = [] }) {
  const result = db.prepare(
    'INSERT INTO messages (user_id, recipient_id, body, kind, work_order_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, recipientId, body, kind, workOrderId, new Date().toISOString());
  const id = result.lastInsertRowid;
  const insertFile = db.prepare(
    'INSERT INTO message_files (message_id, file_path, file_name, file_type, file_size) VALUES (?, ?, ?, ?, ?)'
  );
  for (const f of files) insertFile.run(id, f.path, f.name, f.type, f.size);
  return withFiles([db.prepare(MESSAGE_SELECT + 'WHERE m.id = ?').get(id)])[0];
}

// Who gets emailed for a new chat message — shared by the web UI and replies
// that arrive by email. sender: users row. Replies to these emails come back
// into the same conversation.
function notifyForMessage({ sender, recipientId, body, files = [], isAlert = false }) {
  const emailBody = body + (files.length ? `${body ? '\n\n' : ''}[Attachments: ${files.map(f => f.name).join(', ')}]` : '');

  if (recipientId) {
    // Private messages always email the recipient (unless they've turned
    // email alerts off); the alert flag just marks it urgent.
    const to = db.prepare('SELECT * FROM users WHERE id = ?').get(recipientId);
    notifyUsers([to],
      `${isAlert ? '[URGENT] ' : ''}Private message from ${sender.name}`,
      `${sender.name} sent you a private message:\n\n${emailBody}`,
      sender.id);
    return;
  }

  const others = db.prepare('SELECT * FROM users WHERE id != ?').all(sender.id);
  if (isAlert) {
    notifyUsers(others, `[ALERT] ${sender.name}`, `${sender.name} sent a team alert:\n\n${emailBody}`);
  } else {
    const handles = new Set([...body.matchAll(/@([a-z0-9]+)/gi)].map(m => m[1].toLowerCase()));
    const mentioned = others.filter(u => handles.has(handleOf(u.name)));
    notifyUsers(mentioned, `${sender.name} mentioned you in SFEF chat`, `${sender.name} wrote:\n\n${emailBody}`);
  }
}

module.exports = {
  MESSAGE_SELECT, postMessage, withFiles, notifyForMessage,
  MAX_LEN, MAX_FILE_BYTES, MAX_FILES, CHAT_DIR, ALLOWED_EXT,
};
