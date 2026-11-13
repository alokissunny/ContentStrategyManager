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
function startReelWorkers() {
  // Only a machine that can render takes reel jobs: on a smaller one the job
  // would OOM-kill the process — instead it stays queued for a worker that can.
  const memMb = memoryLimitMb();
  const minMb = Number(process.env.REEL_RENDER_MIN_MEMORY_MB) || 1536;
  if (memMb < minMb) {
    console.warn(`[reelWorkers] NOT started: ${memMb} MB memory < ${minMb} MB a render needs — reels wait in the queue for a bigger worker`);
    return { close: async () => {} };
  }
  const concurrency = envPositiveInt('CAPTURE_REEL_CONCURRENCY', 1);
  const worker = new Worker(QUEUE_NAME, async (job) => {
    const started = Date.now();
    const waited = started - (job.timestamp || started);
    console.log(`[reelWorkers] start reel ${job.data.reelId} · waited ${Math.round(waited / 1000)}s · try ${job.attemptsMade + 1}`);
    await runCaptureReel(job.data.reelId);
    console.log(`[reelWorkers] done reel ${job.data.reelId} in ${Math.round((Date.now() - started) / 1000)}s`);
    return { reelId: job.data.reelId };
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
  return { close: () => worker.close() };
}

module.exports = { startReelWorkers };
