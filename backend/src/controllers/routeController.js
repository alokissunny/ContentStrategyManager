const WeeklyRoute = require('../models/WeeklyRoute');
const BrandAnalysisReport = require('../models/BrandAnalysisReport');
const Project = require('../models/Project');
const InstagramProfile = require('../models/InstagramProfile');
const { generateWeeklyPlan } = require('../services/weeklyPlan');
const { loadCompetitorOverviewForUser } = require('./competitorController');
const { currentProfile } = require('../utils/currentProfile');

// ── Monthly plan config ──────────────────────────────────────────────────────
// Current calendar month: write only the weeks still ahead (up to 4). Start of
// the month → ~4 weeks; mid-month → fewer. Next calendar month is scheduled as
// locked placeholders (no LLM) and stays non-clickable until a later plan run.
const MAX_WEEKS_PER_MONTH = 4;
const NEXT_MONTH_STUBS = 4;
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

/**
 * Mondays still left to plan this calendar month, starting from this week's
 * Monday. Count scales with how far through the month we are:
 *   days 1–7 → 4 weeks · 8–14 → 3 · 15–21 → 2 · 22+ → 1
 */
function remainingWeekStarts(from = new Date()) {
  const start = mondayOf(from);
  const weekOfMonth = Math.ceil(from.getDate() / 7); // 1..5
  const count = Math.max(1, Math.min(MAX_WEEKS_PER_MONTH, 5 - weekOfMonth));
  return Array.from({ length: count }, (_, i) => addDays(start, 7 * i));
}

/** First Monday of the next calendar month after `from`. */
function firstMondayOfNextMonth(from = new Date()) {
  const first = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  first.setHours(0, 0, 0, 0);
  const mon = mondayOf(first);
  // If the 1st isn't Monday, mondayOf lands in the previous month — step forward.
  return mon.getMonth() === first.getMonth() ? mon : addDays(mon, 7);
}

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
  const usage = plan.usage || {};
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
      usage: {
        inputTokens: Number(usage.inputTokens) || 0,
        outputTokens: Number(usage.outputTokens) || 0,
        totalTokens: Number(usage.totalTokens) || 0,
        estimatedCostUsd: Number(usage.estimatedCostUsd) || 0,
        model: usage.model || plan.model || '',
      },
      ...meta,
    },
    { new: true, upsert: true }
  );
}

/**
 * Write the remaining weeks of this month (after week 0) in parallel, then
 * schedule next-month locked stubs. Fire-and-forget from the HTTP path so the
 * studio can open week 0 without waiting on the whole month.
 */
async function finishMonthInBackground(userId, profile, ctx) {
  const {
    brandDna,
    competitorInsights,
    projects,
    weekStarts,
    monthFocus,
    month1Start,
  } = ctx;
  const username = profile.username;

  const weekMeta = (w, weekDate, draft) => ({
    // Stamp from the week's own start date so Aug/Sep never share a monthKey.
    monthKey: monthLabelOf(weekDate),
    monthName: monthNameOf(weekDate),
    monthIndex: draft ? 1 : 0,
    weekIndex: w,
    startsAt: weekDate,
    readyAt: addDays(weekDate, -PREP_DAYS),
    draft,
  });

  // Parallel LLM for weeks 1..n — same quality as sequential, much less wall time.
  if (weekStarts.length > 1) {
    await Promise.all(
      weekStarts.slice(1).map(async (weekDate, i) => {
        const w = i + 1;
        try {
          const plan = await generateWeeklyPlan(profile, brandDna, competitorInsights, projects, {
            weekDate,
            focusPillar: monthFocus,
          });
          await saveWeek(userId, username, plan, weekMeta(w, weekDate, false));
        } catch (err) {
          console.error(`[route] month0 week ${w} generation failed for @${username}:`, err.message);
        }
      }),
    );
  }

  // Next calendar month: locked placeholders only — never LLM-written here.
  const nextFocus = nextPillar(monthFocus);
  const fmt = (dt) => dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  await Promise.all(
    Array.from({ length: NEXT_MONTH_STUBS }, async (_, w) => {
      const weekDate = addDays(month1Start, 7 * w);
      const sunday = addDays(weekDate, 6);
      await saveWeek(userId, username, {
        weekOf: weekDate,
        weekLabel: `${fmt(weekDate)} – ${fmt(sunday)}`,
        model: '',
        focus: { pillar: nextFocus, headline: '' },
        funnel: [],
        days: [],
      }, weekMeta(w, weekDate, true));
    }),
  );
}

