/*
 * Daily scheduled-publish job. Finds days whose scheduledAt has passed,
 * claims them, and publishes through the existing immediate Graph flow.
 */
const crypto = require('crypto');
const WeeklyRoute = require('../models/WeeklyRoute');
const {
  publishDayToInstagram,
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

function dueQuery(now) {
  return {
    days: {
      $elemMatch: {
        published: { $ne: true },
        scheduledAt: { $ne: null, $lte: now },
        'publishImageKeys.0': { $exists: true },
        scheduleStatus: { $in: ['', 'ready', 'failed', 'publishing'] },
      },
    },
  };
}

function isDueDay(day, now) {
  if (!day || day.published) return false;
  if (!day.scheduledAt || new Date(day.scheduledAt).getTime() > now.getTime()) return false;
  const keys = Array.isArray(day.publishImageKeys) ? day.publishImageKeys.filter(Boolean) : [];
  if (!keys.length) return false;
  const status = String(day.scheduleStatus || '');
  if (status === 'publishing') {
    const claimed = day.scheduleClaimedAt ? new Date(day.scheduleClaimedAt).getTime() : 0;
    return !claimed || now.getTime() - claimed >= STALE_MS;
  }
  return status === '' || status === 'ready' || status === 'failed';
}

async function claimDay(routeId, index, now) {
  const stale = new Date(now.getTime() - STALE_MS);
  return WeeklyRoute.findOneAndUpdate(
    {
      _id: routeId,
      [`days.${index}.published`]: { $ne: true },
      [`days.${index}.scheduledAt`]: { $lte: now },
      [`days.${index}.publishImageKeys.0`]: { $exists: true },
      $or: [
        { [`days.${index}.scheduleStatus`]: { $in: ['', 'ready', 'failed'] } },
        { [`days.${index}.scheduleStatus`]: { $exists: false } },
        { [`days.${index}.scheduleStatus`]: 'publishing', [`days.${index}.scheduleClaimedAt`]: { $lte: stale } },
        { [`days.${index}.scheduleStatus`]: 'publishing', [`days.${index}.scheduleClaimedAt`]: { $exists: false } },
      ],
    },
    {
      $set: {
        [`days.${index}.scheduleStatus`]: 'publishing',
        [`days.${index}.scheduleClaimedAt`]: now,
        [`days.${index}.scheduleError`]: '',
      },
    },
    { new: true },
  );
}

async function markDayFailed(routeId, index, message) {
  await WeeklyRoute.updateOne(
    { _id: routeId },
    {
      $set: {
        [`days.${index}.scheduleStatus`]: 'failed',
        [`days.${index}.scheduleError`]: String(message || 'Instagram publish failed').slice(0, 500),
      },
    },
  );
}

async function releaseClaim(routeId, index) {
  await WeeklyRoute.updateOne(
    { _id: routeId, [`days.${index}.scheduleStatus`]: 'publishing' },
    {
      $set: {
        [`days.${index}.scheduleStatus`]: 'ready',
        [`days.${index}.scheduleError`]: '',
        [`days.${index}.scheduleClaimedAt`]: null,
      },
    },
  );
}

async function runPublishDue() {
  const now = new Date();
  const routes = await WeeklyRoute.find(dueQuery(now));
  const summary = { scanned: 0, published: 0, failed: 0, skipped: 0, live: 0 };

  for (const found of routes) {
    for (let i = 0; i < (found.days || []).length; i += 1) {
      if (!isDueDay(found.days[i], now)) continue;
      summary.scanned += 1;

      let conn;
      try {
        const resolved = await resolveConnection(found.user, found);
        conn = resolved.conn;
        if (!conn?.accessToken || !conn.igUserId) {
          await markDayFailed(found._id, i, resolved.handle
            ? `Connect Instagram @${resolved.handle} to publish this plan.`
            : 'Connect Instagram to publish this plan.');
          summary.failed += 1;
          continue;
        }
        await refreshIgTokenIfNeeded(conn);
        const remaining = await publishingQuotaRemaining(conn);
        if (remaining <= 0) {
          console.warn(`[schedule] skip day ${i} on ${found._id}: Instagram 24h publish quota reached`);
          if (String(found.days[i].scheduleStatus) === 'publishing') {
            await releaseClaim(found._id, i);
          }
          summary.skipped += 1;
          continue;
        }
      } catch (err) {
        await markDayFailed(found._id, i, err.message);
        summary.failed += 1;
        continue;
      }

      const claimed = await claimDay(found._id, i, now);
      if (!claimed) {
        summary.skipped += 1;
        continue;
      }

      try {
        const result = await publishDayToInstagram({
          userId: claimed.user,
          route: claimed,
          dayIndex: i,
          imageKeys: claimed.days[i].publishImageKeys,
        });
        if (result.published) summary.published += 1;
        if (result.live) summary.live += 1;
        console.log(`[schedule] published ${claimed._id} day ${i}${result.live ? ' live' : ' locally'}`);
      } catch (err) {
        console.error(`[schedule] ${claimed._id} day ${i} failed:`, err.message);
        await markDayFailed(claimed._id, i, err.message);
        summary.failed += 1;
      }
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
