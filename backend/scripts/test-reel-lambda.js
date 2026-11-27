/**
 * Renders a saved reel the way the reel worker does when the studio's browser doesn't take it:
 * clip copies + Remotion Lambda, local fallback (backend/aws/REEL_RENDER_LAMBDA.md).
 * Nothing is saved to the reel.
 *
 *   REEL_RENDER_BACKEND=lambda node scripts/test-reel-lambda.js <spec.json | reelId> <out.mp4>
 *
 * spec.json = { composition: 'CaptureReel', props: { reel } } (what render.mjs takes);
 * a reelId reads CaptureReel.timeline from Mongo (MONGO_URI).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const agent = require('../src/services/captureReelAgent');

(async () => {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) {
    console.error('usage: node scripts/test-reel-lambda.js <spec.json | reelId> <out.mp4>');
    process.exit(2);
  }
  let timeline;
  if (fs.existsSync(src)) {
    timeline = JSON.parse(fs.readFileSync(src, 'utf8')).props.reel;
  } else {
    const mongoose = require('mongoose');
    await mongoose.connect(process.env.MONGO_URI);
    const CaptureReel = require('../src/models/CaptureReel');
    const r = await CaptureReel.findById(src).lean();
    timeline = await agent.refreshTimelineUrls(r.timeline);
    await mongoose.disconnect();
  }
  const ledger = agent._costLedger();
  const t0 = Date.now();
  const got = await agent._renderOnServer(timeline, path.resolve(out), {
    userId: 'test',
    ledger,
    onProgress: (p) => process.stdout.write(`\r${p}%  `),
  });
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s`, JSON.stringify({ timing: got.timing, lambda: got.lambda }));
  for (const r of ledger.rows) console.log('-', r.source, '|', r.output || '', r.usage?.estimatedCostUsd ? `| $${r.usage.estimatedCostUsd}` : '');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
