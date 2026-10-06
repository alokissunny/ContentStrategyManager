require('dotenv').config();
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
    if (isQueueConfigured() && ['1', 'true', 'on', 'yes'].includes(String(process.env.PLAN_WORKER_IN_API || '').toLowerCase())) {
      const workers = require('./workers/planWorkers').startPlanWorkers();
      process.once('SIGTERM', () => {
        workers.close()
          .catch((err) => console.error('[server] plan workers close failed:', err.message))
          .finally(() => process.exit(0));
      });
    }
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB', err);
    process.exit(1);
  });
