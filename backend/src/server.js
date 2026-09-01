require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const ensureInstagramIndexes = require('./utils/ensureInstagramIndexes');
const { resolvePlanAgentLlm } = require('./services/planAgentLlm');

const PORT = process.env.PORT || 5001;

connectDB()
  .then(async () => {
    await ensureInstagramIndexes();
    const layout = resolvePlanAgentLlm('layout');
    const effort = [
      `strategist=${process.env.PLAN_STRATEGIST_REASONING_EFFORT || 'medium'}`,
      `structure=${process.env.PLAN_STRUCTURE_REASONING_EFFORT || 'medium'}`,
      `day=${process.env.PLAN_DAY_REASONING_EFFORT || 'medium'}`,
    ].join(' ');
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT} · layout=${layout.provider}/${layout.model} · effort ${effort}`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB', err);
    process.exit(1);
  });
