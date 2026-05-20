require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD;

if (!APP_PASSWORD) {
  console.error('ERROR: APP_PASSWORD is not set. Add it to your .env file.');
  process.exit(1);
}

fs.mkdirSync(path.join(__dirname, '..', 'data', 'uploads'), { recursive: true });

// ── Body parsers ──────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false }));

// ── Sessions ──────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'sfef-motors-dev',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days — stay logged in
    httpOnly: true,
  },
}));

// ── Public routes (no auth) ───────────────────────
app.get('/login', (req, res) => {
  if (req.session.authenticated) return res.redirect('/');
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  if (req.body.password === APP_PASSWORD) {
    req.session.authenticated = true;
    res.redirect('/');
  } else {
    res.redirect('/login?error=1');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ── Auth guard ────────────────────────────────────
app.use((req, res, next) => {
  if (req.session.authenticated) return next();
  // Return 401 for API calls, redirect for page requests
  if (req.path.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.redirect('/login');
});

// ── Protected static files & API ─────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'data', 'uploads')));

app.use('/api/cars', require('./routes/cars'));
app.use('/api/maintenance', require('./routes/maintenance'));
app.use('/api/parts', require('./routes/parts'));
app.use('/api/tools', require('./routes/tools'));
app.use('/api/cleaning', require('./routes/cleaning'));
app.use('/api/costs', require('./routes/costs'));
app.use('/api/events', require('./routes/events'));
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
