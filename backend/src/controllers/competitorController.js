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
    differentiator: report.differentiator || '',
    contentPillars: report.contentPillars || '',
  };
}

function resolveUsername(req) {
  const raw = req.body.username || req.query.username || '';
  return raw.replace(/^@/, '').trim().toLowerCase();
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

  const brandDna = await loadBrandDna(req.user._id, profile.username);

  const result = await findCompetitors(profile, { brandDna });

  const snapshot = await CompetitorSet.findOneAndUpdate(
    { user: req.user._id, username: profile.username },
    {
      user: req.user._id,
      username: profile.username,
      baseRegion: result.baseRegion,
      baseFollowers: result.baseFollowers,
      model: result.model,
      competitors: result.competitors,
      fetchedAt: new Date(),
    },
    { new: true, upsert: true }
  );

  res.json({
    username: profile.username,
    baseRegion: snapshot.baseRegion,
    baseFollowers: snapshot.baseFollowers,
    cohorts: result.cohorts,
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

  const cohorts = {
    similar: snapshot.competitors.filter((c) => c.cohort === 'similar'),
    higher: snapshot.competitors.filter((c) => c.cohort === 'higher'),
  };

  res.json({
    username: snapshot.username,
    baseRegion: snapshot.baseRegion,
    baseFollowers: snapshot.baseFollowers,
    cohorts,
    competitorSet: snapshot,
  });
}

module.exports = { fetchCompetitors, getCompetitors };
