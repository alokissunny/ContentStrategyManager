const mongoose = require('mongoose');
const Project = require('../models/Project');
const CaptureReel = require('../models/CaptureReel');
const PlannedPost = require('../models/PlannedPost');
const ReelStyle = require('../models/ReelStyle');
const { getMediaUrl, deleteObjects } = require('../services/s3Client');
const { currentUsername } = require('../utils/currentProfile');
const { isRunningHere } = require('../services/captureReelAgent');
const {
  enqueueCaptureReel, reelJobAlive, queueTag, isReelQueueConfigured, reelQueueDepth,
} = require('../services/reelQueue');
const { memoryLimitMb } = require('../utils/memoryLimit');
const { wantsPromptDebug } = require('../utils/promptDebug');
const { writeVoiceoverScript } = require('../services/voiceoverScript');

// Capture › Reel › Include voiceover: the script the studio records (bauhly-v3 VoicePrep)
// POST /capture-reels/voiceover-script { projectId, captureId } → { parts: [{ ask, say, seconds, assetKeys }] }
async function voiceoverScript(req, res) {
  const { projectId, captureId } = req.body || {};
  if (!isId(projectId) || !isId(captureId)) return res.status(400).json({ message: 'Choose a capture first.' });
  try {
    const { parts, debug } = await writeVoiceoverScript({ userId: req.user._id, projectId, captureId });
    return res.json({ parts, ...(wantsPromptDebug(req) ? { debug } : {}) });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ message: err.message });
    console.error('[captureReel] voiceover script failed:', err.message);
    return res.status(502).json({ message: 'Bauhly could not write the voiceover script just now. Try again.' });
  }
}

// the studio's recorded voiceover for a capture reel: the script parts and one take
// (an uploaded audio key under the user's own prefix) per part
function voiceoverOf(raw, userId) {
  if (!raw || typeof raw !== 'object') return null;
  const prefix = `projects/${userId}/`;
  const parts = (Array.isArray(raw.parts) ? raw.parts : []).slice(0, 6)
    .map((p) => ({ say: String(p?.say || '').trim().slice(0, 600), ask: String(p?.ask || '').trim().slice(0, 140) }))
    .filter((p) => p.say);
  const takes = (Array.isArray(raw.takes) ? raw.takes : []).slice(0, 12)
    .filter((t) => t && typeof t.key === 'string' && t.key.startsWith(prefix) && t.key.length < 300)
    .map((t) => ({ key: t.key, part: Math.max(0, Math.min(5, Math.round(Number(t.part) || 0))) }));
  if (!takes.length) return null;
  return { parts, takes };
}

const isId = (v) => mongoose.isValidObjectId(String(v || ''));
// the sweeper (services/reelSweeper.js) re-queues lost reels within minutes;
// this only closes one nothing has touched for an hour
const STALE_MS = 60 * 60 * 1000;

// A job that stopped reporting (its worker died and the queue lost it, or the
// in-process fallback restarted) is closed rather than left spinning forever.
// A reel still waiting its turn in the queue is not stale, however long.
async function closeStale(reel) {
  if (!['queued', 'working'].includes(reel.status) || isRunningHere(reel._id)) return reel;
  if (reel.queueTag && reel.queueTag !== queueTag()) return reel; // another environment's queue
  if (Date.now() - new Date(reel.updatedAt).getTime() < STALE_MS) return reel;
  if ((await reelJobAlive(reel)) !== false) return reel; // alive, or can't tell (Redis down)
  reel.status = 'error';
  reel.error = 'This reel was interrupted. Try again.';
  await CaptureReel.updateOne({ _id: reel._id }, { $set: { status: 'error', error: reel.error } });
  return reel;
}

async function serialize(r, posts = null, { withPreview = false } = {}) {
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
    format: plan.format || '',
    altHook: plan.altHook || '',
    caption: r.caption || '',
    hashtags: r.hashtags || [],
    videoKey: r.videoKey || '',
    posterKey: r.posterKey || '',
    posterUrl: r.posterKey ? await getMediaUrl(r.posterKey).catch(() => '') : '',
    durationSec: r.durationSec || 0,
    // still rendering: the cut itself, for the in-browser preview player
    ...(withPreview && r.timeline && ['queued', 'working'].includes(r.status) ? { preview: r.timeline } : {}),
    post: post ? { id: String(post._id), date: post.date, published: Boolean(post.published) } : null,
    costUsd: r.costUsd || 0,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt,
  };
}

