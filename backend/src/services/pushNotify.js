/*
 * Push notifications — "Your plan is ready" when a generation finishes, so the
 * studio doesn't have to sit on the loading screen (like ChatGPT's "your reply
 * is ready"). Two channels:
 *
 *  - Web Push (browsers): VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT.
 *    Generate a pair once with `npx web-push generate-vapid-keys`.
 *  - APNs (the iOS app): APNS_KEY (the .p8 contents, \n-escaped is fine),
 *    APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID (default com.bauhly.app).
 *
 * Either channel without its env is skipped quietly. Sends never throw — a
 * failed notification must not fail the plan that triggered it. The service
 * worker / app hides the banner while the studio is looking at the app; the
 * in-app toast covers that case.
 */

const http2 = require('node:http2');
const jwt = require('jsonwebtoken');
const webpush = require('web-push');
const PushDevice = require('../models/PushDevice');

function vapid() {
  const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: (process.env.VAPID_SUBJECT || 'mailto:hello@bauhly.com').trim() };
}

function apnsConfig() {
  const key = (process.env.APNS_KEY || '').replace(/\\n/g, '\n').trim();
  const keyId = (process.env.APNS_KEY_ID || '').trim();
  const teamId = (process.env.APNS_TEAM_ID || '').trim();
  if (!key || !keyId || !teamId) return null;
  return { key, keyId, teamId, bundleId: (process.env.APNS_BUNDLE_ID || 'com.bauhly.app').trim() };
}

function vapidPublicKey() {
  return vapid()?.publicKey || '';
}

function pushConfigured() {
  return { web: Boolean(vapid()), apns: Boolean(apnsConfig()) };
}

// ── Web Push ──

async function sendWeb(device, payload) {
  const cfg = vapid();
  if (!cfg) return 'skipped';
  try {
    await webpush.sendNotification(
      { endpoint: device.key, keys: { p256dh: device.keys?.p256dh, auth: device.keys?.auth } },
      JSON.stringify(payload),
      { vapidDetails: cfg, TTL: 60 * 60 * 24, urgency: 'high', topic: (payload.tag || '').slice(0, 32) || undefined },
    );
    return 'sent';
  } catch (err) {
    // 404/410: the browser dropped the subscription (permission revoked, data cleared)
    if (err.statusCode === 404 || err.statusCode === 410) return 'gone';
    console.error(`[push] web send failed (${err.statusCode || err.code || 'error'}):`, err.body || err.message);
    return 'failed';
  }
}

// ── APNs (HTTP/2 + ES256 provider token) ──

let apnsToken = { value: '', at: 0 };
const apnsSessions = {};

function providerToken(cfg) {
  // Apple wants the token refreshed at most every 20 min and at least every 60.
  if (apnsToken.value && Date.now() - apnsToken.at < 40 * 60 * 1000) return apnsToken.value;
  const value = jwt.sign({}, cfg.key, { algorithm: 'ES256', issuer: cfg.teamId, header: { kid: cfg.keyId } });
  apnsToken = { value, at: Date.now() };
  return value;
}

function apnsSession(sandbox) {
  const host = sandbox ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  const live = apnsSessions[host];
  if (live && !live.closed && !live.destroyed) return live;
  const session = http2.connect(host);
  session.on('error', (err) => console.error('[push] apns connection error:', err.message));
  session.on('close', () => { if (apnsSessions[host] === session) delete apnsSessions[host]; });
  // don't keep the process (scripts, workers shutting down) alive for an idle connection
  session.unref();
  apnsSessions[host] = session;
  return session;
}

// Xcode debug builds get sandbox tokens; production APNs answers BadDeviceToken
// for those, so retry once on the sandbox host and remember it on the device.
async function sendApns(device, payload) {
  const first = await sendApnsTo(device, payload, device.sandbox);
  if (first !== 'bad-token') return first;
  if (device.sandbox) return 'gone';
  const second = await sendApnsTo(device, payload, true);
  if (second === 'sent') await PushDevice.updateOne({ _id: device._id }, { $set: { sandbox: true } }).catch(() => {});
  return second === 'bad-token' ? 'gone' : second;
}

