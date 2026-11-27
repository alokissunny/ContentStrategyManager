/*
 * Capture reels on AWS Lambda — one Lambda per reel (backend/aws/REEL_WORKER_LAMBDA.md).
 *
 *   REEL_RUNNER=lambda: POST /capture-reels ──► CaptureReel (queued) ──► SQS message { reelId }
 *   SQS ──► Lambda reel-worker (src/lambda/reelWorker.js) ──► captureReelAgent.runCaptureReel(reelId)
 *
 * The CaptureReel document stays the record of every reel (as with BullMQ). Liveness is a lease on
 * the reel (leaseUntil, renewed every 30 s by the run that holds it) instead of a BullMQ lock.
 *
 * Env (API + Lambda): REEL_RUNNER=lambda, REEL_SQS_URL, REEL_SQS_REGION (default: from the URL).
 * Credentials: REEL_SQS_ACCESS_KEY_ID / REEL_SQS_SECRET_ACCESS_KEY (the API on Render — an IAM user
 * allowed only to send to this queue), else the default chain (the Lambda's role).
 */
const LEASE_MS = 90 * 1000;
// a queued reel whose message is still in SQS (or delayed): left alone this long by the sweeper
const QUEUED_GRACE_MS = 20 * 60 * 1000;

const isLambdaRunner = () => String(process.env.REEL_RUNNER || '').trim().toLowerCase() === 'lambda'
  && Boolean(String(process.env.REEL_SQS_URL || '').trim());

const queueUrl = () => String(process.env.REEL_SQS_URL || '').trim();
const regionOf = (url) => process.env.REEL_SQS_REGION || /sqs\.([a-z0-9-]+)\.amazonaws\.com/.exec(url)?.[1] || 'eu-north-1';

let sqs = null;
function client() {
  if (!sqs) {
    const { SQSClient } = require('@aws-sdk/client-sqs');
    const id = process.env.REEL_SQS_ACCESS_KEY_ID;
    const secret = process.env.REEL_SQS_SECRET_ACCESS_KEY;
    sqs = new SQSClient({
      region: regionOf(queueUrl()),
      ...(id && secret ? { credentials: { accessKeyId: id, secretAccessKey: secret } } : {}),
    });
  }
  return sqs;
}

/** Send a reel to the Lambda workers. delayMs: SQS allows up to 15 min. */
async function sendReel(reelId, { delayMs = 0 } = {}) {
  const { SendMessageCommand } = require('@aws-sdk/client-sqs');
  const out = await client().send(new SendMessageCommand({
    QueueUrl: queueUrl(),
    MessageBody: JSON.stringify({ reelId: String(reelId), at: Date.now() }),
    ...(delayMs > 0 ? { DelaySeconds: Math.min(900, Math.ceil(delayMs / 1000)) } : {}),
  }));
  return out.MessageId || '';
}

/** { waiting, active } like BullMQ's counts, or null when SQS can't be read. */
async function queueDepth() {
  try {
    const { GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');
    const { Attributes: a = {} } = await client().send(new GetQueueAttributesCommand({
      QueueUrl: queueUrl(),
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed'],
    }));
    return {
      waiting: Number(a.ApproximateNumberOfMessages) || 0,
      active: Number(a.ApproximateNumberOfMessagesNotVisible) || 0,
      delayed: Number(a.ApproximateNumberOfMessagesDelayed) || 0,
    };
  } catch {
    return null;
  }
}

/** Is something running or about to run this reel? (the sweeper's question) */
function reelAlive(reel) {
  const now = Date.now();
  if (reel.leaseUntil && new Date(reel.leaseUntil).getTime() > now) return true;
  // queued and touched recently: its SQS message (maybe delayed, maybe waiting for a free Lambda)
  // is still on its way
  if (reel.status === 'queued' && now - new Date(reel.updatedAt).getTime() < QUEUED_GRACE_MS) return true;
  return false;
}

/**
 * Take the reel for this run, or null when another run holds it (a duplicate SQS delivery) or it
 * is finished. Keeps the lease alive until release().
 */
async function claimReel(reelId, leaseId) {
  const CaptureReel = require('../models/CaptureReel');
  const now = new Date();
  const got = await CaptureReel.findOneAndUpdate(
    {
      _id: reelId,
      status: { $in: ['queued', 'working'] },
      $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }, { leaseId }],
    },
    { $set: { leaseUntil: new Date(now.getTime() + LEASE_MS), leaseId } },
    { new: true },
  ).select('_id').lean();
  if (!got) return null;
  const timer = setInterval(() => {
    CaptureReel.updateOne({ _id: reelId, leaseId }, { $set: { leaseUntil: new Date(Date.now() + LEASE_MS) } }).catch(() => {});
  }, 30 * 1000);
  return {
    release: async () => {
      clearInterval(timer);
      await CaptureReel.updateOne({ _id: reelId, leaseId }, { $set: { leaseUntil: null } }).catch(() => {});
    },
  };
}

module.exports = { isLambdaRunner, sendReel, queueDepth, reelAlive, claimReel, LEASE_MS };
