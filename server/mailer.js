const nodemailer = require('nodemailer');

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

if (!transport) {
  console.warn('[mail] SMTP_USER / SMTP_PASS not set — emails will be logged to the console, not sent.');
}

// Never throws: a mail failure must not break the chat post or work-order
// save that triggered it.
async function sendEmail(to, subject, text) {
  if (!transport) {
    console.log(`[mail:dry-run] to=${to} subject=${subject}\n${text}\n`);
    return false;
  }
  try {
    await transport.sendMail({
      from: SMTP_FROM || `SFEF Motors <${SMTP_USER}>`,
      to, subject,
      text: `${text}\n\n— SFEF Motors\n${APP_URL}`,
    });
    return true;
  } catch (e) {
    console.error(`[mail] failed to send to ${to}: ${e.message}`);
    return false;
  }
}

// users: rows from the users table. Skips anyone who turned email alerts off.
function notifyUsers(users, subject, text) {
  for (const u of users) {
    if (u.notify_email && u.email) sendEmail(u.email, subject, text);
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

module.exports = { sendEmail, notifyUsers, testEmail, APP_URL };
