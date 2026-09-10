const crypto = require('crypto');
const User = require('../models/User');
const InstagramProfile = require('../models/InstagramProfile');
const { currentUsername } = require('../utils/currentProfile');

function normHandle(value) {
  return String(value || '').replace(/^@/, '').trim().toLowerCase() || null;
}

/* a handle this user actually owns — never another studio's, and never a
   guess. Falls back to the currently activated account when none is given. */
async function ownedHandle(userId, requested) {
  const want = normHandle(requested);
  if (want) {
    const profile = await InstagramProfile.findOne({ user: userId, username: want }).select('username').lean();
    if (profile?.username) return profile.username;
    return null;
  }
  return currentUsername(userId);
}
const {
  isS3Configured,
  getPresignedUploadUrl,
  getPresignedMediaUrl,
  deleteObjects,
} = require('../services/s3Client');

// Visual Mood — the reference pictures a studio adds on the Library Settings
// page. The bytes live in S3 under a per-user prefix; Mongo keeps only the key
// (plus a title), and the client is handed short-lived presigned read URLs.

const EXT = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/heic': 'heic', 'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

const LOGO_SLOTS = new Set(['full', 'fullInverted', 'symbol', 'symbolInverted']);

// Everything a handle's mood images live under. A client-supplied key is only
// ever trusted if it sits under THIS user + THIS handle's prefix — so no request
// can attach or delete another studio's (or another account's) object.
function moodPrefix(userId, handle) {
  return `visualbrand/${userId}/${handle}/mood/`;
}

function logoPrefix(userId, handle) {
  return `visualbrand/${userId}/${handle}/logos/`;
}

async function withUrl(m) {
  let url = null;
  try {
    if (isS3Configured()) url = await getPresignedMediaUrl(m.key);
  } catch (err) {
    console.error('[visual-brand] could not presign', m.key, err.message);
  }
  return { key: m.key, title: m.title || '', addedAt: m.addedAt || 0, url };
}

// POST /visual-brand/mood/sign
// Body: { files: [{ contentType }] } → { uploads: [{ key, uploadUrl }] }
// Hands the browser presigned PUT URLs so it uploads the bytes straight to S3.
async function signMoodUploads(req, res) {
  if (!isS3Configured()) {
    return res.status(503).json({ message: 'Media storage is not configured (set S3_BUCKET_NAME).' });
  }
  const handle = await currentUsername(req.user._id);
  if (!handle) return res.status(400).json({ message: 'Connect an Instagram account first' });
  const files = Array.isArray(req.body.files) ? req.body.files : [];
  if (!files.length) return res.status(400).json({ message: 'No files to sign' });
  if (files.length > 20) return res.status(400).json({ message: 'Too many files in one request' });

  const uploads = await Promise.all(
    files.map(async ({ contentType }) => {
      const ext = EXT[contentType] || 'bin';
      const key = `${moodPrefix(req.user._id, handle)}${crypto.randomUUID()}.${ext}`;
      const uploadUrl = await getPresignedUploadUrl(key, contentType);
      return { key, uploadUrl };
    })
  );
  res.json({ uploads });
}

// GET /visual-brand/mood → { moodImages: [{ key, title, addedAt, url }] }
// Only the mood added under the currently active handle, so the page switches
// with the account chosen in the header.
async function listMoodImages(req, res) {
  const handle = await currentUsername(req.user._id);
  const user = await User.findById(req.user._id).select('visualBrand').lean();
  const imgs = (user && user.visualBrand && user.visualBrand.moodImages) || [];
  const mine = handle ? imgs.filter((m) => (m.handle || '') === handle) : [];
  const moodImages = await Promise.all(mine.map(withUrl));
  res.json({ moodImages });
}

// POST /visual-brand/mood
// Body: { images: [{ key, title }] } — keys the client has just PUT to S3.
// → { moodImages: [...the full set, with presigned urls] }
async function addMoodImages(req, res) {
  const handle = await currentUsername(req.user._id);
  if (!handle) return res.status(400).json({ message: 'Connect an Instagram account first' });
  const incoming = Array.isArray(req.body.images) ? req.body.images : [];
  const prefix = moodPrefix(req.user._id, handle);
  const clean = incoming
    .map((m) => ({
      key: String((m && m.key) || '').trim(),
      title: String((m && m.title) || '').trim(),
      handle,
      addedAt: Date.now(),
    }))
    // never trust a client key that is not under this user + handle's own prefix
    .filter((m) => m.key.startsWith(prefix));
  if (!clean.length) return res.status(400).json({ message: 'No valid images to add' });

  const user = await User.findById(req.user._id);
  if (!user.visualBrand) user.visualBrand = { moodImages: [] };
  const existing = new Set((user.visualBrand.moodImages || []).map((m) => m.key));
  // newest first, matching how the page lists them
  clean.reverse().forEach((m) => {
    if (!existing.has(m.key)) {
      user.visualBrand.moodImages.unshift(m);
      existing.add(m.key);
    }
  });
  await user.save();

  // return only this handle's mood, matching listMoodImages
  const mine = (user.visualBrand.moodImages || []).filter((m) => (m.handle || '') === handle);
  const moodImages = await Promise.all(mine.map(withUrl));
  res.json({ moodImages });
}

