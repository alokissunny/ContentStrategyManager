// Background worker process for queued post generation (Render "worker"
// service: `node src/workers/index.js`). Needs the same env as the API plus
// REDIS_URL. See services/planQueue.js.
require('dotenv').config();
const connectDB = require('../config/db');
const { loadRuntimeSettings } = require('../services/runtimeSettings');
const { isQueueConfigured, closePlanQueue } = require('../services/planQueue');

async function main() {
  if (!String(process.env.REDIS_URL || '').trim()) {
    console.error('[workers] REDIS_URL is not set — nothing to do.');
    process.exit(1);
  }
  if (!isQueueConfigured()) {
    console.warn('[workers] PLAN_QUEUE is off — workers run, but the API keeps generating synchronously.');
  }
  await connectDB();
  await loadRuntimeSettings();
  const { startPlanWorkers } = require('./planWorkers');
  const planWorkers = String(process.env.PLAN_WORKERS || '1') === '0' ? null : startPlanWorkers();
  // Capture reels render here too; REEL_WORKERS=0 leaves them to another
  // service (e.g. a bigger instance that only renders reels — with
  // PLAN_WORKERS=0 there).
  const reelWorkers = String(process.env.REEL_WORKERS || '1') === '0'
    ? null : require('./reelWorkers').startReelWorkers();
  const workers = {
    close: () => Promise.all([planWorkers?.close(), reelWorkers?.close()]),
  };

  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`[workers] ${signal} — finishing in-flight jobs…`);
    await workers.close().catch((err) => console.error('[workers] close failed:', err.message));
    await require('../services/reelQueue').closeReelQueue();
    await closePlanQueue();
    process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

main().catch((err) => {
  console.error('[workers] failed to start:', err);
  process.exit(1);
});
