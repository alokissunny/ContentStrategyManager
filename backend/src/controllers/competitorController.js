const BrandAnalysisReport = require('../models/BrandAnalysisReport');
const CompetitorSet = require('../models/CompetitorSet');
const CustomerCohort = require('../models/CustomerCohort');
const CompetitorAnalysis = require('../models/CompetitorAnalysis');
const InstagramProfile = require('../models/InstagramProfile');
const { findCompetitors, generateCompetitorAnalysis } = require('../services/competitorFinder');
const { uploadMarkdown } = require('../services/s3Client');
const { scrapePosts } = require('../services/instagramScraper');

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const COMPETITOR_ANALYSIS_POSTS = Number(process.env.COMPETITOR_ANALYSIS_POSTS) || 40;

function formatOf(type) {
  if (/video|reel|clip/i.test(type || '')) return 'Reel';
  if (/sidecar|carousel|album/i.test(type || '')) return 'Carousel';
  return 'Post';
}

// Deterministic 30-day metrics from a competitor's scraped posts.
function computeActivityMetrics(posts) {
  if (!posts.length) return { postsLast30: 0, perWeek: 0, avgLikes: 0, avgComments: 0, formats: {}, topPost: null };
  const n = posts.length;
  const likes = posts.reduce((s, p) => s + (p.likesCount || 0), 0);
  const comments = posts.reduce((s, p) => s + (p.commentsCount || 0), 0);
  const formats = {};
  posts.forEach((p) => { const f = formatOf(p.type); formats[f] = (formats[f] || 0) + 1; });
  const top = [...posts].sort((a, b) => (b.likesCount || 0) + (b.commentsCount || 0) - ((a.likesCount || 0) + (a.commentsCount || 0)))[0];
  return {
    postsLast30: n,
    perWeek: Math.round((n / (30 / 7)) * 10) / 10,
    avgLikes: Math.round(likes / n),
    avgComments: Math.round(comments / n),
    formats,
    topPost: top ? { likes: top.likesCount || 0, comments: top.commentsCount || 0, caption: (top.caption || '').slice(0, 140), url: top.url } : null,
  };
}

// Scrape ~30 days of posts for each competitor via Apify (best-effort per
// handle) and compute metrics. Runs in parallel so 5 handles don't serialise.
async function scrapeCompetitorActivity(competitors) {
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  return Promise.all(
    (competitors || []).map(async (c) => {
      try {
        const all = await scrapePosts(c.username, COMPETITOR_ANALYSIS_POSTS);
        const posts = all
          .filter((p) => p.timestamp && new Date(p.timestamp).getTime() >= cutoff)
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        return { username: c.username, posts, metrics: computeActivityMetrics(posts) };
      } catch (err) {
        console.error(`[competitors] 30-day scrape failed for @${c.username}:`, err.message);
        return { username: c.username, posts: [], metrics: null, error: err.message };
      }
    })
  );
}

// Pull the axes that matter for competitor matching out of the latest confirmed
// Brand DNA report, if the user has one. Returns null when nothing is available.
async function loadBrandDna(userId, username) {
  const report = await BrandAnalysisReport.findOne({ user: userId, instagramUsername: username }).sort({
    createdAt: -1,
  });
  if (!report) return null;
  return {
    targetClient: report.whoYouHelp || '',
    serviceOffering: report.whatYouOffer || '',
    designStyle: report.visualStyle || '',
    differentiator: report.position || '',
  };
}

// Run competitor discovery for a profile and persist it as the user's
// CompetitorSet for that handle. Used by the automatic refresh triggered when
// an Instagram account is (re)analyzed.
async function buildAndSaveCompetitorSet(userId, profile) {
  const brandDna = await loadBrandDna(userId, profile.username);
  const result = await findCompetitors(profile, { brandDna });

  const snapshot = await CompetitorSet.findOneAndUpdate(
    { user: userId, username: profile.username },
    {
      user: userId,
      username: profile.username,
      baseRegion: result.baseRegion,
      baseFollowers: result.baseFollowers,
      model: result.model,
      competitors: result.competitors,
      fetchedAt: new Date(),
    },
    { new: true, upsert: true }
  );

  return snapshot;
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toISOString().slice(0, 10);
}