// DELETE /visual-brand/mood/:key  (key is URL-encoded)
// Drops the record and best-effort deletes the object from S3.
async function deleteMoodImage(req, res) {
  const handle = await currentUsername(req.user._id);
  const key = decodeURIComponent(req.params.key || '');
  if (!handle || !key.startsWith(moodPrefix(req.user._id, handle))) {
    return res.status(400).json({ message: 'Invalid key' });
  }
  const user = await User.findById(req.user._id);
  const list = (user.visualBrand && user.visualBrand.moodImages) || [];
  const before = list.length;
  if (user.visualBrand) {
    user.visualBrand.moodImages = list.filter((m) => m.key !== key);
  }
  await user.save();

  try {
    if (isS3Configured()) await deleteObjects([key]);
  } catch (err) {
    console.error('[visual-brand] could not delete object', key, err.message);
  }
  res.json({ key, removed: before - ((user.visualBrand && user.visualBrand.moodImages) || []).length });
}

// ── Logos (Library Settings) ────────────────────────────────────────────────
// Four named slots per handle. Uploading to a slot that already has a file
// replaces it (the old S3 object is dropped). Position is a Library Settings
// choice and lives in the settings blob, not here.

function logosOf(user, handle) {
  const list = (user && user.visualBrand && user.visualBrand.logos) || [];
  return handle ? list.filter((m) => (m.handle || '') === handle) : [];
}

async function withLogoUrl(m) {
  const packed = await withUrl(m);
  return { ...packed, slot: m.slot };
}

// POST /visual-brand/logos/sign
// Body: { files: [{ contentType }] } → { uploads: [{ key, uploadUrl }] }
async function signLogoUploads(req, res) {
  if (!isS3Configured()) {
    return res.status(503).json({ message: 'Media storage is not configured (set S3_BUCKET_NAME).' });
  }
  const handle = await currentUsername(req.user._id);
  if (!handle) return res.status(400).json({ message: 'Connect an Instagram account first' });
  const files = Array.isArray(req.body.files) ? req.body.files : [];
  if (!files.length) return res.status(400).json({ message: 'No files to sign' });
  if (files.length > 4) return res.status(400).json({ message: 'Too many files in one request' });

  const uploads = await Promise.all(
    files.map(async ({ contentType }) => {
      const ext = EXT[contentType] || 'bin';
      const key = `${logoPrefix(req.user._id, handle)}${crypto.randomUUID()}.${ext}`;
      const uploadUrl = await getPresignedUploadUrl(key, contentType);
      return { key, uploadUrl };
    })
  );
  res.json({ uploads });
}

// GET /visual-brand/logos → { logos: [{ slot, key, title, addedAt, url }] }
async function listLogos(req, res) {
  const handle = await currentUsername(req.user._id);
  const user = await User.findById(req.user._id).select('visualBrand.logos').lean();
  const logos = await Promise.all(logosOf(user, handle).map(withLogoUrl));
  res.json({ logos });
}

