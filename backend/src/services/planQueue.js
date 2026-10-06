/*
 * Queued post generation (BullMQ on Redis).
 *
 *   POST /posts/generate ──► PlanRun (Mongo) + "plan-run" job
 *   plan-run   job: inputs → Strategist → dated briefs        (planRunSteps.runPlanStep)
 *   plan-post  job ×N: one post each, in parallel               (planRunSteps.runPostStep)
 *   plan-finalize job: waits for every post job, then assembles
 *                      and saves the plan exactly as the sync path does
 *
 * Jobs carry only { runId, index }; state lives on PlanRun / PlanRunPost.
 * Off unless PLAN_QUEUE=1 and REDIS_URL are set — the synchronous path in
 * postController.generateAndSavePosts stays the default and the fallback.
 */
const PlanRun = require('../models/PlanRun');
const { runTag, queueDebug } = require('./planRunLog');

const QUEUE = {
  plan: 'plan-run',
  post: 'plan-post',
  finalize: 'plan-finalize',
};

// A run still in one of these states blocks a second run for the same account.
const ACTIVE_STATUSES = ['queued', 'planning', 'writing', 'finalizing'];
// …unless it is older than this (a run whose jobs were lost never blocks forever).
const ACTIVE_WINDOW_MS = 20 * 60 * 1000;

const KEEP_DONE = { age: 24 * 60 * 60, count: 2000 };
const KEEP_FAILED = { age: 7 * 24 * 60 * 60 };

