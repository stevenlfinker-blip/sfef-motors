const express = require('express');
const router = express.Router();
const { pool } = require('../db');

router.post('/import', async (req, res) => {
  const data = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clear all tables in dependency order
    await client.query('DELETE FROM watchlist');
    await client.query('DELETE FROM events');
    await client.query('DELETE FROM costs');
    await client.query('DELETE FROM cleaning');
    await client.query('DELETE FROM tools');
    await client.query('DELETE FROM parts');
    await client.query('DELETE FROM maintenance');
    await client.query('DELETE FROM cars');

    for (const r of data.cars || []) {
      await client.query(
        'INSERT INTO cars (id, year, make, model, color, mileage, status, notes, vin, ownership, registration, insurance, value) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
        [r.id, r.year, r.make, r.model, r.color||'', r.mileage||'', r.status||'Active', r.notes||'', r.vin||'', r.ownership||'', r.registration||'', r.insurance||'', r.value||0]
      );
    }

    for (const r of data.maintenance || []) {
      await client.query(
        'INSERT INTO maintenance (id, car_id, title, description, due_date, due_mileage, completed, completed_date, cost, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [r.id, r.car_id||null, r.title, r.description||'', r.due_date||null, r.due_mileage||'', r.completed||0, r.completed_date||'', r.cost||0, r.notes||'']
      );
    }

    for (const r of data.parts || []) {
      await client.query(
        'INSERT INTO parts (id, car_id, name, part_number, quantity, location, cost_each, supplier, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [r.id, r.car_id||null, r.name, r.part_number||'', r.quantity||0, r.location||'', r.cost_each||0, r.supplier||'', r.notes||'']
      );
    }

    for (const r of data.tools || []) {
      await client.query(
        'INSERT INTO tools (id, name, brand, category, location, condition, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [r.id, r.name, r.brand||'', r.category||'', r.location||'', r.condition||'Good', r.notes||'']
      );
    }

    for (const r of data.cleaning || []) {
      await client.query(
        'INSERT INTO cleaning (id, product, brand, type, qty, unit, status) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [r.id, r.product, r.brand||'', r.type||'', r.qty||0, r.unit||'', r.status||'In Stock']
      );
    }

    for (const r of data.costs || []) {
      await client.query(
        'INSERT INTO costs (id, car_id, category, description, amount, date, receipt_path, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [r.id, r.car_id||null, r.category||'', r.description||'', r.amount||0, r.date||null, r.receipt_path||'', r.notes||'']
      );
    }

    for (const r of data.events || []) {
      await client.query(
        'INSERT INTO events (id, car_id, title, type, location, date, notes, registered) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [r.id, r.car_id||null, r.title, r.type||'', r.location||'', r.date||null, r.notes||'', r.registered||0]
      );
    }

    for (const r of data.watchlist || []) {
      await client.query(
        'INSERT INTO watchlist (id, year, make, model, asking_price, source, priority, notes, added_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [r.id, r.year||'', r.make, r.model, r.asking_price||0, r.source||'', r.priority||'Medium', r.notes||'', r.added_date||'']
      );
    }

    // Reset sequences so new inserts don't conflict with imported IDs
    for (const t of ['cars','maintenance','parts','tools','cleaning','costs','events','watchlist']) {
      await client.query(`SELECT setval('${t}_id_seq', COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      counts: {
        cars:        (data.cars        || []).length,
        maintenance: (data.maintenance || []).length,
        parts:       (data.parts       || []).length,
        tools:       (data.tools       || []).length,
        cleaning:    (data.cleaning    || []).length,
        costs:       (data.costs       || []).length,
        events:      (data.events      || []).length,
        watchlist:   (data.watchlist   || []).length,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.get('/export', async (req, res) => {
  try {
    const [cars, maintenance, parts, tools, cleaning, costs, events, watchlist] = await Promise.all([
      pool.query('SELECT * FROM cars ORDER BY id'),
      pool.query('SELECT * FROM maintenance ORDER BY id'),
      pool.query('SELECT * FROM parts ORDER BY id'),
      pool.query('SELECT * FROM tools ORDER BY id'),
      pool.query('SELECT * FROM cleaning ORDER BY id'),
      pool.query('SELECT * FROM costs ORDER BY id'),
      pool.query('SELECT * FROM events ORDER BY id'),
      pool.query('SELECT * FROM watchlist ORDER BY id'),
    ]);

    const data = {
      cars:        cars.rows,
      maintenance: maintenance.rows,
      parts:       parts.rows,
      tools:       tools.rows,
      cleaning:    cleaning.rows,
      costs:       costs.rows,
      events:      events.rows,
      watchlist:   watchlist.rows,
      exported_at: new Date().toISOString(),
    };

    const date = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Disposition', `attachment; filename="sfef-motors-backup-${date}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
