const InstagramProfile = require('../models/InstagramProfile');
const BrandAnalysisReport = require('../models/BrandAnalysisReport');
const WeeklyRoute = require('../models/WeeklyRoute');
const { scrapeProfile, scrapePosts } = require('../services/instagramScraper');
const { generateBrandAnalysis } = require('../services/brandAnalysis');
const { uploadMarkdown, getPresignedDownloadUrl } = require('../services/s3Client');
const { computeAuthorityFunnel } = require('../services/authorityFunnel');
const { buildAnalysisOverview } = require('../services/analysisOverview');
const { loadCompetitorOverviewForUser } = require('./competitorController');
const { generateAndSaveRoute } = require('./routeController');

// The "current" handle is the one most recently activated (analyzed or switched
// to in the header). fetchedAt is the tiebreaker so legacy rows — which predate
// activatedAt — still order by when they were last analyzed.
const CURRENT_SORT = { activatedAt: -1, fetchedAt: -1 };

// How long a scrape + analysis stays fresh. Within this window we reuse the
// stored snapshot and report instead of re-running the (slow, paid) Apify
// scrape and LLM analysis.
const ANALYSIS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function extractUsername(input) {
  return (input || '')
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/[/?].*$/, '')
    .trim()
    .toLowerCase();
}

async function fetchInstagram(req, res) {
  const username = extractUsername(req.body.username);
  if (!username) {
    return res.status(400).json({ message: 'Instagram username or profile URL is required' });
  }

  // Reuse a recent analysis. If this handle was both scraped and analysed within
  // the last 30 days, skip the scrape + LLM analysis and return the stored
  // snapshot and report. We still bump activatedAt so the handle becomes current.
  const cutoff = new Date(Date.now() - ANALYSIS_TTL_MS);
  const existing = await InstagramProfile.findOne({ user: req.user._id, username });
  if (existing && existing.fetchedAt && existing.fetchedAt > cutoff) {
    const recentReport = await BrandAnalysisReport.findOne({
      user: req.user._id,
      instagramUsername: username,
      createdAt: { $gt: cutoff },
    }).sort({ createdAt: -1 });
    if (recentReport) {
      existing.activatedAt = new Date();
      await existing.save();
      const report = {
        id: recentReport._id,
        createdAt: recentReport.createdAt,
        downloadUrl: await getPresignedDownloadUrl(recentReport.s3Key),
        // Kept for the onboarding confirmation conversation.
        whoYouHelp: recentReport.whoYouHelp,
        whatYouOffer: recentReport.whatYouOffer,
        howYouSound: recentReport.howYouSound,
      };
      return res.json({ profile: existing, report, reportError: null, cached: true });
    }
  }

  const [profile, posts] = await Promise.all([scrapeProfile(username), scrapePosts(username)]);

  if (!profile) {
    return res.status(404).json({ message: 'Could not read this Instagram profile. It may be private or the username may be wrong.' });
  }

  // One snapshot per handle. Adding another account creates a new row;
  // re-analyzing an existing handle updates that row and makes it current.
  const snapshot = await InstagramProfile.findOneAndUpdate(
    { user: req.user._id, username },
    { ...profile, user: req.user._id, username, posts, fetchedAt: new Date(), activatedAt: new Date() },
    { new: true, upsert: true }
  );

  let report = null;
  let reportError = null;
  try {
    const { markdown, brandProfile, model } = await generateBrandAnalysis(snapshot);
    const s3Key = `reports/${req.user._id}/${username}-${Date.now()}.md`;
    await uploadMarkdown(s3Key, markdown);
    const reportDoc = await BrandAnalysisReport.create({
      user: req.user._id,
      instagramUsername: username,
      s3Key,
      model,
      whatYouOffer: brandProfile?.whatYouOffer || '',
      whoYouHelp: brandProfile?.whoYouHelp || '',
      firstProblem: brandProfile?.firstProblem || '',
      position: brandProfile?.position || '',
      proof: brandProfile?.proof || '',
      howYouSound: brandProfile?.howYouSound || '',
      visualStyle: brandProfile?.visualStyle || '',
      neverDo: brandProfile?.neverDo || '',
    });
    report = {
      id: reportDoc._id,
      createdAt: reportDoc.createdAt,
      downloadUrl: await getPresignedDownloadUrl(s3Key),
      // Kept for the onboarding confirmation conversation.
      whoYouHelp: reportDoc.whoYouHelp,
      whatYouOffer: reportDoc.whatYouOffer,
      howYouSound: reportDoc.howYouSound,
    };
  } catch (err) {
    reportError = err.message;
  }

  // Whenever a handle is (re)analyzed — including adding another account —
  // refresh this week's plan for that handle. The plan is built from the
  // account's Brand DNA + history and, when an operator has assigned a
  // competitor cohort, that cohort's saved analysis. Fire-and-forget, since
  // planning takes a while and the analyze request shouldn't wait.
  generateAndSaveRoute(req.user._id, snapshot).catch((err) => {
    console.error(`[instagram] background plan refresh failed for @${username}:`, err.message);
  });

  res.json({ profile: snapshot, report, reportError });
}