function oneLine(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 90);
}

// The raw 30-day dump scraped from Apify, one section per competitor.
function buildActivityDump(activity) {
  const blocks = (activity || []).map((a) => {
    const m = a.metrics;
    if (!m || !a.posts.length) {
      return `### @${a.username}\n_No posts found in the last 30 days${a.error ? ` (scrape error: ${a.error})` : ''}._`;
    }
    const fmt = Object.entries(m.formats).map(([k, v]) => `${k} ${v}`).join(', ');
    const header = `### @${a.username}\n**${m.postsLast30} posts** in 30 days · ~${m.perWeek}/week · avg ${m.avgLikes} likes, ${m.avgComments} comments · formats: ${fmt}`;
    const rows = a.posts
      .map((p) => `| ${fmtDate(p.timestamp)} | ${formatOf(p.type)} | ${p.likesCount || 0} | ${p.commentsCount || 0} | ${oneLine(p.caption)} |`)
      .join('\n');
    return [header, '', '| Date | Type | Likes | Comments | Caption |', '|---|---|---|---|---|', rows].join('\n');
  });
  return blocks.join('\n\n');
}

// Build the Markdown document persisted to S3: the competitor list, the raw
// 30-day activity dump (scraped via Apify), then the written analysis + insights.
// Kept together so the linked file is fully self-contained.
function buildCompetitorAnalysisMarkdown(profile, set, activity, analysisMarkdown, model) {
  const rows = (set.competitors || [])
    .map((c) => `| @${c.username} | ${c.followersCount || '—'} | ${c.region || '—'} | ${c.designStyle || '—'} | ${c.targetClient || '—'} | ${c.serviceOffering || '—'} | ${c.cohort || '—'} |`)
    .join('\n');
  return [
    `# Competitor analysis — @${profile.username}`,
    `Region: ${set.baseRegion || '—'} · Followers: ${set.baseFollowers || '—'} · Generated: ${new Date().toISOString().slice(0, 10)} · Model: ${model}`,
    '',
    '## Competitors analysed (raw data)',
    '',
    '| Handle | Followers | Region | Design | Target client | Service | Cohort |',
    '|---|---|---|---|---|---|---|',
    rows,
    '',
    '## 30-day activity dump (scraped via Apify)',
    '',
    buildActivityDump(activity),
    '',
    analysisMarkdown,
    '',
  ].join('\n');
}

// Run the full competitor analysis for a profile: ensure a competitor set
// exists, scrape each competitor's last 30 days, write the analysis, store the
// Markdown in S3 and link it to the user's Brand DNA. Used by the weekly-plan
// chain (which needs the insights before planning).
async function buildAndSaveCompetitorAnalysis(userId, profile) {
  let set = await CompetitorSet.findOne({ user: userId, username: profile.username }).sort({ fetchedAt: -1 });
  if (!set || !set.competitors.length) {
    set = await buildAndSaveCompetitorSet(userId, profile);
  }

  // Scrape each competitor's last 30 days from Instagram, then analyse.
  const activity = await scrapeCompetitorActivity(set.competitors);
  const brandDna = await loadBrandDna(userId, profile.username);
  const { analysisMarkdown, model } = await generateCompetitorAnalysis(profile, brandDna, set.competitors, activity);
  const markdown = buildCompetitorAnalysisMarkdown(profile, set, activity, analysisMarkdown, model);

  const s3Key = `competitor-analysis/${userId}/${profile.username}-${Date.now()}.md`;
  await uploadMarkdown(s3Key, markdown);

  set.analysisS3Key = s3Key;
  set.analyzedAt = new Date();
  await set.save();

  // Link the analysis file to the user's Brand DNA (latest report for this handle).
  await BrandAnalysisReport.findOneAndUpdate(
    { user: userId, instagramUsername: profile.username },
    { competitorAnalysisS3Key: s3Key, competitorAnalysisAt: new Date() },
    { sort: { createdAt: -1 } }
  );

  return set;
}