// Generate the rest of this calendar month (dynamic week count) and schedule the
// next month as locked placeholders. Returns week 0 as soon as it's saved so
// the UI can open it while the remaining weeks finish in the background.
async function generateAndSaveRoute(userId, profile) {
  const [brandDna, competitorInsights, projects] = await Promise.all([
    loadBrandDna(userId, profile.username),
    loadCohortCompetitorInsights(userId, profile.username).catch((err) => {
      console.error(`[route] could not load cohort competitor insights for @${profile.username}:`, err.message);
      return null;
    }),
    loadProjectAssets(userId, profile.username).catch((err) => {
      console.error(`[route] could not load projects for plan:`, err.message);
      return [];
    }),
  ]);

  const weekStarts = remainingWeekStarts();
  const month0Start = weekStarts[0];
  const month1Start = firstMondayOfNextMonth(new Date());

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
    }).sort({ weekOf: -1 }).then((route) => ({ route, expectedWeeks: 0 }));
  }
  const monthFocus = week0Plan.focus?.pillar || 'trust';

  // Safe to replace now: drop the scheduled next month and this month onward;
  // weeks that have already started stay as the archive.
  await WeeklyRoute.deleteMany({
    user: userId,
    instagramUsername: profile.username,
    $or: [{ draft: true }, { weekOf: { $gte: month0Start } }],
  });

  const firstWeek = await saveWeek(userId, profile.username, week0Plan, {
    monthKey: monthLabelOf(month0Start),
    monthName: monthNameOf(month0Start),
    monthIndex: 0,
    weekIndex: 0,
    startsAt: month0Start,
    readyAt: addDays(month0Start, -PREP_DAYS),
    draft: false,
  });

  // Rest of the month + next-month stubs continue without blocking the response.
  finishMonthInBackground(userId, profile, {
    brandDna,
    competitorInsights,
    projects,
    weekStarts,
    monthFocus,
    month1Start,
  }).catch((err) => {
    console.error(`[route] background month finish failed for @${profile.username}:`, err.message);
  });

  return { route: firstWeek, expectedWeeks: weekStarts.length };
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
  // Returns as soon as week 0 is ready; remaining weeks fill in the background.
  const { route, expectedWeeks } = await generateAndSaveRoute(req.user._id, profile);
  res.json({
    route,
    expectedWeeks: expectedWeeks || null,
    filling: Boolean(expectedWeeks && expectedWeeks > 1),
  });
}

// Replan a single existing week in place — same Brand DNA, projects, competitor
// cohort, and month focus pillar — without regenerating sibling weeks or
// kicking off a fresh check-in / full-month run.
async function replanWeek(req, res) {
  const existing = await WeeklyRoute.findOne({ _id: req.params.id, user: req.user._id });
  if (!existing) return res.status(404).json({ message: 'Route not found' });
  if (existing.draft) {
    return res.status(400).json({ message: 'This week is still a placeholder — it can’t be replanned yet.' });
  }

  const username = existing.instagramUsername;
  if (!username) {
    return res.status(400).json({ message: 'This plan isn’t tied to an Instagram account.' });
  }

  const active = await currentProfile(req.user._id);
  if (!active || active.username !== username) {
    return res.status(400).json({
      message: `This plan belongs to @${username}. Switch to that account to replan it.`,
    });
  }

  // Prefer the stamped handle’s profile snapshot so the week is grounded in the
  // same account’s posts / analysis that produced the original plan.
  const profile =
    (await InstagramProfile.findOne({ user: req.user._id, username })) || active;

  const [brandDna, competitorInsights, projects] = await Promise.all([
    loadBrandDna(req.user._id, username),
    loadCohortCompetitorInsights(req.user._id, username).catch((err) => {
      console.error(`[route] replan: cohort insights failed for @${username}:`, err.message);
      return null;
    }),
    loadProjectAssets(req.user._id, username).catch((err) => {
      console.error(`[route] replan: projects failed for @${username}:`, err.message);
      return [];
    }),
  ]);

  const weekDate = existing.weekOf || existing.startsAt || mondayOf();
  const focusPillar = existing.focus?.pillar || undefined;

  let plan;
  try {
    plan = await generateWeeklyPlan(profile, brandDna, competitorInsights, projects, {
      weekDate,
      focusPillar,
    });
  } catch (err) {
    console.error(`[route] replan failed for @${username} week ${weekDate}:`, err.message);
    return res.status(502).json({ message: 'Could not replan this week. Please try again in a moment.' });
  }

  // Keep month/schedule stamps; only replace the written week content.
  const route = await saveWeek(req.user._id, username, plan, {
    monthKey: existing.monthKey || monthLabelOf(weekDate),
    monthName: existing.monthName || monthNameOf(weekDate),
    monthIndex: existing.monthIndex ?? 0,
    weekIndex: existing.weekIndex ?? 0,
    startsAt: existing.startsAt || weekDate,
    readyAt: existing.readyAt || addDays(weekDate, -PREP_DAYS),
    draft: false,
  });

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

module.exports = {
  generateAndSaveRoute,
  getCurrentRoute,
  getRoutes,
  generateRoute,
  replanWeek,
  markDayPublished,
  remainingWeekStarts,
  firstMondayOfNextMonth,
};
