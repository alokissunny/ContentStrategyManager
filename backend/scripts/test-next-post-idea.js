/*
 * Dry run of the Next-post idea agent for one handle: reads the real material,
 * calls the model, checks the answer — writes NOTHING (no PostIdea, no tags).
 *   node scripts/test-next-post-idea.js [handle]   (default: the handle with the most captures)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Project = require('../src/models/Project');
const { loadMaterial, contextOf, callModel, cleanIdeas } = require('../src/services/nextPostIdea');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  let handle = process.argv[2];
  let userId;
  if (handle) {
    const p = await Project.findOne({ instagramUsername: handle }).select('user').lean();
    userId = p?.user;
  } else {
    const [top] = await Project.aggregate([
      { $match: { instagramUsername: { $ne: null } } },
      { $project: { user: 1, instagramUsername: 1, n: { $size: { $ifNull: ['$captures', []] } } } },
      { $group: { _id: { user: '$user', h: '$instagramUsername' }, n: { $sum: '$n' } } },
      { $sort: { n: -1 } },
      { $limit: 1 },
    ]);
    userId = top?._id.user;
    handle = top?._id.h;
  }
  if (!userId) throw new Error('no account found');

  const material = await loadMaterial(userId, handle);
  const { ctx, lookups } = contextOf(material);
  console.log(`@${handle}: ${ctx.instagramPosts.length} IG posts · ${ctx.bauhlyPosts.length} Bauhly posts · ${ctx.captures.length} captures · memory fields ${Object.keys(ctx.brandMemory).length}`);

  const { parsed, debugRow } = await callModel(ctx, 'en');
  const ideas = cleanIdeas(parsed, lookups);
  const rawSources = (parsed.ideas || []).reduce((n, i) => n + (i.sources || []).length, 0);
  const keptSources = ideas.reduce((n, i) => n + i.sources.length, 0);
  console.log(`model ${debugRow.model} · ${debugRow.elapsedMs}ms · ${debugRow.usage.inputTokens}+${debugRow.usage.outputTokens} tok · ~$${debugRow.usage.estimatedCostUsd.toFixed(4)}`);
  console.log(`pillar tags returned: ${(parsed.pillarTags || []).length} (untagged sent: ${lookups.untaggedIg.length} IG + ${lookups.untaggedBauhly.length} Bauhly)`);
  console.log(`balance: ${parsed.balanceNote || '-'}`);
  console.log(`sources kept ${keptSources}/${rawSources}`);
  for (const i of ideas) {
    console.log(`\n#${i.rank} [${i.pillar}] ${i.title}\n  ${i.eyebrow}\n  why: ${i.why}\n  opening: ${i.opening}`
      + `\n  questions: ${JSON.stringify(i.questions)}\n  sources: ${i.sources.map((s) => `${s.kind}:${s.label || s.id}`).join(', ')}`
      + `\n  assets: ${i.assets.length} · questionLed ${i.questionLed} · scores ${JSON.stringify(i.scores)}`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
