const mongoose = require('mongoose');

// One place a user gets push notifications ("your plan is ready"): a browser's
// Web Push subscription or the iOS app's APNs device token. `key` is the
// endpoint (web) or the token (apns) — unique, so re-subscribing the same
// browser/phone (even signed in as someone else) moves it instead of
// duplicating it. Rows the push service reports gone are deleted on send.
const pushDeviceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['web', 'apns'], required: true },
    key: { type: String, required: true, unique: true },
    // web only: the PushSubscription's encryption keys
    keys: {
      p256dh: { type: String, default: '' },
      auth: { type: String, default: '' },
    },
    // apns only: sandbox tokens (Xcode debug builds) need the sandbox host
    sandbox: { type: Boolean, default: false },
    // Settings › Language at subscribe time — the notification text follows it
    locale: { type: String, default: 'en' },
    userAgent: { type: String, default: '' },
    lastSentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model('PushDevice', pushDeviceSchema);