// POST /capture-reels { projectId, captureIds: [..], direction? }
async function createReel(req, res) {
  const { projectId, direction, styleId, ideaId } = req.body || {};
  // a recommended post: the cut follows the reel plan made for it
  const idea = isId(ideaId)
    ? await require('../models/PostIdea').findOne({ _id: ideaId, user: req.user._id }).select('reelPlan assets sources').lean()
    : null;
  const storyPlan = idea?.reelPlan?.sequences?.length ? idea.reelPlan : null;
  // recording-guide takes (ReelPlanner): which sequence each upload was recorded for
  const takes = (Array.isArray(req.body?.takes) ? req.body.takes : []).slice(0, 24)
    .filter((t) => t && typeof t.key === 'string' && t.key.length < 300)
    .map((t) => ({ key: t.key, sequence: Math.max(0, Math.min(9, Math.round(Number(t.sequence) || 0))), role: t.role === 'broll' ? 'broll' : 'say' }));
  // B-roll beyond this capture: the idea's suggested media, then its source captures' photos/clips
  const brollKeys = storyPlan ? await require('../services/ideaReelPlan').reelBrollKeys(req.user._id, idea) : [];
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
  if (!members.some((c) => (c.attachments || []).length) && storyPlan?.format !== 'motion_graphics') {
    return res.status(400).json({ message: 'This capture has no photos or clips to cut a reel from. Add some first.' });
  }
  // the takes recorded for this reel are marked on the capture, so they stay this reel's
  // footage and are never offered as project photos/clips again (studio, 2026-11-21)
  if (takes.length) {
    const roleOf = new Map(takes.map((t) => [t.key, t.role]));
    let marked = false;
    members.forEach((c) => (c.attachments || []).forEach((a) => {
      if (roleOf.has(a.key) && a.reelTake !== roleOf.get(a.key)) { a.reelTake = roleOf.get(a.key); marked = true; }
    }));
    if (marked) await project.save().catch((err) => console.warn('[captureReel] could not mark takes', err.message));
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
    ideaId: storyPlan ? idea._id : null,
    storyPlan,
    takes: takes.length ? takes : null,
    brollKeys,
    styleId: style?._id || null,
    styleName: style?.name || '',
    // Capture › format panel › Reel › Include voiceover: the studio's own recorded takes
    voiceover: voiceoverOf(req.body?.voiceover, req.user._id),
    // Capture › format panel › Reel settings
    prefs: req.body?.prefs && typeof req.body.prefs === 'object' ? {
      graphics: req.body.prefs.graphics === 'out' ? 'out' : 'in',
      music: req.body.prefs.music === 'none' ? 'none' : 'auto',
    } : null,
    queueTag: queueTag(),
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
  const reel = await CaptureReel.findOne({ _id: req.params.id, user: req.user._id });
  if (!reel) return res.status(404).json({ message: 'Reel not found' });
  return res.json({ reel: await serialize(await closeStale(reel), null, { withPreview: true }) });
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

// GET /capture-reels/system (admin) — can THIS server render reels? What the
// reel worker sees from inside the deployment: memory, whether it started,
// and the queue. For "my reel keeps waiting".
async function reelSystem(req, res) {
  const minMb = Number(process.env.REEL_RENDER_MIN_MEMORY_MB) || 1536;
  const memMb = memoryLimitMb();
  const { reelWorkerState } = require('../workers/reelWorkers');
  const waiting = await CaptureReel.countDocuments({ status: 'queued', queueTag: queueTag() });
  res.json({
    queueConfigured: isReelQueueConfigured(),
    queueTag: queueTag(),
    memoryLimitMb: memMb,
    renderNeedsMb: minMb,
    canRender: memMb >= minMb,
    workerInThisProcess: reelWorkerState(),
    env: {
      PLAN_QUEUE: process.env.PLAN_QUEUE || '', REEL_QUEUE: process.env.REEL_QUEUE || '',
      PLAN_WORKER_IN_API: process.env.PLAN_WORKER_IN_API || '', REEL_WORKER_IN_API: process.env.REEL_WORKER_IN_API || '',
      CAPTURE_REEL_CONCURRENCY: process.env.CAPTURE_REEL_CONCURRENCY || '', NODE_ENV: process.env.NODE_ENV || '',
    },
    queue: await reelQueueDepth(),
    reelsWaitingInThisQueue: waiting,
  });
}

/*
 * POST /api/capture-reels/:id/regenerate — experimental (studio, 2026-11-21): a new reel from the
 * SAME capture, recordings (takes), story plan and project photos, cut again by the current editor
 * (a fresh edit, music and render). The old reel stays until the new one replaces it in the list.
 * A Talking head story is cut as Talking head + B-roll (Face camera's format since 2026-11-21).
 */
async function regenerateReel(req, res) {
  const { id } = req.params;
  if (!isId(id)) return res.status(404).json({ message: 'Reel not found' });
  const old = await CaptureReel.findOne({ _id: id, user: req.user._id }).lean();
  if (!old) return res.status(404).json({ message: 'Reel not found' });
  const project = await Project.findOne({ _id: old.projectId, user: req.user._id });
  const members = (old.captureIds || []).map((cid) => project?.captures.id(cid)).filter(Boolean);
  if (!project || !members.length) return res.status(404).json({ message: 'That capture no longer exists.' });
  const busy = await CaptureReel.findOne({
    user: req.user._id, captureIds: { $in: members.map((c) => c._id) }, status: { $in: ['queued', 'working'] },
  });
  if (busy && (await closeStale(busy)).status !== 'error') {
    return res.status(409).json({ message: 'A reel is already being made from this capture.', reel: await serialize(busy) });
  }
  // the recordings that are still on the capture
  const onFile = new Set(members.flatMap((c) => (c.attachments || []).map((a) => a.key)));
  const takes = (old.takes || []).filter((t) => t?.key && onFile.has(t.key));
  // the story: the idea's current plan when there is one, else the one this reel was cut to
  const idea = old.ideaId
    ? await require('../models/PostIdea').findOne({ _id: old.ideaId, user: req.user._id }).select('reelPlan assets sources').lean()
    : null;
  let storyPlan = idea?.reelPlan?.sequences?.length ? idea.reelPlan : old.storyPlan;
  // spoken formats this build cuts as Talking head + B-roll (Face camera's format; talking_head_motion is
  // a format from another branch) — so a regenerate runs the cut, caption and motion-graphics agents
  if (['talking_head', 'talking_head_motion'].includes(storyPlan?.format)) storyPlan = { ...storyPlan, format: 'talking_head_broll' };
  const brollKeys = idea ? await require('../services/ideaReelPlan').reelBrollKeys(req.user._id, idea) : (old.brollKeys || []);
  // from a post's Debug tab: the new video replaces the one in that post (same day)
  let replacesPostId = null;
  if (req.body?.replacePost && old.postId) {
    const target = await PlannedPost.findOne({ _id: old.postId, user: req.user._id }).select('published').lean();
    if (target?.published) return res.status(409).json({ message: 'This post is already on Instagram — its video can’t be replaced.' });
    if (target) replacesPostId = target._id;
  }
  const reel = await CaptureReel.create({
    user: req.user._id,
    instagramUsername: old.instagramUsername || project.instagramUsername || null,
    projectId: project._id,
    captureIds: members.map((c) => c._id),
    direction: old.direction || '',
    ideaId: old.ideaId || null,
    storyPlan: storyPlan || null,
    takes: takes.length ? takes : null,
    brollKeys,
    styleId: old.styleId || null,
    styleName: old.styleName || '',
    prefs: old.prefs || null,
    voiceover: old.voiceover || null,
    replacesPostId,
    queueTag: queueTag(),
  });
  const via = await enqueueCaptureReel(reel._id);
  console.log(`[captureReel] ${reel._id} regenerated from ${old._id} (${takes.length} take(s), ${via})`);
  return res.status(202).json({ reel: await serialize(reel) });
}

module.exports = {
  voiceoverScript, createReel, regenerateReel, listReels, getReel, deleteReel, reelSystem };
