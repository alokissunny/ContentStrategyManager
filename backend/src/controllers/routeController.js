const WeeklyRoute = require('../models/WeeklyRoute');
const InstagramProfile = require('../models/InstagramProfile');
const BrandAnalysisReport = require('../models/BrandAnalysisReport');
const { generateWeeklyPlan } = require('../services/weeklyPlan');

// Brand DNA axes that sharpen the plan's voice/positioning, from the latest
// confirmed report (same shape used by competitorController).
async function loadBrandDna(userId, username) {
  const report = await BrandAnalysisReport.findOne({ user: userId, instagramUsername: username }).sort({
    createdAt: -1,
  });
  if (!report) return null;
  return {
    whoYouHelp: report.whoYouHelp || '',
    whatYouOffer: report.whatYouOffer || '',
    howYouSound: report.howYouSound || '',
    visualStyle: report.visualStyle || '',
    contentPillars: report.contentPillars || '',
    differentiator: report.differentiator || '',
  };
}

// Generate this week's plan for a profile and persist it as the user's current
// route. Shared by the manual endpoint and the auto-refresh after analysis.
async function generateAndSaveRoute(userId, profile) {
  const brandDna = await loadBrandDna(userId, profile.username);
  const plan = await generateWeeklyPlan(profile, brandDna);

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
