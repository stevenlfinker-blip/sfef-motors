const express = require('express');
const router = express.Router();
const db = require('../db');
const { postMessage } = require('../chat');
const { notifyUsers } = require('../mailer');

const SELECT = `
  SELECT m.*, c.make || ' ' || c.model || ' ' || c.year AS car_name, u.name AS assigned_name
  FROM maintenance m
  LEFT JOIN cars c ON m.car_id = c.id
  LEFT JOIN users u ON m.assigned_to = u.id
`;

const STATUSES = ['open', 'in_progress'];

// Only real team members can be assigned; anything else becomes unassigned.
function cleanAssignee(v) {
  const id = Number(v);
  return id && db.prepare('SELECT id FROM users WHERE id = ?').get(id) ? id : null;
}

// Drops a system message in the team chat and emails the new assignee
// (not when they assigned it to themselves).
function announceAssignment(actor, order) {
  const assignee = db.prepare('SELECT * FROM users WHERE id = ?').get(order.assigned_to);
  const details = [order.car_name, order.due_date ? `due ${order.due_date}` : ''].filter(Boolean).join(', ');
  postMessage({
    userId: actor.id,
    kind: 'system',
    workOrderId: order.id,
    body: `${actor.name} assigned "${order.title}"${details ? ` (${details})` : ''} to ${assignee.name}`,
  });
  if (assignee.id !== actor.id) {
    notifyUsers([assignee], `Work order assigned: ${order.title}`, [
      `${actor.name} assigned you a work order.`,
      '',
      `Task: ${order.title}`,
      order.car_name ? `Car: ${order.car_name}` : '',
      order.due_date ? `Due: ${order.due_date}` : '',
      order.description ? `\n${order.description}` : '',
    ].filter(l => l !== '').join('\n'));
  }
}

router.get('/', (req, res) => {
  res.json(db.prepare(SELECT + 'ORDER BY m.completed ASC, m.due_date ASC').all());
});

router.post('/', (req, res) => {
  const { car_id, title, description, due_date, due_mileage, cost, notes, assigned_to, status } = req.body;
  const assignee = cleanAssignee(assigned_to);
  const result = db.prepare(
    'INSERT INTO maintenance (car_id, title, description, due_date, due_mileage, cost, notes, assigned_to, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(car_id||null, title, description||'', due_date||null, due_mileage||'', cost||0, notes||'', assignee, STATUSES.includes(status) ? status : 'open');
  const created = db.prepare(SELECT + 'WHERE m.id = ?').get(result.lastInsertRowid);
  if (assignee) announceAssignment(req.user, created);
  res.status(201).json(created);
});

router.put('/:id', (req, res) => {
  const { car_id, title, description, due_date, due_mileage, completed, completed_date, cost, notes, assigned_to, status } = req.body;
  const before = db.prepare('SELECT assigned_to, completed FROM maintenance WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Not found' });
  const assignee = cleanAssignee(assigned_to);
  db.prepare(
    'UPDATE maintenance SET car_id=?, title=?, description=?, due_date=?, due_mileage=?, completed=?, completed_date=?, cost=?, notes=?, assigned_to=?, status=? WHERE id=?'
  ).run(car_id||null, title, description||'', due_date||null, due_mileage||'', completed?1:0, completed_date||'', cost||0, notes||'', assignee, STATUSES.includes(status) ? status : 'open', req.params.id);
  const updated = db.prepare(SELECT + 'WHERE m.id = ?').get(req.params.id);

  if (assignee && assignee !== before.assigned_to) announceAssignment(req.user, updated);
  if (updated.completed && !before.completed) {
    postMessage({
      userId: req.user.id, kind: 'system', workOrderId: updated.id,
      body: `${req.user.name} completed "${updated.title}"${updated.car_name ? ` (${updated.car_name})` : ''}`,
    });
  }
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM maintenance WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
