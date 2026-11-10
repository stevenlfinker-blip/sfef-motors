// Web push notifications (phone/desktop banners), sent alongside email.
//
// Keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY from the environment if set,
// otherwise generated once and kept in data/vapid.json (on Render that's the
// persistent disk, so they survive deploys). Changing keys would silently
// break every device's subscription, so they must stay stable.
const path = require('path');
const fs = require('fs');
const webpush = require('web-push');
const db = require('./db');

db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );
`);
// Delivery tracking: what the push service said, and when the device's
// service worker confirmed it actually received the notification.
for (const col of ['last_sent_at TEXT', "last_result TEXT DEFAULT ''", 'last_received_at TEXT', "last_device_error TEXT DEFAULT ''"]) {
  try { db.exec(`ALTER TABLE push_subscriptions ADD COLUMN ${col}`); } catch (e) { /* already exists */ }
}
try { db.exec("ALTER TABLE users ADD COLUMN notify_push INTEGER DEFAULT 1"); } catch (e) { /* already exists */ }
try { db.exec("ALTER TABLE users ADD COLUMN push_previews INTEGER DEFAULT 1"); } catch (e) { /* already exists */ }

function loadKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const file = path.join(__dirname, '..', 'data', 'vapid.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* first run */ }
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  console.log('[push] generated new VAPID keys in data/vapid.json');
  return keys;
}

const KEYS = loadKeys();
webpush.setVapidDetails(
  `mailto:${process.env.SMTP_USER || 'admin@sfef-motors.local'}`,
  KEYS.publicKey,
  KEYS.privateKey,
);

function saveSubscription(userId, sub, userAgent = '') {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('Invalid subscription');
  // Same device signing in as someone else re-points the subscription to them.
  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh,
      auth = excluded.auth, user_agent = excluded.user_agent`
  ).run(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, String(userAgent).slice(0, 200), new Date().toISOString());
}

function removeSubscription(endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

// payload: { title, body, url, tag }. Returns { sent, failed }. Never throws.
async function sendToUser(userId, payload) {
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  let sent = 0, failed = 0;
  const mark = db.prepare('UPDATE push_subscriptions SET last_sent_at = ?, last_result = ? WHERE id = ?');
  await Promise.all(subs.map(async s => {
    try {
      // sid lets the device's service worker report back that it got it.
      const r = await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ ...payload, sid: s.id }),
        { TTL: 24 * 60 * 60, urgency: 'high' },
      );
      mark.run(new Date().toISOString(), `accepted (${r.statusCode})`, s.id);
      sent++;
    } catch (e) {
      failed++;
      mark.run(new Date().toISOString(), `rejected (${e.statusCode || e.code || 'error'}): ${String(e.body || e.message).slice(0, 150)}`, s.id);
      // 404/410: the device unsubscribed or the app was removed — forget it.
      if (e.statusCode === 404 || e.statusCode === 410) removeSubscription(s.endpoint);
      else console.error(`[push] send failed (${e.statusCode || e.code || ''}): ${e.body || e.message}`);
    }
  }));
  return { sent, failed };
}

// users: rows from the users table. Skips anyone who turned push off.
// payload may be a function of the user (for per-user preview settings).
function pushUsers(users, payload) {
  for (const u of users) {
    if (!u || !u.notify_push) continue;
    sendToUser(u.id, typeof payload === 'function' ? payload(u) : payload);
  }
}

module.exports = { publicKey: KEYS.publicKey, saveSubscription, removeSubscription, sendToUser, pushUsers };
