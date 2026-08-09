const crypto = require('crypto');
const User = require('../models/User');
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
};

// Everything a user's mood images live under. A client-supplied key is only ever
// trusted if it sits under THIS user's prefix — so no request can attach or
// delete another studio's object.
function moodPrefix(userId) {
  return `visualbrand/${userId}/mood/`;
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
  const files = Array.isArray(req.body.files) ? req.body.files : [];
  if (!files.length) return res.status(400).json({ message: 'No files to sign' });
  if (files.length > 20) return res.status(400).json({ message: 'Too many files in one request' });

  const uploads = await Promise.all(
    files.map(async ({ contentType }) => {
      const ext = EXT[contentType] || 'bin';
      const key = `${moodPrefix(req.user._id)}${crypto.randomUUID()}.${ext}`;
      const uploadUrl = await getPresignedUploadUrl(key, contentType);
      return { key, uploadUrl };
    })
  );
  res.json({ uploads });
}

// GET /visual-brand/mood → { moodImages: [{ key, title, addedAt, url }] }
async function listMoodImages(req, res) {
  const user = await User.findById(req.user._id).select('visualBrand').lean();
  const imgs = (user && user.visualBrand && user.visualBrand.moodImages) || [];
  const moodImages = await Promise.all(imgs.map(withUrl));
  res.json({ moodImages });
}

// POST /visual-brand/mood
// Body: { images: [{ key, title }] } — keys the client has just PUT to S3.
// → { moodImages: [...the full set, with presigned urls] }
async function addMoodImages(req, res) {
  const incoming = Array.isArray(req.body.images) ? req.body.images : [];
  const prefix = moodPrefix(req.user._id);
  const clean = incoming
    .map((m) => ({
      key: String((m && m.key) || '').trim(),
      title: String((m && m.title) || '').trim(),
      addedAt: Date.now(),
    }))
    // never trust a client key that is not under this user's own prefix
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

  const moodImages = await Promise.all(user.visualBrand.moodImages.map(withUrl));
  res.json({ moodImages });
}

// DELETE /visual-brand/mood/:key  (key is URL-encoded)
// Drops the record and best-effort deletes the object from S3.
async function deleteMoodImage(req, res) {
  const key = decodeURIComponent(req.params.key || '');
  if (!key.startsWith(moodPrefix(req.user._id))) {
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

module.exports = {
  signMoodUploads,
  listMoodImages,
  addMoodImages,
  deleteMoodImage,
};
