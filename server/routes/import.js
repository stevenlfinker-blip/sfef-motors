const express = require('express');
const router = express.Router();
const db = require('../db');

router.post('/import', (req, res) => {
  const data = req.body;

  db.exec('BEGIN');
  try {
    ['watchlist', 'events', 'expenses', 'cleaning', 'tools', 'parts', 'maintenance', 'cars'].forEach(t => {
      try { db.prepare(`DELETE FROM ${t}`).run(); } catch (_) {}
    });
    try {
      db.prepare(`DELETE FROM sqlite_sequence WHERE name IN ('cars','maintenance','parts','tools','cleaning','expenses','events','watchlist')`).run();
    } catch (_) {}

    const insertCar = db.prepare('INSERT INTO cars (id, year, make, model, color, mileage, status, notes, vin, ownership, registration, insurance, value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of data.cars || []) {
      insertCar.run(r.id, r.year, r.make, r.model, r.color||'', r.mileage||'', r.status||'Active', r.notes||'', r.vin||'', r.ownership||'', r.registration||'', r.insurance||'', r.value||0);
    }

    const insertMaint = db.prepare('INSERT INTO maintenance (id, car_id, title, description, due_date, due_mileage, completed, completed_date, cost, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of data.maintenance || []) {
      insertMaint.run(r.id, r.car_id||null, r.title, r.description||'', r.due_date||null, r.due_mileage||'', r.completed||0, r.completed_date||'', r.cost||0, r.notes||'');
    }

    const insertPart = db.prepare('INSERT INTO parts (id, car_id, name, part_number, quantity, location, cost_each, supplier, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of data.parts || []) {
      insertPart.run(r.id, r.car_id||null, r.name, r.part_number||'', r.quantity||0, r.location||'', r.cost_each||0, r.supplier||'', r.notes||'');
    }

    const insertTool = db.prepare('INSERT INTO tools (id, name, brand, category, location, condition, notes) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const r of data.tools || []) {
      insertTool.run(r.id, r.name, r.brand||'', r.category||'', r.location||'', r.condition||'Good', r.notes||'');
    }

    const insertClean = db.prepare('INSERT INTO cleaning (id, product, brand, type, qty, unit, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const r of data.cleaning || []) {
      insertClean.run(r.id, r.product, r.brand||'', r.type||'', r.qty||0, r.unit||'', r.status||'In Stock');
    }

    const insertExpense = db.prepare('INSERT INTO expenses (id, car_id, expense_type, vendor, category, description, amount, date, receipt_path, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of (data.expenses || data.costs || [])) {
      insertExpense.run(r.id, r.car_id||null, r.expense_type||'', r.vendor||'', r.category||'', r.description||'', r.amount||0, r.date||null, r.receipt_path||'', r.notes||'');
    }

    const insertEvent = db.prepare('INSERT INTO events (id, car_id, title, type, location, date, notes, registered) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of data.events || []) {
      insertEvent.run(r.id, r.car_id||null, r.title, r.type||'', r.location||'', r.date||null, r.notes||'', r.registered||0);
    }

    const insertWatch = db.prepare('INSERT INTO watchlist (id, year, make, model, asking_price, source, priority, notes, added_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of data.watchlist || []) {
      insertWatch.run(r.id, r.year||'', r.make, r.model, r.asking_price||0, r.source||'', r.priority||'Medium', r.notes||'', r.added_date||'');
    }

    db.exec('COMMIT');

    res.json({
      success: true,
      counts: {
        cars:        (data.cars        || []).length,
        maintenance: (data.maintenance || []).length,
        parts:       (data.parts       || []).length,
        tools:       (data.tools       || []).length,
        cleaning:    (data.cleaning    || []).length,
        expenses:    (data.expenses || data.costs || []).length,
        events:      (data.events      || []).length,
        watchlist:   (data.watchlist   || []).length,
      },
    });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: err.message });
  }
});

router.get('/export', (req, res) => {
  const data = {
    cars:        db.prepare('SELECT * FROM cars').all(),
    maintenance: db.prepare('SELECT * FROM maintenance').all(),
    parts:       db.prepare('SELECT * FROM parts').all(),
    tools:       db.prepare('SELECT * FROM tools').all(),
    cleaning:    db.prepare('SELECT * FROM cleaning').all(),
    expenses:    db.prepare('SELECT * FROM expenses').all(),
    events:      db.prepare('SELECT * FROM events').all(),
    watchlist:   db.prepare('SELECT * FROM watchlist').all(),
    exported_at: new Date().toISOString(),
  };
  const date = new Date().toISOString().split('T')[0];
  res.setHeader('Content-Disposition', `attachment; filename="sfef-motors-backup-${date}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.json(data);
});

module.exports = router;
