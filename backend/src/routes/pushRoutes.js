const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const PushDevice = require('../models/PushDevice');
const { appLocaleOf } = require('../utils/appLocale');
const { vapidPublicKey, pushConfigured, notifyUser } = require('../services/pushNotify');

const router = express.Router();

router.use(protect);

// What the client needs to subscribe: the VAPID key (web) and which channels
// the server can actually send on.
router.get('/config', (req, res) => {
  res.json({ vapidPublicKey: vapidPublicKey(), ...pushConfigured() });
});

// body: { kind: 'web', subscription: PushSubscriptionJSON } | { kind: 'apns', token, sandbox? }
router.post('/subscribe', asyncHandler(async (req, res) => {
  const kind = req.body?.kind === 'apns' ? 'apns' : 'web';
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);
  let key = '';
  const set = { user: req.user._id, kind, userAgent, locale: appLocaleOf(req) };
  if (kind === 'web') {
    const sub = req.body?.subscription || {};
    key = String(sub.endpoint || '').trim();
    if (!/^https:\/\//.test(key) || !sub.keys?.p256dh || !sub.keys?.auth) {
      return res.status(400).json({ message: 'Invalid push subscription' });
    }
    set.keys = { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) };
  } else {
    key = String(req.body?.token || '').trim();
    if (!/^[0-9a-fA-F]{32,200}$/.test(key)) return res.status(400).json({ message: 'Invalid device token' });
    set.sandbox = Boolean(req.body?.sandbox);
  }
  await PushDevice.updateOne({ key }, { $set: set }, { upsert: true });
  res.json({ ok: true });
}));

router.post('/unsubscribe', asyncHandler(async (req, res) => {
  const key = String(req.body?.endpoint || req.body?.token || '').trim();
  if (key) await PushDevice.deleteOne({ key, user: req.user._id });
  res.json({ ok: true });
}));

// Send yourself a test notification (Settings / debugging).
router.post('/test', asyncHandler(async (req, res) => {
  const out = await notifyUser(req.user._id, (locale) => ({
    title: locale === 'es' ? 'Notificaciones activadas' : 'Notifications are on',
    body: locale === 'es' ? 'Te avisaremos aquí cuando tu plan esté listo.' : "We'll let you know here when your plan is ready.",
    url: '/dashboard',
    tag: 'push-test',
    force: true,
  }));
  res.json(out);
}));

module.exports = router;
