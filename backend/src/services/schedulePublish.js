/*
 * Daily scheduled-publish job. Finds posts whose scheduledAt has passed,
 * claims them, and publishes through the existing immediate Graph flow.
 *
 * Now that each post is its own PlannedPost document, claiming is a single
 * atomic findOneAndUpdate on the document — no positional `days.${index}` array
 * paths, and no scanning sibling days inside a week.
 */
const crypto = require('crypto');
const PlannedPost = require('../models/PlannedPost');
const {
  publishPostToInstagram,
  resolveConnection,
  refreshIgTokenIfNeeded,
  publishingQuotaRemaining,
} = require('./metaPublish');

const STALE_MS = 30 * 60 * 1000;

function cronSecret() {
  return String(process.env.SCHEDULE_CRON_SECRET || '').trim();
}

function cronAuthorized(req) {
  const secret = cronSecret();
  if (!secret) return false;
  const header = String(req.headers.authorization || '');
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const fromHeader = String(req.headers['x-cron-secret'] || bearer || '').trim();
  if (!fromHeader || fromHeader.length !== secret.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(fromHeader), Buffer.from(secret));
  } catch (_) {
    return false;
  }
}

// Posts due to go out: unpublished, scheduled in the past, with rendered images,
// and either waiting or a stale claim we can retake.
function dueQuery(now) {
  const stale = new Date(now.getTime() - STALE_MS);
  return {
    published: { $ne: true },
    scheduledAt: { $ne: null, $lte: now },
    'publishImageKeys.0': { $exists: true },
    $or: [
      { scheduleStatus: { $in: ['', 'ready', 'failed'] } },
      { scheduleStatus: { $exists: false } },
      { scheduleStatus: 'publishing', scheduleClaimedAt: { $lte: stale } },
      { scheduleStatus: 'publishing', scheduleClaimedAt: { $exists: false } },
    ],
  };
}

// Atomically claim one post for publishing. Returns the claimed document, or
// null if another worker got there first.
async function claimPost(postId, now) {
  const stale = new Date(now.getTime() - STALE_MS);
  return PlannedPost.findOneAndUpdate(
    {
      _id: postId,
      published: { $ne: true },
      scheduledAt: { $lte: now },
      'publishImageKeys.0': { $exists: true },
      $or: [
        { scheduleStatus: { $in: ['', 'ready', 'failed'] } },
        { scheduleStatus: { $exists: false } },
        { scheduleStatus: 'publishing', scheduleClaimedAt: { $lte: stale } },
        { scheduleStatus: 'publishing', scheduleClaimedAt: { $exists: false } },
      ],
    },
    {
      $set: { scheduleStatus: 'publishing', scheduleClaimedAt: now, scheduleError: '' },
    },
    { new: true },
  );
}

async function markPostFailed(postId, message) {
  await PlannedPost.updateOne(
    { _id: postId },
    {
      $set: {
        scheduleStatus: 'failed',
        scheduleError: String(message || 'Instagram publish failed').slice(0, 500),
      },
    },
  );
}

async function releaseClaim(postId) {
  await PlannedPost.updateOne(
    { _id: postId, scheduleStatus: 'publishing' },
    { $set: { scheduleStatus: 'ready', scheduleError: '', scheduleClaimedAt: null } },
  );
}

async function runPublishDue() {
  const now = new Date();
  const due = await PlannedPost.find(dueQuery(now)).select('_id user instagramUsername scheduleStatus');
  const summary = { scanned: 0, published: 0, failed: 0, skipped: 0, live: 0 };

  for (const found of due) {
    summary.scanned += 1;

    let conn;
    try {
      const resolved = await resolveConnection(found.user, found);
      conn = resolved.conn;
      if (!conn?.accessToken || !conn.igUserId) {
        await markPostFailed(found._id, resolved.handle
          ? `Connect Instagram @${resolved.handle} to publish this plan.`
          : 'Connect Instagram to publish this plan.');
        summary.failed += 1;
        continue;
      }
      await refreshIgTokenIfNeeded(conn);
      const remaining = await publishingQuotaRemaining(conn);
      if (remaining <= 0) {
        console.warn(`[schedule] skip post ${found._id}: Instagram 24h publish quota reached`);
        if (String(found.scheduleStatus) === 'publishing') {
          await releaseClaim(found._id);
        }
        summary.skipped += 1;
        continue;
      }
    } catch (err) {
      await markPostFailed(found._id, err.message);
      summary.failed += 1;
      continue;
    }

    const claimed = await claimPost(found._id, now);
    if (!claimed) {
      summary.skipped += 1;
      continue;
    }

    try {
      const result = await publishPostToInstagram({
        userId: claimed.user,
        post: claimed,
        imageKeys: claimed.publishImageKeys,
      });
      if (result.published) summary.published += 1;
      if (result.live) summary.live += 1;
      console.log(`[schedule] published post ${claimed._id}${result.live ? ' live' : ' locally'}`);
    } catch (err) {
      console.error(`[schedule] post ${claimed._id} failed:`, err.message);
      await markPostFailed(claimed._id, err.message);
      summary.failed += 1;
    }
  }

  return summary;
}

async function publishDueHandler(req, res) {
  if (!cronSecret()) {
    return res.status(503).json({ message: 'Scheduled publishing is not configured (SCHEDULE_CRON_SECRET).' });
  }
  if (!cronAuthorized(req)) {
    return res.status(401).json({ message: 'Not authorized' });
  }
  const summary = await runPublishDue();
  res.json({ ok: true, ...summary });
}

module.exports = {
  runPublishDue,
  publishDueHandler,
  cronAuthorized,
  cronSecret,
  releaseClaim,
};
