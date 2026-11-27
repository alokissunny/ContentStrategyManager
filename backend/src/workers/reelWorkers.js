const { Worker } = require('bullmq');
const { redisConnection } = require('../services/planQueue');
const { QUEUE_NAME, envPositiveInt } = require('../services/reelQueue');
const { runCaptureReel } = require('../services/captureReelAgent');
const CaptureReel = require('../models/CaptureReel');
const { memoryLimitMb } = require('../utils/memoryLimit');

// A reel renders in a child process, so the event loop stays free to renew the
// lock; this is how long a lock survives a missed renewal before the job is
// treated as stalled and handed to another worker.
// Short, so a reel whose worker died is picked up again within ~1.5 min (the
// lock is renewed every 30 s while it runs — the render is a child process).
const LOCK_MS = 60 * 1000;

// Starts the capture-reel worker in this process. CAPTURE_REEL_CONCURRENCY =
// reels rendered at once here (each is a headless Chromium — keep it to the
// cores you have). Returns { close } for graceful shutdown.
// what /capture-reels/system reports about this process
let state = { started: false, reason: 'never asked to start (no queue, or REEL_WORKER_IN_API / PLAN_WORKER_IN_API off here)' };
const reelWorkerState = () => state;

function startReelWorkers() {
  // Only a machine that can render takes reel jobs: on a smaller one the job
  // would OOM-kill the process — instead it stays queued for a worker that can.
  const memMb = memoryLimitMb();
  const minMb = Number(process.env.REEL_RENDER_MIN_MEMORY_MB) || 1536;
  if (memMb < minMb) {
    console.warn(`[reelWorkers] NOT started: ${memMb} MB memory < ${minMb} MB a render needs — reels wait in the queue for a bigger worker`);
    state = { started: false, reason: `memory ${memMb} MB < ${minMb} MB needed (REEL_RENDER_MIN_MEMORY_MB)`, memoryLimitMb: memMb };
    return { close: async () => {} };
  }
  const concurrency = envPositiveInt('CAPTURE_REEL_CONCURRENCY', 1);
  let running = 0;
  const worker = new Worker(QUEUE_NAME, async (job) => {
    running += 1;
    try {
    const started = Date.now();
    const waited = started - (job.timestamp || started);
    console.log(`[reelWorkers] start reel ${job.data.reelId} · waited ${Math.round(waited / 1000)}s · try ${job.attemptsMade + 1}`);
    // peak memory of this process while the reel ran (other reels running at once count too) —
    // what sizes the box and CAPTURE_REEL_CONCURRENCY; a local Chrome render is a child process
    // and isn't in it
    let peak = process.memoryUsage().rss;
    const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 2000);
    sampler.unref?.();
    try {
      await runCaptureReel(job.data.reelId);
    } finally {
      clearInterval(sampler);
      console.log(`[reelWorkers] reel ${job.data.reelId} · peak rss ${Math.round(peak / 1048576)} MB · ${running - 1} other reel(s) running`);
    }
    console.log(`[reelWorkers] done reel ${job.data.reelId} in ${Math.round((Date.now() - started) / 1000)}s`);
    return { reelId: job.data.reelId };
    } finally { running -= 1; }
  }, {
    connection: redisConnection(),
    concurrency,
    lockDuration: LOCK_MS,
    // a reel whose worker died mid-run (deploy, out of memory) is handed out
    // once more — it resumes from its saved cut; a second death fails it (no
    // crash loop; the reel also counts its own tries)
    maxStalledCount: 1,
  });
  worker.on('failed', (job, err) => {
    console.error(`[reelWorkers] reel ${job?.data?.reelId} failed: ${err.message}`);
    // retries are BullMQ's (a retryable error re-delivers with backoff); here
    // only the end of the road: stalled twice, or out of tries
    const outOfTries = (job?.attemptsMade || 0) >= (job?.opts?.attempts || 1);
    if (job?.data?.reelId && (/stalled/i.test(err.message) || outOfTries)) {
      CaptureReel.updateOne({ _id: job.data.reelId, status: { $in: ['queued', 'working'] } }, {
        $set: {
          status: 'error',
          error: /stalled/i.test(err.message)
            ? 'The server stopped while this reel was rendering. Try again.'
            : 'This reel could not be made after several tries. Try again.',
          errorDetail: /stalled/i.test(err.message)
            ? `worker died mid-run twice (deploy or out of memory) — ${err.message}`
            : `out of tries — ${err.message}`,
          finishedAt: new Date(),
        },
      }).catch(() => {});
    }
  });
  worker.on('error', (err) => console.error('[reelWorkers] worker error:', err.message));
  console.log(`[reelWorkers] listening on ${QUEUE_NAME} · concurrency ${concurrency} · memory limit ${memoryLimitMb()} MB`);
  state = { started: true, concurrency, memoryLimitMb: memoryLimitMb(), since: new Date().toISOString() };
  const stopBeat = startHeartbeat(state);
  return { close: async () => { await stopBeat(); await worker.close(); } };
}

// Heartbeat in Redis, so the API (which never renders) can tell admins which
// reel workers are alive on OTHER services — e.g. igsignal-reel-worker.
const HEARTBEAT_PREFIX = 'reel-worker:alive:';
const HEARTBEAT_EVERY_MS = 30 * 1000;
const HEARTBEAT_TTL_S = 90;

function startHeartbeat(info) {
  const os = require('os');
  const key = `${HEARTBEAT_PREFIX}${os.hostname()}:${process.pid}`;
  const value = () => JSON.stringify({
    host: os.hostname(),
    service: process.env.RENDER_SERVICE_NAME || '',
    concurrency: info.concurrency,
    memoryLimitMb: info.memoryLimitMb,
    since: info.since,
  });
  const beat = () => redisConnection().set(key, value(), 'EX', HEARTBEAT_TTL_S)
    .catch((err) => console.warn('[reelWorkers] heartbeat failed:', err.message));
  beat();
  const t = setInterval(beat, HEARTBEAT_EVERY_MS);
  t.unref();
  return async () => {
    clearInterval(t);
    await redisConnection().del(key).catch(() => {});
  };
}

// The reel workers alive anywhere on this Redis (heartbeat < 90 s old).
async function liveReelWorkers() {
  const redis = redisConnection();
  const keys = [];
  let cursor = '0';
  do {
    // eslint-disable-next-line no-await-in-loop
    const [next, batch] = await redis.scan(cursor, 'MATCH', `${HEARTBEAT_PREFIX}*`, 'COUNT', 100);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0' && keys.length < 200);
  if (!keys.length) return [];
  const values = await redis.mget(keys);
  return values.filter(Boolean).map((v) => { try { return JSON.parse(v); } catch { return null; } }).filter(Boolean);
}

module.exports = { startReelWorkers, reelWorkerState, liveReelWorkers };
