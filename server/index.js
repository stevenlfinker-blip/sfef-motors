const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

fs.mkdirSync(path.join(__dirname, '..', 'data', 'uploads'), { recursive: true });

app.use(express.json({ limit: '50mb' }));
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  SFEF MOTORS`);
  console.log(`  ---------`);
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
