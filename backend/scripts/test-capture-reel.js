#!/usr/bin/env node
/**
 * Capture Reel agent — end-to-end on a real capture.
 *
 *   node scripts/test-capture-reel.js                 # newest capture with media
 *   node scripts/test-capture-reel.js <captureId>     # a specific capture
 *   node scripts/test-capture-reel.js <captureId> "make it punchy"
 *   STYLE=<reel shortCode> node scripts/test-capture-reel.js <captureId>   # in a reel style
 *
 * Creates a CaptureReel document and runs the whole pipeline inline
 * (director → voice → timeline → Remotion → S3). Costs a few cents.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Project = require('../src/models/Project');
const CaptureReel = require('../src/models/CaptureReel');
const { runCaptureReel } = require('../src/services/captureReelAgent');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const [want, direction = ''] = process.argv.slice(2);
  const projects = await Project.find(want ? { 'captures._id': want } : {}).sort({ updatedAt: -1 }).limit(want ? 1 : 30);
  let pick = null;
  for (const p of projects) {
    for (const c of [...p.captures].reverse()) {
      if (want ? String(c._id) === want : (c.attachments || []).length >= 3) { pick = { p, c }; break; }
    }
    if (pick) break;
  }
  if (!pick) throw new Error('No capture with media found');
  const { p, c } = pick;
  const members = c.sessionId ? p.captures.filter((x) => x.sessionId === c.sessionId) : [c];
  console.log(`capture ${c._id} · ${members.length} member(s) · ${members.reduce((n, m) => n + m.attachments.length, 0)} file(s)`);
  console.log(`note: ${String(c.sessionSummary || c.text).slice(0, 160)}`);
  const style = process.env.STYLE ? await require('../src/models/ReelStyle').findOne({ shortCode: process.env.STYLE }).lean() : null;
  if (process.env.STYLE && !style) throw new Error(`No reel style ${process.env.STYLE}`);
  const reel = await CaptureReel.create({
    user: p.user, instagramUsername: p.instagramUsername, projectId: p._id,
    captureIds: members.map((m) => m._id), direction,
    ...(style ? { styleId: style._id, styleName: style.name } : {}),
  });
  await runCaptureReel(reel._id);
  const done = await CaptureReel.findById(reel._id).lean();
  console.log(JSON.stringify({
    status: done.status, error: done.error, durationSec: done.durationSec, costUsd: done.costUsd,
    videoKey: done.videoKey, audioMode: done.plan?.audioMode, hook: done.plan?.hook, concept: done.plan?.concept,
    scenes: done.plan?.scenes?.map((s) => `${s.assetId}${s.card ? `#${s.cardNumber}` : ''} ${s.startSec}+${s.durationSec}s ${s.motion}/${s.transition} ${s.kicker ? `[${s.kicker}] ` : ''}${s.overlayText ? `«${s.overlayText}» ` : ''}${s.voiceLine}`),
    look: done.timeline?.look, timings: done.timings, shots: done.timeline?.scenes?.length,
    cta: done.plan?.cta, caption: done.caption, hashtags: done.hashtags,
  }, null, 2));
  await mongoose.disconnect();
  process.exit(0); // queue / cache modules keep handles open
})().catch((err) => { console.error(err); process.exit(1); });
