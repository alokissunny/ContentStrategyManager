const { Worker } = require('bullmq');
const { redisConnection } = require('../services/planQueue');
const { QUEUE_NAME, envPositiveInt } = require('../services/reelQueue');
const { runCaptureReel } = require('../services/captureReelAgent');

// A reel renders in a child process, so the event loop stays free to renew the
// lock; this is how long a lock survives a missed renewal before the job is
// treated as stalled and handed to another worker.
const LOCK_MS = 5 * 60 * 1000;

// Starts the capture-reel worker in this process. CAPTURE_REEL_CONCURRENCY =
// reels rendered at once here (each is a headless Chromium — keep it to the
// cores you have). Returns { close } for graceful shutdown.
function startReelWorkers() {
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
  });
  worker.on('failed', (job, err) => console.error(`[reelWorkers] reel ${job?.data?.reelId} failed: ${err.message}`));
  worker.on('error', (err) => console.error('[reelWorkers] worker error:', err.message));
  console.log(`[reelWorkers] listening on ${QUEUE_NAME} · concurrency ${concurrency}`);
  return { close: () => worker.close() };
}

module.exports = { startReelWorkers };