// Latest completed dashboard for a filter scope, newest first. Follower range /
// period are pinned to the back office Overview defaults, so a cohort is keyed
// by Business Type + Location.
function findCohortAnalysis(businessCategory, location) {
  return CompetitorAnalysis.findOne({
    status: 'completed',
    dashboard: { $ne: null },
    'filterScope.businessCategory': businessCategory,
    'filterScope.location': location,
    'filterScope.followerRangeLabel': 'All sizes',
    'filterScope.period': 'last-30',
  })
    .sort({ finishedAt: -1, startedAt: -1 })
    .lean();
}

/*
 * Competitor Overview for a signed-in user's Instagram handle: the same analysis
 * the back office Overview renders, scoped to the competitor cohort (Business
 * Type + Location) an operator assigned to that handle. Falls back to the same
 * business type at Global when the handle's country has not been analysed yet.
 *
 * `username` should be the active Instagram handle. When omitted, falls back to
 * any cohort for the user (legacy single-cohort rows).
 */
async function loadCompetitorOverviewForUser(userId, username) {
  const handle = username ? String(username).trim().toLowerCase() : '';
  let cohortDoc = null;
  if (handle) {
    cohortDoc = await CustomerCohort.findOne({ user: userId, instagramUsername: handle }).lean();
  }
  // Legacy: one cohort per user with a missing/stale username.
  if (!cohortDoc) {
    cohortDoc = await CustomerCohort.findOne({
      user: userId,
      $or: [{ instagramUsername: null }, { instagramUsername: '' }, { instagramUsername: { $exists: false } }],
    }).lean();
  }
  if (!cohortDoc && !handle) {
    cohortDoc = await CustomerCohort.findOne({ user: userId }).sort({ updatedAt: -1 }).lean();
  }

  // Other *currently connected* handles that already have a cohort — used so
  // the empty state can explain "assigned, but not for *this* account".
  const connected = await InstagramProfile.find({ user: userId }).select('username').lean();
  const connectedSet = new Set(
    connected.map((p) => String(p.username || '').toLowerCase()).filter(Boolean),
  );
  const otherAssigned = await CustomerCohort.find({ user: userId })
    .select('instagramUsername')
    .lean();
  const otherAssignedHandles = [
    ...new Set(
      otherAssigned
        .map((c) => (c.instagramUsername ? String(c.instagramUsername).toLowerCase() : ''))
        .filter((u) => u && u !== handle && connectedSet.has(u)),
    ),
  ];

  if (!cohortDoc) {
    return {
      username: handle || null,
      cohort: null,
      scopeUsed: null,
      dashboard: null,
      generatedAt: null,
      otherAssignedHandles,
    };
  }

  const businessCategory = cohortDoc.businessCategory || 'interior-designer';
  const location = cohortDoc.location || 'Global';

  let analysis = await findCohortAnalysis(businessCategory, location);
  let scopeUsed = analysis ? { businessCategory, location } : null;

  if (!analysis && location !== 'Global') {
    analysis = await findCohortAnalysis(businessCategory, 'Global');
    if (analysis) scopeUsed = { businessCategory, location: 'Global' };
  }

  return {
    username: handle || cohortDoc.instagramUsername || null,
    cohort: {
      businessCategory,
      location,
      instagramUsername: cohortDoc.instagramUsername || handle || null,
    },
    scopeUsed,
    dashboard: analysis ? analysis.dashboard : null,
    generatedAt: analysis ? analysis.finishedAt || analysis.startedAt || null : null,
    accountsAnalyzed: analysis ? analysis.accountsAnalyzed ?? null : null,
    postsAnalyzed: analysis ? analysis.postsAnalyzed ?? null : null,
    otherAssignedHandles,
  };
}

async function getCompetitorOverview(req, res) {
  const profile = await InstagramProfile.findOne({ user: req.user._id }).sort({
    activatedAt: -1,
    fetchedAt: -1,
  });
  // Avoid intermediaries serving a stale empty overview after a cohort is assigned.
  res.set('Cache-Control', 'no-store');
  res.json(await loadCompetitorOverviewForUser(req.user._id, profile?.username));
}

module.exports = {
  getCompetitorOverview,
  loadCompetitorOverviewForUser,
  buildAndSaveCompetitorSet,
  buildAndSaveCompetitorAnalysis,
};
