const WeeklyRoute = require('../models/WeeklyRoute');
const BrandAnalysisReport = require('../models/BrandAnalysisReport');
const Project = require('../models/Project');
const { generateWeeklyPlan } = require('../services/weeklyPlan');
const { loadCompetitorOverviewForUser } = require('./competitorController');
const { currentProfile } = require('../utils/currentProfile');

// ── Monthly plan config ──────────────────────────────────────────────────────
// A plan is a month of 4 weeks. The current month is written; the next month is
// scheduled as placeholders and stays locked until Bauhly "writes" it (the next
// plan run). A week becomes readable PREP_DAYS before it starts.
const WEEKS_PER_MONTH = 4;
const PREP_DAYS = 5;
const PILLAR_ROTATION = ['discovery', 'credibility', 'trust'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d; };
// The Monday of the week containing `from` (weeks are Monday-anchored app-wide).
function mondayOf(from = new Date()) {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
const monthLabelOf = (date) => `${MONTH_ABBR[date.getMonth()]} ${date.getFullYear()}`;
const monthNameOf = (date) => MONTH_NAMES[date.getMonth()];
// Next pillar after `pillar` in the rotation — the next month's focus.
const nextPillar = (pillar) => {
  const i = PILLAR_ROTATION.indexOf(pillar);
  return PILLAR_ROTATION[(i + 1) % PILLAR_ROTATION.length];
};

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

// Persist one week (upsert by handle+weekOf), stamped with month/schedule meta.
async function saveWeek(userId, username, plan, meta) {
  return WeeklyRoute.findOneAndUpdate(
    { user: userId, instagramUsername: username, weekOf: plan.weekOf },
    {
      user: userId,
      instagramUsername: username,
      weekOf: plan.weekOf,
      weekLabel: plan.weekLabel,
      model: plan.model || '',
      focus: plan.focus,
      funnel: plan.funnel || [],
      days: plan.days || [],
      generatedAt: new Date(),
      ...meta,
    },
    { new: true, upsert: true }
  );
}

// Generate a MONTH (4 weeks sharing one pillar-gap focus) and schedule the next
// month as locked placeholders — no strategy written for it yet. A regen
// replaces this month + the scheduled next month; weeks that have already
// started are kept as the studio's archive. Shared by the manual endpoint and
// the auto-refresh after analysis.
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

  const month0Start = mondayOf();                          // this week's Monday
  const month1Start = addDays(month0Start, 7 * WEEKS_PER_MONTH);
  const month0Key = monthLabelOf(month0Start);
  const month0Name = monthNameOf(month0Start);

  // Write week 0 BEFORE clearing the old plan: if the model call fails here, the
  // studio keeps their existing plan rather than losing it to a failed regen.
  let week0Plan;
  try {
    week0Plan = await generateWeeklyPlan(profile, brandDna, competitorInsights, projects, {
      weekDate: month0Start,
    });
  } catch (err) {
    console.error(`[route] month0 week 0 generation failed for @${profile.username}:`, err.message);
    return WeeklyRoute.findOne({
      user: userId, instagramUsername: profile.username, draft: false,
    }).sort({ weekOf: -1 });
  }
  const monthFocus = week0Plan.focus?.pillar || 'trust';

  // Safe to replace now: drop the scheduled next month and this month onward;
  // weeks that have already started stay as the archive.
  await WeeklyRoute.deleteMany({
    user: userId,
    instagramUsername: profile.username,
    $or: [{ draft: true }, { weekOf: { $gte: month0Start } }],
  });

  // ── Current month: 4 written weeks, one shared focus (week 0's gap pillar) ──
  const weekMeta = (w, weekDate, draft) => ({
    monthKey: draft ? monthLabelOf(month1Start) : month0Key,
    monthName: draft ? monthNameOf(month1Start) : month0Name,
    monthIndex: draft ? 1 : 0,
    weekIndex: w,
    startsAt: weekDate,
    readyAt: addDays(weekDate, -PREP_DAYS),
    draft,
  });
  const firstWeek = await saveWeek(userId, profile.username, week0Plan, weekMeta(0, month0Start, false));
  for (let w = 1; w < WEEKS_PER_MONTH; w += 1) {
    const weekDate = addDays(month0Start, 7 * w);
    try {
      const plan = await generateWeeklyPlan(profile, brandDna, competitorInsights, projects, {
        weekDate,
        focusPillar: monthFocus,   // the rest of the month reuse week 0's focus
      });
      await saveWeek(userId, profile.username, plan, weekMeta(w, weekDate, false));
    } catch (err) {
      console.error(`[route] month0 week ${w} generation failed for @${profile.username}:`, err.message);
    }
  }

  // ── Next month: 4 locked placeholders — scheduled, no strategy written ──
  const nextFocus = nextPillar(monthFocus);
  const fmt = (dt) => dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  for (let w = 0; w < WEEKS_PER_MONTH; w += 1) {
    const weekDate = addDays(month1Start, 7 * w);
    const sunday = addDays(weekDate, 6);
    await saveWeek(userId, profile.username, {
      weekOf: weekDate,
      weekLabel: `${fmt(weekDate)} – ${fmt(sunday)}`,
      model: '',
      focus: { pillar: nextFocus, headline: '' },
      funnel: [],
      days: [],
    }, weekMeta(w, weekDate, true));
  }

  // The endpoint/UI opens the current running week.
  return firstWeek || WeeklyRoute.findOne({
    user: userId, instagramUsername: profile.username, draft: false,
  }).sort({ weekOf: -1 });
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

  // The running week: the newest WRITTEN (non-draft) week that has already
  // started, falling back to the earliest upcoming written week. Never a draft —
  // a locked next-month placeholder is not "current".
  const thisMonday = mondayOf();
  let route = await WeeklyRoute.findOne({
    user: req.user._id,
    instagramUsername: profile.username,
    draft: false,
    weekOf: { $lte: thisMonday },
  }).sort({ weekOf: -1 });
  if (!route) {
    route = await WeeklyRoute.findOne({
      user: req.user._id,
      instagramUsername: profile.username,
      draft: false,
    }).sort({ weekOf: 1 });
  }

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
        layout: String(s.layout || ''),
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