async function getInstagramProfile(req, res) {
  const profiles = await InstagramProfile.find({ user: req.user._id }).sort(CURRENT_SORT);
  // `profile` (the current handle) is kept for backward compatibility; `profiles`
  // lists every handle connected to this account, current one first.
  res.json({ profile: profiles[0] || null, profiles });
}

// Make an already-connected handle the current one, so plans, brand profile and
// analysis across the app follow it. Used by the header account switcher.
async function activateInstagram(req, res) {
  const username = extractUsername(req.body.username);
  if (!username) {
    return res.status(400).json({ message: 'Instagram username is required' });
  }
  const profile = await InstagramProfile.findOneAndUpdate(
    { user: req.user._id, username },
    { activatedAt: new Date() },
    { new: true }
  );
  if (!profile) {
    return res.status(404).json({ message: 'That Instagram account is not connected to your workspace.' });
  }
  const profiles = await InstagramProfile.find({ user: req.user._id }).sort(CURRENT_SORT);
  res.json({ profile, profiles });
}

// Authority funnel (Discovery / Credibility / Trust) for the most recently
// analysed handle — powers the post-onboarding "Authority Foundation" modal.
async function getAuthorityFunnel(req, res) {
  const query = { user: req.user._id };
  if (req.query.username) query.username = req.query.username.toLowerCase();
  const profile = await InstagramProfile.findOne(query).sort(CURRENT_SORT);
  if (!profile) {
    return res.status(404).json({ message: 'No Instagram analysis yet. Connect a handle first.' });
  }
  const { week, funnel } = computeAuthorityFunnel(profile);
  res.json({ username: profile.username, week, funnel });
}

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

// Full "Your analysis" modal payload: verdict, account summary, strengths,
// opportunities, similar accounts (when a cohort is assigned), strategic focus.
async function getAnalysisOverview(req, res) {
  const query = { user: req.user._id };
  if (req.query.username) query.username = req.query.username.toLowerCase();
  const profile = await InstagramProfile.findOne(query).sort(CURRENT_SORT);
  if (!profile) {
    return res.status(404).json({ message: 'No Instagram analysis yet. Connect a handle first.' });
  }

  const [brandDna, cohortOverview, weeklyRoute] = await Promise.all([
    loadBrandDna(req.user._id, profile.username),
    loadCompetitorOverviewForUser(req.user._id, profile.username),
    WeeklyRoute.findOne({ user: req.user._id, instagramUsername: profile.username }).sort({ weekOf: -1 }),
  ]);

  const overview = buildAnalysisOverview(profile, brandDna, cohortOverview, weeklyRoute);
  res.json(overview);
}

module.exports = { fetchInstagram, getInstagramProfile, activateInstagram, getAuthorityFunnel, getAnalysisOverview };
