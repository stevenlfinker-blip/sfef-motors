const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cars (
      id SERIAL PRIMARY KEY,
      year TEXT,
      make TEXT,
      model TEXT,
      color TEXT DEFAULT '',
      mileage TEXT DEFAULT '',
      status TEXT DEFAULT 'Active',
      notes TEXT DEFAULT '',
      vin TEXT DEFAULT '',
      ownership TEXT DEFAULT '',
      registration TEXT DEFAULT '',
      insurance TEXT DEFAULT '',
      value NUMERIC DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS maintenance (
      id SERIAL PRIMARY KEY,
      car_id INTEGER REFERENCES cars(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      due_date TEXT,
      due_mileage TEXT DEFAULT '',
      completed SMALLINT DEFAULT 0,
      completed_date TEXT DEFAULT '',
      cost NUMERIC DEFAULT 0,
      notes TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS parts (
      id SERIAL PRIMARY KEY,
      car_id INTEGER REFERENCES cars(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      part_number TEXT DEFAULT '',
      quantity INTEGER DEFAULT 0,
      location TEXT DEFAULT '',
      cost_each NUMERIC DEFAULT 0,
      supplier TEXT DEFAULT '',
      notes TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS tools (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      brand TEXT DEFAULT '',
      category TEXT DEFAULT '',
      location TEXT DEFAULT '',
      condition TEXT DEFAULT 'Good',
      notes TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS cleaning (
      id SERIAL PRIMARY KEY,
      product TEXT NOT NULL,
      brand TEXT DEFAULT '',
      type TEXT DEFAULT '',
      qty NUMERIC DEFAULT 0,
      unit TEXT DEFAULT '',
      status TEXT DEFAULT 'In Stock'
    );

    CREATE TABLE IF NOT EXISTS costs (
      id SERIAL PRIMARY KEY,
      car_id INTEGER REFERENCES cars(id) ON DELETE SET NULL,
      category TEXT DEFAULT '',
      description TEXT NOT NULL,
      amount NUMERIC NOT NULL DEFAULT 0,
      date TEXT,
      receipt_path TEXT DEFAULT '',
      notes TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      car_id INTEGER REFERENCES cars(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      type TEXT DEFAULT '',
      location TEXT DEFAULT '',
      date TEXT,
      notes TEXT DEFAULT '',
      registered SMALLINT DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      id SERIAL PRIMARY KEY,
      year TEXT DEFAULT '',
      make TEXT NOT NULL,
      model TEXT NOT NULL,
      asking_price NUMERIC DEFAULT 0,
      source TEXT DEFAULT '',
      priority TEXT DEFAULT 'Medium',
      notes TEXT DEFAULT '',
      added_date TEXT DEFAULT ''
    );
  `);
}

module.exports = { pool, initDb };
