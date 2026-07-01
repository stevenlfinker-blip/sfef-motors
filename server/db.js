const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'garage.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// One-time migration: add purchase_price column to cars
try { db.exec("ALTER TABLE cars ADD COLUMN purchase_price REAL DEFAULT 0"); } catch (e) { /* already exists */ }

// One-time migration: add sources column to car_valuations
try { db.exec("ALTER TABLE car_valuations ADD COLUMN sources TEXT DEFAULT '[]'"); } catch (e) { /* already exists */ }

// One-time migration: rename costs → expenses
try { db.exec('ALTER TABLE costs RENAME TO expenses'); } catch (e) { /* already done or doesn't exist */ }
// One-time migration: add vendor column to expenses
try { db.exec("ALTER TABLE expenses ADD COLUMN vendor TEXT DEFAULT ''"); } catch (e) { /* already exists */ }
// One-time migration: add expense_type column to expenses
try { db.exec("ALTER TABLE expenses ADD COLUMN expense_type TEXT DEFAULT ''"); } catch (e) { /* already exists */ }
// One-time migration: add category column to cars, and backfill known
// categories for pre-existing rows. Both run only when the column is
// actually being added — never again — so later manual edits to a car's
// category stick across restarts instead of being reset on every boot.
try {
  db.exec("ALTER TABLE cars ADD COLUMN category TEXT DEFAULT 'Daily'");
  db.exec("UPDATE cars SET category='Collectable' WHERE (make='Porsche' AND model NOT LIKE '%Macan%') OR (make='Ferrari') OR (make='Ford' AND year < 1980)");
  db.exec("UPDATE cars SET category='Lease' WHERE ownership='Lease'");
} catch (e) { /* already exists */ }

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
    value REAL DEFAULT 0,
    category TEXT DEFAULT 'Daily'
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
    expense_type TEXT DEFAULT '',
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

  CREATE TABLE IF NOT EXISTS other_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    notes TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS car_valuations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    car_id INTEGER NOT NULL,
    low REAL,
    avg REAL,
    high REAL,
    trend TEXT DEFAULT '',
    market_note TEXT DEFAULT '',
    sources TEXT DEFAULT '[]',
    fetched_at TEXT NOT NULL,
    FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE CASCADE
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

