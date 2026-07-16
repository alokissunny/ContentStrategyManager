const InstagramProfile = require('../models/InstagramProfile');
const BrandAnalysisReport = require('../models/BrandAnalysisReport');
const CompetitorSet = require('../models/CompetitorSet');
const { findCompetitors } = require('../services/competitorFinder');

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
  });
}

module.exports = { fetchCompetitors, getCompetitors, buildAndSaveCompetitorSet };
