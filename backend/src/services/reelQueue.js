/*
 * Capture reels on BullMQ (Redis) — Captures › Generate reel.
 *
 *   POST /capture-reels ──► CaptureReel (Mongo, status queued) + "capture-reel" job { reelId }
 *   worker (workers/reelWorkers.js) ──► captureReelAgent.runCaptureReel(reelId)
 *
 * Rendering is CPU-heavy (headless Chromium + ffmpeg), so it belongs on worker
 * processes that scale on their own: more worker instances = more reels at
 * once; CAPTURE_REEL_CONCURRENCY = reels per worker process. State lives on the
 * CaptureReel document; the job only carries the id (job id = reel id, so a
 * double click never queues the same reel twice).
 *
 * Uses the plan queue's Redis (REDIS_URL). On when PLAN_QUEUE or REEL_QUEUE is
 * set; if Redis is unreachable the reel runs in the API process instead.
 */
const { redisConnection, envPositiveInt } = require('./planQueue');

const QUEUE_NAME = 'capture-reel';

// Which queue a reel belongs to. Local dev and prod share one MongoDB, so a
// sweeper must only touch reels made against ITS OWN Redis — else a dev
// machine re-queues (and renders) prod's reels. Stamped on every reel.
function queueTag() {
  if (process.env.REEL_QUEUE_TAG) return process.env.REEL_QUEUE_TAG;
  const basis = isReelQueueConfigured() ? `redis:${process.env.REDIS_URL}` : `local:${require('os').hostname()}`;
  return require('crypto').createHash('sha1').update(basis).digest('hex').slice(0, 12);
}
const ENQUEUE_TIMEOUT_MS = 5000;

const flag = (name) => ['1', 'true', 'on', 'yes'].includes(String(process.env[name] || '').trim().toLowerCase());

function isReelQueueConfigured() {
  if (!String(process.env.REDIS_URL || '').trim()) return false;
  if (String(process.env.REEL_QUEUE || '').trim()) return flag('REEL_QUEUE');
  return flag('PLAN_QUEUE');
}

let queueInstance = null;
function reelQueue() {
  if (!queueInstance) {
    const { Queue } = require('bullmq');
    queueInstance = new Queue(QUEUE_NAME, { connection: redisConnection() });
  }
  return queueInstance;
}

function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${what} timed out`)), ms); }),
  ]).finally(() => clearTimeout(t));
}

/**
 * Queue a reel. Returns 'queue' or 'local' (in-process fallback).
 * `fresh` = a re-queue by the sweeper: a new job id, since BullMQ ignores an
 * add whose id it still remembers (finished jobs are kept for a day).
 */
async function enqueueCaptureReel(reelId, { fresh = false } = {}) {
  const id = String(reelId);
  const { runInProcess, MAX_ATTEMPTS } = require('./captureReelAgent');
  if (!isReelQueueConfigured()) { runInProcess(id); return 'local'; }
  const jobId = fresh ? `${id}-${Date.now().toString(36)}` : id;
  try {
    await withTimeout(reelQueue().add('reel', { reelId: id }, {
      jobId,
      // a temporary failure is retried with growing waits (20 s, 40 s); the
      // reel itself counts tries, so a worker death also uses one up
      attempts: MAX_ATTEMPTS,
      backoff: { type: 'exponential', delay: 20000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 2000 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    }), ENQUEUE_TIMEOUT_MS, 'enqueue');
    await require('../models/CaptureReel').updateOne({ _id: id }, { $set: { jobId } }).catch(() => {});
    return 'queue';
  } catch (err) {
    console.error(`[reelQueue] could not queue reel ${id} (${err.message}) — running it here`);
    runInProcess(id);
    return 'local';
  }
}

/** Is a job for this reel waiting or running anywhere? null = cannot tell. */
async function reelJobAlive(reel) {
  if (!isReelQueueConfigured()) return null;
  const jobId = typeof reel === 'object' && reel ? (reel.jobId || String(reel._id)) : String(reel);
  try {
    const job = await withTimeout(reelQueue().getJob(jobId), 2000, 'getJob');
    if (!job) return false;
    const state = await withTimeout(job.getState(), 2000, 'getState');
    return ['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'].includes(state);
  } catch {
    return null;
  }
}

/** How many reels are ahead in the queue (for "Waiting for the reel ahead…"). */
async function reelQueueDepth() {
  if (!isReelQueueConfigured()) return null;
  try {
    const c = await withTimeout(reelQueue().getJobCounts('waiting', 'active', 'delayed'), 2000, 'counts');
    return c;
  } catch {
    return null;
  }
}

async function removeReelJob(reel) {
  if (!isReelQueueConfigured()) return;
  try {
    const job = await withTimeout(reelQueue().getJob(reel.jobId || String(reel._id)), 2000, 'getJob');
    if (job) await job.remove().catch(() => {});
  } catch { /* gone or unreachable */ }
}

async function closeReelQueue() {
  await queueInstance?.close().catch(() => {});
  queueInstance = null;
}

module.exports = {
  QUEUE_NAME,
  queueTag,
  envPositiveInt,
  isReelQueueConfigured,
  enqueueCaptureReel,
  reelJobAlive,
  removeReelJob,
  reelQueueDepth,
  closeReelQueue,
};
