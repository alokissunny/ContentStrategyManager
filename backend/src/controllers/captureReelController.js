const mongoose = require('mongoose');
const Project = require('../models/Project');
const CaptureReel = require('../models/CaptureReel');
const PlannedPost = require('../models/PlannedPost');
const ReelStyle = require('../models/ReelStyle');
const { getMediaUrl, deleteObjects } = require('../services/s3Client');
const { currentUsername } = require('../utils/currentProfile');
const { isRunningHere } = require('../services/captureReelAgent');
const { enqueueCaptureReel, reelJobAlive } = require('../services/reelQueue');

const isId = (v) => mongoose.isValidObjectId(String(v || ''));
const STALE_MS = 20 * 60 * 1000;

// A job that stopped reporting (its worker died and the queue lost it, or the
// in-process fallback restarted) is closed rather than left spinning forever.
// A reel still waiting its turn in the queue is not stale, however long.
async function closeStale(reel) {
  if (!['queued', 'working'].includes(reel.status) || isRunningHere(reel._id)) return reel;
  if (Date.now() - new Date(reel.updatedAt).getTime() < STALE_MS) return reel;
  if (await reelJobAlive(reel._id)) return reel;
  reel.status = 'error';
  reel.error = 'This reel was interrupted. Try again.';
  await CaptureReel.updateOne({ _id: reel._id }, { $set: { status: 'error', error: reel.error } });
  return reel;
}

async function serialize(r, posts = null) {
  const plan = r.plan || {};
  // the calendar post it went onto (read live: moved / deleted posts show)
  let post = null;
  if (r.postId) {
    post = posts ? posts.get(String(r.postId)) || null
      : await PlannedPost.findById(r.postId).select('date published').lean();
  }
  return {
    id: String(r._id),
    projectId: String(r.projectId),
    captureIds: (r.captureIds || []).map(String),
    status: r.status,
    stage: r.stage,
    error: r.error || '',
    ...(r.errorDetail && r.status === 'error' ? { errorDetail: r.errorDetail } : {}),
    direction: r.direction || '',
    styleId: r.styleId ? String(r.styleId) : '',
    styleName: r.styleName || '',
    concept: plan.concept || '',
    hook: plan.hook?.text || '',
    audioMode: plan.audioMode || '',
    caption: r.caption || '',
    hashtags: r.hashtags || [],
    videoKey: r.videoKey || '',
    posterKey: r.posterKey || '',
    posterUrl: r.posterKey ? await getMediaUrl(r.posterKey).catch(() => '') : '',
    durationSec: r.durationSec || 0,
    post: post ? { id: String(post._id), date: post.date, published: Boolean(post.published) } : null,
    costUsd: r.costUsd || 0,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt,
  };
}

// POST /capture-reels { projectId, captureIds: [..], direction? }
async function createReel(req, res) {
  const { projectId, direction, styleId } = req.body || {};
  let style = null;
  if (styleId) {
    style = isId(styleId) ? await ReelStyle.findOne({ _id: styleId, status: 'ready' }).select('name').lean() : null;
    if (!style) return res.status(400).json({ message: 'That reel style is not available.' });
  }
  const captureIds = (Array.isArray(req.body?.captureIds) ? req.body.captureIds : []).filter(isId).slice(0, 24);
  if (!isId(projectId) || !captureIds.length) return res.status(400).json({ message: 'Choose a capture to make a reel from.' });
  const project = await Project.findOne({ _id: projectId, user: req.user._id });
  if (!project) return res.status(404).json({ message: 'Capture not found' });
  const members = captureIds.map((id) => project.captures.id(id)).filter(Boolean);
  if (!members.length) return res.status(404).json({ message: 'Capture not found' });
  if (!members.some((c) => (c.attachments || []).length)) {
    return res.status(400).json({ message: 'This capture has no photos or clips to cut a reel from. Add some first.' });
  }
  // one reel at a time per capture
  const busy = await CaptureReel.findOne({
    user: req.user._id, captureIds: { $in: members.map((c) => c._id) }, status: { $in: ['queued', 'working'] },
  });
  if (busy && (await closeStale(busy)).status !== 'error') {
    return res.status(409).json({ message: 'A reel is already being made from this capture.', reel: await serialize(busy) });
  }
  const reel = await CaptureReel.create({
    user: req.user._id,
    instagramUsername: project.instagramUsername || (await currentUsername(req.user._id)) || null,
    projectId: project._id,
    captureIds: members.map((c) => c._id),
    direction: String(direction || '').trim().slice(0, 600),
    styleId: style?._id || null,
    styleName: style?.name || '',
  });
  const via = await enqueueCaptureReel(reel._id);
  console.log(`[captureReel] ${reel._id} queued (${via})`);
  return res.status(202).json({ reel: await serialize(reel) });
}

// GET /capture-reels?captureId=…  (newest first)
async function listReels(req, res) {
  const filter = { user: req.user._id };
  const ids = String(req.query.captureId || '').split(',').filter(isId).slice(0, 24);
  if (ids.length) filter.captureIds = { $in: ids };
  const rows = await CaptureReel.find(filter).select('-timeline').sort({ createdAt: -1 }).limit(ids.length ? 20 : 50);
  const postIds = rows.map((r) => r.postId).filter(Boolean);
  const posts = new Map((postIds.length
    ? await PlannedPost.find({ _id: { $in: postIds }, user: req.user._id }).select('date published').lean()
    : []).map((p) => [String(p._id), p]));
  const reels = await Promise.all(rows.map(async (r) => serialize(await closeStale(r), posts)));
  return res.json({ reels });
}

async function getReel(req, res) {
  if (!isId(req.params.id)) return res.status(404).json({ message: 'Reel not found' });
  const reel = await CaptureReel.findOne({ _id: req.params.id, user: req.user._id }).select('-timeline');
  if (!reel) return res.status(404).json({ message: 'Reel not found' });
  return res.json({ reel: await serialize(await closeStale(reel)) });
}

async function deleteReel(req, res) {
  if (!isId(req.params.id)) return res.status(404).json({ message: 'Reel not found' });
  const reel = await CaptureReel.findOne({ _id: req.params.id, user: req.user._id });
  if (!reel) return res.status(404).json({ message: 'Reel not found' });
  if (isRunningHere(reel._id)) return res.status(409).json({ message: 'This reel is still being made.' });
  // its calendar post goes too, unless it is already on Instagram (then the
  // post keeps the video it published)
  const post = reel.postId ? await PlannedPost.findOne({ _id: reel.postId, user: req.user._id }) : null;
  if (post?.published) {
    await reel.deleteOne();
    return res.json({ ok: true, keptPost: true });
  }
  if (post) await post.deleteOne();
  const keys = [reel.videoKey, reel.posterKey, reel.voiceKey].filter(Boolean);
  if (keys.length) await deleteObjects(keys).catch((err) => console.warn('[captureReel] delete objects', err.message));
  await reel.deleteOne();
  return res.json({ ok: true });
}

module.exports = { createReel, listReels, getReel, deleteReel };
