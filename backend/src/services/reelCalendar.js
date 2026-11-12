/*
 * A finished capture reel goes onto the calendar the way a generated carousel
 * does: as one PlannedPost (format Reel) on the next empty publishing day of
 * the handle (InstagramProfile.publishing — the same rule and the same
 * buildEmptySlots fill as POST /posts/generate), and the capture it came from
 * is marked used and linked to that post (Captures shows the day).
 */
const PlannedPost = require('../models/PlannedPost');
const CaptureReel = require('../models/CaptureReel');
const InstagramProfile = require('../models/InstagramProfile');
const { buildEmptySlots, isoDate, parseIsoDate } = require('./weeklyPlan');
const { CURRENT_SORT } = require('../utils/currentProfile');

const DUPLICATE_KEY = 11000;

function dateLabelOf(iso) {
  const d = parseIsoDate(iso);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Put a done reel on the calendar (idempotent: a reel already placed keeps its
 * post). Returns the PlannedPost, or null when there is no handle / no slot.
 */
async function placeReelOnCalendar(reelId) {
  const reel = await CaptureReel.findById(reelId);
  if (!reel || reel.status !== 'done' || !reel.videoKey) return null;
  if (reel.postId) {
    const existing = await PlannedPost.findById(reel.postId);
    if (existing) return existing;
  }
  const { allowedWeekdaysFor, markCapturesUsed } = require('../controllers/postController');
  const profile = reel.instagramUsername
    ? await InstagramProfile.findOne({ user: reel.user, username: reel.instagramUsername })
    : await InstagramProfile.findOne({ user: reel.user }).sort(CURRENT_SORT);
  const handle = profile?.username || reel.instagramUsername;
  if (!handle) {
    console.warn(`[reelCalendar] reel ${reel._id}: no Instagram handle — not placed`);
    return null;
  }

  const plan = reel.plan || {};
  const doc = (slot) => ({
    user: reel.user,
    instagramUsername: handle,
    date: slot.date,
    day: slot.day || '',
    dateLabel: dateLabelOf(slot.date),
    format: 'Reel',
    contentType: 'Reel',
    pillar: slot.pillar || 'discovery',
    title: plan.hook?.text || plan.concept || 'Reel',
    direction: plan.concept || '',
    published: false,
    content: {
      slides: [],
      onScreenText: [plan.hook?.text, ...(plan.scenes || []).map((s) => s.kicker)].filter(Boolean),
      caption: reel.caption || plan.caption || '',
      hashtags: reel.hashtags || [],
      cta: plan.cta?.line || '',
      reel: {
        reelId: String(reel._id),
        videoKey: reel.videoKey,
        posterKey: reel.posterKey || '',
        durationSec: reel.durationSec || 0,
        hook: plan.hook?.text || '',
        audioMode: plan.audioMode || '',
      },
    },
    agentTrace: { reel: { reelId: String(reel._id), concept: plan.concept || '', scenes: plan.scenes || [] } },
    model: reel.model || '',
    generatedAt: new Date(),
    usage: { estimatedCostUsd: reel.costUsd || 0, model: reel.model || '' },
  });

  // empty dates race with a plan run filling the same calendar: the unique
  // (user, handle, date) index turns a lost race into a retry on the next slot
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const today = startOfToday();
    // eslint-disable-next-line no-await-in-loop
    const taken = await PlannedPost.find({ user: reel.user, instagramUsername: handle, date: { $gte: isoDate(today) } })
      .select('date').lean();
    const { emptyDates } = buildEmptySlots({
      fromDate: today,
      occupiedDates: taken.map((p) => p.date),
      allowedWeekdays: allowedWeekdaysFor(profile),
    });
    const slot = emptyDates[0];
    if (!slot) {
      console.warn(`[reelCalendar] reel ${reel._id}: no empty day in the fill horizon for @${handle}`);
      return null;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const post = await PlannedPost.create(doc(slot));
      // eslint-disable-next-line no-await-in-loop
      await CaptureReel.updateOne({ _id: reel._id }, { $set: { postId: post._id } });
      // eslint-disable-next-line no-await-in-loop
      await markCapturesUsed(reel.user, (reel.captureIds || []).map(String), [post]);
      console.log(`[reelCalendar] reel ${reel._id} → @${handle} ${slot.date} (post ${post._id})`);
      return post;
    } catch (err) {
      if (err?.code !== DUPLICATE_KEY) throw err;
    }
  }
  return null;
}

module.exports = { placeReelOnCalendar };
