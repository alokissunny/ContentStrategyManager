const InstagramProfile = require('../models/InstagramProfile');
const BrandAnalysisReport = require('../models/BrandAnalysisReport');
const CompetitorSet = require('../models/CompetitorSet');
const { findCompetitors, generateCompetitorAnalysis } = require('../services/competitorFinder');
const { uploadMarkdown, getPresignedDownloadUrl, getObjectText } = require('../services/s3Client');
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

function resolveUsername(req) {
  const raw = req.body.username || req.query.username || '';
  return raw.replace(/^@/, '').trim().toLowerCase();
}

// Only two cohorts are surfaced (smaller peers fold into "similar").
function splitCohorts(competitors) {
  return {
    similar: competitors.filter((c) => c.cohort === 'similar'),
    higher: competitors.filter((c) => c.cohort === 'higher'),
  };
}

// Run competitor discovery for a profile and persist it as the user's
// CompetitorSet for that handle. Shared by the manual endpoint and the
// automatic refresh triggered when an Instagram account is (re)analyzed.
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

async function fetchCompetitors(req, res) {
  const username = resolveUsername(req);

  // Default to the user's most recently analysed handle when none is given.
  const query = { user: req.user._id };
  if (username) query.username = username;
  const profile = await InstagramProfile.findOne(query).sort({ fetchedAt: -1 });

  if (!profile) {
    return res.status(404).json({
      message: 'No Instagram profile found. Connect and analyze a handle before finding competitors.',
    });
  }

  const snapshot = await buildAndSaveCompetitorSet(req.user._id, profile);

  res.json({
    username: snapshot.username,
    baseRegion: snapshot.baseRegion,
    baseFollowers: snapshot.baseFollowers,
    cohorts: splitCohorts(snapshot.competitors),
    competitorSet: snapshot,
  });
}

async function getCompetitors(req, res) {
  const username = resolveUsername(req);
  const query = { user: req.user._id };
  if (username) query.username = username;

  const snapshot = await CompetitorSet.findOne(query).sort({ fetchedAt: -1 });
  if (!snapshot) {
    return res.status(404).json({ message: 'No competitor analysis yet. Run a competitor search first.' });
  }

  res.json({
    username: snapshot.username,
    baseRegion: snapshot.baseRegion,
    baseFollowers: snapshot.baseFollowers,
    cohorts: splitCohorts(snapshot.competitors),
    competitorSet: snapshot,
    analyzedAt: snapshot.analyzedAt || null,
    analysisDownloadUrl: snapshot.analysisS3Key ? await getPresignedDownloadUrl(snapshot.analysisS3Key) : null,
  });
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
// Markdown in S3 and link it to the user's Brand DNA. Shared by the endpoint and
// by the weekly-plan chain (which needs the insights before planning).
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

async function analyzeCompetitors(req, res) {
  const username = resolveUsername(req);
  const query = { user: req.user._id };
  if (username) query.username = username;

  const profile = await InstagramProfile.findOne(query).sort({ fetchedAt: -1 });
  if (!profile) {
    return res.status(404).json({
      message: 'No Instagram profile found. Connect and analyze a handle before running competitor analysis.',
    });
  }

  const set = await buildAndSaveCompetitorAnalysis(req.user._id, profile);
  const s3Key = set.analysisS3Key;

  res.json({
    username: profile.username,
    analyzedAt: set.analyzedAt,
    downloadUrl: await getPresignedDownloadUrl(s3Key),
  });
}

// Full detailed competitor strategy (the analysis Markdown) for rendering on
// the Competitor strategy page.
async function getCompetitorAnalysis(req, res) {
  const username = resolveUsername(req);
  const query = { user: req.user._id };
  if (username) query.username = username;

  const set = await CompetitorSet.findOne(query).sort({ fetchedAt: -1 });
  if (!set || !set.analysisS3Key) {
    return res.status(404).json({ message: 'No competitor strategy yet. Run competitor analysis first.' });
  }
  const markdown = await getObjectText(set.analysisS3Key);
  res.json({
    username: set.username,
    analyzedAt: set.analyzedAt,
    markdown,
    // The page renders insights only; the full file (incl. the raw 30-day dump)
    // stays available to download.
    downloadUrl: await getPresignedDownloadUrl(set.analysisS3Key),
  });
}

module.exports = {
  fetchCompetitors,
  getCompetitors,
  analyzeCompetitors,
  getCompetitorAnalysis,
  buildAndSaveCompetitorSet,
  buildAndSaveCompetitorAnalysis,
};
