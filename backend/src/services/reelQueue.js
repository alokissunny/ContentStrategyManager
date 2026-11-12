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

/** Queue a reel. Returns 'queue' or 'local' (in-process fallback). */
async function enqueueCaptureReel(reelId) {
  const id = String(reelId);
  const { runInProcess } = require('./captureReelAgent');
  if (!isReelQueueConfigured()) { runInProcess(id); return 'local'; }
  try {
    await withTimeout(reelQueue().add('reel', { reelId: id }, {
      jobId: id,
      // a failure inside the run is written onto the reel and the job ends
      // normally; a retry only happens when the worker itself died mid-run
      attempts: 2,
      backoff: { type: 'fixed', delay: 5000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 2000 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    }), ENQUEUE_TIMEOUT_MS, 'enqueue');
    return 'queue';
  } catch (err) {
    console.error(`[reelQueue] could not queue reel ${id} (${err.message}) — running it here`);
    runInProcess(id);
    return 'local';
  }
}

/** Is a job for this reel waiting or running anywhere? null = cannot tell. */
async function reelJobAlive(reelId) {
  if (!isReelQueueConfigured()) return null;
  try {
    const job = await withTimeout(reelQueue().getJob(String(reelId)), 2000, 'getJob');
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

async function closeReelQueue() {
  await queueInstance?.close().catch(() => {});
  queueInstance = null;
}

module.exports = {
  QUEUE_NAME,
  envPositiveInt,
  isReelQueueConfigured,
  enqueueCaptureReel,
  reelJobAlive,
  reelQueueDepth,
  closeReelQueue,
};
