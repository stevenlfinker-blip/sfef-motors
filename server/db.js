const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'garage.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// One-time migration: rename costs → expenses
try { db.exec('ALTER TABLE costs RENAME TO expenses'); } catch (e) { /* already done or doesn't exist */ }
// One-time migration: add vendor column to expenses
try { db.exec("ALTER TABLE expenses ADD COLUMN vendor TEXT DEFAULT ''"); } catch (e) { /* already exists */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS cars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    value REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS maintenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    car_id INTEGER,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    due_date TEXT,
    due_mileage TEXT DEFAULT '',
    completed INTEGER DEFAULT 0,
    completed_date TEXT DEFAULT '',
    cost REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    car_id INTEGER,
    name TEXT NOT NULL,
    part_number TEXT DEFAULT '',
    quantity INTEGER DEFAULT 0,
    location TEXT DEFAULT '',
    cost_each REAL DEFAULT 0,
    supplier TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    brand TEXT DEFAULT '',
    category TEXT DEFAULT '',
    location TEXT DEFAULT '',
    condition TEXT DEFAULT 'Good',
    notes TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS cleaning (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product TEXT NOT NULL,
    brand TEXT DEFAULT '',
    type TEXT DEFAULT '',
    qty REAL DEFAULT 0,
    unit TEXT DEFAULT '',
    status TEXT DEFAULT 'In Stock'
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    car_id INTEGER,
    vendor TEXT DEFAULT '',
    category TEXT DEFAULT '',
    description TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    date TEXT,
    receipt_path TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    car_id INTEGER,
    title TEXT NOT NULL,
    type TEXT DEFAULT '',
    location TEXT DEFAULT '',
    date TEXT,
    notes TEXT DEFAULT '',
    registered INTEGER DEFAULT 0,
    FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year TEXT DEFAULT '',
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    asking_price REAL DEFAULT 0,
    source TEXT DEFAULT '',
    priority TEXT DEFAULT 'Medium',
    notes TEXT DEFAULT '',
    added_date TEXT DEFAULT ''
  );
`);

module.exports = db;
