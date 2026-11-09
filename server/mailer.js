const nodemailer = require('nodemailer');
const crypto = require('crypto');

const { SMTP_HOST = 'smtp.gmail.com', SMTP_PORT = '465', SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
const APP_URL = process.env.APP_URL || 'https://sfef-motors.onrender.com';

const transport = (SMTP_USER && SMTP_PASS)
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      // fail fast instead of hanging for minutes if the host blocks SMTP
      connectionTimeout: 15000,
      greetingTimeout: 15000,
    })
  : null;

// ── Reply-by-email ──────────────────────────────────────────────────────────
// Each notification gets Reply-To: <user>+r<userId>-<peer>-<sig>@<domain>.
// Gmail delivers +addresses to the normal inbox; server/inbound.js reads them
// back. peer 0 = team room, otherwise the private chat with that user. The
// HMAC stops anyone from forging a token to post as someone else.
const REPLY_SECRET = process.env.SESSION_SECRET || 'sfef-motors-dev';

function _sig(userId, peer) {
  return crypto.createHmac('sha256', REPLY_SECRET).update(`reply:${userId}:${peer}`).digest('hex').slice(0, 16);
}

function replyAddress(userId, peer) {
  if (!SMTP_USER) return null;
  const [local, domain] = SMTP_USER.split('@');
  return `${local}+r${userId}-${peer}-${_sig(userId, peer)}@${domain}`;
}

// Returns { userId, peer } for a valid reply address, else null.
function parseReplyAddress(address) {
  if (!SMTP_USER) return null;
  const [local, domain] = SMTP_USER.toLowerCase().split('@');
  const m = String(address || '').toLowerCase().match(/^([^+@]+)\+r(\d+)-(\d+)-([0-9a-f]{16})@(.+)$/);
  if (!m || m[1] !== local || m[5] !== domain) return null;
  const userId = Number(m[2]), peer = Number(m[3]);
  const expected = _sig(userId, peer);
  if (!crypto.timingSafeEqual(Buffer.from(m[4]), Buffer.from(expected))) return null;
  return { userId, peer };
}

if (!transport) {
  console.warn('[mail] SMTP_USER / SMTP_PASS not set — emails will be logged to the console, not sent.');
}

// Never throws: a mail failure must not break the chat post or work-order
// save that triggered it.
async function sendEmail(to, subject, text, { replyTo } = {}) {
  if (!transport) {
    console.log(`[mail:dry-run] to=${to} subject=${subject}${replyTo ? ` replyTo=${replyTo}` : ''}\n${text}\n`);
    return false;
  }
  try {
    await transport.sendMail({
      from: SMTP_FROM || `SFEF Motors <${SMTP_USER}>`,
      to, subject, replyTo,
      text: `${text}\n\n${replyTo ? 'Reply to this email to respond in SFEF chat.\n' : ''}— SFEF Motors\n${APP_URL}`,
    });
    return true;
  } catch (e) {
    console.error(`[mail] failed to send to ${to}: ${e.message}`);
    return false;
  }
}

// users: rows from the users table. Skips anyone who turned email alerts off.
// peer: where a reply to this email should land — 0 for the team room, or the
// user id of the private chat partner (a number, or a function of the user).
function notifyUsers(users, subject, text, peer = 0) {
  for (const u of users) {
    if (!u.notify_email || !u.email) continue;
    const p = typeof peer === 'function' ? peer(u) : peer;
    sendEmail(u.email, subject, text, { replyTo: replyAddress(u.id, p || 0) });
  }
}

// For the admin "Send test email" button: sends immediately and reports the
// real outcome, with a plain-English hint for the common failures.
async function testEmail(to) {
  if (!transport) {
    return { ok: false, error: 'SMTP_USER / SMTP_PASS are not set on this server', hint: 'Add both in the Render dashboard under Environment, then save.' };
  }
  try {
    await transport.sendMail({
      from: SMTP_FROM || `SFEF Motors <${SMTP_USER}>`,
      to,
      subject: 'SFEF Motors test email',
      text: `This is a test from SFEF Motors. If you can read it, email alerts are working.\n\n— SFEF Motors\n${APP_URL}`,
    });
    return { ok: true, from: SMTP_USER };
  } catch (e) {
    const msg = `${e.code || ''} ${e.response || e.message}`.trim();
    let hint = '';
    if (/ETIMEDOUT|ECONNREFUSED|ESOCKET|ECONNECTION|timeout/i.test(msg)) hint = 'The server could not reach Gmail — the host is likely blocking email ports. Switching to an email API (e.g. Brevo) fixes this.';
    else if (/EAUTH|535|Invalid login|Username and Password/i.test(msg)) hint = 'Gmail rejected the login — re-check SMTP_USER and the 16-character app password (SMTP_PASS).';
    return { ok: false, error: msg, hint, from: SMTP_USER };
  }
}

module.exports = { sendEmail, notifyUsers, testEmail, replyAddress, parseReplyAddress, APP_URL };
