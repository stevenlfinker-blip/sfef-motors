// Reply-by-email: reads replies to our notification emails from the Gmail
// inbox (IMAP) and posts them into the right chat conversation.
//
// Only runs where EMAIL_REPLIES=1 (set on Render only). If two copies of the
// app read the same inbox, they'd race for replies and post them into
// different databases.
const path = require('path');
const fs = require('fs');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const db = require('./db');
const { parseReplyAddress } = require('./mailer');
const {
  postMessage, notifyForMessage, MAX_LEN, MAX_FILE_BYTES, MAX_FILES, CHAT_DIR, ALLOWED_EXT,
} = require('./chat');

const { SMTP_USER, SMTP_PASS, IMAP_HOST = 'imap.gmail.com' } = process.env;
const POLL_MS = 30 * 1000;

// Remembers processed emails so a reply is never posted twice, even if
// marking it read in Gmail fails.
db.exec(`
  CREATE TABLE IF NOT EXISTS inbound_emails (
    message_id TEXT PRIMARY KEY,
    processed_at TEXT NOT NULL
  );
`);

// Keep only the new text of a reply: drop the quoted original email and
// common phone signatures.
function stripQuoted(text) {
  let t = String(text || '').replace(/\r\n/g, '\n');
  const cutPatterns = [
    /^On [^\n]{0,200}(\n[^\n]{0,200})?wrote:\s*$/m,     // Gmail / Apple Mail (may wrap onto 2 lines)
    /^-{2,}\s*Original Message\s*-{2,}/im,            // Outlook
    /^_{10,}\s*$/m,                                   // Outlook separator line
    /^From: .+\n(Sent|Date): /m,                      // Outlook header block
    /^Reply to this email to respond in SFEF chat\./m, // our own footer, if unquoted
  ];
  for (const re of cutPatterns) {
    const m = t.match(re);
    if (m) t = t.slice(0, m.index);
  }
  t = t.split('\n').filter(l => !l.startsWith('>')).join('\n');
  t = t.replace(/\n*Sent from my (iPhone|iPad|Android|Galaxy|mobile)[^\n]*\s*$/i, '');
  return t.trim().slice(0, MAX_LEN);
}

function _addresses(parsed) {
  return ['to', 'cc'].flatMap(k => parsed[k]?.value || []).map(a => a.address).filter(Boolean);
}

function _saveAttachments(parsed) {
  const out = [];
  for (const a of parsed.attachments || []) {
    if (out.length >= MAX_FILES) break;
    // Skip inline signature logos etc.; keep real attachments and photos.
    if (a.related && !/^image\//.test(a.contentType)) continue;
    const name = (a.filename || '').replace(/[\r\n"\\/]/g, '_').slice(0, 150);
    if (!name || !ALLOWED_EXT.test(name) || a.size > MAX_FILE_BYTES) continue;
    const stored = Date.now() + '-' + Math.random().toString(36).slice(2) + path.extname(name).toLowerCase();
    fs.writeFileSync(path.join(CHAT_DIR, stored), a.content);
    out.push({ path: stored, name, type: a.contentType, size: a.size });
  }
  return out;
}

// Returns a short outcome string (for logs/tests).
function handleEmail(parsed) {
  const msgId = parsed.messageId || `${parsed.date?.toISOString()}-${parsed.subject}`;
  if (db.prepare('SELECT 1 FROM inbound_emails WHERE message_id = ?').get(msgId)) return 'duplicate';
  const remember = () => db.prepare('INSERT OR IGNORE INTO inbound_emails (message_id, processed_at) VALUES (?, ?)')
    .run(msgId, new Date().toISOString());

  const token = _addresses(parsed).map(parseReplyAddress).find(Boolean);
  if (!token) { remember(); return 'no-token'; }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(token.userId);
  const from = (parsed.from?.value?.[0]?.address || '').toLowerCase();
  if (!user || from !== user.email) {
    console.warn(`[inbound] rejected reply: token for user ${token.userId}, sent from ${from || 'unknown'}`);
    remember();
    return 'sender-mismatch';
  }
  let peer = token.peer || null;
  if (peer && (peer === user.id || !db.prepare('SELECT id FROM users WHERE id = ?').get(peer))) peer = null; // partner removed → team room

  const body = stripQuoted(parsed.text);
  const files = _saveAttachments(parsed);
  remember();
  if (!body && !files.length) return 'empty';

  postMessage({ userId: user.id, recipientId: peer, body, files });
  notifyForMessage({ sender: user, recipientId: peer, body, files });
  console.log(`[inbound] posted reply from ${user.name} to ${peer ? 'private chat ' + peer : 'team room'}`);
  return 'posted';
}

let _running = false;
async function checkInbox() {
  if (_running) return;
  _running = true;
  const client = new ImapFlow({
    host: IMAP_HOST, port: 993, secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    logger: false,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      // Only touch unread mail sent to one of our +r reply addresses, so the
      // rest of the inbox (bounces, other mail) is left alone and unread.
      const [local, domain] = SMTP_USER.toLowerCase().split('@');
      const ours = new RegExp(`^${local.replace(/\./g, '\\.')}\\+r\\d+-\\d+-[0-9a-f]{16}@${domain.replace(/\./g, '\\.')}$`, 'i');
      const uids = [];
      for await (const m of client.fetch({ seen: false }, { envelope: true, uid: true })) {
        const addrs = [...(m.envelope.to || []), ...(m.envelope.cc || [])].map(a => a.address || '');
        if (addrs.some(a => ours.test(a))) uids.push(m.uid);
      }
      for (const uid of uids) {
        const { content } = await client.download(String(uid), undefined, { uid: true });
        const parsed = await simpleParser(content);
        try { handleEmail(parsed); }
        catch (e) { console.error('[inbound] failed to process a reply:', e.message); }
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      }
    } finally { lock.release(); }
    await client.logout();
  } catch (e) {
    console.error('[inbound] inbox check failed:', e.message);
    try { client.close(); } catch (_) {}
  } finally { _running = false; }
}

function start() {
  if (process.env.EMAIL_REPLIES !== '1') {
    console.log('[inbound] reply-by-email is off (set EMAIL_REPLIES=1 to enable — on ONE server only)');
    return;
  }
  if (!SMTP_USER || !SMTP_PASS) {
    console.warn('[inbound] EMAIL_REPLIES=1 but SMTP_USER / SMTP_PASS are not set');
    return;
  }
  console.log(`[inbound] checking ${SMTP_USER} for replies every ${POLL_MS / 1000}s`);
  checkInbox();
  setInterval(checkInbox, POLL_MS);
}

module.exports = { start, handleEmail, stripQuoted, checkInbox };
