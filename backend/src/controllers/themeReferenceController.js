const ThemeReference = require('../models/ThemeReference');

// The studio's saved theme references (Choose from library › Your references),
// newest use first.
const MAX_REFERENCES = 60;

const publicRef = (r) => ({
  id: String(r._id),
  key: r.key,
  name: r.name || 'Your reference',
  lastUsedAt: r.lastUsedAt,
  hasRules: Boolean(r.designRules),
});

// GET /posts/theme-references → { references: [{ id, key, name, lastUsedAt, hasRules }] }
async function listThemeReferences(req, res) {
  const rows = await ThemeReference.find({ user: req.user._id })
    .sort({ lastUsedAt: -1 })
    .limit(MAX_REFERENCES)
    .select('key name lastUsedAt designRules')
    .lean();
  return res.json({ references: rows.map(publicRef) });
}

// DELETE /posts/theme-references/:refId — takes it out of the library (the
// uploaded file itself stays: posts and debug traces may still point at it)
async function deleteThemeReference(req, res) {
  const gone = await ThemeReference.findOneAndDelete({ _id: req.params.refId, user: req.user._id }).catch(() => null);
  if (!gone) return res.status(404).json({ message: 'That reference is not in your library.' });
  return res.json({ ok: true, id: String(gone._id) });
}

// The saved row for a reference — by its stored file, else by the picture's
// fingerprint (the same photo uploaded again). null when never applied.
async function savedReference(userId, key, hash = '') {
  if (!key && !hash) return null;
  const byKey = key ? await ThemeReference.findOne({ user: userId, key }).lean().catch(() => null) : null;
  if (byKey || !hash) return byKey;
  return ThemeReference.findOne({ user: userId, hash }).sort({ lastUsedAt: -1 }).lean().catch(() => null);
}

// Save (or touch) a reference after it was applied — its name and the Design
// Rules agent's read of it, so a re-apply skips the extraction.
async function rememberReference(userId, { key, name = '', designRules = null, hash = '' }) {
  if (!key) return null;
  const set = { lastUsedAt: new Date(), ...(hash ? { hash } : {}) };
  if (designRules?.rules) {
    set.designRules = designRules.rules;
    set.rulesModel = designRules.model || '';
  }
  try {
    return await ThemeReference.findOneAndUpdate(
      { user: userId, key },
      {
        $set: set,
        $inc: { uses: 1 },
        $setOnInsert: { name: String(name || '').slice(0, 80) },
      },
      { upsert: true, new: true }
    ).lean();
  } catch (err) {
    console.warn(`[themeReferences] could not save ${key}: ${err.message}`);
    return null;
  }
}

module.exports = { listThemeReferences, deleteThemeReference, savedReference, rememberReference };
