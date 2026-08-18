const WeeklyRoute = require('../models/WeeklyRoute');
const BrandAnalysisReport = require('../models/BrandAnalysisReport');
const Project = require('../models/Project');
const InstagramProfile = require('../models/InstagramProfile');
const { generateWeeklyPlan } = require('../services/weeklyPlan');
const { analyzeImageAsset } = require('../services/imageAnalysis');
const { rewriteCaption } = require('../services/captionPolish');
const { loadCompetitorOverviewForUser } = require('./competitorController');
const { currentProfile } = require('../utils/currentProfile');
const { findMetaConnectionForUsername } = require('../services/graphInstagram');

// ── Monthly plan config ──────────────────────────────────────────────────────
// Current calendar month: write only the weeks still ahead (up to 4). Start of
// the month → ~4 weeks; mid-month → fewer. Next calendar month is scheduled as
// locked placeholders (no LLM) and stays non-clickable until a later plan run.
const MAX_WEEKS_PER_MONTH = 4;
const NEXT_MONTH_STUBS = 4;
const PREP_DAYS = 5;

function wantsPromptDebug(req) {
  return String(req.get('x-debug-prompts') || '').trim() === '1';
}
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

// Store weekOf as UTC midnight of the local calendar day so IST-stamped and
// UTC-stamped Mondays of the same date compare equal.
function asUtcDay(date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

// A ± window around that calendar day. An IST midnight (UTC previous evening)
// and a UTC midnight of the same Monday both land inside it.
function weekLookupWindow(date) {
  const mid = asUtcDay(date);
  return {
    start: new Date(mid.getTime() - 18 * 60 * 60 * 1000),
    end: new Date(mid.getTime() + 30 * 60 * 60 * 1000),
  };
}

// 0-based index of this Monday among Mondays that fall in its calendar month
// (1 Aug Sat → first Monday is the 3rd, so 10 Aug is week 1 → "Week 2").
function weekIndexInMonth(weekDate) {
  const monthStart = new Date(weekDate.getFullYear(), weekDate.getMonth(), 1);
  monthStart.setHours(0, 0, 0, 0);
  let first = mondayOf(monthStart);
  if (first < monthStart) first = addDays(first, 7);
  const week = mondayOf(weekDate);
  const diff = Math.round((week.getTime() - first.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return Math.max(0, diff);
}

const monthLabelOf = (date) => `${MONTH_ABBR[date.getMonth()]} ${date.getFullYear()}`;
const monthNameOf = (date) => MONTH_NAMES[date.getMonth()];
// Next pillar after `pillar` in the rotation — the next month's focus.
const nextPillar = (pillar) => {
  const i = PILLAR_ROTATION.indexOf(pillar);
  return PILLAR_ROTATION[(i + 1) % PILLAR_ROTATION.length];
};

/** Human age of a Date for plan-source logs. */
function ageLabel(date) {
  if (!date) return 'unknown age';
  const ms = Date.now() - new Date(date).getTime();
  if (ms < 0) return 'just now';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * Trace where Instagram inputs for a plan come from. Planning always reads the
 * saved InstagramProfile snapshot (it does not live-call Apify/Graph) — so we
 * log the snapshot's origin (`dataSource`) plus whether Meta is connected now.
 */
async function logPlanInstagramSource(userId, profile, trigger = 'generate') {
  const username = profile?.username || '?';
  const origin = profile?.dataSource || 'unknown';
  const posts = Array.isArray(profile?.posts) ? profile.posts.length : 0;
  const hasInsights = Boolean(
    profile?.insights &&
      (profile.insights.reach != null ||
        profile.insights.impressions != null ||
        profile.insights.profileViews != null ||
        profile.insights.views != null),
  );
  let metaConnected = false;
  try {
    metaConnected = Boolean(await findMetaConnectionForUsername(userId, username));
  } catch (err) {
    console.warn(`[route] could not check Meta connection for @${username}:`, err.message);
  }

  // origin = where the saved snapshot was last built; live = Meta link right now.
  const sourceNote =
    origin === 'graph'
      ? 'SAVED snapshot originally from Meta Graph API'
      : origin === 'apify'
        ? 'SAVED snapshot originally from Apify scrape'
        : 'SAVED snapshot (origin unknown — analyze before this field existed)';

  console.log(
    `[route] ${trigger} @${username} · Instagram input: ${sourceNote}` +
      ` · fetched ${ageLabel(profile?.fetchedAt)}` +
      ` · posts=${posts}` +
      ` · graphInsights=${hasInsights ? 'yes' : 'no'}` +
      ` · metaConnectedNow=${metaConnected ? 'yes' : 'no'}` +
      ` · dataSource=${origin}`,
  );

  if (metaConnected && origin !== 'graph') {
    console.log(
      `[route] ${trigger} @${username} · note: Meta is connected but this plan uses an older ` +
        `${origin === 'apify' ? 'Apify' : 'unknown'} snapshot — re-analyze the handle to refresh via Graph`,
    );
  }
}

/**
 * Mondays still left to plan this calendar month, starting from this week's
 * Monday. A week belongs to the month of its Monday, so we take THIS week's
 * Monday plus every later Monday that still falls in `from`'s month — capped at
 * MAX_WEEKS_PER_MONTH. This always reaches the last week of the month (the old
 * `5 - weekOfMonth` heuristic trimmed weeks off the END, so mid-month runs
 * silently dropped the final week).
 */
function remainingWeekStarts(from = new Date()) {
  const start = mondayOf(from);
  const month = from.getMonth();
  const year = from.getFullYear();
  const starts = [];
  let d = new Date(start);
  while (starts.length < MAX_WEEKS_PER_MONTH) {
    // Always include the current week (its Monday can sit in the previous month
    // early in the month); after that, only Mondays still inside this month.
    const inThisMonth = d.getMonth() === month && d.getFullYear() === year;
    if (starts.length === 0 || inThisMonth) {
      starts.push(new Date(d));
      d = addDays(d, 7);
    } else {
      break;
    }
  }
  return starts;
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
// Cap auto-analysis per plan run so a large library doesn't blow up latency/cost
// on a single generation; the rest get analysed on later runs (or on demand).
const MAX_AUTO_ANALYZE = Number(process.env.PLAN_AUTO_ANALYZE_LIMIT) || 16;

// Make sure the project images the planner sees actually carry vision context.
// Any image that has never been analysed is run through the vision model and the
// result is saved back onto the Project — so the planner (and the post UI) can
// match a relevant photo instead of guessing. Bounded and best-effort: one bad
// image or a missing API key never blocks plan generation.
async function ensureProjectImagesAnalyzed(projects) {
  if (!process.env.ANTHROPIC_API_KEY) return;
  let budget = MAX_AUTO_ANALYZE;
  for (const p of projects) {
    if (budget <= 0) break;
    let dirty = false;
    for (const c of p.captures || []) {
      for (const a of c.attachments || []) {
        if (budget <= 0) break;
        if (a.type !== 'image' || !a.key) continue;
        if (a.analysis && a.analysis.status === 'done') continue;
        budget -= 1;
        try {
          // eslint-disable-next-line no-await-in-loop
          const result = await analyzeImageAsset(a.key, { type: a.type });
          a.analysis = { status: 'done', ...result, error: '', analyzedAt: new Date() };
          dirty = true;
        } catch (err) {
          console.error('[route] auto-analyse failed for', a.key, err.message);
          a.analysis = { status: 'error', error: err.message || 'Analysis failed', analyzedAt: new Date() };
          dirty = true;
        }
      }
    }
    if (dirty) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await p.save();
      } catch (err) {
        console.error('[route] could not persist auto-analysis for project', p._id?.toString(), err.message);
      }
    }
  }
}

async function loadProjectAssets(userId, username) {
  const filter = { user: userId };
  // Strict handle match — unscoped / other-account projects must not be planned
  // onto this week, or a switch in the header would keep showing those photos.
  if (username) filter.instagramUsername = username;
  const projects = await Project.find(filter).sort({ updatedAt: -1 }).limit(12);
  // Fill in any missing image analysis before reading the assets back.
  await ensureProjectImagesAnalyzed(projects);
  return projects.map((p) => {
    const notes = [];
    const assets = [];
    for (const c of p.captures || []) {
      if (c.text?.trim()) notes.push(c.text.trim().slice(0, 280));
      for (const a of c.attachments || []) {
        if (a.type === 'image' && a.key) {
          // Fold in the AI image-analysis metadata (see imageAnalysis service) so
          // the planner can pick a genuinely relevant photo per post, not just a
          // random key. Only surface a completed analysis; keep it compact.
          const an = a.analysis && a.analysis.status === 'done' ? a.analysis : null;
          assets.push({
            key: a.key,
            note: (c.text || '').trim().slice(0, 120),
            vision: an
              ? {
                  summary: an.summary || '',
                  subjects: (an.subjects || []).slice(0, 8),
                  tags: (an.tags || []).slice(0, 10),
                  colors: (an.colors || []).slice(0, 6),
                  mood: an.mood || '',
                  text: (an.text || '').slice(0, 120),
                }
              : null,
          });
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

// Persist one week. Match the same calendar Monday even when an older row was
// stamped in a different timezone (exact Date equality would insert a duplicate).
async function saveWeek(userId, username, plan, meta) {
  const usage = plan.usage || {};
  const weekOf = asUtcDay(plan.weekOf);
  const { start, end } = weekLookupWindow(plan.weekOf);
  const payload = {
    user: userId,
    instagramUsername: username,
    weekOf,
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
    startsAt: meta?.startsAt ? asUtcDay(meta.startsAt) : weekOf,
  };
  const existing = await WeeklyRoute.findOne({
    user: userId,
    instagramUsername: username,
    weekOf: { $gte: start, $lt: end },
  }).sort({ generatedAt: -1 });
  if (existing) {
    return WeeklyRoute.findByIdAndUpdate(existing._id, payload, { new: true });
  }
  return WeeklyRoute.create(payload);
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
    usedAssetKeys,
  } = ctx;
  const username = profile.username;

  const weekMeta = (weekDate, draft) => ({
    // Stamp from the week's own start date so Aug/Sep never share a monthKey.
    monthKey: monthLabelOf(weekDate),
    monthName: monthNameOf(weekDate),
    monthIndex: draft ? 1 : 0,
    weekIndex: weekIndexInMonth(weekDate),
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
            usedAssetKeys, // shared across the month so no photo repeats between weeks
          });
          await saveWeek(userId, username, plan, weekMeta(weekDate, false));
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
      }, weekMeta(weekDate, true));
    }),
  );
}

// Generate the rest of this calendar month (dynamic week count) and schedule the
// next month as locked placeholders. Returns week 0 as soon as it's saved so
// the UI can open it while the remaining weeks finish in the background.
async function generateAndSaveRoute(userId, profile, trigger = 'generate') {
  await logPlanInstagramSource(userId, profile, trigger);

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

  console.log(
    `[route] ${trigger} @${profile.username} · context: brandDna=${brandDna ? 'yes' : 'no'}` +
      ` · cohort=${competitorInsights ? 'yes' : 'no'}` +
      ` · projects=${(projects || []).length}`,
  );

  const weekStarts = remainingWeekStarts();
  const month0Start = weekStarts[0];
  const month1Start = firstMondayOfNextMonth(new Date());

  // One shared image-claim set for the whole month: an image assigned to any
  // slide on any day of any week can't be assigned again — no photo repeats
  // within a post or across the monthly plan. Week 0 claims first, then the
  // background weeks claim what's left.
  const usedAssetKeys = new Set();

  // Write week 0 BEFORE clearing the old plan: if the model call fails here, the
  // studio keeps their existing plan rather than losing it to a failed regen.
  let week0Plan;
  try {
    week0Plan = await generateWeeklyPlan(profile, brandDna, competitorInsights, projects, {
      weekDate: month0Start,
      usedAssetKeys,
    });
  } catch (err) {
    console.error(`[route] month0 week 0 generation failed for @${profile.username}:`, err.message);
    return WeeklyRoute.findOne({
      user: userId, instagramUsername: profile.username, draft: false,
    }).sort({ weekOf: -1 }).then((route) => ({ route, expectedWeeks: 0, debug: null }));
  }
  const monthFocus = week0Plan.focus?.pillar || 'trust';

  // Safe to replace now: drop next-month stubs and every week from this Monday
  // onward. A timezone-shifted stamp for "this week" can sit a few hours before
  // local midnight, so the cutoff is the lookup window — not exact equality —
  // or Replan month inserts a second row for the same Monday.
  const cutoff = weekLookupWindow(month0Start).start;
  await WeeklyRoute.deleteMany({
    user: userId,
    instagramUsername: profile.username,
    $or: [
      { draft: true },
      { weekOf: { $gte: cutoff } },
      { startsAt: { $gte: cutoff } },
    ],
  });

  const firstWeek = await saveWeek(userId, profile.username, week0Plan, {
    monthKey: monthLabelOf(month0Start),
    monthName: monthNameOf(month0Start),
    monthIndex: 0,
    weekIndex: weekIndexInMonth(month0Start),
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
    usedAssetKeys,
  }).catch((err) => {
    console.error(`[route] background month finish failed for @${profile.username}:`, err.message);
  });

  return {
    route: firstWeek,
    expectedWeeks: weekStarts.length,
    debug: week0Plan?.debug || null,
  };
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
  const trigger = String(req.body?.trigger || req.query?.trigger || 'generate').slice(0, 64);
  console.log(`[route] POST /routes/generate trigger=${trigger} user=${req.user._id} @${profile.username}`);
  // Returns as soon as week 0 is ready; remaining weeks fill in the background.
  const { route, expectedWeeks, debug } = await generateAndSaveRoute(req.user._id, profile, trigger);
  const out = {
    route,
    expectedWeeks: expectedWeeks || null,
    filling: Boolean(expectedWeeks && expectedWeeks > 1),
    dataSource: profile.dataSource || 'unknown',
    fetchedAt: profile.fetchedAt || null,
  };
  if (wantsPromptDebug(req) && (debug?.agents?.length || debug?.finalPrompt)) out.debug = debug;
  res.json(out);
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

  const trigger = String(req.body?.trigger || req.query?.trigger || 'replan-week').slice(0, 64);
  console.log(`[route] POST /routes/${existing._id}/replan trigger=${trigger} @${username}`);
  await logPlanInstagramSource(req.user._id, profile, trigger);

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

  console.log(
    `[route] ${trigger} @${username} · context: brandDna=${brandDna ? 'yes' : 'no'}` +
      ` · cohort=${competitorInsights ? 'yes' : 'no'}` +
      ` · projects=${(projects || []).length}`,
  );

  const weekDate = existing.weekOf || existing.startsAt || mondayOf();
  const focusPillar = existing.focus?.pillar || undefined;

  // Seed the image-claim set with photos the *other* weeks of this month already
  // use, so a replanned week doesn't reuse an image that's live elsewhere in the
  // monthly plan. The week being replanned is excluded (its own images are freed).
  const usedAssetKeys = new Set();
  if (existing.monthKey) {
    const siblings = await WeeklyRoute.find({
      user: req.user._id,
      instagramUsername: username,
      monthKey: existing.monthKey,
      draft: false,
      _id: { $ne: existing._id },
    });
    for (const s of siblings) {
      for (const d of s.days || []) {
        for (const sl of d.content?.slides || []) {
          if (sl.assetKey) usedAssetKeys.add(sl.assetKey);
        }
      }
    }
  }

  let plan;
  try {
    plan = await generateWeeklyPlan(profile, brandDna, competitorInsights, projects, {
      weekDate,
      focusPillar,
      usedAssetKeys,
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

  const out = { route };
  if (wantsPromptDebug(req) && (plan?.debug?.agents?.length || plan?.debug?.finalPrompt)) {
    out.debug = plan.debug;
  }
  res.json(out);
}

async function markDayPublished(req, res) {
  const index = Number(req.params.index);
  const route = await WeeklyRoute.findOne({ _id: req.params.id, user: req.user._id });
  if (!route) return res.status(404).json({ message: 'Route not found' });
  if (!route.days[index]) return res.status(404).json({ message: 'Day not found' });

  const day = route.days[index];

  if (req.body.published !== undefined) {
    day.published = Boolean(req.body.published);
    // A post that has gone out is no longer "scheduled" — the schedule was its
    // way of getting there, and it has arrived.
    if (day.published) day.scheduledAt = null;
  } else if (
    req.body.content === undefined &&
    req.body.slides === undefined &&
    req.body.scheduledAt === undefined &&
    req.body.time === undefined &&
    req.body.postAtPref === undefined
  ) {
    // Legacy toggle when the body is empty / only flipping publish.
    day.published = !day.published;
  }

  // The studio's chosen publish time for this post (a 24h "HH:MM" string, or ''
  // to fall back to the plan's / default time).
  if (req.body.time !== undefined) {
    day.time = String(req.body.time || '');
  }

  // The plan's weekly posting-time preference ("Use this time every week").
  // Lives on the route, not the day, so every post reads it unless it sets its
  // own time.
  if (req.body.postAtPref !== undefined) {
    route.postAtPref = String(req.body.postAtPref || '');
  }

  // Schedule / unschedule this post. `null` (or empty) clears it; a valid date
  // string sets it. Scheduling never touches `published` — a scheduled post is
  // a decision about the future, not one that has happened.
  if (req.body.scheduledAt !== undefined) {
    if (req.body.scheduledAt === null || req.body.scheduledAt === '') {
      day.scheduledAt = null;
    } else {
      const at = new Date(req.body.scheduledAt);
      if (!Number.isNaN(at.getTime())) day.scheduledAt = at;
    }
  }

  // Persist slide / caption edits from the studio editor.
  if (req.body.content && typeof req.body.content === 'object') {
    const incoming = req.body.content;
    const cur = day.content || {};
    if (Array.isArray(incoming.slides)) {
      // Preserve the plan-written supporting line and the context-rich base
      // image prompt across edits — a layout/title/image change must not wipe
      // them. Fall back to the existing slide at the same position when the
      // client omits either field.
      const prevSlides = Array.isArray(cur.slides) ? cur.slides : [];
      cur.slides = incoming.slides.map((s, i) => {
        const prev = prevSlides[i] || {};
        return {
          role: String(s.role || ''),
          title: String(s.title || ''),
          subtitle: String(s.subtitle ?? prev.subtitle ?? ''),
          imagePrompt: String(s.imagePrompt ?? prev.imagePrompt ?? ''),
          assetKey: String(s.assetKey || ''),
          assetKeys: Array.isArray(s.assetKeys)
            ? s.assetKeys.map((k) => String(k || ''))
            : (Array.isArray(prev.assetKeys) ? prev.assetKeys.map((k) => String(k || '')) : []),
          layout: String(s.layout || ''),
        };
      });
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

// POST /routes/:id/day/:index/polish-caption
// Rewrite the day's caption with Claude (preferred) or OpenAI. Returns the
// draft only — the studio still has to press Done to persist it.
async function polishCaption(req, res) {
  const index = Number(req.params.index);
  const route = await WeeklyRoute.findOne({ _id: req.params.id, user: req.user._id });
  if (!route) return res.status(404).json({ message: 'Route not found' });
  if (!route.days[index]) return res.status(404).json({ message: 'Day not found' });

  const day = route.days[index];
  const instruction = String(req.body?.instruction || '').trim();
  const kind = req.body?.kind === 'words' ? 'words' : 'caption';
  const caption = req.body?.caption !== undefined
    ? String(req.body.caption)
    : String(day.content?.caption || '');

  const dna = await loadBrandDna(req.user._id, route.instagramUsername);
  try {
    const result = await rewriteCaption({
      caption,
      instruction,
      kind,
      context: {
        handle: route.instagramUsername,
        pillar: day.pillar,
        format: day.format,
        focus: route.focus?.headline,
        direction: day.direction,
        strategy: day.content?.strategy,
        voice: dna?.howYouSound,
        role: req.body?.role ? String(req.body.role) : undefined,
        fills: Array.isArray(req.body?.fills) ? req.body.fills : undefined,
      },
    });
    if (result.unchanged) {
      return res.json({
        caption: result.caption,
        unchanged: true,
        message: kind === 'words'
          ? 'That would leave the text exactly as it is.'
          : 'That would leave the caption exactly as it is.',
        model: result.model,
        ...(wantsPromptDebug(req) ? {
          debug: { finalPrompt: result.finalPrompt, systemPrompt: result.systemPrompt, model: result.model },
        } : {}),
      });
    }
    return res.json({
      caption: result.caption,
      model: result.model,
      ...(wantsPromptDebug(req) ? {
        debug: { finalPrompt: result.finalPrompt, systemPrompt: result.systemPrompt, model: result.model },
      } : {}),
    });
  } catch (err) {
    const status = err.status || 502;
    console.error('[route] caption polish failed:', err.message);
    return res.status(status).json({ message: err.message || 'Could not rewrite the caption.' });
  }
}

module.exports = {
  generateAndSaveRoute,
  getCurrentRoute,
  getRoutes,
  generateRoute,
  replanWeek,
  markDayPublished,
  polishCaption,
  remainingWeekStarts,
  firstMondayOfNextMonth,
};
