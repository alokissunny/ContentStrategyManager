const WeeklyRoute = require('../models/WeeklyRoute');
const InstagramProfile = require('../models/InstagramProfile');
const BrandAnalysisReport = require('../models/BrandAnalysisReport');
const CompetitorSet = require('../models/CompetitorSet');
const { generateWeeklyPlan } = require('../services/weeklyPlan');
const { getObjectText } = require('../services/s3Client');

// The insight sections of the competitor analysis worth feeding into the plan —
// what's working / not working and the openings to exploit.
const INSIGHT_SECTIONS = /^##\s*(What's working|What's not working|Positioning gaps)/i;

function extractInsightSections(markdown) {
  const out = [];
  let keep = false;
  for (const line of String(markdown || '').split('\n')) {
    if (/^##\s/.test(line)) keep = INSIGHT_SECTIONS.test(line);
    if (keep) out.push(line);
  }
  return out.join('\n').trim();
}

// Competitor context for the weekly plan: the peer set plus the written
// insights from the latest competitor analysis (if one has been run).
async function loadCompetitorInsights(userId, username) {
  const set = await CompetitorSet.findOne({ user: userId, username }).sort({ fetchedAt: -1 });
  if (!set) return null;

  const competitors = (set.competitors || []).map((c) => ({
    username: c.username,
    followers: c.followersCount,
    cohort: c.cohort,
    designStyle: c.designStyle,
  }));

  let insights = '';
  if (set.analysisS3Key) {
    try {
      insights = extractInsightSections(await getObjectText(set.analysisS3Key));
    } catch (err) {
      console.error(`[route] could not read competitor analysis for @${username}:`, err.message);
    }
  }

  if (!competitors.length && !insights) return null;
  return { competitors, insights };
}

// Brand DNA axes that sharpen the plan's voice/positioning, from the latest
// confirmed report (same shape used by competitorController).
async function loadBrandDna(userId, username) {
  const report = await BrandAnalysisReport.findOne({ user: userId, instagramUsername: username }).sort({
    createdAt: -1,
  });
  if (!report) return null;
  return {
    whatYouOffer: report.whatYouOffer || '',
    whoYouHelp: report.whoYouHelp || '',
    firstProblem: report.firstProblem || '',
    position: report.position || '',
    proof: report.proof || '',
    howYouSound: report.howYouSound || '',
    visualStyle: report.visualStyle || '',
    neverDo: report.neverDo || '',
  };
}

// Generate this week's plan for a profile and persist it as the user's current
// route. Shared by the manual endpoint and the auto-refresh after analysis.
async function generateAndSaveRoute(userId, profile, options = {}) {
  const { ensureInsights = true } = options;
  const brandDna = await loadBrandDna(userId, profile.username);

  let competitorInsights = await loadCompetitorInsights(userId, profile.username);

  // Chain: the weekly strategy should be built on competitor insights, so if no
  // analysis has been written yet, run it first. Best-effort — if competitor
  // discovery/scraping/S3 fails we still plan from the account's own data.
  if (ensureInsights && !competitorInsights?.insights) {
    try {
      // Required lazily to avoid a require cycle at module load.
      const { buildAndSaveCompetitorAnalysis } = require('./competitorController');
      console.log(`[route] no competitor insights for @${profile.username} — running analysis first`);
      await buildAndSaveCompetitorAnalysis(userId, profile);
      competitorInsights = await loadCompetitorInsights(userId, profile.username);
    } catch (err) {
      console.error(`[route] competitor analysis chain failed for @${profile.username}:`, err.message);
    }
  }

  const plan = await generateWeeklyPlan(profile, brandDna, competitorInsights);

  const route = await WeeklyRoute.findOneAndUpdate(
    { user: userId, weekOf: plan.weekOf },
    {
      user: userId,
      instagramUsername: profile.username,
      weekOf: plan.weekOf,
      weekLabel: plan.weekLabel,
      model: plan.model,
      focus: plan.focus,
      funnel: plan.funnel,
      days: plan.days,
      generatedAt: new Date(),
    },
    { new: true, upsert: true }
  );

  return route;
}

async function getCurrentRoute(req, res) {
  const route = await WeeklyRoute.findOne({ user: req.user._id }).sort({ weekOf: -1 });
  res.json({ route });
}

async function getRoutes(req, res) {
  const routes = await WeeklyRoute.find({ user: req.user._id }).sort({ weekOf: -1 });
  res.json({ routes });
}

async function generateRoute(req, res) {
  const profile = await InstagramProfile.findOne({ user: req.user._id }).sort({ fetchedAt: -1 });
  if (!profile) {
    return res.status(404).json({
      message: 'No Instagram profile found. Connect and analyze a handle before generating a plan.',
    });
  }
  const route = await generateAndSaveRoute(req.user._id, profile);
  res.json({ route });
}

async function markDayPublished(req, res) {
  const index = Number(req.params.index);
  const route = await WeeklyRoute.findOne({ _id: req.params.id, user: req.user._id });
  if (!route) return res.status(404).json({ message: 'Route not found' });
  if (!route.days[index]) return res.status(404).json({ message: 'Day not found' });

  route.days[index].published = req.body.published !== undefined ? Boolean(req.body.published) : !route.days[index].published;
  await route.save();
  res.json({ route });
}

module.exports = { generateAndSaveRoute, getCurrentRoute, getRoutes, generateRoute, markDayPublished };
