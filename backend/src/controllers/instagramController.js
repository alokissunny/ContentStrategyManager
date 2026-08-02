const InstagramProfile = require('../models/InstagramProfile');
const BrandAnalysisReport = require('../models/BrandAnalysisReport');
const WeeklyRoute = require('../models/WeeklyRoute');
const { scrapeProfile, scrapePosts } = require('../services/instagramScraper');
const { generateBrandAnalysis } = require('../services/brandAnalysis');
const { uploadMarkdown, getPresignedDownloadUrl } = require('../services/s3Client');
const { computeAuthorityFunnel } = require('../services/authorityFunnel');
const { buildAnalysisOverview } = require('../services/analysisOverview');
const { buildAndSaveCompetitorSet, loadCompetitorOverviewForUser } = require('./competitorController');
const { generateAndSaveRoute } = require('./routeController');

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

  const [profile, posts] = await Promise.all([scrapeProfile(username), scrapePosts(username)]);

  if (!profile) {
    return res.status(404).json({ message: 'Could not read this Instagram profile. It may be private or the username may be wrong.' });
  }

  // Admins can connect several handles (one snapshot per handle). Non-admins
  // keep a single profile that is overwritten each time they re-analyze.
  const isAdmin = req.user.role === 'admin';
  const filter = isAdmin ? { user: req.user._id, username } : { user: req.user._id };

  const snapshot = await InstagramProfile.findOneAndUpdate(
    filter,
    { ...profile, user: req.user._id, username, posts, fetchedAt: new Date() },
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

  // Whenever the connected handle is (re)analyzed — including a non-admin
  // switching accounts — refresh the whole downstream chain for this handle:
  // competitor discovery → competitor analysis → weekly plan, so the plan is
  // built on fresh competitor insights. Run sequentially (the plan step reuses
  // the competitor set rather than racing to rediscover it) and fire-and-forget,
  // since the pipeline takes minutes and the analyze request shouldn't wait.
  (async () => {
    await buildAndSaveCompetitorSet(req.user._id, snapshot);
    // generateAndSaveRoute runs the competitor analysis itself when insights
    // are missing, then plans the week from them.
    await generateAndSaveRoute(req.user._id, snapshot);
  })().catch((err) => {
    console.error(`[instagram] background competitor/plan refresh failed for @${username}:`, err.message);
  });

  res.json({ profile: snapshot, report, reportError });
}

async function getInstagramProfile(req, res) {
  const profiles = await InstagramProfile.find({ user: req.user._id }).sort({ fetchedAt: -1 });
  // `profile` (the most recently fetched) is kept for backward compatibility;
  // `profiles` lists every handle connected to this account.
  res.json({ profile: profiles[0] || null, profiles });
}

// Authority funnel (Discovery / Credibility / Trust) for the most recently
// analysed handle — powers the post-onboarding "Authority Foundation" modal.
async function getAuthorityFunnel(req, res) {
  const query = { user: req.user._id };
  if (req.query.username) query.username = req.query.username.toLowerCase();
  const profile = await InstagramProfile.findOne(query).sort({ fetchedAt: -1 });
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
  const profile = await InstagramProfile.findOne(query).sort({ fetchedAt: -1 });
  if (!profile) {
    return res.status(404).json({ message: 'No Instagram analysis yet. Connect a handle first.' });
  }

  const [brandDna, cohortOverview, weeklyRoute] = await Promise.all([
    loadBrandDna(req.user._id, profile.username),
    loadCompetitorOverviewForUser(req.user._id),
    WeeklyRoute.findOne({ user: req.user._id, instagramUsername: profile.username }).sort({ weekOf: -1 }),
  ]);

  const overview = buildAnalysisOverview(profile, brandDna, cohortOverview, weeklyRoute);
  res.json(overview);
}

module.exports = { fetchInstagram, getInstagramProfile, getAuthorityFunnel, getAnalysisOverview };
