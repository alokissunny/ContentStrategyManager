/*
 * Rendering a capture reel in the studio's browser (@remotion/web-renderer).
 *
 * A capable desktop browser renders the same composition ~10x faster than the
 * reel worker's CPU (2026-11-26: 972 frames in 15 s vs ~25 min on Render
 * standard). The server keeps every AI step and the finishing (poster,
 * calendar); only the MP4 render moves, and only while someone is watching:
 *
 *   studio polls GET /capture-reels/:id?viewer=browser ──► browserRender.viewerAt
 *   worker reaches the render ──► viewer fresh? state 'offered', waits ≤ OFFER_WAIT_MS
 *   studio POST …/browser-render/claim ──► 'claimed' (+ upload URL); the worker
 *       hands off: its try is given back, a delayed check job is queued
 *   studio POST …/progress every ~2 s (heartbeat + renderPct)
 *   studio PUTs the MP4 to S3, POST …/done ──► 'uploaded', reel queued now ──►
 *       worker finalises from the upload (no render)
 *   studio POST …/fail, or no heartbeat for STALE_MS ──► 'abandoned' ──► the
 *       worker renders it as before
 *
 * BROWSER_REEL_RENDER=off (on the worker) turns the offer off.
 */
const CaptureReel = require('../models/CaptureReel');

const VIEWER_FRESH_MS = 15 * 1000; // a studio poll this recent = someone is watching
const OFFER_WAIT_MS = Number(process.env.BROWSER_RENDER_OFFER_WAIT_MS) || 12 * 1000;
const STALE_MS = Number(process.env.BROWSER_RENDER_STALE_MS) || 25 * 1000;
const CHECK_MS = 20 * 1000; // how often the worker looks at a reel the browser is rendering

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enabled = () => !['off', '0', 'false'].includes(String(process.env.BROWSER_REEL_RENDER || '').toLowerCase());

function uploadKeyOf(reel) {
  return `projects/${reel.user}/reel-${reel._id}-browser.mp4`;
}

async function checkLater(reelId, delayMs = CHECK_MS) {
  const { enqueueCaptureReel } = require('./reelQueue');
  await enqueueCaptureReel(reelId, { fresh: true, delayMs });
}

/**
 * At the start of a run: a reel the browser is rendering is left alone while
 * its heartbeat is fresh (checked again later, no try used up); a silent one is
 * marked abandoned so this run renders it. Returns true = do nothing now.
 */
async function deferToBrowser(reel) {
  const br = reel.browserRender || {};
  if (br.state !== 'claimed') return false;
  const last = new Date(br.heartbeatAt || br.claimedAt || 0).getTime();
  if (Date.now() - last < STALE_MS) {
    await checkLater(reel._id);
    return true;
  }
  await CaptureReel.updateOne({ _id: reel._id, 'browserRender.state': 'claimed' }, {
    $set: { 'browserRender.state': 'abandoned', 'browserRender.failReason': 'the browser stopped reporting' },
  });
  reel.browserRender = { ...br, state: 'abandoned' };
  return false;
}

/**
 * At the render step: offer it to a watching browser. true = the browser took
 * it (the caller stops; a check job is queued and this try is given back).
 */
// What the browser renderer reproduces faithfully today (2026-11-26 test:
// photo + video scenes, captions, hook, CTA, voice, music, sound effects).
// SVG-drawn parts (explainer drawings, motion graphics, annotation lines) and
// reference-reel looks render differently there (an SVG becomes an image: no
// web fonts, its own sizing) — those reels stay on the server for now.
function browserCanMatch(timeline) {
  if (!timeline || !Array.isArray(timeline.scenes)) return false;
  if (timeline.motion || timeline.look || timeline.overlay) return false;
  return !timeline.scenes.some((s) => s.explainer || (s.annotations && s.annotations.length) || s.layout === 'split');
}

async function offerToBrowser(reelId, timeline) {
  if (!enabled()) return false;
  if (!browserCanMatch(timeline)) return false;
  if (!require('./reelQueue').isReelQueueConfigured()) return false; // hand-off needs the queue
  const cur = await CaptureReel.findById(reelId).select('browserRender status').lean();
  const br = cur?.browserRender || {};
  if (!cur || cur.status !== 'working') return false;
  if (['abandoned', 'uploaded'].includes(br.state)) return false; // tried already: the server renders
  if (!br.viewerAt || Date.now() - new Date(br.viewerAt).getTime() > VIEWER_FRESH_MS) return false;
  await CaptureReel.updateOne({ _id: reelId }, {
    $set: { 'browserRender.state': 'offered', 'browserRender.offeredAt': new Date(), renderPct: 0 },
  });
  const until = Date.now() + OFFER_WAIT_MS;
  while (Date.now() < until) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(1000);
    // eslint-disable-next-line no-await-in-loop
    const now = await CaptureReel.findById(reelId).select('browserRender').lean();
    if (now?.browserRender?.state === 'claimed') return handOff(reelId);
  }
  // nobody claimed it — unless a claim lands right now (the claim is conditional too)
  const declined = await CaptureReel.updateOne({ _id: reelId, 'browserRender.state': 'offered' }, {
    $set: { 'browserRender.state': 'declined' },
  });
  if (declined.modifiedCount === 0) {
    const now = await CaptureReel.findById(reelId).select('browserRender').lean();
    if (now?.browserRender?.state === 'claimed') return handOff(reelId);
  }
  return false;
}

async function handOff(reelId) {
  // this run made the cut but rendered nothing: it doesn't count as a try
  await CaptureReel.updateOne({ _id: reelId }, { $inc: { attempts: -1 } });
  await checkLater(reelId);
  return true;
}

module.exports = { deferToBrowser, offerToBrowser, uploadKeyOf, browserCanMatch, STALE_MS, enabled };