// POST /visual-brand/logos
// Body: { slot, key, title } — the key the client has just PUT to S3.
// Replaces whatever was in that slot for this handle.
async function putLogo(req, res) {
  const handle = await currentUsername(req.user._id);
  if (!handle) return res.status(400).json({ message: 'Connect an Instagram account first' });
  const slot = String((req.body && req.body.slot) || '').trim();
  const key = String((req.body && req.body.key) || '').trim();
  const title = String((req.body && req.body.title) || '').trim();
  if (!LOGO_SLOTS.has(slot)) return res.status(400).json({ message: 'Unknown logo slot' });
  const prefix = logoPrefix(req.user._id, handle);
  if (!key.startsWith(prefix)) return res.status(400).json({ message: 'Invalid key' });

  const user = await User.findById(req.user._id);
  if (!user.visualBrand) user.visualBrand = {};
  if (!Array.isArray(user.visualBrand.logos)) user.visualBrand.logos = [];

  const previous = user.visualBrand.logos.find((m) => m.handle === handle && m.slot === slot);
  user.visualBrand.logos = user.visualBrand.logos.filter((m) => !(m.handle === handle && m.slot === slot));
  user.visualBrand.logos.push({ key, slot, title, handle, addedAt: Date.now() });
  user.markModified('visualBrand.logos');
  await user.save();

  if (previous && previous.key && previous.key !== key) {
    try {
      if (isS3Configured()) await deleteObjects([previous.key]);
    } catch (err) {
      console.error('[visual-brand] could not delete replaced logo', previous.key, err.message);
    }
  }

  const logos = await Promise.all(logosOf(user, handle).map(withLogoUrl));
  res.json({ logos });
}

// DELETE /visual-brand/logos/:slot
async function deleteLogo(req, res) {
  const handle = await currentUsername(req.user._id);
  const slot = String(req.params.slot || '').trim();
  if (!handle || !LOGO_SLOTS.has(slot)) {
    return res.status(400).json({ message: 'Invalid slot' });
  }
  const user = await User.findById(req.user._id);
  const list = (user.visualBrand && user.visualBrand.logos) || [];
  const gone = list.find((m) => (m.handle || '') === handle && m.slot === slot);
  if (user.visualBrand) {
    user.visualBrand.logos = list.filter((m) => !(m.handle === handle && m.slot === slot));
    user.markModified('visualBrand.logos');
  }
  await user.save();

  if (gone && gone.key) {
    try {
      if (isS3Configured()) await deleteObjects([gone.key]);
    } catch (err) {
      console.error('[visual-brand] could not delete logo', gone.key, err.message);
    }
  }
  res.json({ slot, removed: gone ? 1 : 0 });
}

// ── Library Settings (palette, type, layout toggles, palette readings) ──────
// Persisted server-side, one blob per handle, so the same account sees the same
// library on any origin. The blob is opaque to the server — it stores and scopes
// what the client sends; the client owns the shape (see lib/store.js SYNC_KEYS).

const MAX_SETTINGS_BYTES = 512 * 1024; // a guard against a runaway client blob

// GET /visual-brand/settings → { settings: <data>|null, updatedAt }
// Only the blob saved under the currently active handle.
async function getSettings(req, res) {
  const handle = await ownedHandle(req.user._id, req.query.handle);
  if (!handle) return res.json({ settings: null, updatedAt: 0 });
  const user = await User.findById(req.user._id).select('visualBrand.settings').lean();
  const all = (user && user.visualBrand && user.visualBrand.settings) || [];
  const mine = all.find((x) => (x.handle || '') === handle);
  res.json({ settings: mine ? mine.data : null, updatedAt: mine ? mine.updatedAt || 0 : 0, handle });
}

// PUT /visual-brand/settings  Body: { data: {...} }
// Upserts this handle's settings blob. Last write wins (per handle).
async function saveSettings(req, res) {
  const requested = req.body && req.body.handle;
  const handle = await ownedHandle(req.user._id, requested);
  if (!handle && normHandle(requested)) {
    return res.status(403).json({ message: 'That Instagram account is not connected.' });
  }
  if (!handle) return res.status(400).json({ message: 'Connect an Instagram account first' });
  const data = req.body && typeof req.body.data === 'object' && req.body.data !== null ? req.body.data : {};
  if (Buffer.byteLength(JSON.stringify(data)) > MAX_SETTINGS_BYTES) {
    return res.status(413).json({ message: 'Settings blob too large' });
  }
  const user = await User.findById(req.user._id);
  if (!user.visualBrand) user.visualBrand = {};
  if (!Array.isArray(user.visualBrand.settings)) user.visualBrand.settings = [];
  const now = Date.now();
  const row = user.visualBrand.settings.find((x) => (x.handle || '') === handle);
  if (row) {
    row.data = data;
    row.updatedAt = now;
  } else {
    user.visualBrand.settings.push({ handle, data, updatedAt: now });
  }
  // Mixed-typed subfields don't dirty-track on their own
  user.markModified('visualBrand.settings');
  await user.save();
  res.json({ ok: true, updatedAt: now, handle });
}

module.exports = {
  signMoodUploads,
  listMoodImages,
  addMoodImages,
  deleteMoodImage,
  signLogoUploads,
  listLogos,
  putLogo,
  deleteLogo,
  getSettings,
  saveSettings,
};
