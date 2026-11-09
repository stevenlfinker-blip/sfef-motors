const crypto = require('crypto');

// scrypt via node:crypto — no extra dependency. Stored as "salt:hash" (hex).
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Burned on unknown-email logins so response time doesn't reveal which
// emails have accounts.
const DUMMY_HASH = hashPassword('not-a-real-password');

// @mention handle = first word of the name, letters/digits only, lowercase.
function handleOf(name) {
  return String(name || '').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '');
}

module.exports = { hashPassword, verifyPassword, DUMMY_HASH, handleOf };
