const ReelStyle = require('../models/ReelStyle');
const { getMediaUrl } = require('../services/s3Client');
const { analyzeReelStyle, shortCodeOf } = require('../services/reelStyleAnalyzer');
const { track } = require('../utils/backgroundWork');

const MAX_OWN_STYLES = 30;
const STALE_ANALYSIS_MS = 5 * 60 * 1000;
const isAdmin = (req) => req.user?.role === 'admin';
const mineOf = (d, userId) => (d.addedBy || []).some((id) => String(id) === String(userId));

// What the Generate reel picker shows for a style
async function serialize(d, req) {
  const s = d.style || {};
  const audio = s.audio?.mode === 'music' ? 'Music' : s.audio?.mode === 'voiceover+music' ? 'Voice + music' : 'Voiceover';
  const shot = Number(s.pacing?.shotSec) || 0;
  const mine = mineOf(d, req.user._id);
  return {
    id: String(d._id),
    name: d.name || d.shortCode,
    summary: d.summary || '',
    sourceUrl: d.sourceUrl,
    status: d.status,
    error: d.error || '',
    thumbUrl: d.thumbKey ? await getMediaUrl(d.thumbKey).catch(() => '') : '',
    tags: d.status === 'ready' ? [
      audio,
      shot ? (shot < 1 ? 'Fast cuts' : shot < 2 ? 'Quick cuts' : 'Calm pace') : '',
      s.chapters?.numbered ? 'Numbered tips' : '',
      Number(s.pacing?.targetLengthSec) ? `~${Math.round(Math.min(45, s.pacing.targetLengthSec))}s` : '',
    ].filter(Boolean) : [],
    hook: s.hook?.pattern || '',
    mine,
    shared: Boolean(d.shared),
    // your own link, or a shared style when you are an admin (hides it for everyone)
    canRemove: mine || (Boolean(d.shared) && isAdmin(req)),
  };
}

// an analysis that stopped reporting (server restarted mid-run) is closed
async function closeStale(d) {
  if (d.status !== 'analyzing' || Date.now() - new Date(d.updatedAt).getTime() < STALE_ANALYSIS_MS) return d;
  await ReelStyle.updateOne({ _id: d._id }, { $set: { status: 'error', error: 'The analysis was interrupted. Remove it and paste the link again.' } });
  return { ...d, status: 'error', error: 'The analysis was interrupted. Remove it and paste the link again.' };
}

// GET /reel-styles — the shared styles + the ones this studio added by link
// (theirs in any state, so the picker can show "Analysing…" and failures)
async function listReelStyles(req, res) {
  const rows = await ReelStyle.find({
    $or: [
      { shared: true, hidden: { $ne: true }, status: 'ready' },
      { addedBy: req.user._id },
    ],
  }).sort({ shared: -1, order: 1, createdAt: 1 }).lean();
  const fresh = await Promise.all(rows.map(closeStale));
  res.json({ styles: await Promise.all(fresh.map((d) => serialize(d, req))) });
}

// POST /reel-styles { url } — copy the style of any public reel. An already
// analysed reel is reused (no second analysis); a new one is analysed in the
// background (~30 s) and the picker polls the list.
async function createReelStyle(req, res) {
  const url = String(req.body?.url || '').trim();
  const shortCode = shortCodeOf(url);
  if (!shortCode) return res.status(400).json({ message: 'Paste a link to an Instagram reel, like instagram.com/reel/…' });
  const own = await ReelStyle.countDocuments({ addedBy: req.user._id });
  if (own >= MAX_OWN_STYLES) return res.status(400).json({ message: `You can keep up to ${MAX_OWN_STYLES} reel styles. Remove one first.` });

  let doc = await ReelStyle.findOne({ shortCode });
  if (doc) {
    const rerun = doc.status === 'error';
    doc = await ReelStyle.findOneAndUpdate(
      { _id: doc._id },
      { $addToSet: { addedBy: req.user._id }, ...(rerun ? { $set: { status: 'analyzing', error: '' } } : {}) },
      { new: true },
    );
    if (rerun) track(analyzeReelStyle(doc._id));
  } else {
    try {
      doc = await ReelStyle.create({
        shortCode,
        sourceUrl: `https://www.instagram.com/reel/${shortCode}/`,
        status: 'analyzing',
        createdBy: req.user._id,
        addedBy: [req.user._id],
        shared: false,
        order: 1000,
      });
    } catch (err) {
      // two pastes of the same new link at once: the first one analyses it
      if (err?.code !== 11000) throw err;
      doc = await ReelStyle.findOneAndUpdate({ shortCode }, { $addToSet: { addedBy: req.user._id } }, { new: true });
      return res.status(202).json({ style: await serialize(doc.toObject(), req) });
    }
    track(analyzeReelStyle(doc._id));
  }
  res.status(202).json({ style: await serialize(doc.toObject(), req) });
}

// DELETE /reel-styles/:id — drop a style you added; an admin can also hide a
// shared one from everyone (reversible: hidden flag)
async function removeReelStyle(req, res) {
  const doc = await ReelStyle.findById(req.params.id).catch(() => null);
  if (!doc) return res.status(404).json({ message: 'Reel style not found' });
  if (mineOf(doc, req.user._id)) {
    await ReelStyle.updateOne({ _id: doc._id }, { $pull: { addedBy: req.user._id } });
    return res.json({ ok: true });
  }
  if (doc.shared && isAdmin(req)) {
    await ReelStyle.updateOne({ _id: doc._id }, { $set: { hidden: true } });
    return res.json({ ok: true, hidden: true });
  }
  return res.status(404).json({ message: 'Reel style not found' });
}

module.exports = { listReelStyles, createReelStyle, removeReelStyle };