// ── Seed estimated market history (runs once if missing) ──────────────────────
(function seedMarketHistory() {
  const existing = db.prepare(
    "SELECT COUNT(*) as n FROM car_valuations WHERE fetched_at < '2026-06-01'"
  ).get();
  if (existing.n >= 20) return; // already seeded

  const insert = db.prepare(
    'INSERT INTO car_valuations (car_id, low, avg, high, trend, market_note, sources, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const SEED = [
    // 2018 Porsche 911 GT2RS — appreciating, anchored to real BaT/RM comps
    { car_id:1, months:[
      ['2025-07-15',330000,'Appreciating','Estimated Jul 2025: GT2RS market establishing floor; non-Weissach examples with 4K miles trading $310-355K following Monterey results.'],
      ['2025-08-15',345000,'Appreciating','Estimated Aug 2025: Monterey Car Week; Weissach editions trading $370-400K at RM/Gooding; non-Weissach ~10-15% below.'],
      ['2025-09-15',365000,'Appreciating','Estimated Sep 2025: Post-Monterey demand sustaining appreciation; BaT comps settling $350-380K range.'],
      ['2025-10-15',395000,'Appreciating','Estimated Oct 2025: Fall collector market showing continued GT2RS strength; limited supply supporting upward price pressure.'],
      ['2025-11-15',425000,'Appreciating','Estimated Nov 2025: BaT sold 3300-mile Weissach for $500,033; non-Weissach black 4K-mile example estimated $415-440K.'],
      ['2025-12-15',440000,'Appreciating','Estimated Dec 2025: Year-end transactions confirming $430-460K floor for moderate-mileage GT2RS examples.'],
      ['2026-01-15',460000,'Appreciating','Estimated Jan 2026: Arizona auction season; BaT comps anchored near $450-470K for black examples with ~4K miles.'],
      ['2026-02-15',490000,'Appreciating','Estimated Feb 2026: BaT listings trending sharply upward; multiple Weissach examples listed above $520K.'],
      ['2026-03-15',520000,'Appreciating','Estimated Mar 2026: BaT sold a Weissach for $548K; non-Weissach black examples estimated ~$510-530K.'],
      ['2026-04-15',550000,'Appreciating','Estimated Apr 2026: 531-mile Grey Black GT2RS sold on BaT for $608K; accelerating market.'],
      ['2026-05-15',575000,'Appreciating','Estimated May 2026: RM Sotheby\'s Miami Weissach sold for $747K; non-Weissach black comparable estimated $560-590K.'],
    ]},
    // 2019 Porsche 911 Speedster — Heritage Package, PTS Grey, appreciating
    { car_id:2, months:[
      ['2025-07-15',260000,'Appreciating','Estimated Jul 2025: Speedster post-Monterey; Heritage Package PTS examples trading $250-275K.'],
      ['2025-08-15',275000,'Appreciating','Estimated Aug 2025: Monterey auction results showing collector appetite; $270-290K range.'],
      ['2025-09-15',292000,'Appreciating','Estimated Sep 2025: Sustained demand; PTS Grey Heritage examples strengthening above $280K.'],
      ['2025-10-15',310000,'Appreciating','Estimated Oct 2025: Fall auction circuit; limited supply (1,948 built) driving appreciation.'],
      ['2025-11-15',328000,'Appreciating','Estimated Nov 2025: BaT Heritage Speedsters approaching $330-340K; PTS Grey adding 5-8% premium.'],
      ['2025-12-15',345000,'Appreciating','Estimated Dec 2025: Heritage Package Speedsters consistently above $330K; low-mileage pushing $350K.'],
      ['2026-01-15',365000,'Appreciating','Estimated Jan 2026: Arizona season; Speedster Heritage comps $355-380K for PTS examples under 3K miles.'],
      ['2026-02-15',390000,'Appreciating','Estimated Feb 2026: Strong early 2026 demand; Heritage PTS tracking toward $400K.'],
      ['2026-03-15',415000,'Appreciating','Estimated Mar 2026: Spring season; PTS Heritage approaching $420K in private transactions.'],
      ['2026-04-15',440000,'Appreciating','Estimated Apr 2026: Spring momentum; 2,820-mile PTS Grey Heritage estimated $430-455K.'],
      ['2026-05-15',460000,'Appreciating','Estimated May 2026: BaT Speedster Heritage comps pushing $450-470K ahead of Monterey.'],
    ]},
    // 1996 Ferrari 512M Testarossa — Corsa Rosa, appreciating
    { car_id:3, months:[
      ['2025-07-15',390000,'Appreciating','Estimated Jul 2025: Ferrari 512M building momentum; Corsa Rosa commanding 12-18% over Rosso Corsa; $370-415K at summer auctions.'],
      ['2025-08-15',405000,'Appreciating','Estimated Aug 2025: Monterey; flat-12 Ferraris seeing renewed collector interest; $390-430K range.'],
      ['2025-09-15',420000,'Appreciating','Estimated Sep 2025: Post-Monterey demand holding; European results showing international buyer appetite.'],
      ['2025-10-15',438000,'Appreciating','Estimated Oct 2025: Fall market; 512M with documented history consistently $420-455K.'],
      ['2025-11-15',455000,'Appreciating','Estimated Nov 2025: Late-year results supporting continued appreciation; Corsa Rosa examples rare.'],
      ['2025-12-15',472000,'Appreciating','Estimated Dec 2025: 512M firmly above $450K for clean original-color matching-numbers examples.'],
      ['2026-01-15',488000,'Appreciating','Estimated Jan 2026: Scottsdale results for classic Ferraris supporting $475-505K for 512M with provenance.'],
      ['2026-02-15',505000,'Appreciating','Estimated Feb 2026: Flat-12 Ferrari segment outpacing general classic car market.'],
      ['2026-03-15',522000,'Appreciating','Estimated Mar 2026: RM/Bonhams European results confirming $500-545K for top-spec 512M.'],
      ['2026-04-15',545000,'Appreciating','Estimated Apr 2026: Corsa Rosa 512M with service records approaching $550K threshold.'],
      ['2026-05-15',560000,'Appreciating','Estimated May 2026: Pre-Monterey; Corsa Rosa and documented history placing at top of comparable market.'],
    ]},
    // 2026 Porsche 911 GT3 Touring — depreciating from allocation premium highs
    { car_id:4, months:[
      ['2025-07-15',405000,'Depreciating','Estimated Jul 2025: 2026 GT3 Touring commanding allocation premiums on near-new delivery; $380-430K based on 992.2 demand patterns.'],
      ['2025-08-15',398000,'Depreciating','Estimated Aug 2025: Monterey; GT3 Touring low-mileage examples holding $370-415K; early softening from peak.'],
      ['2025-09-15',388000,'Depreciating','Estimated Sep 2025: Supply increasing as deliveries ramp; prices easing from summer peaks.'],
      ['2025-10-15',378000,'Depreciating','Estimated Oct 2025: BaT comps for GT3 Touring reflecting $360-400K for under-2K-mile examples.'],
      ['2025-11-15',368000,'Depreciating','Estimated Nov 2025: Allocation premiums largely dissipated; 1,200-mile examples $355-385K.'],
      ['2025-12-15',358000,'Depreciating','Estimated Dec 2025: CarGurus showing YoY price pressure; clean examples in $345-375K range.'],
      ['2026-01-15',370000,'Depreciating','Estimated Jan 2026: Scottsdale lifted briefly; Bonhams sold 19-mile example for $373,500; 1,200-mile adjusted lower.'],
      ['2026-02-15',358000,'Depreciating','Estimated Feb 2026: Post-Scottsdale correction; settling $350-365K as YoY decline (-13.3%) takes hold.'],
      ['2026-03-15',352000,'Depreciating','Estimated Mar 2026: DuPont Registry $426K for 970-mile example; 1,200-mile car adjusted to $340-360K.'],
      ['2026-04-15',348000,'Depreciating','Estimated Apr 2026: BaT range $185,500-$389,995; 1,200-mile Green example mid-range $340-355K.'],
      ['2026-05-15',344000,'Depreciating','Estimated May 2026: Autotrader average $350,672; 1,200-mile example slightly below average.'],
    ]},
    // 1946 Ford SuperDeluxe — stable
    { car_id:5, months:[
      ['2025-07-15',21000,'Stable','Estimated Jul 2025: 1946 Ford Super Deluxe summer market; driver-quality $18-24K, restored show cars $35-55K.'],
      ['2025-08-15',21500,'Stable','Estimated Aug 2025: Stable summer market; postwar American iron holding consistent values.'],
      ['2025-09-15',22000,'Stable','Estimated Sep 2025: Fall circuit; Mecum results for 1946 Ford consistent with summer pricing.'],
      ['2025-10-15',22500,'Stable','Estimated Oct 2025: 1946 Ford Super Deluxe in original condition $21-25K range.'],
      ['2025-11-15',23000,'Stable','Estimated Nov 2025: Vintage Ford market stable with slight year-over-year appreciation.'],
      ['2025-12-15',23500,'Stable','Estimated Dec 2025: Year-end; collector interest steady among postwar American enthusiasts.'],
      ['2026-01-15',24000,'Stable','Estimated Jan 2026: Barrett-Jackson Scottsdale; $22-28K for driver-quality examples.'],
      ['2026-02-15',24500,'Stable','Estimated Feb 2026: Stable winter market; supply of original examples slowly shrinking.'],
      ['2026-03-15',25500,'Stable','Estimated Mar 2026: Spring show season; original-condition examples seeing renewed interest.'],
      ['2026-04-15',26500,'Stable','Estimated Apr 2026: Consistent demand; Arizona and Florida results supporting $24-28K range.'],
      ['2026-05-15',27500,'Stable','Estimated May 2026: Pre-summer; minor appreciation sustained by limited supply of original examples.'],
    ]},
  ];

  for (const car of SEED) {
    for (const [date, avg, trend, note] of car.months) {
      const mo = date.slice(0, 7);
      const already = db.prepare(
        "SELECT id FROM car_valuations WHERE car_id = ? AND fetched_at LIKE ?"
      ).get(car.car_id, mo + '%');
      if (already) continue;
      const low  = Math.round(avg * 0.88);
      const high = Math.round(avg * 1.12);
      const mo_label = new Date(date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      insert.run(car.car_id, low, avg, high, trend, `[ESTIMATED — ${mo_label}] ${note}`, '[]', date + 'T12:00:00.000Z');
    }
  }
})();

module.exports = db;
