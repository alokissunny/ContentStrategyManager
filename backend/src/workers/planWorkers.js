const { Worker } = require('bullmq');
const {
  QUEUE,
  envPositiveInt,
  redisConnection,
  addPostJobs,
  addFinalizeJob,
} = require('../services/planQueue');
const { runPlanStep, runPostStep, runFinalizeStep, failRun } = require('../services/planRunSteps');
const { PLAN_FAILED_REASON } = require('../controllers/postController');
const {
  WORKER_ID,
  runTag,
  withLogContext,
  installConsolePrefix,
  queueDebug,
  seconds,
} = require('../services/planRunLog');

// A carousel call can run for minutes; BullMQ renews the lock while the event
// loop is free, and this is how long a lock survives a missed renewal.
const LOCK_MS = 2 * 60 * 1000;

function isFinalAttempt(job) {
  return job.attemptsMade + 1 >= (job.opts.attempts || 1);
}

// "post 2/3 · try 1/2 · w:host:pid" — which job, which attempt, which process.
function jobLabel(kind, job) {
  const { index, of } = job.data || {};
  const which = Number.isInteger(index) ? ` ${index + 1}${of ? `/${of}` : ''}` : '';
  return `${kind}${which} · try ${job.attemptsMade + 1}/${job.opts.attempts || 1} · w:${WORKER_ID}`;
}

function summaryOf(out) {
  if (!out || typeof out !== 'object') return '';
  return Object.entries(out)
    .filter(([, v]) => v !== undefined && typeof v !== 'object')
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
}

// Runs a processor inside the job's log context, with start / done / failed lines.
function instrumented(kind, processor) {
  return async (job) => {
    const context = { run: runTag(job.data?.runId, job.data?.handle), job: jobLabel(kind, job) };
    return withLogContext(context, async () => {
      const started = Date.now();
      const waited = started - (job.timestamp || started);
      console.log(`[planWorkers] start · job=${job.id} · waited ${seconds(waited)} in queue`);
      try {
        const out = await processor(job);
        console.log(`[planWorkers] done in ${seconds(Date.now() - started)}${summaryOf(out) ? ` · ${summaryOf(out)}` : ''}`);
        return out;
      } catch (err) {
        const retrying = !isFinalAttempt(job);
        console.error(
          `[planWorkers] failed after ${seconds(Date.now() - started)}: ${err.message}` +
            (retrying ? ' — will retry' : ' — no attempts left'),
        );
        throw err;
      }
    });
  };
}

// Starts the plan-run, plan-post and plan-finalize workers in this process.
// Returns { close } for graceful shutdown (in-flight jobs finish first).
function startPlanWorkers() {
  installConsolePrefix();
  const connection = redisConnection();

  const plan = new Worker(QUEUE.plan, instrumented('plan', async (job) => {
    const { runId, handle } = job.data;
    const out = await runPlanStep(runId);
    if (out.done) return out;
    if (out.posts > 0) await addPostJobs(runId, out.posts, handle);
    else await addFinalizeJob(runId, handle);
    return out;
  }), { connection, concurrency: envPositiveInt('PLAN_RUN_CONCURRENCY', 2), lockDuration: LOCK_MS });

  // Matches PLAN_DAY_CONCURRENCY (8): the sync path's per-request pool, now
  // shared by every run this worker serves.
  const post = new Worker(QUEUE.post, instrumented('post', async (job) => {
    const { runId, index } = job.data;
    return runPostStep(runId, index, { finalAttempt: isFinalAttempt(job) });
  }), { connection, concurrency: envPositiveInt('PLAN_POST_CONCURRENCY', 8), lockDuration: LOCK_MS });

  const finalize = new Worker(QUEUE.finalize, instrumented('finalize', async (job) => runFinalizeStep(job.data.runId)), {
    connection,
    concurrency: envPositiveInt('PLAN_FINALIZE_CONCURRENCY', 2),
    lockDuration: LOCK_MS,
  });

  // When a plan or finalize job has used its last attempt, close the run so the
  // client stops polling and shows the same error the sync path would.
  const closeOnFinalFailure = async (job) => {
    if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
      console.error(`[planWorkers] ${runTag(job.data?.runId, job.data?.handle)} · ${job.name} job ${job.id} gave up — marking the run failed`);
      await failRun(job.data.runId, PLAN_FAILED_REASON).catch(() => {});
    }
  };
  plan.on('failed', closeOnFinalFailure);
  finalize.on('failed', closeOnFinalFailure);

  for (const w of [plan, post, finalize]) {
    w.on('error', (err) => console.error(`[planWorkers] ${w.name} worker error (w:${WORKER_ID}):`, err.message));
    // Stalled = the process holding the job stopped renewing its lock (crash,
    // deploy, blocked event loop). BullMQ hands the job to another worker.
    w.on('stalled', (jobId) => console.warn(`[planWorkers] ${w.name} job ${jobId} stalled — re-queued for another attempt`));
    w.on('active', (job) => queueDebug(`${runTag(job.data?.runId, job.data?.handle)} · ${w.name} job ${job.id} active on w:${WORKER_ID}`));
    w.on('completed', (job) => queueDebug(`${runTag(job.data?.runId, job.data?.handle)} · ${w.name} job ${job.id} completed`));
  }

  console.log(
    `[planWorkers] started on w:${WORKER_ID} · concurrency run=${plan.opts.concurrency} ` +
      `post=${post.opts.concurrency} finalize=${finalize.opts.concurrency}`,
  );
  return {
    close: () => Promise.all([plan.close(), post.close(), finalize.close()]),
  };
}

module.exports = { startPlanWorkers };
