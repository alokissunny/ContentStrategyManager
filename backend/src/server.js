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
      `day=${process.env.PLAN_DAY_REASONING_EFFORT || 'medium'}`,
      `visual=${process.env.PLAN_VISUAL_REASONING_EFFORT || 'low'}`,
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
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB', err);
    process.exit(1);
  });