function sendApnsTo(device, payload, sandbox) {
  const cfg = apnsConfig();
  if (!cfg) return Promise.resolve('skipped');
  const body = JSON.stringify({
    aps: { alert: { title: payload.title, body: payload.body }, sound: 'default', 'thread-id': payload.tag || 'plan' },
    url: payload.url || '',
  });
  return new Promise((resolve) => {
    let req;
    try {
      req = apnsSession(sandbox).request({
        ':method': 'POST',
        ':path': `/3/device/${device.key}`,
        authorization: `bearer ${providerToken(cfg)}`,
        'apns-topic': cfg.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        ...(payload.tag ? { 'apns-collapse-id': payload.tag.slice(0, 64) } : {}),
      });
    } catch (err) {
      console.error('[push] apns request failed:', err.message);
      resolve('failed');
      return;
    }
    let status = 0;
    let text = '';
    req.setTimeout(10000, () => { req.close(); resolve('failed'); });
    req.on('response', (headers) => { status = headers[':status']; });
    req.on('data', (chunk) => { text += chunk; });
    req.on('end', () => {
      if (status === 200) return resolve('sent');
      const reason = (() => { try { return JSON.parse(text).reason; } catch { return text; } })();
      if (reason === 'BadDeviceToken') return resolve('bad-token');
      if (status === 410 || reason === 'Unregistered') return resolve('gone');
      console.error(`[push] apns send failed (${status}): ${reason}`);
      return resolve('failed');
    });
    req.on('error', (err) => { console.error('[push] apns stream error:', err.message); resolve('failed'); });
    req.end(body);
  });
}

/**
 * Notify every device the user has registered. payload: { title, body, url, tag },
 * or locale => payload to word it in each device's UI language.
 * Resolves with { sent, removed }; never rejects.
 */
async function notifyUser(userId, payloadOf) {
  try {
    if (!userId) return { sent: 0, removed: 0 };
    const devices = await PushDevice.find({ user: userId }).lean();
    if (!devices.length) return { sent: 0, removed: 0 };
    const wordFor = typeof payloadOf === 'function' ? payloadOf : () => payloadOf;
    const results = await Promise.all(devices.map((d) => {
      const payload = wordFor(d.locale === 'es' ? 'es' : 'en');
      return d.kind === 'apns' ? sendApns(d, payload) : sendWeb(d, payload);
    }));
    const gone = devices.filter((_, i) => results[i] === 'gone').map((d) => d._id);
    const sentIds = devices.filter((_, i) => results[i] === 'sent').map((d) => d._id);
    if (gone.length) await PushDevice.deleteMany({ _id: { $in: gone } });
    if (sentIds.length) await PushDevice.updateMany({ _id: { $in: sentIds } }, { $set: { lastSentAt: new Date() } });
    console.log(`[push] "${wordFor('en').title}" → ${sentIds.length}/${devices.length} device(s)` +
      (gone.length ? ` · removed ${gone.length} expired` : ''));
    return { sent: sentIds.length, removed: gone.length };
  } catch (err) {
    console.error('[push] notify failed:', err.message);
    return { sent: 0, removed: 0 };
  }
}

/**
 * The plan-finished notification. outcome: 'done' | 'needs-input' | 'failed'.
 * Fire-and-forget at the call sites.
 */
function notifyPlanFinished(userId, { outcome, count = 0, message = '' } = {}) {
  const n = Number(count) || 0;
  return notifyUser(userId, (locale) => ({ ...planCopy(locale, outcome, n, message), tag: 'plan-ready' }));
}

function planCopy(locale, outcome, n, message) {
  // the server's own reason text is English; Spanish devices get the generic line
  const reason = locale === 'en' ? message : '';
  if (locale === 'es') {
    if (outcome === 'done') {
      return {
        title: 'Tu plan está listo',
        body: n ? `${n} ${n === 1 ? 'publicación nueva' : 'publicaciones nuevas'} en tu calendario — toca para revisar.` : 'Tu calendario está al día.',
        url: '/dashboard',
      };
    }
    if (outcome === 'needs-input') {
      return { title: 'Tu plan necesita un poco más', body: 'Añade una idea o foto más clara e inténtalo de nuevo.', url: '/dashboard/plans' };
    }
    return { title: 'No pudimos terminar tu plan', body: 'Inténtalo de nuevo.', url: '/dashboard/plans' };
  }
  if (outcome === 'done') {
    return {
      title: 'Your plan is ready',
      body: n ? `${n} new post${n === 1 ? '' : 's'} on your calendar — tap to review.` : 'Your calendar is up to date.',
      url: '/dashboard',
    };
  }
  if (outcome === 'needs-input') {
    return { title: 'Your plan needs a little more', body: reason || 'Add a clearer idea or photo and try again.', url: '/dashboard/plans' };
  }
  return { title: "We couldn't finish your plan", body: reason || 'Please try again.', url: '/dashboard/plans' };
}

module.exports = { notifyUser, notifyPlanFinished, vapidPublicKey, pushConfigured };
