#!/usr/bin/env node
/**
 * Analyse reference reels into ReelStyles (Captures › Generate reel › Choose reel style).
 *
 *   node scripts/seed-reel-styles.js <curatorUserId> <reelUrl> [<reelUrl> …]
 *
 * Re-running a URL re-analyses it. The curator id is only the S3 prefix the
 * thumbnails are stored under (projects/<id>/…).
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { addReelStyle, analyzeReelStyle } = require('../src/services/reelStyleAnalyzer');

(async () => {
  const [userId, ...urls] = process.argv.slice(2);
  if (!userId || !urls.length) throw new Error('usage: seed-reel-styles.js <curatorUserId> <reelUrl>…');
  await mongoose.connect(process.env.MONGO_URI);
  await Promise.all(urls.map(async (url, i) => {
    const doc = await addReelStyle(url, { userId, order: i });
    const done = await analyzeReelStyle(doc._id);
    console.log(done ? `${done.shortCode} · ${done.name} — ${done.summary}` : `${url} failed`);
  }));
  await mongoose.disconnect();
})().catch((err) => { console.error(err); process.exit(1); });
