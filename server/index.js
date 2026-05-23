require('dotenv').config();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const os = require('os');

const IS_PROD = process.env.NODE_ENV === 'production';

const app = express();
const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD;

if (!APP_PASSWORD) {
  console.error('ERROR: APP_PASSWORD is not set. Add it to your .env file.');
  process.exit(1);
}

// ── Trust Render/proxy headers for correct IP detection ──
app.set('trust proxy', 1);

fs.mkdirSync(path.join(__dirname, '..', 'data', 'uploads'), { recursive: true });

// ── Security headers ──────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // inline scripts — would need nonces to enable
}));

// Block search engines from indexing (private app)
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
});

// ── Rate limiters ─────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min window
  max: 10,                   // 10 attempts max
  message: 'Too many login attempts. Try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only count failures
});

// Generous limit for legitimate app use, blocks automated scraping
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict limit on the destructive import endpoint
const importLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many import attempts.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Body parsers ──────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// ── Sessions ──────────────────────────────────────
const sessionDir = path.join(__dirname, '..', 'data', 'sessions');
fs.mkdirSync(sessionDir, { recursive: true });

app.use(session({
  store: new FileStore({ path: sessionDir, retries: 1, logFn: () => {} }),
  secret: process.env.SESSION_SECRET || 'sfef-motors-dev',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: IS_PROD,       // HTTPS only on Render
    sameSite: 'strict',    // blocks cross-site request forgery
  },
}));

// ── Public routes (no auth) ───────────────────────
app.get('/login', (req, res) => {
  if (req.session.authenticated) return res.redirect('/');
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

app.post('/login', loginLimiter, (req, res) => {
  if (req.body.password === APP_PASSWORD) {
    // Regenerate session ID on login — prevents session fixation attacks
    req.session.regenerate(err => {
      if (err) return res.redirect('/login?error=1');
      req.session.authenticated = true;
      req.session.save(() => res.redirect('/'));
    });
  } else {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    console.warn(`[SECURITY] Failed login from ${ip} at ${new Date().toISOString()}`);
    res.redirect('/login?error=1');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ── Auth guard ────────────────────────────────────
app.use((req, res, next) => {
  if (req.session.authenticated) return next();
  if (req.path.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.redirect('/login');
});

// ── Protected static files & API ─────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'data', 'uploads')));

app.use('/api/', apiLimiter);
app.use('/api/import', importLimiter);

app.use('/api/cars', require('./routes/cars'));
app.use('/api/maintenance', require('./routes/maintenance'));
app.use('/api/parts', require('./routes/parts'));
app.use('/api/tools', require('./routes/tools'));
app.use('/api/cleaning', require('./routes/cleaning'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/events', require('./routes/events'));
app.use('/api/watchlist', require('./routes/watchlist'));
app.use('/api', require('./routes/import'));

// ── Start ─────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  SFEF MOTORS`);
  console.log(`  -----------`);
  console.log(`  Local:   http://localhost:${PORT}`);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  Network: http://${net.address}:${PORT}`);
      }
    }
  }
  console.log('');
});
