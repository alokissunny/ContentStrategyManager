/*
 * Reel sweeper — no capture reel is silently dropped.
 *
 * The CaptureReel document is the record of every reel; the BullMQ queue is
 * only how it is delivered to a worker. Every couple of minutes this looks for
 * reels still queued/working that nothing has touched lately, and asks the
 * queue whether a job for each is alive:
 *
 *   job alive (waiting, running, retrying) → leave it, unless it has waited
 *       far too long for a worker that never came → fail it with a clear message
 *   no job (Redis was down when it was made, a process restarted mid-run, the
 *       job was lost)  → put it back on the queue (a fresh job id), or fail it
 *       once it is out of tries
 *   no queue at all (no Redis) → re-run it in this process
 *
 * A re-run resumes from the saved cut when there is one, so it never pays
 * for the director / voice / music twice.
 */
const CaptureReel = require('../models/CaptureReel');

const EVERY_MS = 2 * 60 * 1000;
const QUIET_MS = 3 * 60 * 1000; // untouched this long = worth checking
const MAX_WAIT_MS = Number(process.env.CAPTURE_REEL_MAX_WAIT_MS) || 45 * 60 * 1000;

async function failReel(reel, error, detail) {
  await CaptureReel.updateOne({ _id: reel._id, status: { $in: ['queued', 'working'] } }, {
    $set: { status: 'error', error, errorDetail: detail, finishedAt: new Date() },
  });
}

async function sweepReels() {
  const {
    isReelQueueConfigured, reelJobAlive, enqueueCaptureReel, removeReelJob, queueTag,
  } = require('./reelQueue');
  const { isRunningHere, runInProcess, MAX_ATTEMPTS } = require('./captureReelAgent');
  const now = Date.now();
  const rows = await CaptureReel.find({
    // only reels made against THIS queue: dev and prod share the database
    queueTag: queueTag(),
    status: { $in: ['queued', 'working'] },
    updatedAt: { $lt: new Date(now - QUIET_MS) },
  }).select('_id status stage attempts jobId createdAt startedAt updatedAt').limit(50).lean();
  let requeued = 0;
  for (const reel of rows) {
    if (isRunningHere(reel._id)) continue;
    const outOfTries = (reel.attempts || 0) >= MAX_ATTEMPTS + 1;
    if (!isReelQueueConfigured()) {
      if (outOfTries) await failReel(reel, 'This reel could not be made after several tries. Try again.', 'sweeper: out of tries');
      else { runInProcess(reel._id); requeued += 1; }
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const alive = await reelJobAlive(reel);
    if (alive === null) continue; // Redis unreachable — can't tell, try next sweep
    if (alive) {
      // waiting for a worker that never comes (none running, or none big enough)
      if (!reel.startedAt && now - new Date(reel.createdAt).getTime() > MAX_WAIT_MS) {
        // eslint-disable-next-line no-await-in-loop
        await removeReelJob(reel);
        // eslint-disable-next-line no-await-in-loop
        await failReel(reel, 'No render server picked this reel up. Try again in a little while.',
          `waited ${Math.round((now - new Date(reel.createdAt).getTime()) / 60000)} min with no reel worker (is one running with enough memory?)`);
      }
      continue;
    }
    if (outOfTries) {
      // eslint-disable-next-line no-await-in-loop
      await failReel(reel, 'This reel could not be made after several tries. Try again.', 'sweeper: no job and out of tries');
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const via = await enqueueCaptureReel(reel._id, { fresh: true });
    console.log(`[reelSweeper] reel ${reel._id} had no job (was ${reel.status}/${reel.stage}, try ${reel.attempts || 0}) — re-queued (${via})`);
    requeued += 1;
  }
  return { checked: rows.length, requeued };
}

let timer = null;
function startReelSweeper() {
  if (timer) return;
  const tick = () => sweepReels().catch((err) => console.error('[reelSweeper] sweep failed:', err.message));
  setTimeout(tick, 15000).unref?.(); // soon after boot: pick up what a restart dropped
  timer = setInterval(tick, EVERY_MS);
  timer.unref?.();
  console.log(`[reelSweeper] watching for dropped reels every ${EVERY_MS / 1000}s`);
}

function stopReelSweeper() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { sweepReels, startReelSweeper, stopReelSweeper };
