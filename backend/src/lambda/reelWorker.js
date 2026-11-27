/*
 * AWS Lambda reel worker — one invocation runs one capture reel (backend/aws/REEL_WORKER_LAMBDA.md).
 *
 *   SQS "capture-reels" (batch size 1) ──► handler ──► claim the reel (lease) ──► runCaptureReel(reelId)
 *
 * The pipeline is the same code the Render worker runs; the render itself happens on Remotion Lambda
 * (remotion/render-lambda.mjs), so there is no Chrome here (REEL_LOCAL_FALLBACK=0).
 *
 * Outcomes:
 *   - done, or a failure runCaptureReel already wrote to the reel → the message is deleted
 *   - a temporary failure (retryable) → a fresh message 20 s later, this one deleted
 *   - another run holds the reel (duplicate delivery) / it is finished → deleted, nothing run
 *   - the function dies or times out → the lease runs out; SQS redelivers the message (and the
 *     sweeper re-sends a lost one); the next run resumes from the saved cut
 *
 * Handlers: `reelWorker.handler` (the queue) and `reelWorker.dlq` (messages that failed twice).
 */
const path = require('path');

// Lambda's code folder is read-only: caches go to /tmp; ffmpeg from this package
process.env.REMOTION_CACHE_DIR ||= '/tmp/remotion-cache';
process.env.REEL_LOCAL_FALLBACK ||= '0';
process.env.MONGO_MAX_POOL_SIZE ||= '3';
try { process.env.FFMPEG_PATH ||= require('ffmpeg-static'); } catch { /* set in the environment */ }
if (!process.env.REMOTION_AWS_REGION && process.env.AWS_REGION) process.env.REMOTION_AWS_REGION = process.env.AWS_REGION;

let ready = null;
function warm() {
  if (!ready) {
    ready = (async () => {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState !== 1) await require('../config/db')();
      await require('../services/runtimeSettings').loadRuntimeSettings();
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

const reelIdOf = (record) => {
  try { return String(JSON.parse(record.body || '{}').reelId || ''); } catch { return ''; }
};

exports.handler = async (event, context) => {
  // the event loop keeps the Mongo pool and timers alive between invocations
  context.callbackWaitsForEmptyEventLoop = false;
  await warm();
  const agent = require('../services/captureReelAgent');
  const runner = require('../services/reelLambdaRunner');
  for (const record of event.Records || []) {
    const reelId = reelIdOf(record);
    if (!/^[0-9a-f]{24}$/i.test(reelId)) { console.warn('[reelLambda] bad message', record.messageId); continue; }
    const lease = await runner.claimReel(reelId, context.awsRequestId);
    if (!lease) { console.log(`[reelLambda] reel ${reelId} is taken or finished — skipped`); continue; }
    // finish (or hand back) before the function is stopped: 30 s for saving the state
    agent.setRunDeadline(Date.now() + context.getRemainingTimeInMillis() - 30 * 1000);
    const t0 = Date.now();
    try {
      console.log(`[reelLambda] start reel ${reelId} · receive #${record.attributes?.ApproximateReceiveCount || 1}`);
      await agent.runCaptureReel(reelId);
      console.log(`[reelLambda] done reel ${reelId} in ${Math.round((Date.now() - t0) / 1000)}s · rss ${Math.round(process.memoryUsage().rss / 1048576)} MB`);
    } catch (err) {
      if (!err.retryable) throw err; // unexpected: let SQS redeliver (the lease is released below)
      console.warn(`[reelLambda] reel ${reelId} will be tried again: ${err.message}`);
      await runner.sendReel(reelId, { delayMs: 20 * 1000 });
    } finally {
      agent.setRunDeadline(0);
      await lease.release();
      // a reel's temp files (clips, copies, the MP4) must not fill /tmp for the next one
      cleanTmp();
    }
  }
  return { batchItemFailures: [] };
};

// Messages SQS gave up on (received twice, never finished): close the reel with a clear message
exports.dlq = async (event) => {
  await warm();
  const CaptureReel = require('../models/CaptureReel');
  for (const record of event.Records || []) {
    const reelId = reelIdOf(record);
    if (!/^[0-9a-f]{24}$/i.test(reelId)) continue;
    const r = await CaptureReel.updateOne(
      { _id: reelId, status: { $in: ['queued', 'working'] }, $or: [{ leaseUntil: null }, { leaseUntil: { $lt: new Date() } }] },
      { $set: { status: 'error', error: 'This reel could not be made after several tries. Try again.', errorDetail: 'Lambda reel worker: message went to the dead-letter queue', finishedAt: new Date(), leaseUntil: null } },
    );
    console.warn(`[reelLambda] DLQ reel ${reelId} — ${r.modifiedCount ? 'marked failed' : 'already finished or running'}`);
  }
  return { batchItemFailures: [] };
};

function cleanTmp() {
  const fs = require('fs');
  const os = require('os');
  const dir = os.tmpdir();
  try {
    for (const f of fs.readdirSync(dir)) {
      if (/^(capreel|reelproxy|bauhly-video)/.test(f)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
    }
  } catch { /* best effort */ }
}
