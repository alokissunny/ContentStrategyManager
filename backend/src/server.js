require('dotenv').config();
// sharp's operation cache keeps decoded pictures around between calls; on a
// 512 MB instance the Theme Apply renders need that memory more
require('sharp').cache(false);
const app = require('./app');
const connectDB = require('./config/db');
const ensureInstagramIndexes = require('./utils/ensureInstagramIndexes');
const { resolvePlanAgentLlm } = require('./services/planAgentLlm');
const { loadRuntimeSettings } = require('./services/runtimeSettings');

const PORT = process.env.PORT || 5001;

connectDB()
  .then(async () => {
    await ensureInstagramIndexes();
    await loadRuntimeSettings();
    const layout = resolvePlanAgentLlm('layout');
    const effort = [
      `strategist=${process.env.PLAN_STRATEGIST_REASONING_EFFORT || 'medium'}`,
      `structure=${process.env.PLAN_STRUCTURE_REASONING_EFFORT || 'medium'}`,
      `carousel=${process.env.PLAN_CAROUSEL_REASONING_EFFORT || 'low'}`,
    ].join(' ');
    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT} · layout=${layout.provider}/${layout.model} · effort ${effort}`);
    });
    // Plan/carousel generation runs long (a high-reasoning carousel can take
    // several minutes). Node's default requestTimeout is 5 min, which would abort
    // those requests mid-generation. Give long agent runs room; keep headers
    // timeout tight. Env override: SERVER_REQUEST_TIMEOUT_MS.
    const reqTimeout = Number(process.env.SERVER_REQUEST_TIMEOUT_MS);
    server.requestTimeout = Number.isFinite(reqTimeout) && reqTimeout >= 0 ? reqTimeout : 600000;
    server.headersTimeout = 65000;

    // Queued post generation: PLAN_WORKER_IN_API=1 runs the BullMQ workers in
    // this process (no separate worker service needed). See services/planQueue.
    const { isQueueConfigured } = require('./services/planQueue');
    let workers = null;
    const workersInApi = ['1', 'true', 'on', 'yes'].includes(String(process.env.PLAN_WORKER_IN_API || '').toLowerCase());
    if (isQueueConfigured() && workersInApi) {
      workers = require('./workers/planWorkers').startPlanWorkers();
    }
    // Capture reels (Captures › Generate reel) — same switch; production should
    // run them on the worker service instead (rendering is CPU-heavy).
    let reelWorkers = null;
    // REEL_WORKER_IN_API=0 leaves reels to a separate (bigger) worker service
    // even when plan workers run here — a render needs ~700 MB.
    const reelEnv = String(process.env.REEL_WORKER_IN_API || '').trim().toLowerCase();
    const reelsInApi = reelEnv ? ['1', 'true', 'on', 'yes'].includes(reelEnv) : workersInApi;
    if (require('./services/reelQueue').isReelQueueConfigured() && reelsInApi) {
      reelWorkers = require('./workers/reelWorkers').startReelWorkers();
    }
    // the API keeps every capture reel moving: re-queues ones whose job was lost
    require('./services/reelSweeper').startReelSweeper();

    // Graceful shutdown: a deploy sends SIGTERM. Stop taking new connections,
    // let open requests and background runs (Theme Apply, fire-and-forget plan
    // generation) finish, then exit. Keep SHUTDOWN_GRACE_MS under Render's
    // maxShutdownDelaySeconds (render.yaml).
    const graceMs = Number(process.env.SHUTDOWN_GRACE_MS) > 0 ? Number(process.env.SHUTDOWN_GRACE_MS) : 240_000;
    let stopping = false;
    const shutdown = async (signal) => {
      if (stopping) return;
      stopping = true;
      const { drain, inFlight } = require('./utils/backgroundWork');
      console.log(`[server] ${signal} — draining (${inFlight()} background run(s), up to ${Math.round(graceMs / 1000)}s)`);
      const deadline = setTimeout(() => {
        console.error('[server] shutdown grace ran out — exiting with work still running');
        process.exit(1);
      }, graceMs + 5_000);
      deadline.unref();
      const closed = new Promise((ok) => server.close(() => ok()));
      server.closeIdleConnections?.();
      const [drained] = await Promise.all([
        drain(graceMs),
        workers ? workers.close().catch((err) => console.error('[server] plan workers close failed:', err.message)) : null,
        reelWorkers ? reelWorkers.close().catch((err) => console.error('[server] reel workers close failed:', err.message)) : null,
      ]);
      await Promise.race([closed, new Promise((ok) => setTimeout(ok, 5_000))]);
      if (!drained) console.error('[server] background runs still going at exit');
      process.exit(0);
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB', err);
    process.exit(1);
  });
