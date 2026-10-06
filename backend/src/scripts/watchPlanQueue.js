// Live view of the plan-generation queues: every job going in (with its data)
// and coming out (result or error). Read-only — it never takes jobs.
//
//   node src/scripts/watchPlanQueue.js            # live events from now on
//   node src/scripts/watchPlanQueue.js --history  # replay the last events first
//
// Needs REDIS_URL (read from backend/.env).
require('dotenv').config();
const { Queue, QueueEvents } = require('bullmq');
const IORedis = require('ioredis');
const { QUEUE } = require('../services/planQueue');

const url = process.env.REDIS_URL;
if (!url) {
  console.error('REDIS_URL is not set.');
  process.exit(1);
}
const history = process.argv.includes('--history');
const connection = new IORedis(url, { maxRetriesPerRequest: null });

const time = () => new Date().toISOString().slice(11, 23);
const short = (v, n = 160) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > n ? `${s.slice(0, n)}…` : s;
};
const runOf = (data) => (data?.runId ? `run ${String(data.runId).slice(-6)}${data.handle ? ` @${data.handle}` : ''}` : '');

async function watch(name) {
  const queue = new Queue(name, { connection });
  const events = new QueueEvents(name, { connection: connection.duplicate(), lastEventId: history ? '0' : '$' });
  const label = (jobId) => `${time()} ${name.padEnd(13)} ${String(jobId).padEnd(46)}`;
  const jobData = async (jobId) => (await queue.getJob(jobId).catch(() => null))?.data;

  events.on('added', async ({ jobId }) => {
    const data = await jobData(jobId);
    console.log(`${label(jobId)} IN        ${runOf(data)} data=${short(data)}`);
  });
  events.on('waiting-children', ({ jobId }) => console.log(`${label(jobId)} WAITING   for its child jobs`));
  events.on('active', async ({ jobId, prev }) => {
    const job = await queue.getJob(jobId).catch(() => null);
    console.log(`${label(jobId)} ACTIVE    ${runOf(job?.data)} attempt ${(job?.attemptsMade || 0) + 1}/${job?.opts?.attempts || 1} (was ${prev})`);
  });
  events.on('completed', async ({ jobId, returnvalue }) => {
    const job = await queue.getJob(jobId).catch(() => null);
    const took = job?.finishedOn && job?.processedOn ? ` in ${((job.finishedOn - job.processedOn) / 1000).toFixed(1)}s` : '';
    console.log(`${label(jobId)} OUT ✓     ${runOf(job?.data)}${took} result=${short(returnvalue)}`);
  });
  events.on('failed', ({ jobId, failedReason }) => console.log(`${label(jobId)} OUT ✗     ${short(failedReason, 240)}`));
  events.on('delayed', async ({ jobId, delay }) => {
    const job = await queue.getJob(jobId).catch(() => null);
    console.log(
      `${label(jobId)} RETRY     at ${new Date(Number(delay)).toISOString().slice(11, 19)}` +
        (job?.failedReason ? ` after: ${short(job.failedReason, 200)}` : ''),
    );
  });
  events.on('stalled', ({ jobId }) => console.log(`${label(jobId)} STALLED   worker stopped renewing its lock — will be retried`));
  events.on('removed', ({ jobId }) => console.log(`${label(jobId)} REMOVED`));

  await events.waitUntilReady();
  return { queue, events };
}

(async () => {
  const watched = await Promise.all(Object.values(QUEUE).map(watch));
  const counts = await Promise.all(watched.map(async ({ queue }) => {
    const c = await queue.getJobCounts('waiting', 'active', 'waiting-children', 'delayed', 'completed', 'failed');
    return `${queue.name}: ${Object.entries(c).map(([k, v]) => `${k}=${v}`).join(' ')}`;
  }));
  console.log(`Watching ${Object.values(QUEUE).join(', ')}${history ? ' (with history)' : ''} — Ctrl+C to stop`);
  counts.forEach((c) => console.log(`  ${c}`));
  const stop = async () => {
    await Promise.all(watched.flatMap(({ queue, events }) => [events.close(), queue.close()]));
    await connection.quit();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})().catch((err) => {
  console.error('watcher failed:', err.message);
  process.exit(1);
});
