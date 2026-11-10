const express = require('express');
const router = express.Router();
const { publicKey, saveSubscription, removeSubscription, sendToUser, markReceived, listDevices } = require('../push');

function requireMember(req, res, next) {
  if (!req.user?.id) return res.status(403).json({ error: 'Sign in with your own account to get notifications.' });
  next();
}

router.get('/key', (req, res) => res.json({ publicKey }));

router.post('/subscribe', requireMember, (req, res) => {
  try {
    saveSubscription(req.user.id, req.body.subscription, req.get('user-agent'));
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/unsubscribe', (req, res) => {
  if (req.body.endpoint) removeSubscription(String(req.body.endpoint));
  res.json({ success: true });
});

// "Send test notification" in My Settings — goes to all of my devices.
router.post('/test', requireMember, async (req, res) => {
  const startedAt = new Date().toISOString();
  const r = await sendToUser(req.user.id, {
    title: 'SFEF Motors', body: 'Notifications are working on this device 🎉', url: '/?chat=team', tag: 'test',
  });
  res.json({ ...r, startedAt });
});

// The service worker reports each notification it receives (and any error
// showing it), so the test can tell "never arrived" from "arrived but hidden".
router.post('/ack', requireMember, (req, res) => {
  markReceived(req.user.id, Number(req.body.sid), req.body.error || '');
  res.json({ success: true });
});

router.get('/devices', requireMember, (req, res) => res.json(listDevices(req.user.id)));

module.exports = router;
