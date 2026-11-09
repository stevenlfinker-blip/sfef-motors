const db = require('./db');

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

module.exports = { MESSAGE_SELECT, postMessage, withFiles };
