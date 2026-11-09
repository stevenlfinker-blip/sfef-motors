const nodemailer = require('nodemailer');

const { SMTP_HOST = 'smtp.gmail.com', SMTP_PORT = '465', SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
const APP_URL = process.env.APP_URL || 'https://sfef-motors.onrender.com';

const transport = (SMTP_USER && SMTP_PASS)
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
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

module.exports = { sendEmail, notifyUsers, APP_URL };
