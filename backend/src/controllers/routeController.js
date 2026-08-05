const WeeklyRoute = require('../models/WeeklyRoute');
const InstagramProfile = require('../models/InstagramProfile');
const BrandAnalysisReport = require('../models/BrandAnalysisReport');
const Project = require('../models/Project');
const { generateWeeklyPlan } = require('../services/weeklyPlan');
const { loadCompetitorOverviewForUser } = require('./competitorController');

// Competitor context for the weekly plan: the competitor cohort (Business Type +
// Location) an operator assigned to this Instagram handle in the back office,
// and its saved analysis dashboard. Returns null when no cohort is assigned or
// no analysis exists yet — the plan is then built from Brand DNA + history.
async function loadCohortCompetitorInsights(userId, username) {
  const overview = await loadCompetitorOverviewForUser(userId, username);
  if (!overview || !overview.cohort || !overview.dashboard) return null;
  return { cohort: overview.cohort, scopeUsed: overview.scopeUsed, dashboard: overview.dashboard };
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

// Studio projects → compact inventory the planner can ground posts and slides in.
// Scoped to the handle the plan is for, so each account grounds on its own
// projects. Legacy projects (unassigned to a handle) are still included until
// they're adopted into an account on the next Projects page load.
async function loadProjectAssets(userId, username) {
  const filter = { user: userId };
  if (username) filter.instagramUsername = { $in: [username, null, ''] };
  const projects = await Project.find(filter).sort({ updatedAt: -1 }).limit(12);
  return projects.map((p) => {
    const notes = [];
    const assets = [];
    for (const c of p.captures || []) {
      if (c.text?.trim()) notes.push(c.text.trim().slice(0, 280));
      for (const a of c.attachments || []) {
        if (a.type === 'image' && a.key) {
          assets.push({ key: a.key, note: (c.text || '').trim().slice(0, 120) });
        }
      }
    }
    return {
      id: p._id.toString(),
      name: p.name,
      notes: notes.slice(0, 8),
      assets: assets.slice(0, 24),
    };
  });
}

// Generate this week's plan for a profile and persist it as the user's current
// route. Shared by the manual endpoint and the auto-refresh after analysis.
async function generateAndSaveRoute(userId, profile) {
  const brandDna = await loadBrandDna(userId, profile.username);

  // Reference the assigned competitor cohort's analysis when one exists.
  // Best-effort — a plan can always be built from the account's own data.
  const competitorInsights = await loadCohortCompetitorInsights(userId, profile.username).catch((err) => {
    console.error(`[route] could not load cohort competitor insights for @${profile.username}:`, err.message);
    return null;
  });

  const projects = await loadProjectAssets(userId, profile.username).catch((err) => {
    console.error(`[route] could not load projects for plan:`, err.message);
    return [];
  });

  const plan = await generateWeeklyPlan(profile, brandDna, competitorInsights, projects);

  // Key the upsert by handle too, so plans for different handles don't
  // overwrite each other within the same week.
  const route = await WeeklyRoute.findOneAndUpdate(
    { user: userId, instagramUsername: profile.username, weekOf: plan.weekOf },
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

// The handle the app is currently showing — most recently activated (analyzed
// or switched to in the header), with fetchedAt as a legacy-row tiebreaker.
async function currentProfile(userId) {
  return InstagramProfile.findOne({ user: userId }).sort({ activatedAt: -1, fetchedAt: -1 });
}

// A handle analyzed this recently is assumed to still be running its background
// discovery → analysis → plan chain.
const REGENERATING_WINDOW_MS = 15 * 60 * 1000;

async function getCurrentRoute(req, res) {
  // Scope to the *current* handle. Without this, switching Instagram accounts
  // keeps serving the previous handle's plan until the (multi-minute) background
  // regeneration finishes — i.e. another account's strategy.
  const profile = await currentProfile(req.user._id);
  if (!profile) return res.json({ route: null, preparing: false });

  const route = await WeeklyRoute.findOne({
    user: req.user._id,
    instagramUsername: profile.username,
  }).sort({ weekOf: -1 });

  // No plan yet for a handle that was just analyzed → the chain is still running.
  const preparing =
    !route && Date.now() - new Date(profile.fetchedAt).getTime() < REGENERATING_WINDOW_MS;

  res.json({ route, preparing, username: profile.username });
}

async function getRoutes(req, res) {
  // Same handle scoping as getCurrentRoute — switching accounts in the header
  // must only show that account's archive, not every plan for the user.
  const profile = await currentProfile(req.user._id);
  if (!profile) return res.json({ routes: [], username: null });

  const routes = await WeeklyRoute.find({
    user: req.user._id,
    instagramUsername: profile.username,
  }).sort({ weekOf: -1 });

  res.json({ routes, username: profile.username });
}

async function generateRoute(req, res) {
  const profile = await currentProfile(req.user._id);
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

  const day = route.days[index];

  if (req.body.published !== undefined) {
    day.published = Boolean(req.body.published);
  } else if (req.body.content === undefined && req.body.slides === undefined) {
    // Legacy toggle when the body is empty / only flipping publish.
    day.published = !day.published;
  }

  // Persist slide / caption edits from the studio editor.
  if (req.body.content && typeof req.body.content === 'object') {
    const incoming = req.body.content;
    const cur = day.content || {};
    if (Array.isArray(incoming.slides)) {
      cur.slides = incoming.slides.map((s) => ({
        role: String(s.role || ''),
        title: String(s.title || ''),
        assetKey: String(s.assetKey || ''),
      }));
      cur.onScreenText = cur.slides.map((s) => s.title).filter(Boolean);
    }
    if (incoming.caption !== undefined) cur.caption = String(incoming.caption);
    if (incoming.cta !== undefined) cur.cta = String(incoming.cta);
    if (incoming.strategy !== undefined) cur.strategy = String(incoming.strategy);
    if (incoming.notes !== undefined) cur.notes = String(incoming.notes);
    if (incoming.plan !== undefined) cur.plan = String(incoming.plan);
    if (Array.isArray(incoming.hashtags)) {
      cur.hashtags = incoming.hashtags.map((h) => String(h).replace(/^#/, ''));
    }
    day.content = cur;
  }

  route.markModified('days');
  await route.save();
  res.json({ route });
}

module.exports = { generateAndSaveRoute, getCurrentRoute, getRoutes, generateRoute, markDayPublished };