function envFlagOn(name) {
  const v = String(process.env[name] || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

function envPositiveInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function isQueueConfigured() {
  return envFlagOn('PLAN_QUEUE') && Boolean(String(process.env.REDIS_URL || '').trim());
}

// PLAN_QUEUE_USERS (comma-separated user ids) limits the queued path to those
// accounts during rollout; empty = everyone.
function planQueueEnabledFor(userId) {
  if (!isQueueConfigured()) return false;
  const allow = String(process.env.PLAN_QUEUE_USERS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return !allow.length || allow.includes(String(userId));
}

let connection = null;
function redisConnection() {
  if (!connection) {
    const IORedis = require('ioredis');
    // BullMQ workers block on Redis; maxRetriesPerRequest must be null.
    connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
    let lastLogged = 0;
    connection.on('error', (err) => {
      // ioredis retries forever; log at most once a minute.
      if (Date.now() - lastLogged < 60_000) return;
      lastLogged = Date.now();
      console.error('[planQueue] redis error:', err.message);
    });
  }
  return connection;
}

let planQueueInstance = null;
let flowProducerInstance = null;
let finalizeQueueInstance = null;

function planQueue() {
  if (!planQueueInstance) {
    const { Queue } = require('bullmq');
    planQueueInstance = new Queue(QUEUE.plan, { connection: redisConnection() });
  }
  return planQueueInstance;
}

function finalizeQueue() {
  if (!finalizeQueueInstance) {
    const { Queue } = require('bullmq');
    finalizeQueueInstance = new Queue(QUEUE.finalize, { connection: redisConnection() });
  }
  return finalizeQueueInstance;
}

function flowProducer() {
  if (!flowProducerInstance) {
    const { FlowProducer } = require('bullmq');
    flowProducerInstance = new FlowProducer({ connection: redisConnection() });
  }
  return flowProducerInstance;
}

function finalizeJobOptions(runId) {
  return {
    jobId: `finalize-${runId}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: KEEP_DONE,
    removeOnFail: KEEP_FAILED,
  };
}

async function activeRunFor(userId, username) {
  return PlanRun.findOne({
    user: userId,
    instagramUsername: username,
    status: { $in: ACTIVE_STATUSES },
    createdAt: { $gte: new Date(Date.now() - ACTIVE_WINDOW_MS) },
  }).sort({ createdAt: -1 }).select('-state');
}

// Create a PlanRun and queue its first job. Returns the account's run already
// in progress instead of starting a second one. Throws when Redis is
// unreachable, leaving no run behind, so the caller can fall back to sync.
async function enqueuePlanRun({ userId, username, trigger = 'generate', planSource = {} }) {
  const active = await activeRunFor(userId, username);
  if (active) {
    console.log(`[planQueue] ${runTag(active._id, username)} already ${active.status} — reusing it for this ${trigger}`);
    return { run: active, reused: true };
  }

  const run = await PlanRun.create({
    user: userId,
    instagramUsername: username,
    trigger,
    planSource: {
      sessionId: planSource.sessionId || '',
      captureIds: planSource.captureIds || [],
      allowedWeekdays: planSource.allowedWeekdays || null,
    },
  });
  try {
    // The shared connection waits indefinitely for Redis to come back, so bound
    // the wait: a request must fall back to sync, not hang. A job that still
    // lands later finds no PlanRun and does nothing.
    const timeoutMs = envPositiveInt('PLAN_QUEUE_ENQUEUE_TIMEOUT_MS', 5000);
    let timer;
    await Promise.race([
      planQueue().add('plan', { runId: String(run._id), handle: username }, {
        jobId: `plan-${run._id}`,
        attempts: 2,
        backoff: { type: 'exponential', delay: 15_000 },
        removeOnComplete: KEEP_DONE,
        removeOnFail: KEEP_FAILED,
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`queue unavailable (no answer from Redis in ${timeoutMs} ms)`)), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
  } catch (err) {
    await PlanRun.deleteOne({ _id: run._id }).catch(() => {});
    throw err;
  }
  console.log(`[planQueue] ${runTag(run._id, username)} queued · trigger=${trigger}` +
    (planSource.sessionId ? ` session=${planSource.sessionId}` : '') +
    ` · runId=${run._id}`);
  return { run, reused: false };
}

// One job per post, all children of the finalize job: BullMQ starts finalize
// only after every post job has finished. Job ids are deterministic, so adding
// the flow again after a retried plan job is a no-op.
async function addPostJobs(runId, count, handle = '') {
  const id = String(runId);
  await flowProducer().add({
    name: 'finalize',
    queueName: QUEUE.finalize,
    data: { runId: id, handle },
    opts: finalizeJobOptions(id),
    children: Array.from({ length: count }, (_, index) => ({
      name: 'post',
      queueName: QUEUE.post,
      data: { runId: id, index, of: count, handle },
      opts: {
        jobId: `post-${id}-${index}`,
        attempts: envPositiveInt('PLAN_POST_ATTEMPTS', 2),
        backoff: { type: 'exponential', delay: 15_000 },
        // A post that still fails is skipped, never blocks the rest of the plan.
        ignoreDependencyOnFailure: true,
        removeOnComplete: KEEP_DONE,
        removeOnFail: KEEP_FAILED,
      },
    })),
  });
  queueDebug(`${runTag(id, handle)} added ${count} post job(s) + finalize`);
}

// No posts to write (Strategist planned none): finalize straight away.
async function addFinalizeJob(runId, handle = '') {
  const id = String(runId);
  await finalizeQueue().add('finalize', { runId: id, handle }, finalizeJobOptions(id));
  queueDebug(`${runTag(id, handle)} finalize job added (no posts to write)`);
}

async function closePlanQueue() {
  await Promise.all([
    planQueueInstance?.close(),
    finalizeQueueInstance?.close(),
    flowProducerInstance?.close(),
  ].filter(Boolean));
  if (connection) await connection.quit().catch(() => {});
  planQueueInstance = null;
  finalizeQueueInstance = null;
  flowProducerInstance = null;
  connection = null;
}

module.exports = {
  QUEUE,
  ACTIVE_STATUSES,
  envPositiveInt,
  isQueueConfigured,
  planQueueEnabledFor,
  redisConnection,
  activeRunFor,
  enqueuePlanRun,
  addPostJobs,
  addFinalizeJob,
  closePlanQueue,
};
