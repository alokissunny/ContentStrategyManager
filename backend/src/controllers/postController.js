const mongoose = require('mongoose');
const PlannedPost = require('../models/PlannedPost');
const Project = require('../models/Project');
const InstagramProfile = require('../models/InstagramProfile');
const { brandKitColors, brandStylePalette } = require('../services/brandKitColors');
const { generateWeeklyPlan, buildEmptySlots, isoDate, parseIsoDate } = require('../services/weeklyPlan');
const { rewriteCaption } = require('../services/captionPolish');
const { refineCarouselFromEdits } = require('../services/carouselRefine');
const { addSlideToCarousel } = require('../services/addSlideAgent');
const { runLayoutForPost, writeLayoutVariations, applyLayoutToContent, normalizeWriterPost, attachGeneratedVisuals, visualThemeOf } = require('../services/planOrchestrator');
const { loadReferenceImage } = require('../services/imageAnalysis');
const { decorativeDebugAgents } = require('../services/decorativeAgent');
const { themeById, themeImageOf } = require('../data/carouselThemes');
const { copyFromLayoutHtml, injectImageIntoSlots, parseCarouselDocument } = require('../services/layoutHtml');
const { applySlideTheme } = require('../services/themeMerge');
const { compileBrandMemory } = require('../services/planContext');
const { generateCoverSpec, renderCoverVideo } = require('../services/carouselCoverAgent');
const { isS3Configured, uploadBytes, getMediaUrl, getObjectBytes } = require('../services/s3Client');
const { applyThemeToSlide, themedSlideDocument } = require('../services/themeApplyAgent');
const { isImageGenConfigured } = require('../services/openaiImage');
const { toVisionImage } = require('../services/visionImage');
const { currentProfile } = require('../utils/currentProfile');
const { ownedMediaKeys, clearScheduleFields } = require('../services/metaPublish');
const {
  logPlanInstagramSource,
  loadCohortCompetitorInsights,
  loadBrandDna,
  loadProjectAssets,
  collectUsedAssetKeys,
} = require('../services/planInputs');

// A handle analyzed this recently is assumed to still be running its background
// discovery → analysis → plan chain.
const REGENERATING_WINDOW_MS = 15 * 60 * 1000;

const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d; };
const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

function wantsPromptDebug(req) {
  return String(req.get('x-debug-prompts') || '').trim() === '1';
}
function optionalText(value) {
  return typeof value === 'string' ? value.trim() : '';
}
// The run that last touched this post and the agents it ran — the post's Debug
// tab shows only these, so a section left over from an older run (a Visual
// trace from generation after a Fix layout, …) never reads as current.
function lastRunOf(kind, agents = []) {
  return { kind, at: new Date().toISOString(), agents: agents.filter(Boolean) };
}

function plainOf(value) {
  if (value == null) return value;
  if (typeof value.toObject === 'function') return value.toObject();
  try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
}

// ── Publishing-day rule ───────────────────────────────────────────────────
// The profile's `publishing` field is the single source of truth for which
// weekdays new posts may be allocated onto. Reading it here (not from the request)
// means the rule governs EVERY allocation path — capture, month-fill, any client,
// stale bundle or not — instead of relying on the frontend to resend it each time.
const DEFAULT_PUBLISH_DAYS = [0, 2, 4]; // Mon / Wed / Fri

function sanitizeWeekdays(list) {
  return Array.isArray(list)
    ? [...new Set(list.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : [];
}

// The Monday-indexed weekdays new posts may land on, or null for no restriction.
// 'weekly' (even spread) carries no weekday gate into the fill.
function allowedWeekdaysFor(profile) {
  const pub = profile?.publishing || {};
  if (pub.mode === 'weekly') return null;
  const days = sanitizeWeekdays(pub.days);
  return days.length ? days : DEFAULT_PUBLISH_DAYS;
}

function readPublishingRule(profile) {
  const pub = profile?.publishing || {};
  const mode = pub.mode === 'weekly' ? 'weekly' : 'days';
  const days = sanitizeWeekdays(pub.days);
  return { mode, days: days.length ? days : DEFAULT_PUBLISH_DAYS };
}

// ── Generation ──────────────────────────────────────────────────────────────
// Fill empty calendar slots with fresh posts. The planner is unchanged — it
// still produces days assigned to the empty dates — but here each returned day
// is saved as its own PlannedPost. No month/week grouping, no focus/funnel
// persisted, no next-month stubs. Smarter placement is a future schedule agent.

// One generated plan-day → a PlannedPost document (insert payload).
function dayToPostDoc(userId, username, d, plan, perPostUsage) {
  return {
    user: userId,
    instagramUsername: username,
    date: String(d.date || ''), // "YYYY-MM-DD" — a calendar day, not a Date
    day: d.day || '',
    dateLabel: d.dateLabel || '',
    time: d.time || '',
    format: d.format || 'Post',
    contentType: d.contentType || '',
    pillar: d.pillar || 'discovery',
    goalTag: d.goalTag || '',
    title: d.title || '',
    direction: d.direction || '',
    published: false,
    content: plainOf(d.content) || {},
    agentTrace: d.agentTrace ? {
      ...plainOf(d.agentTrace),
      lastRun: lastRunOf('generate', ['strategy', 'structure', 'dayWriter', 'carousel', d.agentTrace.visual ? 'visual' : '']),
    } : null,
    model: plan.model || '',
    generatedAt: new Date(),
    usage: perPostUsage,
  };
}

async function generateAndSavePosts(userId, profile, trigger = 'generate', planSource = {}) {
  await logPlanInstagramSource(userId, profile, trigger);

  const [brandDna, competitorInsights, projects] = await Promise.all([
    loadBrandDna(userId, profile.username),
    loadCohortCompetitorInsights(userId, profile.username).catch((err) => {
      console.error(`[posts] could not load cohort competitor insights for @${profile.username}:`, err.message);
      return null;
    }),
    loadProjectAssets(userId, profile.username).catch((err) => {
      console.error('[posts] could not load projects for plan:', err.message);
      return [];
    }),
  ]);

  const today = startOfDay();
  const todayIso = isoDate(today);
  // Occupancy = every upcoming post already on this handle's calendar. `date`
  // is a "YYYY-MM-DD" string, so a lexicographic >= today's iso is chronological.
  const existingPosts = await PlannedPost.find({
    user: userId,
    instagramUsername: profile.username,
    date: { $gte: todayIso },
  }).select('date content.slides.assetKey').lean();
  const emptySlots = buildEmptySlots({
    fromDate: today,
    occupiedDates: existingPosts.map((p) => p.date),
    allowedWeekdays: planSource.allowedWeekdays || null,
  });
  const usedAssetKeys = collectUsedAssetKeys(existingPosts);

  console.log(
    `[posts] ${trigger} @${profile.username} · context: brandDna=${brandDna ? 'yes' : 'no'}` +
      ` · cohort=${competitorInsights ? 'yes' : 'no'}` +
      ` · projects=${(projects || []).length}` +
      ` · ${emptySlots.occupied.length} occupied / ${emptySlots.emptyDates.length} empty slots` +
      (planSource.sessionId ? ` · session=${planSource.sessionId}` : ''),
  );

  let plan;
  try {
    plan = await generateWeeklyPlan(profile, brandDna, competitorInsights, projects, {
      weekDate: today,
      usedAssetKeys,
      monthCalendar: emptySlots,
      sessionId: planSource.sessionId || '',
      captureIds: planSource.captureIds || [],
      userId,
    });
  } catch (err) {
    console.error(`[posts] slot fill failed for @${profile.username}:`, err.message);
    return { posts: [], count: 0, debug: null, emptyReason: 'We couldn’t build posts just now. Please try again.' };
  }

  const days = (plan.days || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d.date || '')));
  if (!days.length) {
    const emptyReason = String(plan.constraints?.insufficientContext || '').trim()
      || 'No posts could be built from this conversation.';
    // NOT a failure — the strategist judged the capture too thin to plan from and
    // asked for more. `needsInput` lets the client show a friendly prompt/CTA
    // rather than a red error (see planGeneration.js).
    return { posts: [], count: 0, debug: plan.debug || null, emptyReason, needsInput: true };
  }

  // Split the run's LLM usage evenly across the posts it produced (display only).
  const u = plan.usage || {};
  const n = days.length;
  const perPostUsage = {
    inputTokens: Math.round((Number(u.inputTokens) || 0) / n),
    outputTokens: Math.round((Number(u.outputTokens) || 0) / n),
    totalTokens: Math.round((Number(u.totalTokens) || 0) / n),
    estimatedCostUsd: (Number(u.estimatedCostUsd) || 0) / n,
    elapsedMs: Number(u.elapsedMs) || 0,
    model: u.model || plan.model || '',
  };

  const docs = days.map((d) => dayToPostDoc(userId, profile.username, d, plan, perPostUsage));

  // Insert only onto empty slots. The unique (user, handle, date) index makes a
  // collision with an already-occupied date a no-op duplicate error, which we
  // swallow — existing posts are never overwritten.
  let saved = [];
  try {
    saved = await PlannedPost.insertMany(docs, { ordered: false });
  } catch (err) {
    if (err && Array.isArray(err.insertedDocs)) {
      saved = err.insertedDocs;
      const dups = (err.writeErrors || []).length;
      if (dups) console.log(`[posts] ${trigger} @${profile.username}: skipped ${dups} already-occupied slot(s)`);
    } else {
      console.error(`[posts] insert failed for @${profile.username}:`, err.message);
      throw err;
    }
  }

  console.log(`[posts] ${trigger} @${profile.username}: saved ${saved.length} post(s)`);
  return { posts: saved, count: saved.length, debug: plan.debug || null, emptyReason: '' };
}

// ── Read endpoints ────────────────────────────────────────────────────────
// GET /posts — calendar list for the current handle. Heavy content + trace are
// projected out (fetched per-post on open), same speedup as the old getRoutes.
// `date` is a "YYYY-MM-DD" string, so a lexicographic bound is chronological and
// stays covered by the { user, instagramUsername, date } index. Anything that is
// not a well-formed date is ignored, leaving that side of the range open.
function isoBound(value) {
  const s = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

async function getPosts(req, res) {
  const profile = await currentProfile(req.user._id).select('username fetchedAt').lean();
  if (!profile) return res.json({ posts: [], username: null, preparing: false });

  // Optional date window keeps the payload bounded as a handle's history grows —
  // the calendar sends the range it is showing (plus buffer) and widens on
  // navigation. No `from`/`to` = the full list (backward compatible).
  const from = isoBound(req.query.from);
  const to = isoBound(req.query.to);
  const query = { user: req.user._id, instagramUsername: profile.username };
  if (from || to) {
    query.date = {};
    if (from) query.date.$gte = from;
    if (to) query.date.$lte = to;
  }

  const posts = await PlannedPost.find(query)
    .sort({ date: 1 }).select('-content -agentTrace').lean();

  const preparing =
    !posts.length && Date.now() - new Date(profile.fetchedAt).getTime() < REGENERATING_WINDOW_MS;

  res.json({ posts, username: profile.username, preparing });
}

// GET /posts/:id — render payload for the post editor: content WITHOUT the two
// heavy blobs (agentTrace debug-only; slides.layoutOptions fetched on demand).
async function getPostById(req, res) {
  const post = await PlannedPost.findOne({ _id: req.params.id, user: req.user._id })
    .select('-agentTrace -content.slides.layoutOptions').lean();
  if (!post) return res.status(404).json({ message: 'Post not found' });
  res.json({ post });
  // the slides' display copies (light WebP) made ahead of the first look
  const keys = (post.content?.slides || []).flatMap((sl) => [
    ...(Array.isArray(sl?.assetKeys) ? sl.assetKeys : []), sl?.assetKey, sl?.image?.key, sl?.visual?.assetKey,
  ]);
  const inDoc = String(post.content?.carouselHtml || '').match(/projects\/[a-f0-9]{24}\/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp|gif|hei[cf])/gi) || [];
  require('./mediaController').warmDisplayCopies([...keys, ...inDoc].flatMap((k) => String(k || '').split(',')));
}

// GET /posts/:id/options — this post's stored layoutOptions per slide.
async function getPostOptions(req, res) {
  const post = await PlannedPost.findOne({ _id: req.params.id, user: req.user._id })
    .select('content.slides.layoutOptions').lean();
  if (!post) return res.status(404).json({ message: 'Post not found' });
  const slides = (post.content?.slides || []).map((s, i) => ({
    index: Number(s?.index) > 0 ? Number(s.index) : i + 1,
    layoutOptions: Array.isArray(s?.layoutOptions) ? s.layoutOptions : [],
  }));
  res.json({ slides });
}

// GET /posts/:id/debug — the raw agent trace for the post's Debug Preview.
async function getPostDebug(req, res) {
  const post = await PlannedPost.findOne({ _id: req.params.id, user: req.user._id })
    .select('agentTrace').lean();
  if (!post) return res.status(404).json({ message: 'Not found' });
  res.json({ agentTrace: post.agentTrace || {} });
}

// POST /posts/generate — fill empty calendar slots for the current handle.
async function generatePlan(req, res) {
  const profile = await currentProfile(req.user._id);
  if (!profile) {
    return res.status(404).json({
      message: 'No Instagram profile found. Connect and analyze a handle before generating posts.',
    });
  }
  const trigger = String(req.body?.trigger || req.query?.trigger || 'generate').slice(0, 64);
  const sessionId = String(req.body?.sessionId || '').trim();
  const captureIds = Array.isArray(req.body?.captureIds)
    ? req.body.captureIds.map((id) => String(id || '').trim()).filter(Boolean).slice(0, 24)
    : [];
  // The profile's saved publishing rule governs allocation. If the client sent an
  // explicit distribution (Distribute panel / generate), adopt it as the new rule
  // so the change takes effect now AND persists for every future allocation — the
  // frontend no longer has to resend it, and a stale client can't override it.
  const bodyMode = req.body?.mode === 'weekly' ? 'weekly' : (req.body?.mode === 'days' ? 'days' : '');
  const bodyDays = Array.isArray(req.body?.days) ? sanitizeWeekdays(req.body.days) : null;
  if (bodyMode || bodyDays) {
    profile.publishing = {
      mode: bodyMode || profile.publishing?.mode || 'days',
      days: (bodyDays && bodyDays.length) ? bodyDays : (sanitizeWeekdays(profile.publishing?.days).length
        ? sanitizeWeekdays(profile.publishing.days) : DEFAULT_PUBLISH_DAYS),
    };
    await profile.save().catch((e) => console.error('[posts] could not persist publishing rule:', e.message));
  }
  const allowedWeekdays = allowedWeekdaysFor(profile);
  const pubRule = readPublishingRule(profile);
  console.log(`[posts] POST /posts/generate trigger=${trigger} user=${req.user._id} @${profile.username}` +
    (sessionId ? ` session=${sessionId}` : '') +
    ` publish=${pubRule.mode}${allowedWeekdays ? `[${allowedWeekdays.join(',')}]` : '(any day)'}`);

  const { posts, count, debug, emptyReason, needsInput } = await generateAndSavePosts(req.user._id, profile, trigger, {
    sessionId,
    captureIds,
    allowedWeekdays,
  });
  if (emptyReason && !count) {
    const out = { message: emptyReason };
    // a soft "needs more context" result, not a failure — the client shows a
    // friendly prompt/CTA instead of an error banner
    if (needsInput) out.needsInput = true;
    if (wantsPromptDebug(req) && (debug?.agents?.length || debug?.finalPrompt)) out.debug = debug;
    return res.status(422).json(out);
  }
  // Captures page: the captures this plan was written from are now "used".
  const usedIds = captureIds.filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id));
  if (count && usedIds.length) {
    await Project.updateMany(
      { user: req.user._id, 'captures._id': { $in: usedIds } },
      {
        $set: { 'captures.$[c].usedInPlanAt': new Date() },
        // the posts it went into (Captures shows their days); another plan adds
        $addToSet: { 'captures.$[c].usedInPosts': { $each: posts.map((p) => p._id).filter(Boolean) } },
      },
      { arrayFilters: [{ 'c._id': { $in: usedIds } }] },
    ).catch((e) => console.error('[posts] could not mark captures used:', e.message));
  }
  const out = {
    posts,
    count,
    dataSource: profile.dataSource || 'unknown',
    fetchedAt: profile.fetchedAt || null,
  };
  if (wantsPromptDebug(req) && (debug?.agents?.length || debug?.finalPrompt)) out.debug = debug;
  res.json(out);
}

// DELETE /posts — clear the full calendar for the current handle: every
// unpublished planned post, any date. Already-published posts stay.
async function clearUpcoming(req, res) {
  const profile = await currentProfile(req.user._id);
  if (!profile) return res.status(404).json({ message: 'No Instagram profile found.' });

  const result = await PlannedPost.deleteMany({
    user: req.user._id,
    instagramUsername: profile.username,
    published: { $ne: true },
  });
  console.log(`[posts] clear-calendar @${profile.username} · deleted=${result.deletedCount}`);
  res.json({ deleted: result.deletedCount });
}

// DELETE /posts/:id — remove one post from the calendar (Calendar › day menu ›
// Remove post). The day stays in the plan with nothing on it.
async function deletePost(req, res) {
  const record = await PlannedPost.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!record) return res.status(404).json({ message: 'Post not found' });
  console.log(`[posts] removed ${req.params.id} (${String(record.date || '').slice(0, 10)})`);
  res.json({ deleted: 1, id: String(record._id) });
}

// GET /posts/distribution — the current handle's saved publishing-day rule.
async function getDistribution(req, res) {
  const profile = await currentProfile(req.user._id).select('publishing username').lean();
  if (!profile) return res.status(404).json({ message: 'No Instagram profile found.' });
  res.json(readPublishingRule(profile));
}

// PUT /posts/distribution — save the publishing-day rule for the current handle.
async function setDistribution(req, res) {
  const profile = await currentProfile(req.user._id);
  if (!profile) return res.status(404).json({ message: 'No Instagram profile found.' });
  const mode = req.body?.mode === 'weekly' ? 'weekly' : 'days';
  const days = sanitizeWeekdays(req.body?.days);
  profile.publishing = {
    mode,
    days: days.length ? days : (sanitizeWeekdays(profile.publishing?.days).length
      ? sanitizeWeekdays(profile.publishing.days) : DEFAULT_PUBLISH_DAYS),
  };
  await profile.save();
  console.log(`[posts] set publishing rule @${profile.username} · ${mode}[${profile.publishing.days.join(',')}]`);
  res.json(readPublishingRule(profile));
}

// ── Distribute posts ────────────────────────────────────────────────────────
// Reallocate the upcoming, movable posts onto the studio's chosen publishing
// weekdays. "Movable" = strictly after today, not published, not scheduled, not
// held for review — history and promises stay where they are. The posts keep
// their order (oldest first) and take the pattern's free days from tomorrow
// forward, one per day, skipping any date a kept post already holds.
const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const mondayIndexOf = (d) => (d.getDay() + 6) % 7;

// how many whole weeks this month still has in it — the denominator "Spread
// weekly" divides by.
function weeksLeftInMonth(today) {
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const c = new Date(today);
  c.setHours(0, 0, 0, 0);
  c.setDate(c.getDate() - mondayIndexOf(c)); // Monday of this week
  let n = 0;
  while (c <= last) { n += 1; c.setDate(c.getDate() + 7); }
  return Math.max(1, n);
}

// the weekday pattern an even spread produces: how many posts a week (count ÷
// weeks, rounded up), then those weekdays from Monday outward.
function weeklyPatternDays(count, weeks) {
  const perWeek = Math.max(1, Math.min(7, Math.ceil(Math.max(1, count) / Math.max(1, weeks))));
  return Array.from({ length: perWeek }, (_, i) => Math.floor((i * 7) / perWeek));
}

async function distributePosts(req, res) {
  const profile = await currentProfile(req.user._id).select('username').lean();
  if (!profile) return res.status(404).json({ message: 'No Instagram profile found.' });
  const handle = profile.username;

  const mode = req.body?.mode === 'weekly' ? 'weekly' : 'days';
  const chosen = sanitizeWeekdays(req.body?.days);

  // Distributing also SETS the rule for future allocation: the weekdays chosen
  // here are the ones new posts will land on from now on.
  const pubSet = mode === 'days' && chosen.length
    ? { 'publishing.mode': 'days', 'publishing.days': chosen }
    : { 'publishing.mode': mode };
  await InstagramProfile.updateOne({ _id: profile._id }, { $set: pubSet })
    .catch((e) => console.error('[posts] could not persist publishing rule on distribute:', e.message));

  const today = startOfDay();
  const todayIso = isoDate(today);

  const all = await PlannedPost.find({ user: req.user._id, instagramUsername: handle })
    .select('date published scheduledAt savedForReview title format').lean();

  // Movable: strictly after today, not locked, and actually a post.
  const movable = all
    .filter((p) => p.date > todayIso
      && !p.published && !p.scheduledAt && !p.savedForReview
      && (String(p.title || '').trim() || String(p.format || '').trim()))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const respond = async (moved) => {
    const posts = await PlannedPost.find({ user: req.user._id, instagramUsername: handle })
      .sort({ date: 1 }).select('-content -agentTrace').lean();
    res.json({ posts, moved });
  };

  if (!movable.length) return respond(0);

  // Dates spoken for by posts that stay put — targets must avoid them.
  const movableIds = new Set(movable.map((p) => String(p._id)));
  const keepDates = new Set(all.filter((p) => !movableIds.has(String(p._id))).map((p) => p.date));

  const patternDays = mode === 'weekly'
    ? new Set(weeklyPatternDays(movable.length, weeksLeftInMonth(today)))
    : new Set(chosen.length ? chosen : [0, 2, 4]);

  // Walk forward from tomorrow, collecting the pattern's free days in order.
  const targets = [];
  const cursor = new Date(today);
  cursor.setDate(cursor.getDate() + 1);
  for (let i = 0; i < 800 && targets.length < movable.length; i += 1) {
    const iso = isoDate(cursor);
    if (patternDays.has(mondayIndexOf(cursor)) && !keepDates.has(iso)) {
      targets.push({ iso, wd: mondayIndexOf(cursor) });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  if (targets.length < movable.length) {
    return res.status(400).json({ message: 'Not enough room to distribute all posts onto those days.' });
  }

  // Already where the pattern wants them — nothing to write.
  if (movable.every((p, i) => p.date === targets[i].iso)) return respond(0);

  const monthShort = (iso) => {
    const d = parseIsoDate(iso);
    return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  };

  // Two-phase write so the unique (user, handle, date) index never collides: a
  // target may be another movable post's current date, so first park them all on
  // throwaway dates, then set the finals (which are distinct and avoid kept days).
  const parkOps = movable.map((p, i) => ({
    updateOne: { filter: { _id: p._id }, update: { $set: { date: `0000-00-${String(i).padStart(4, '0')}` } } },
  }));
  const finalOps = movable.map((p, i) => ({
    updateOne: {
      filter: { _id: p._id },
      update: { $set: { date: targets[i].iso, day: WEEKDAY_LONG[targets[i].wd], dateLabel: monthShort(targets[i].iso) } },
    },
  }));
  await PlannedPost.bulkWrite(parkOps, { ordered: false });
  await PlannedPost.bulkWrite(finalOps, { ordered: false });

  console.log(`[posts] distribute @${handle} · mode=${mode} · moved=${movable.length}`);
  return respond(movable.length);
}

// ── Shift posts ─────────────────────────────────────────────────────────────
// Apply a client-proposed date map (from the month calendar's Shift posts flow).
// Same two-phase write as distribute so the unique (user, handle, date) index
// never collides. Published posts are refused; scheduled posts keep their
// clock shifted by the day delta when they are included in the map.
async function shiftPosts(req, res) {
  const profile = await currentProfile(req.user._id).select('username').lean();
  if (!profile) return res.status(404).json({ message: 'No Instagram profile found.' });
  const handle = profile.username;

  const moves = req.body?.moves;
  if (!moves || typeof moves !== 'object' || Array.isArray(moves)) {
    return res.status(400).json({ message: 'Send a map of post id → YYYY-MM-DD date.' });
  }

  const entries = Object.entries(moves)
    .map(([id, date]) => ({ id: String(id), date: String(date || '').slice(0, 10) }))
    .filter((e) => e.id && /^\d{4}-\d{2}-\d{2}$/.test(e.date));
  if (!entries.length) {
    return res.status(400).json({ message: 'No valid moves to apply.' });
  }

  const ids = entries.map((e) => e.id);
  const posts = await PlannedPost.find({
    _id: { $in: ids },
    user: req.user._id,
    instagramUsername: handle,
  });
  if (posts.length !== ids.length) {
    return res.status(404).json({ message: 'One or more posts could not be found.' });
  }

  const byId = new Map(posts.map((p) => [String(p._id), p]));
  for (const e of entries) {
    const p = byId.get(e.id);
    if (p.published) {
      return res.status(400).json({ message: 'Published posts stay where they are.' });
    }
  }

  /* Destination uniqueness among the moves themselves */
  const dests = entries.map((e) => e.date);
  if (new Set(dests).size !== dests.length) {
    return res.status(400).json({ message: 'Two posts cannot land on the same day.' });
  }

  /* Destinations must not collide with posts outside the move set */
  const others = await PlannedPost.find({
    user: req.user._id,
    instagramUsername: handle,
    _id: { $nin: ids },
    date: { $in: dests },
  }).select('_id date').lean();
  if (others.length) {
    return res.status(400).json({
      message: 'That day already has a post that is not part of this move.',
    });
  }

  const monthShort = (iso) => {
    const d = parseIsoDate(iso);
    return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  };

  const parkOps = entries.map((e, i) => ({
    updateOne: {
      filter: { _id: e.id, user: req.user._id },
      update: { $set: { date: `0000-00-${String(i).padStart(4, '0')}` } },
    },
  }));

  const finalOps = entries.map((e) => {
    const p = byId.get(e.id);
    const from = String(p.date || '').slice(0, 10);
    const to = e.date;
    const wd = mondayIndexOf(parseIsoDate(to) || new Date());
    const $set = {
      date: to,
      day: WEEKDAY_LONG[wd],
      dateLabel: monthShort(to),
    };
    /* Keep the clock on the new day when a scheduled post travels with the run */
    if (p.scheduledAt) {
      const fromD = parseIsoDate(from);
      const toD = parseIsoDate(to);
      if (fromD && toD) {
        const delta = Math.round((toD - fromD) / 86400000);
        const at = new Date(p.scheduledAt);
        at.setDate(at.getDate() + delta);
        $set.scheduledAt = at;
      }
    }
    return {
      updateOne: {
        filter: { _id: e.id, user: req.user._id },
        update: { $set },
      },
    };
  });

  await PlannedPost.bulkWrite(parkOps, { ordered: false });
  await PlannedPost.bulkWrite(finalOps, { ordered: false });

  const refreshed = await PlannedPost.find({ user: req.user._id, instagramUsername: handle })
    .sort({ date: 1 }).select('-content -agentTrace').lean();
  console.log(`[posts] shift @${handle} · moved=${entries.length}`);
  return res.json({ posts: refreshed, moved: entries.length });
}

// ── Content merge (preserves plan-written fields across studio edits) ────────
function mergeSlides(incomingSlides, prevSlides) {
  const prev = Array.isArray(prevSlides) ? prevSlides : [];
  return incomingSlides.map((s, i) => {
    const p = prev[i] || {};
    const list = (v, fallback) => (Array.isArray(v) ? v.map((x) => String(x || '')) : fallback);
    const blank = Boolean(s.blank) || String(s.layout || '') === 'blank';
    const manual = !blank && (Boolean(s.manual) || String(s.layout || '').startsWith('el-'));
    return {
      role: String(s.role || ''),
      colorSet: String(s.colorSet ?? p.colorSet ?? ''),
      colorSetAt: Number(s.colorSetAt ?? p.colorSetAt ?? 0) || 0,
      themeRegions: s.themeRegions ?? p.themeRegions ?? null,
      ground: String(s.ground ?? p.ground ?? ''),
      logoMark: String(s.logoMark ?? p.logoMark ?? ''),
      title: String(s.title || ''),
      subtitle: (blank || manual) ? String(s.subtitle || '') : String(s.subtitle ?? p.subtitle ?? ''),
      body: (blank || manual) ? String(s.body || '') : String(s.body ?? p.body ?? ''),
      structure: blank ? String(s.structure || '') : String(s.structure ?? p.structure ?? ''),
      items: blank ? list(s.items, []) : list(s.items, Array.isArray(p.items) ? p.items : []),
      itemsA: blank ? list(s.itemsA, []) : list(s.itemsA, Array.isArray(p.itemsA) ? p.itemsA : []),
      itemsB: blank ? list(s.itemsB, []) : list(s.itemsB, Array.isArray(p.itemsB) ? p.itemsB : []),
      stat: (blank || manual) ? String(s.stat || '') : String(s.stat ?? p.stat ?? ''),
      quote: (blank || manual) ? String(s.quote || '') : String(s.quote ?? p.quote ?? ''),
      action: blank ? String(s.action || '') : String(s.action ?? p.action ?? ''),
      comparisonA: blank ? String(s.comparisonA || '') : String(s.comparisonA ?? p.comparisonA ?? ''),
      comparisonB: blank ? String(s.comparisonB || '') : String(s.comparisonB ?? p.comparisonB ?? ''),
      labels: blank ? list(s.labels, []) : list(s.labels, Array.isArray(p.labels) ? p.labels : []),
      image: (blank || manual) ? String(s.image || '') : String(s.image ?? p.image ?? ''),
      imagePrompt: blank ? String(s.imagePrompt || '') : String(s.imagePrompt ?? p.imagePrompt ?? ''),
      assetKey: String(s.assetKey || ''),
      assetKeys: Array.isArray(s.assetKeys)
        ? s.assetKeys.map((k) => String(k || ''))
        : ((blank || manual) ? [] : (Array.isArray(p.assetKeys) ? p.assetKeys.map((k) => String(k || '')) : [])),
      layout: blank ? 'blank' : String(s.layout || ''),
      layoutHtml: (blank || manual) ? String(s.layoutHtml || '') : String(s.layoutHtml ?? p.layoutHtml ?? ''),
      layoutTheme: (blank || manual) ? String(s.layoutTheme || '') : String(s.layoutTheme ?? p.layoutTheme ?? ''),
      blank,
      manual,
      layoutOptions: (() => {
        if (blank || manual) return [];
        const opts = Array.isArray(s.layoutOptions)
          ? s.layoutOptions
          : (Array.isArray(p.layoutOptions) ? p.layoutOptions : []);
        return opts
          .map((o, idx) => ({
            rank: Number(o?.rank) > 0 ? Number(o.rank) : idx + 1,
            label: String(o?.label || ''),
            reason: String(o?.reason || ''),
            direction: String(o?.direction || ''),
            html: String(o?.html || ''),
          }))
          .filter((o) => o.html);
      })(),
      annotation: blank
        ? { text: '', targetSubject: '', targetRegion: '' }
        : ((s.annotation && typeof s.annotation === 'object')
          ? {
            text: String(s.annotation.text ?? p.annotation?.text ?? ''),
            targetSubject: String(s.annotation.targetSubject ?? p.annotation?.targetSubject ?? ''),
            targetRegion: String(s.annotation.targetRegion ?? p.annotation?.targetRegion ?? ''),
            ...(s.annotation.targetBox && typeof s.annotation.targetBox === 'object'
              ? { targetBox: s.annotation.targetBox }
              : (p.annotation?.targetBox ? { targetBox: p.annotation.targetBox } : {})),
          }
          : (p.annotation || { text: '', targetSubject: '', targetRegion: '' })),
      visualNeed: blank
        ? null
        : ((s.visualNeed && typeof s.visualNeed === 'object') ? s.visualNeed : (p.visualNeed || null)),
    };
  });
}

// PATCH /posts/:id — one handler for publish / schedule / time / content edits.
async function updatePost(req, res) {
  const post = await PlannedPost.findOne({ _id: req.params.id, user: req.user._id });
  if (!post) return res.status(404).json({ message: 'Post not found' });

  if (req.body.published !== undefined) {
    post.published = Boolean(req.body.published);
    if (post.published) { clearScheduleFields(post); post.savedForReview = false; }
  } else if (
    req.body.content === undefined &&
    req.body.scheduledAt === undefined &&
    req.body.time === undefined &&
    req.body.publishImageKeys === undefined &&
    req.body.scheduleStatus === undefined &&
    req.body.savedForReview === undefined
  ) {
    // Legacy toggle when the body is empty / only flipping publish.
    post.published = !post.published;
    if (post.published) { clearScheduleFields(post); post.savedForReview = false; }
  }

  if (req.body.time !== undefined) {
    post.time = String(req.body.time || '');
  }

  // "Save for review" — hold this post in the calendar as a draft, not queued
  // to publish. It and a live schedule are mutually exclusive, so turning it on
  // clears any pending slot; scheduling (below) turns it back off.
  if (req.body.savedForReview !== undefined) {
    post.savedForReview = Boolean(req.body.savedForReview);
    if (post.savedForReview) {
      clearScheduleFields(post);
      post.publishImageKeys = [];
    }
  }

  // Schedule / unschedule. null/'' clears; a valid date sets it. Scheduling
  // never touches `published`.
  if (req.body.scheduledAt !== undefined) {
    if (req.body.scheduledAt === null || req.body.scheduledAt === '') {
      clearScheduleFields(post);
      post.publishImageKeys = [];
    } else {
      const at = new Date(req.body.scheduledAt);
      if (Number.isNaN(at.getTime())) {
        return res.status(400).json({ message: 'That publish time is not a valid date.' });
      }
      const keys = ownedMediaKeys(req.user._id, req.body.publishImageKeys);
      if (!keys.length) {
        return res.status(400).json({
          message: 'Render the slides before scheduling so the daily job has something to post.',
        });
      }
      post.scheduledAt = at;
      post.publishImageKeys = keys;
      post.scheduleStatus = 'ready';
      post.scheduleError = '';
      post.scheduleClaimedAt = null;
      post.savedForReview = false;
    }
  }

  if (req.body.scheduleStatus !== undefined && req.body.scheduledAt === undefined) {
    const next = String(req.body.scheduleStatus || '');
    if (!['', 'ready', 'failed'].includes(next)) {
      return res.status(400).json({ message: 'That schedule status cannot be set from the studio.' });
    }
    if (!post.scheduledAt || post.published) {
      return res.status(400).json({ message: 'This post is not waiting to go out.' });
    }
    post.scheduleStatus = next;
    if (next === 'ready') post.scheduleError = '';
  }

  // Persist slide / caption edits from the studio editor.
  if (req.body.content && typeof req.body.content === 'object') {
    const incoming = req.body.content;
    const cur = post.content || {};
    if (Array.isArray(incoming.slides)) {
      const prevSlides = Array.isArray(cur.slides) ? cur.slides : [];
      cur.slides = mergeSlides(incoming.slides, prevSlides);
      cur.onScreenText = cur.slides.map((s) => s.title).filter(Boolean);
    }
    if (incoming.caption !== undefined) cur.caption = String(incoming.caption);
    if (incoming.cta !== undefined) cur.cta = String(incoming.cta);
    if (incoming.strategy !== undefined) cur.strategy = String(incoming.strategy);
    if (incoming.notes !== undefined) cur.notes = String(incoming.notes);
    if (incoming.plan !== undefined) cur.plan = String(incoming.plan);
    if (incoming.carouselHtml !== undefined) cur.carouselHtml = String(incoming.carouselHtml || '');
    // Editor mode's Cancel puts the post's theme back along with its slides
    if (incoming.themeId !== undefined) cur.themeId = String(incoming.themeId || '');
    if (Array.isArray(incoming.hashtags)) {
      cur.hashtags = incoming.hashtags.map((h) => String(h).replace(/^#/, ''));
    }
    if (incoming.coverVideo !== undefined) {
      cur.coverVideo = incoming.coverVideo && incoming.coverVideo.key
        ? { key: String(incoming.coverVideo.key), updatedAt: new Date().toISOString() }
        : null;
    }
    post.content = cur;
    post.markModified('content');
  }

  await post.save();
  res.json({ post });
}

// POST /posts/:id/polish-caption — rewrite the caption/words; returns a draft.
async function polishCaption(req, res) {
  const post = await PlannedPost.findOne({ _id: req.params.id, user: req.user._id });
  if (!post) return res.status(404).json({ message: 'Post not found' });

  const instruction = String(req.body?.instruction || '').trim();
  const kind = req.body?.kind === 'words' ? 'words' : 'caption';
  const caption = req.body?.caption !== undefined
    ? String(req.body.caption)
    : String(post.content?.caption || '');

  const dna = await loadBrandDna(req.user._id, post.instagramUsername);
  try {
    const result = await rewriteCaption({
      caption,
      instruction,
      kind,
      context: {
        handle: post.instagramUsername,
        pillar: post.pillar,
        format: post.format,
        direction: post.direction,
        strategy: post.content?.strategy,
        voice: dna?.howYouSound,
        role: req.body?.role ? String(req.body.role) : undefined,
        fills: Array.isArray(req.body?.fills) ? req.body.fills : undefined,
      },
    });
    const debug = wantsPromptDebug(req) ? {
      debug: {
        finalPrompt: result.finalPrompt,
        systemPrompt: result.systemPrompt,
        model: result.model,
        output: result.caption,
      },
    } : {};
    if (result.unchanged) {
      return res.json({
        caption: result.caption,
        unchanged: true,
        message: kind === 'words'
          ? 'That would leave the text exactly as it is.'
          : 'That would leave the caption exactly as it is.',
        model: result.model,
        ...debug,
      });
    }
    return res.json({ caption: result.caption, model: result.model, ...debug });
  } catch (err) {
    const status = err.status || 502;
    console.error('[posts] caption polish failed:', err.message);
    return res.status(status).json({ message: err.message || 'Could not rewrite the caption.' });
  }
}

// POST /posts/:id/refine — Editor mode's prompt band. The studio's current
// carousel comes in (every hand edit baked in); the Slide Edit agent edits only
// the slide(s) in scope from that slide's html + the change asked for
// (services/carouselRefine.js → slideEditAgent.js). The result is saved on the
// post exactly like a Fix layout rerun and the post is returned.
// A request for a picture (`visual: true`, or words asking for one) first runs
// the Visual agent on `visualSlideIndex`; the new picture goes to the carousel
// agent as a supplied asset and lands on that slide.
// Body: { instruction, slideIndex?, focus?, visual?, visualSlideIndex?,
//   current: { carouselHtml, direction, slides: [{ index, layoutHtml, themed, assetKeys }] } }
async function refinePost(req, res) {
  const record = await PlannedPost.findOne({ _id: req.params.id, user: req.user._id });
  if (!record) return res.status(404).json({ message: 'Post not found' });
  const stored = Array.isArray(record.content?.slides) ? record.content.slides.map((s) => plainOf(s)) : [];
  const current = req.body?.current && typeof req.body.current === 'object' ? req.body.current : {};
  const sent = Array.isArray(current.slides) ? current.slides : [];
  if (!stored.length) return res.status(400).json({ message: 'This post has no slides to refine.' });
  if (sent.length !== stored.length) {
    return res.status(409).json({ message: 'The post changed while you were editing — reopen it and try again.' });
  }
  const own = `projects/${req.user._id}/`;
  const ownKeys = (list) => (Array.isArray(list) ? list : [])
    .map((k) => String(k || '').trim())
    .filter((k) => k.startsWith(own));
  const label = record.day || (record.date ? record.date.toISOString().slice(0, 10) : record._id.toString());
  const dna = await loadBrandDna(req.user._id, record.instagramUsername).catch(() => null);
  const brand = compileBrandMemory(dna);
  // one row per step for the debug panel (only when the client asks for it)
  const steps = wantsPromptDebug(req) ? [] : null;
  const started = Date.now();
  const debugOf = (extra = {}) => (steps ? {
    debug: {
      mode: 'carousel-refine',
      instruction: String(req.body?.instruction || '').slice(0, 800),
      elapsedMs: Date.now() - started,
      agents: steps,
      ...extra,
    },
  } : {});

  try {
    const out = await refineCarouselFromEdits({
      userId: req.user._id,
      label,
      instruction: req.body?.instruction,
      slideIndex: req.body?.slideIndex,
      focus: req.body?.focus || null,
      current: { ...current, slides: sent.map((s, i) => ({ ...s, assetKeys: ownKeys(s?.assetKeys) })) },
      brand,
      handle: record.instagramUsername,
      visual: typeof req.body?.visual === 'boolean' ? req.body.visual : undefined,
      visualSlideIndex: req.body?.visualSlideIndex,
      slideRecords: stored,
      // the strategist's brief keeps every edit on-angle and truthful
      strategy: plainOf(record.agentTrace?.strategyBrief) || null,
      // a repair pass from the editor: overlaps / overflow it measured on the rendered slide
      layoutIssues: Array.isArray(req.body?.layoutIssues) ? req.body.layoutIssues.map(String).slice(0, 12) : null,
      // the slide in scope as the editor renders it (real type sizes / boxes)
      geometry: req.body?.geometry && typeof req.body.geometry === 'object' ? req.body.geometry : null,
      // the theme CSS rules that apply to that slide (read-only context)
      slideCss: typeof req.body?.slideCss === 'string' ? req.body.slideCss.slice(0, 16000) : '',
      // the suggestion chips pressed in the Editor chat: { kind, path, labels }
      intent: req.body?.intent && typeof req.body.intent === 'object' ? req.body.intent : null,
      // a picture made by this edit matches the slide's theme
      visualTheme: await visualThemeForPost(record, Number(req.body?.visualSlideIndex) || Number(req.body?.slideIndex) || Number(req.body?.focus?.slideIndex) || 1),
      debug: steps,
    });

    // The studio's latest pictures travel with the reference — keep them on the
    // slides, then lay the recreated carousel over every slide.
    const merged = stored.map((slide, i) => {
      const keys = ownKeys(sent[i]?.assetKeys);
      return keys.length ? { ...slide, assetKey: keys[0], assetKeys: keys } : slide;
    });
    const content = plainOf(record.content) || {};
    const next = applyLayoutToContent(
      { ...content, slides: merged },
      { status: 'ready', html: out.html, slides: out.slides, themeId: content.themeId || '' },
    );
    // the words a slide now shows become its stored copy (plan list, captions),
    // and its pictures follow the order its image slots hold them in — which is
    // how a freshly generated visual joins the slide
    next.slides = next.slides.map((slide, i) => {
      const index = Number(slide?.index) > 0 ? Number(slide.index) : i + 1;
      if (!out.changed.includes(index)) return slide;
      const copy = copyFromLayoutHtml(slide.layoutHtml)?.filled || {};
      const keys = out.slideKeys?.[index];
      const pics = Array.isArray(keys) ? { assetKeys: keys, assetKey: keys[0] || '' } : {};
      return { ...slide, ...copy, ...pics };
    });
    record.content = { ...content, ...next, slides: next.slides, carouselHtml: out.html };
    const trace = record.agentTrace && typeof record.agentTrace === 'object' ? plainOf(record.agentTrace) : {};
    const debugEntry = { model: out.model };
    record.agentTrace = {
      ...trace,
      lastRun: lastRunOf('refine'),
      layout: { ...(plainOf(trace.layout) || {}), html: out.html },
      carousel: { ...(plainOf(trace.carousel) || {}), html: out.html },
      refines: [
        ...(Array.isArray(trace.refines) ? trace.refines : []).slice(-19),
        {
          at: new Date().toISOString(),
          instruction: String(req.body?.instruction || '').slice(0, 800),
          slideIndex: Number(req.body?.slideIndex) || null,
          model: debugEntry.model || '',
          ...(out.visual ? {
            visual: out.visual.ok
              ? { key: out.visual.key, placement: out.visual.placement, prompt: out.visual.imagePrompt, placed: out.visual.placed }
              : { skipped: out.visual.skipReason || 'failed' },
          } : {}),
        },
      ],
    };
    record.markModified('content');
    record.markModified('agentTrace');
    await record.save();
    return res.json({
      post: record,
      changed: out.changed,
      visual: out.visual
        ? (out.visual.ok
          ? { ok: true, key: out.visual.key, src: out.visual.src, alt: out.visual.alt, placement: out.visual.placement, placed: out.visual.placed }
          : { ok: false, reason: out.visual.skipReason || '' })
        : null,
      ...debugOf({ model: debugEntry.model }),
    });
  } catch (err) {
    const status = err.status || 502;
    console.error('[posts] carousel refine failed:', err.message);
    return res.status(status).json({
      message: err.message || 'Could not refine this carousel.',
      ...debugOf({ error: err.message }),
    });
  }
}

// POST /posts/:id/slides — Editor mode › Slide › Add before / Add after. The
// studio has answered Capture ("What is this new slide about?"); that capture
// and the post's FULL strategy brief go to the Add Slide agent
// (services/addSlideAgent.js), which writes one new slide in the carousel's own
// design. It is spliced in at `at` (0-based), later slides are renumbered, and
// the post is saved and returned.
// Body: { at, capture: { text, conversationSummary, conversationTitle,
//   understanding, turns, attachments:[{key,type}], projectName },
//   current: { carouselHtml, direction, slides: [{ index, layoutHtml, themed, assetKeys }] } }
async function addSlideToPost(req, res) {
  const record = await PlannedPost.findOne({ _id: req.params.id, user: req.user._id });
  if (!record) return res.status(404).json({ message: 'Post not found' });
  const stored = Array.isArray(record.content?.slides) ? record.content.slides.map((s) => plainOf(s)) : [];
  const current = req.body?.current && typeof req.body.current === 'object' ? req.body.current : {};
  const sent = Array.isArray(current.slides) ? current.slides : [];
  if (!stored.length) return res.status(400).json({ message: 'This post has no slides to add to.' });
  if (sent.length !== stored.length) {
    return res.status(409).json({ message: 'The post changed while you were editing — reopen it and try again.' });
  }
  if (stored.length >= 20) return res.status(400).json({ message: 'Instagram carousels hold up to 20 slides.' });
  const capture = req.body?.capture && typeof req.body.capture === 'object' ? req.body.capture : {};
  if (!String(capture.text || '').trim() && !(Array.isArray(capture.attachments) && capture.attachments.length)) {
    return res.status(400).json({ message: 'Say what the new slide is about.' });
  }
  const own = `projects/${req.user._id}/`;
  const ownKeys = (list) => (Array.isArray(list) ? list : [])
    .map((k) => String(k || '').trim())
    .filter((k) => k.startsWith(own));
  const label = record.day || (record.date ? record.date.toISOString().slice(0, 10) : record._id.toString());
  const dna = await loadBrandDna(req.user._id, record.instagramUsername).catch(() => null);
  const brand = compileBrandMemory(dna);
  const steps = wantsPromptDebug(req) ? [] : null;
  const started = Date.now();
  const debugOf = (extra = {}) => (steps ? {
    debug: { mode: 'add-slide', elapsedMs: Date.now() - started, agents: steps, ...extra },
  } : {});

  try {
    const out = await addSlideToCarousel({
      userId: req.user._id,
      handle: record.instagramUsername,
      label,
      at: Number(req.body?.at),
      capture,
      current: { ...current, slides: sent.map((s) => ({ ...s, assetKeys: ownKeys(s?.assetKeys) })) },
      // the post's FULL strategy — the new slide must be a beat in that story
      strategy: plainOf(record.agentTrace?.strategyBrief) || null,
      // its picture (if it needs one) matches the theme of the slide it follows
      visualTheme: await visualThemeForPost(record, Math.max(1, Number(req.body?.at) || 1)),
      brand,
      slideRecords: stored,
      debug: steps,
    });

    // the studio's latest pictures stay on their slides; the new slide's record
    // goes in at its position, and every slide is renumbered in order
    const kept = stored.map((slide, i) => {
      const keys = ownKeys(sent[i]?.assetKeys);
      return keys.length ? { ...slide, assetKey: keys[0], assetKeys: keys } : slide;
    });
    const role = out.newIndex === 1 ? 'Hook' : (out.newIndex === stored.length + 1 ? 'Takeaway' : 'Slide');
    const fresh = {
      role,
      title: '',
      assetKey: out.keys[0] || '',
      assetKeys: out.keys,
      layout: 'dynamic',
    };
    const merged = [...kept.slice(0, out.at), fresh, ...kept.slice(out.at)]
      .map((slide, i) => ({ ...slide, index: i + 1 }));
    const content = plainOf(record.content) || {};
    const next = applyLayoutToContent(
      { ...content, slides: merged },
      { status: 'ready', html: out.html, slides: out.slides, themeId: content.themeId || '' },
    );
    next.slides = next.slides.map((slide, i) => {
      if (i !== out.at) return slide;
      const copy = copyFromLayoutHtml(slide.layoutHtml)?.filled || {};
      return { ...slide, ...copy };
    });
    record.content = {
      ...content,
      ...next,
      slides: next.slides,
      onScreenText: next.slides.map((s) => s.title || ''),
      carouselHtml: out.html,
    };
    const trace = record.agentTrace && typeof record.agentTrace === 'object' ? plainOf(record.agentTrace) : {};
    record.agentTrace = {
      ...trace,
      lastRun: lastRunOf('add-slide'),
      layout: { ...(plainOf(trace.layout) || {}), html: out.html },
      carousel: { ...(plainOf(trace.carousel) || {}), html: out.html },
      addedSlides: [
        ...(Array.isArray(trace.addedSlides) ? trace.addedSlides : []).slice(-19),
        {
          at: new Date().toISOString(),
          index: out.newIndex,
          capture: String(capture.text || '').slice(0, 800),
          model: out.model || '',
          ...(out.visual ? { visual: out.visual.ok ? { key: out.visual.key } : { skipped: out.visual.skipReason || 'failed' } } : {}),
        },
      ],
    };
    record.markModified('content');
    record.markModified('agentTrace');
    await record.save();
    return res.json({
      post: record,
      index: out.newIndex,
      visual: out.visual
        ? (out.visual.ok ? { ok: true, key: out.visual.key, src: out.visual.src } : { ok: false, reason: out.visual.skipReason || '' })
        : null,
      ...debugOf({ model: out.model }),
    });
  } catch (err) {
    const status = err.status || 502;
    console.error('[posts] add slide failed:', err.message);
    return res.status(status).json({
      message: err.message || 'Could not add the slide.',
      ...debugOf({ error: err.message }),
    });
  }
}

// GET /posts/:id/project — the project this post was written from, so a capture
// made for it (Editor › Add slide) is filed there without asking. The strategist
// names it on the brief (`project`, a name — captures carry names, not ids);
// matched to the studio's projects by name, this account's first.
// → { projectId, projectName } (projectId '' when no project has that name)
async function getPostProject(req, res) {
  const record = await PlannedPost.findOne({ _id: req.params.id, user: req.user._id })
    .select('instagramUsername agentTrace.strategyBrief.project').lean();
  if (!record) return res.status(404).json({ message: 'Post not found' });
  const raw = record.agentTrace?.strategyBrief?.project;
  const projectName = String((raw && typeof raw === 'object' ? (raw.name || raw.title) : raw) || '').trim();
  if (!projectName) return res.json({ projectId: '', projectName: '' });
  const esc = projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = await Project.find({ user: req.user._id, name: new RegExp(`^${esc}$`, 'i') })
    .select('_id name instagramUsername updatedAt').sort({ updatedAt: -1 }).lean();
  const handle = String(record.instagramUsername || '').toLowerCase();
  const hit = matches.find((m) => String(m.instagramUsername || '') === handle) || matches[0];
  return res.json({ projectId: hit ? String(hit._id) : '', projectName: hit?.name || projectName });
}

// Copy/asset fields the studio can edit — overlaid onto the rich Day Writer
// slides on a standalone carousel rerun so edits survive.
const EDITABLE_SLIDE_FIELDS = [
  'title', 'subtitle', 'body', 'items', 'itemsA', 'itemsB',
  'comparisonA', 'comparisonB', 'stat', 'quote', 'action', 'labels',
  'image', 'assetKey', 'assetKeys', 'imagePrompt', 'annotation',
];

// The post fed to the carousel agent on a standalone rerun — start from the rich
// Day Writer slides (in agentTrace) and overlay only user-edited copy/asset
// fields from the stored slides, matching what the full plan feeds.
function layoutPostFromPost(post) {
  const trace = post?.agentTrace && typeof post.agentTrace === 'object' ? post.agentTrace : {};
  const writer = trace.dayWriter && typeof trace.dayWriter === 'object' ? trace.dayWriter : null;
  const stored = Array.isArray(post?.content?.slides) ? post.content.slides.map((s) => plainOf(s)) : [];

  if (writer?.content?.slides?.length) {
    const rich = plainOf(writer.content.slides);
    const merged = rich.map((slide, i) => {
      const edited = stored.find((s) => (
        Number(s?.index) > 0 && Number(s.index) === Number(slide?.index)
      )) || stored[i] || {};
      const overlay = {};
      for (const key of EDITABLE_SLIDE_FIELDS) {
        if (edited[key] !== undefined && edited[key] !== null && edited[key] !== '') overlay[key] = edited[key];
      }
      return { ...slide, ...overlay };
    });
    return {
      ...plainOf(writer),
      format: writer.format || post.format,
      content: { ...(writer.content || {}), slides: merged },
    };
  }
  return { format: post.format, status: 'ready', content: { slides: stored } };
}

// The theme a picture made for slide `slideIndex` of this post must sit inside:
// that slide's own theme (Themes › This slide) or the post's, with its example
// board — or, for a post drawn from the studio's reference photo, that photo.
async function visualThemeForPost(record, slideIndex) {
  const slides = Array.isArray(record?.content?.slides) ? record.content.slides : [];
  const own = String(slides[(Number(slideIndex) || 1) - 1]?.layoutTheme || '').trim();
  const id = own || String(record?.content?.themeId || '').trim();
  const ref = record?.agentTrace?.themeReference;
  if (/^custom-reference/.test(id) && ref?.key) {
    let image = null;
    try { image = await loadReferenceImage(ref.key); } catch { /* the words still carry the look */ }
    return visualThemeOf('', {
      referenceTheme: { id: 'custom-reference', name: 'Your reference photo', reference: ref.reference || '', imageStyle: ref.imageStyle || '' },
      referenceImage: image,
    });
  }
  return visualThemeOf(id);
}

// POST /posts/:id/layout — run the Carousel agent on this post only.
async function rerunLayout(req, res) {
  const record = await PlannedPost.findOne({ _id: req.params.id, user: req.user._id });
  if (!record) return res.status(404).json({ message: 'Post not found' });

  // The carousel agent has no themes: it designs in its house style. Themes —
  // a library pick or an uploaded reference — are applied afterwards as images
  // by POST /posts/:id/theme-image (the Theme Apply agent).
  if (req.body?.themeId || req.body?.referenceImageKey) {
    return res.status(400).json({ message: 'Themes are applied with Editor › Themes (the Theme Apply agent), not the carousel agent.' });
  }

  const post = layoutPostFromPost(record);
  const trace = record.agentTrace && typeof record.agentTrace === 'object' ? record.agentTrace : {};
  if (trace.strategyBrief) {
    post.content = normalizeWriterPost(post, trace.strategyBrief, []);
  }
  if (!Array.isArray(post?.content?.slides) || !post.content.slides.length) {
    return res.status(400).json({ message: 'This post has no slides to layout.' });
  }

  const structure = plainOf(trace.structure) || {};
  const label = record.day || (record.date ? record.date.toISOString().slice(0, 10) : record._id.toString());
  const dna = await loadBrandDna(req.user._id, record.instagramUsername).catch(() => null);
  const kitColors = await brandKitColors(req.user._id, record.instagramUsername);
  const brand = { ...compileBrandMemory(dna), ...(kitColors ? { palette: brandStylePalette(kitColors) } : {}) };
  const dayWriterOutput = plainOf(trace.dayWriter)
    || (Array.isArray(post.content?.slides) ? { content: { slides: post.content.slides } } : '');

  // This slide: the slide the studio is looking at NOW (after any added /
  // removed slides and edits), so the index and its words line up
  const oneSlide = Number(req.body?.slideIndex) || 0;
  let layoutPost = post;
  let layoutStructure = structure;
  if (oneSlide) {
    const current = Array.isArray(record.content?.slides) ? record.content.slides.map((s) => plainOf(s)) : [];
    if (oneSlide < 1 || oneSlide > current.length) return res.status(404).json({ message: 'Slide not found on this post.' });
    layoutPost = { ...post, content: { ...(post.content || {}), slides: current.map((s, i) => ({ ...s, index: i + 1 })) } };
    layoutStructure = {};
  }

  try {
    const result = await runLayoutForPost({
      source: `Carousel:${label}:debug`,
      structure: layoutStructure,
      post: layoutPost,
      dayBrief: plainOf(trace.strategyBrief) || {},
      brand,
      dayWriterOutput,
      userId: req.user._id,
      handle: record.instagramUsername,
      // Themes › This slide: the agent writes that slide only
      onlySlide: Number(req.body?.slideIndex) || 0,
    });
    if (result.parsed?.status === 'failed') {
      return res.status(422).json({
        message: result.parsed.failureReason || 'Carousel agent could not compose this post.',
        layout: result.parsed,
      });
    }

    const current = plainOf(record.content) || {};
    // Editor › Themes › This slide: the carousel was written in the new theme,
    // but only this slide moves into it — into a section of its own, with its
    // CSS scoped — and every other slide keeps exactly what it has (see
    // services/themeMerge.js).
    const slideIndex = Number(req.body?.slideIndex) || 0;
    let layoutForContent = result.parsed;
    let baseSlides = post.content.slides;
    let slideDir = '';
    if (slideIndex) {
      const stored = Array.isArray(current.slides) ? current.slides : [];
      const curDoc = current.carouselHtml || plainOf(trace.carousel)?.html || plainOf(trace.layout)?.html || '';
      if (slideIndex < 1 || slideIndex > stored.length) return res.status(404).json({ message: 'Slide not found on this post.' });
      if (!curDoc) return res.status(400).json({ message: 'This carousel has no layout yet — apply a theme to all slides first.' });
      const merged = applySlideTheme({ currentDoc: curDoc, newDoc: result.parsed.html, slideIndex });
      slideDir = merged.dir;
      const parsed2 = parseCarouselDocument(merged.html, stored.length);
      layoutForContent = { status: 'ready', html: parsed2.html, slides: parsed2.slides, themeId: current.themeId || '' };
      baseSlides = stored;
    }
    let next = applyLayoutToContent({ ...current, slides: baseSlides }, layoutForContent);
    if (slideIndex) {
      // the re-themed slide's words are what its new html shows
      next.slides = next.slides.map((sl, i) => (i === slideIndex - 1
        ? { ...sl, ...(copyFromLayoutHtml(sl.layoutHtml)?.filled || {}), layoutTheme: slideDir || sl.layoutTheme }
        : sl));
    }
    // Fill any slide that now has an empty image slot but no supplied asset with
    // a generated conceptual visual (OpenAI gpt-image-1). This is a user-initiated
    // re-run, so fillEmpty is on — it generates for any missing-asset image slot,
    // not only the structure agent's generate-conceptual-support slides.
    const visualAgents = [];
    try {
      next = await attachGeneratedVisuals({
        source: label,
        content: next,
        brief: plainOf(trace.strategyBrief) || {},
        brand,
        userId: req.user._id,
        handle: record.instagramUsername,
        fillEmpty: true,
        collect: (agent) => { if (agent?.debugEntry) visualAgents.push(agent); },
        // pictures finished to sit in the default Warm editorial look
        visualTheme: visualThemeOf(''),
      });
    } catch (err) {
      console.warn('[posts] visual agent skipped on layout rerun:', err.message);
    }
    record.content = { ...current, ...next, slides: next.slides };
    // a full rerun is the carousel agent's house style — no theme on the post
    if (!slideIndex) record.content.themeId = '';
    const debugEntry = result.debugEntry || {};
    const savedLayout = slideIndex ? { ...layoutForContent, slideIndex, slideTheme: slideDir } : result.parsed;
    record.agentTrace = {
      ...trace,
      lastRun: lastRunOf('layout', ['carousel', Array.isArray(next.visualTrace) && next.visualTrace.length ? 'visual' : '']),
      layout: savedLayout,
      carousel: savedLayout,
      layoutPrompt: optionalText(debugEntry.prompt) || trace.layoutPrompt || '',
      themeId: slideIndex ? (trace.themeId || '') : '',
      visual: Array.isArray(next.visualTrace) && next.visualTrace.length
        ? {
          slides: next.visualTrace,
          usage: next.visualUsage || null,
          agents: visualAgents.map((a) => ({
            source: a.debugEntry?.source || '',
            prompt: a.debugEntry?.prompt || '',
            output: a.debugEntry?.output || '',
          })),
        }
        : trace.visual || null,
    };
    record.markModified('content');
    record.markModified('agentTrace');
    await record.save();

    return res.json({
      post: record,
      layout: result.parsed,
      carousel: result.parsed,
      ...(wantsPromptDebug(req) ? {
        debug: {
          mode: 'carousel-debug',
          model: result.usage?.model || debugEntry.model,
          usage: result.usage || debugEntry.usage || null,
          agents: [
            {
              source: debugEntry.source || `Carousel:${label}:debug`,
              model: debugEntry.model,
              provider: debugEntry.provider || '',
              prompt: debugEntry.prompt,
              output: debugEntry.output || '',
              ...(debugEntry.inputImage ? { inputImage: debugEntry.inputImage } : {}),
              elapsedMs: Number(debugEntry.elapsedMs || result.usage?.elapsedMs) || 0,
              usage: result.usage || debugEntry.usage || null,
              inputTokens: Number(result.usage?.inputTokens || debugEntry.usage?.inputTokens) || 0,
              outputTokens: Number(result.usage?.outputTokens || debugEntry.usage?.outputTokens) || 0,
              totalTokens: Number(result.usage?.totalTokens || debugEntry.usage?.totalTokens) || 0,
              estimatedCostUsd: Number(result.usage?.estimatedCostUsd || debugEntry.usage?.estimatedCostUsd) || 0,
            },
            ...[...decorativeDebugAgents(result.decorative), ...visualAgents].map((a) => ({
              source: a.debugEntry?.source || `Visual:${label}`,
              model: a.debugEntry?.model,
              provider: a.debugEntry?.provider || '',
              prompt: a.debugEntry?.prompt,
              output: a.debugEntry?.output || '',
              ...(a.debugEntry?.inputImage ? { inputImage: a.debugEntry.inputImage } : {}),
              elapsedMs: Number(a.debugEntry?.elapsedMs) || 0,
              usage: a.usage || null,
              inputTokens: Number(a.usage?.inputTokens) || 0,
              outputTokens: Number(a.usage?.outputTokens) || 0,
              totalTokens: Number(a.usage?.totalTokens) || 0,
              estimatedCostUsd: Number(a.usage?.estimatedCostUsd) || 0,
            })),
          ],
          elapsedMs: Number(debugEntry.elapsedMs || result.usage?.elapsedMs) || 0,
        },
      } : {}),
    });
  } catch (err) {
    const status = err.statusCode || err.status || 502;
    console.error('[posts] layout rerun failed:', err.message);
    return res.status(status).json({ message: err.message || 'Could not run the carousel agent.' });
  }
}

// POST /posts/:id/theme-image — Editor › Themes › Upload a reference. The Theme
// Apply agent (services/themeApplyAgent.js) re-paints each slide asked for in
// the reference photo's look — from the slide as it looks now, its photo, its
// words and the post's strategy — and returns an IMAGE, not html. Each picture
// goes into the carousel document as a full-bleed slide in a section of its own
// (themeMerge.applySlideTheme), so every other slide keeps exactly what it has.
// Body: { referenceImageKey, slideIndexes: [1-based…], snapshots?: { [index]: dataUrl } }
const THEME_IMAGE_CONCURRENCY = Math.max(1, Number(process.env.THEME_IMAGE_CONCURRENCY) || 3);
const COPY_FIELDS = ['role', 'title', 'subtitle', 'body', 'items', 'itemsA', 'itemsB', 'stat', 'quote', 'action',
  'comparisonA', 'comparisonB', 'labels', 'colorSet', 'colorSetAt', 'ground', 'logoMark', 'annotation', 'visualNeed'];

function snapshotOf(dataUrl) {
  const m = String(dataUrl || '').match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const buffer = Buffer.from(m[2], 'base64');
  return buffer.length && buffer.length <= 6 * 1024 * 1024 ? { buffer } : null;
}

// A slide the Theme Apply agent painted (its section is `themed-image[-sN]`).
const isThemedSlide = (sl) => /^themed-image/.test(String(sl?.layoutTheme || ''));
// What Remove theme puts back on a slide (layoutHtml is rebuilt from the
// carousel html, so it is not stored twice).
const PRE_THEME_FIELDS = ['layout', 'layoutTheme', 'assetKey', 'assetKeys', 'title', 'subtitle', 'body', 'items', 'itemsA', 'itemsB', 'stat', 'quote', 'action', 'comparisonA', 'comparisonB', 'labels', 'image'];
const preThemeSlide = (sl) => Object.fromEntries(PRE_THEME_FIELDS.filter((k) => sl?.[k] !== undefined).map((k) => [k, plainOf(sl[k])]));

// POST /posts/:id/remove-theme — Editor › Themes › Remove theme. Puts the
// carousel agent's design back (the snapshot taken before the first theme):
// every slide, or only `slideIndex` (its original article moves back into the
// carousel document in a section of its own, like Themes › This slide).
// 409 { needsRegenerate } when the post was themed before snapshots existed.
// ── Theme Apply renders, edited by region ───────────────────────────────────
// A picture the AI debug panel shows (the input a model saw, its raw output) —
// uploaded only when the panel asked for prompts.
async function debugImage(buffer, userId, label) {
  if (!buffer?.length) return null;
  try {
    const key = `projects/${userId}/debug/${require('crypto').randomUUID()}.jpg`;
    const jpeg = await require('sharp')(buffer).jpeg({ quality: 85 }).toBuffer();
    await uploadBytes(key, jpeg, 'image/jpeg', { immutable: true });
    return { label, key, kb: Math.round(jpeg.length / 1024) };
  } catch (err) {
    console.warn(`[posts] debug image not stored: ${err.message}`);
    return null;
  }
}
// the region map's debug row (Theme Apply and the on-demand map)
async function regionMapDebugEntry(dbg, userId, idx) {
  if (!dbg) return null;
  return {
    source: `Region map (Haiku) · slide ${idx}`,
    model: dbg.model || '',
    prompt: dbg.prompt,
    output: dbg.output,
    elapsedMs: Number(dbg.usage?.elapsedMs) || 0,
    usage: dbg.usage || null,
    ...(dbg.usage || {}),
    inputImage: await debugImage(dbg.inputImage, userId, 'Slide with the numbered line boxes the model saw'),
  };
}

// A themed slide is one picture; `themeRegions` (services/themeRegions) says
// where its text blocks and photo sit, so the editor can change one of them.
function themedSlideAt(record, slideParam) {
  const stored = Array.isArray(record?.content?.slides) ? record.content.slides.map((s) => plainOf(s)) : [];
  const idx = Number(slideParam) || 0;
  const slide = stored[idx - 1];
  if (!slide) return { error: [404, 'Slide not found on this post.'] };
  if (!isThemedSlide(slide)) return { error: [400, 'This slide has no applied theme to edit.'] };
  const keys = [...(Array.isArray(slide.assetKeys) ? slide.assetKeys : []), slide.assetKey].map((k) => String(k || '')).filter(Boolean);
  const lead = keys.find((k) => /\/themed-/.test(k)) || '';
  if (!lead) return { error: [409, 'The themed picture for this slide is missing — apply the theme again.'] };
  return { stored, idx, slide, lead, photos: [...new Set(keys.filter((k) => k !== lead && !/\/themed-/.test(k)))] };
}

// the render's copy + photo box as the Theme Apply run recorded them
function themeRunFor(record, idx, key) {
  const runs = Array.isArray(record?.agentTrace?.themeApply) ? record.agentTrace.themeApply : [];
  for (let r = runs.length - 1; r >= 0; r -= 1) {
    const hit = (Array.isArray(runs[r]?.slides) ? runs[r].slides : []).find((s) => s.index === idx && (!key || s.key === key));
    if (hit) return hit;
  }
  return null;
}

// read the regions of a themed slide's current render and store them on the
// post → { regions, mapped, record } or { error: [status, message] }
async function readSlideRegions(record, slideIndex) {
  const at = themedSlideAt(record, slideIndex);
  if (at.error) return { error: at.error };
  const { idx, slide, lead } = at;
  const { mapRegions, sameWords } = require('../services/themeRegions');
  const run = themeRunFor(record, idx, lead) || themeRunFor(record, idx, '');
  // the copy the render was drawn with, plus the words of any region edit
  // since (the slide's last map carries them)
  const lines = Array.isArray(run?.textLines) && run.textLines.length
    ? [...run.textLines]
    : [['Headline', slide.title], ['Supporting text', slide.subtitle], ['Body', slide.body]]
      .filter(([, t]) => String(t || '').trim()).map(([role, text]) => ({ role, text: String(text).trim() }));
  (Array.isArray(slide.themeRegions?.texts) ? slide.themeRegions.texts : []).forEach((t) => {
    if (t?.text && !lines.some((l) => sameWords(l.text, t.text))) lines.push({ role: t.role || 'text', text: t.text });
  });
  let bytes;
  try {
    bytes = (await getObjectBytes(lead)).buffer;
  } catch (err) {
    return { error: [502, `Could not read the themed picture (${err.message}).`] };
  }
  // region edits never move the photo frame, so the latest Theme Apply run's
  // photo box still holds for a render edited since
  const mapped = await mapRegions({ buffer: bytes, lines, photoBox: run?.primaryImage?.box || null, key: lead });
  if (!mapped) return { error: [502, 'Could not find the text and picture on this slide — try again.'] };
  const regions = { key: lead, v: mapped.v, texts: mapped.texts, images: mapped.images };
  // the slide may have moved on while the model read it (another edit)
  const now = await PlannedPost.findOne({ _id: record._id, user: record.user });
  const cur = now && themedSlideAt(now, idx);
  if (!cur || cur.error || cur.lead !== lead) return { regions, mapped, record: now || record };
  now.content.slides[idx - 1].themeRegions = regions;
  now.markModified('content');
  await now.save();
  return { regions, mapped, record: now };
}

// POST /posts/:id/slide/:slideIndex/theme-regions — map (or return) the regions
// of the slide's current themed render. Body: { force? }
async function mapThemeRegions(req, res) {
  const record = await PlannedPost.findOne({ _id: req.params.id, user: req.user._id });
  if (!record) return res.status(404).json({ message: 'Post not found' });
  const at = themedSlideAt(record, req.params.slideIndex);
  if (at.error) return res.status(at.error[0]).json({ message: at.error[1] });
  const { idx, slide, lead } = at;
  const { REGIONS_V } = require('../services/themeRegions');
  if (slide.themeRegions?.key === lead && (Number(slide.themeRegions.v) || 1) >= REGIONS_V && !req.body?.force) return res.json({ regions: slide.themeRegions });
  const read = await readSlideRegions(record, idx);
  if (read.error) return res.status(read.error[0]).json({ message: read.error[1] });
  const { regions, mapped } = read;
  const debug = wantsPromptDebug(req) ? {
    mode: 'theme-regions',
    elapsedMs: Number(mapped.usage?.elapsedMs) || 0,
    usage: mapped.usage,
    agents: [await regionMapDebugEntry({ ...mapped.debug, model: mapped.model, usage: mapped.usage }, req.user._id, idx)].filter(Boolean),
  } : null;
  return res.json({ regions, post: read.record, ...(debug ? { debug } : {}) });
}

// The map's record of how a text block is set, after a redraw asked for
// `marks` (the Editor's text panel) — so the panel shows the new look without
// reading the picture again. Runs whose words are gone are dropped.
const MARK_FIELD = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strike' };
const MARK_ALIGN = { alignl: 'left', alignc: 'center', alignr: 'right' };
function restyleRegion(region, marks) {
  if (!region.style && !marks.length) return region;
  const style = { ...(region.style || {}) };
  let runs = (Array.isArray(region.runs) ? region.runs : []).filter((r) => region.text.includes(r.words)).map((r) => ({ ...r }));
  marks.forEach((m) => {
    const field = MARK_FIELD[m.id] || (/^hl-/.test(m.id) ? 'highlight' : (['ink', 'accent', 'ground'].includes(m.id) ? 'color' : ''));
    if (MARK_ALIGN[m.id]) { style.align = MARK_ALIGN[m.id]; return; }
    if (!field) return;
    const value = field === 'color' || field === 'highlight' ? (m.off ? '' : m.hex) : !m.off;
    if (!m.words) {
      style[field] = value;
      runs = runs.map((r) => { const { [field]: _drop, ...rest } = r; return rest; }).filter((r) => Object.keys(r).length > 1);
    } else if (region.text.includes(m.words)) {
      const at = runs.find((r) => r.words === m.words);
      if (at) at[field] = value; else runs.push({ words: m.words, [field]: value });
    }
  });
  return { ...region, style, runs };
}

// POST /posts/:id/slide/:slideIndex/theme-region — change parts of the themed
// render. Body: one change, or { changes: [change, …] } — sent together they
// are ONE image-model call. A change is { regionId, action:
//   'text'       (text region)  text? marks? remove? instructions? — the
//                instructions are rewrite asks applied to the words first,
//   'photo'      (picture)      photoKey — fitted in, no model,
//   'regenerate' (picture)      instruction? referenceKey?,
//   'remove'     (picture) }.
async function editThemeRegion(req, res) {
  const record = await PlannedPost.findOne({ _id: req.params.id, user: req.user._id });
  if (!record) return res.status(404).json({ message: 'Post not found' });
  const at = themedSlideAt(record, req.params.slideIndex);
  if (at.error) return res.status(at.error[0]).json({ message: at.error[1] });
  const { idx, slide, lead, photos } = at;
  const regions = slide.themeRegions;
  if (!regions || regions.key !== lead) return res.status(409).json({ needsMap: true, message: 'Map the slide\'s regions first.' });
  const own = `projects/${req.user._id}/`;
  const { placePhoto, rewriteText, textArea, imageArea, eraseArea, recolourArea, repaintAreas } = require('../services/themeRegions');

  // ── read every change first; a bad one fails the lot before any work ──
  const asked = (Array.isArray(req.body?.changes) ? req.body.changes : [req.body]).slice(0, 12);
  const byRegion = new Map(); // the last change to a region wins
  for (const c of asked) {
    const regionId = String(c?.regionId || '');
    const action = String(c?.action || '');
    // the whole slide in a Brand Kit colour set — not a region
    if (action === 'recolour') {
      const hex = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : '');
      const palette = { ground: hex(c?.palette?.ground), fg: hex(c?.palette?.fg), accent: hex(c?.palette?.accent) };
      if (!palette.ground && !palette.fg && !palette.accent) return res.status(400).json({ message: 'Choose a colour set first.' });
      byRegion.set('colours', { regionId: 'colours', action, palette, setId: String(c?.setId || '').slice(0, 60), name: String(c?.name || '').slice(0, 60), region: { id: 'colours' } });
      continue;
    }
    const textRegion = (regions.texts || []).find((t) => t.id === regionId);
    const imageRegion = (regions.images || []).find((t) => t.id === regionId);
    if (!textRegion && !imageRegion) return res.status(404).json({ message: 'That part of the slide was not found.' });
    const plan = { regionId, action, region: textRegion || imageRegion, isText: Boolean(textRegion) };
    if (action === 'text' && textRegion) {
      plan.removed = c?.remove === true;
      plan.marks = (Array.isArray(c?.marks) ? c.marks : []).slice(0, 24)
        .map((m) => ({
          id: String(m?.id || '').slice(0, 24),
          words: String(m?.words || '').slice(0, 200),
          what: String(m?.what || '').slice(0, 120),
          off: m?.off === true,
          hex: /^#[0-9a-f]{6}$/i.test(String(m?.hex || '')) ? String(m.hex).toLowerCase() : '',
        }))
        .filter((m) => m.id && m.what);
      plan.text = plan.removed ? '' : (String(c?.text || '').trim().slice(0, 400) || textRegion.text);
      plan.asks = (Array.isArray(c?.instructions) ? c.instructions : []).slice(0, 8).map((x) => String(x || '').slice(0, 300)).filter(Boolean);
    } else if (action === 'photo' && imageRegion) {
      plan.photoKey = String(c?.photoKey || '');
      if (!plan.photoKey.startsWith(own)) return res.status(400).json({ message: 'Choose one of your own photos.' });
    } else if (action === 'regenerate' && imageRegion) {
      plan.instruction = String(c?.instruction || '').slice(0, 400);
      plan.refKey = String(c?.referenceKey || '');
      if (plan.refKey && !plan.refKey.startsWith(own)) return res.status(400).json({ message: 'Use one of your own photos as the reference.' });
    } else if (action === 'remove' && imageRegion) {
      plan.removed = true;
    } else {
      return res.status(400).json({ message: 'That change is not available for this part of the slide.' });
    }
    byRegion.set(regionId, plan);
  }
  const plans = [...byRegion.values()];
  if (!plans.length) return res.status(400).json({ message: 'Nothing to change.' });
  const needsModel = plans.some((p) => p.action !== 'photo');
  if (needsModel && !isImageGenConfigured()) return res.status(503).json({ message: 'Image generation is not configured.' });

  const started = Date.now();
  let base;
  let painted = null;
  try {
    // the words the chat asked for, all rewritten at once (small model)
    const others = (id) => (regions.texts || []).filter((t) => t.id !== id).map((t) => t.text).join(' / ');
    await Promise.all(plans.filter((p) => p.action === 'text' && !p.removed && p.asks.length).map(async (p) => {
      p.text = (await rewriteText({ text: p.text, role: p.region.role, instructions: p.asks, context: others(p.regionId) })).text;
    }));
    for (const p of plans.filter((x) => x.action === 'text' && !x.removed)) {
      if (!p.text) return res.status(400).json({ message: 'Write the new text first.' });
      // nothing asked of this one after all — leave it out
      if (p.text === p.region.text && !p.marks.length) p.noop = true;
    }
    const live = plans.filter((p) => !p.noop);
    if (!live.length) return res.status(400).json({ message: 'The text is unchanged.' });

    base = (await getObjectBytes(lead)).buffer;
    // photos the studio chose are pasted in first (no model)
    let buffer = base;
    for (const p of live.filter((x) => x.action === 'photo')) {
      const photo = (await getObjectBytes(p.photoKey)).buffer; // eslint-disable-line no-await-in-loop
      buffer = (await placePhoto({ buffer, region: p.region, photo })).buffer; // eslint-disable-line no-await-in-loop
    }
    // …then every other change, ONE image-model call over all their areas
    const modelled = live.filter((p) => p.action !== 'photo');
    if (modelled.length) {
      const refKeys = [...new Set(modelled.map((p) => p.refKey).filter(Boolean))];
      const references = await Promise.all(refKeys.map(async (k) => (await getObjectBytes(k)).buffer));
      // pictures the recolour leaves alone: every one not being changed itself
      const touchedPics = new Set(live.filter((p) => !p.isText && p.action !== 'recolour').map((p) => p.regionId));
      const keep = (regions.images || []).filter((im) => !touchedPics.has(im.id)).map((im) => im.box);
      // the recolour goes first so the numbered areas are changed on top of it
      modelled.sort((a, b) => (b.action === 'recolour') - (a.action === 'recolour'));
      const areas = modelled.map((p) => {
        if (p.action === 'recolour') return recolourArea({ palette: p.palette, name: p.name, keep });
        if (p.action === 'text') return textArea({ region: p.region, text: p.text, marks: p.marks, remove: p.removed });
        if (p.action === 'remove') return eraseArea({ region: p.region });
        return imageArea({ region: p.region, instruction: p.instruction, refImage: p.refKey ? refKeys.indexOf(p.refKey) + 2 : 0 });
      });
      painted = await repaintAreas(buffer, areas, references);
      buffer = painted.buffer;
    } else {
      buffer = await require('sharp')(buffer).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
    }
    plans.length = 0;
    plans.push(...live);
    base = buffer;
  } catch (err) {
    console.error(`[posts] ThemeRegion:${req.params.id}#${idx} ${plans.map((p) => p.action).join('+')} failed:`, err.message);
    return res.status(502).json({ message: err.message || 'Could not change that part of the slide.' });
  }

  const key = `${own}themed-${require('crypto').randomUUID()}.jpg`;
  await uploadBytes(key, base, 'image/jpeg', { immutable: true });
  const src = await getMediaUrl(key).catch(() => '');
  // the carousel document's <img> for this slide now points at the new render
  const swapKey = (html) => String(html || '').replace(/<img\b[^>]*>/gi, (tag) => (tag.includes(`"${lead}"`)
    ? tag.split(lead).join(key).replace(/\ssrc\s*=\s*"[^"]*"/i, '')
    : tag));
  const current = plainOf(record.content) || {};
  const gone = new Set(plans.filter((p) => p.removed).map((p) => p.regionId));
  const textPlan = new Map(plans.filter((p) => p.action === 'text').map((p) => [p.regionId, p]));
  const recoloured = plans.find((p) => p.action === 'recolour');
  const nextRegions = {
    ...regions,
    key,
    // the words' colours changed with the set — the map is read again next open
    ...(recoloured ? { v: 0 } : {}),
    images: (regions.images || []).filter((t) => !gone.has(t.id)),
    texts: (regions.texts || [])
      .filter((t) => !gone.has(t.id))
      .map((t) => {
        const p = textPlan.get(t.id);
        return p ? restyleRegion({ ...t, text: p.text || t.text }, p.marks) : t;
      }),
  };
  // the slide's copy fields follow the words that changed (or came off)
  const swapText = (v) => [...textPlan.values()].reduce((acc, p) => {
    if (typeof acc !== 'string' || !p.region.text || !acc.includes(p.region.text)) return acc;
    if (!p.removed && p.text === p.region.text) return acc;
    return acc.split(p.region.text).join(p.removed ? '' : p.text);
  }, v);
  const photoKeys = plans.filter((p) => p.photoKey).map((p) => p.photoKey);
  const nextPhotos = [...new Set([...photoKeys, ...photos])];
  const was = slide;
  record.content.slides[idx - 1] = {
    ...was,
    title: swapText(was.title),
    subtitle: swapText(was.subtitle),
    body: swapText(was.body),
    assetKey: key,
    assetKeys: [key, ...nextPhotos],
    themeRegions: nextRegions,
    // the menu shows the set the picture is now drawn in
    ...(recoloured?.setId ? { colorSet: recoloured.setId, colorSetAt: Date.now() } : {}),
  };
  record.content.carouselHtml = swapKey(current.carouselHtml);
  const usage = painted?.usage || null;
  const trace = record.agentTrace && typeof record.agentTrace === 'object' ? plainOf(record.agentTrace) : {};
  record.agentTrace = {
    ...trace,
    layout: trace.layout ? { ...trace.layout, html: swapKey(trace.layout.html) } : trace.layout,
    carousel: trace.carousel ? { ...trace.carousel, html: swapKey(trace.carousel.html) } : trace.carousel,
    themeRegionEdits: [
      ...(Array.isArray(trace.themeRegionEdits) ? trace.themeRegionEdits : []).slice(-29),
      {
        at: new Date().toISOString(),
        index: idx,
        from: lead,
        key,
        changes: plans.map((p) => ({
          regionId: p.regionId,
          action: p.action,
          text: p.action === 'text' && !p.removed ? p.text : undefined,
          marks: p.marks?.length ? p.marks : undefined,
          removed: p.removed || undefined,
          photoKey: p.photoKey || undefined,
          palette: p.palette || undefined,
          referenceKey: p.refKey || undefined,
          instruction: p.instruction || undefined,
        })),
        model: painted?.model || '',
        usage,
      },
    ],
  };
  record.markModified('content');
  record.markModified('agentTrace');
  await record.save();
  // a recolour leaves the map stale (the words' colours changed): read it again
  // now, in the background, so the next Editor open does not wait on it
  if (recoloured) {
    readSlideRegions(record, idx)
      .then((r) => { if (r.error) console.warn(`[posts] ThemeRegion:${req.params.id}#${idx} re-map: ${r.error[1]}`); })
      .catch((err) => console.warn(`[posts] ThemeRegion:${req.params.id}#${idx} re-map failed: ${err.message}`));
  }

  const whatOf = (p) => {
    const r = p.region;
    if (p.action === 'text') {
      return p.removed
        ? `Text ${p.regionId} (${r.role}) removed: ${JSON.stringify(r.text)}`
        : `Text ${p.regionId} (${r.role}): ${JSON.stringify(r.text)} → ${JSON.stringify(p.text)}${p.asks?.length ? ` (asked: ${p.asks.join('; ')})` : ''}${p.marks?.length ? ` · ${p.marks.map((m) => (m.words ? `"${m.words}" ${m.what}` : m.what)).join('; ')}` : ''}`;
    }
    if (p.action === 'recolour') return `Whole slide recoloured${p.name ? ` into "${p.name}"` : ''}: ${JSON.stringify(p.palette)}`;
    if (p.action === 'photo') return `Picture ${p.regionId}: photo ${p.photoKey} fitted in`;
    if (p.action === 'remove') return `Picture ${p.regionId} removed`;
    return `Picture ${p.regionId} regenerated${p.refKey ? ` from reference ${p.refKey}` : ''}${p.instruction ? `: ${p.instruction}` : ''}`;
  };
  const what = plans.map(whatOf).join('\n');
  console.log(`[posts] ThemeRegion:${req.params.id}#${idx} ${plans.length} change(s) [${plans.map((p) => `${p.action}:${p.regionId}`).join(', ')}] → ${key} (${painted ? '1 image call' : 'no model'}, ${Date.now() - started}ms)`);
  let debug = null;
  if (wantsPromptDebug(req)) {
    const d = painted?.debug || {};
    const agents = [];
    if (painted) {
      agents.push({
        source: `Region edit (image model) · slide ${idx} · ${plans.filter((p) => p.action !== 'photo').length} area(s) in one call`,
        model: painted.model || '',
        prompt: `${d.prompt || ''}\n\nInput images: 1. the slide${plans.some((p) => p.refKey) ? ' · then the reference photo(s)' : ''} · mask: transparent over each area`,
        output: `${what}\nKept areas (px): ${JSON.stringify(d.regions || [])}${d.size ? ` · model size ${d.size}` : ''}\nThe model's own picture is below; only the areas are kept from it.`,
        elapsedMs: Number(usage?.elapsedMs) || 0,
        usage,
        ...(usage || {}),
        inputImage: { label: 'Slide before the edit', key: lead },
        outputImage: await debugImage(d.raw, req.user._id, 'Image model output (before keeping only the areas)'),
      });
    }
    agents.push({
      source: `Region edit result · slide ${idx}`,
      model: painted ? 'composite' : 'sharp (no model)',
      prompt: painted ? 'Each area from the model\'s picture, pasted back into the slide with a soft edge (photos the studio chose are fitted in first).' : '(no model call — the photos are fitted into their picture areas and pasted in)',
      output: `${what}\nSaved as ${key}`,
      inputImage: { label: 'Slide before the edit', key: lead },
      outputImage: { label: 'Slide after the edit', key },
    });
    debug = { mode: 'theme-region', elapsedMs: Date.now() - started, usage, instruction: what, agents };
  }
  return res.json({ post: record, key, src, regions: nextRegions, usage, changes: plans.length, ...(debug ? { debug } : {}) });
}

// GET /posts/:id/pre-theme — the carousel agent's design as it was before the
// first Theme Apply (agentTrace.preTheme). A re-theme renders the BASE slide
// from it and sends that as Image 1, never the previous themed render.
async function getPreTheme(req, res) {
  const record = await PlannedPost.findOne({ _id: req.params.id, user: req.user._id }, { agentTrace: 1 }).lean();
  if (!record) return res.status(404).json({ message: 'Post not found' });
  const snap = record.agentTrace?.preTheme;
  if (!snap?.carouselHtml || !Array.isArray(snap.slides)) return res.json({ carouselHtml: '', slides: [] });
  return res.json({ carouselHtml: snap.carouselHtml, slides: snap.slides, at: snap.at || null });
}

async function removeTheme(req, res) {
  const record = await PlannedPost.findOne({ _id: req.params.id, user: req.user._id });
  if (!record) return res.status(404).json({ message: 'Post not found' });
  const current = plainOf(record.content) || {};
  const stored = Array.isArray(current.slides) ? current.slides.map((s) => plainOf(s)) : [];
  const trace = record.agentTrace && typeof record.agentTrace === 'object' ? plainOf(record.agentTrace) : {};
  const snap = trace.preTheme;
  if (!stored.some(isThemedSlide)) return res.status(400).json({ message: 'This post has no theme to remove.' });
  if (!snap?.carouselHtml || !Array.isArray(snap.slides)) {
    return res.status(409).json({ needsRegenerate: true, message: 'This post was themed before its original design was saved.' });
  }
  if (snap.slides.length !== stored.length) {
    return res.status(409).json({ needsRegenerate: true, message: 'Slides were added or removed since the theme was applied, so the saved design no longer lines up.' });
  }
  const one = Number(req.body?.slideIndex) || 0;
  if (one && (one < 1 || one > stored.length)) return res.status(404).json({ message: 'Slide not found on this post.' });
  // no slideIndex: the whole carousel goes back to the agent's design
  const targets = one ? [one] : stored.map((_, i) => i + 1);
  const { sectionsOf, indexOf, buildDocument, stylesOf, linksOf } = require('../services/themeMerge');
  const { extractHtmlDocument } = require('../services/layoutHtml');
  try {
    let doc;
    const dirs = {};
    if (!one) {
      // the snapshot is the carousel as the agent left it — it replaces the document
      doc = snap.carouselHtml;
    } else {
      doc = current.carouselHtml || trace.carousel?.html || '';
      const snapDoc = extractHtmlDocument(snap.carouselHtml);
      const snapSections = sectionsOf(snapDoc);
      targets.forEach((i) => {
        const sec = snapSections.find((s) => s.articles.some((a) => indexOf(a) === i));
        const article = sec?.articles.find((a) => indexOf(a) === i);
        if (!article) throw new Error(`The saved design has no slide ${i}.`);
        const single = buildDocument({ links: linksOf(snapDoc), css: stylesOf(snapDoc), sections: [{ dir: sec.dir, articles: [article] }] });
        const merged = applySlideTheme({ currentDoc: doc, newDoc: single, slideIndex: i });
        doc = merged.html;
        dirs[i] = merged.dir;
      });
    }
    const parsed = parseCarouselDocument(doc, stored.length);
    const next = applyLayoutToContent(
      { ...current, slides: stored },
      { status: 'ready', html: parsed.html, slides: parsed.slides, themeId: current.themeId || '' },
    );
    next.slides = next.slides.map((sl, n) => {
      const i = n + 1;
      if (!targets.includes(i)) return sl;
      const was = snap.slides[n] || {};
      return { ...sl, ...was, ...(dirs[i] ? { layoutTheme: dirs[i] } : {}), layoutOptions: [] };
    });
    record.content = { ...current, ...next, slides: next.slides, carouselHtml: doc };
    const stillThemed = next.slides.some(isThemedSlide);
    if (!stillThemed) record.content.themeId = snap.themeId || '';
    record.agentTrace = {
      ...trace,
      lastRun: lastRunOf('remove-theme'),
      layout: { ...(plainOf(trace.layout) || {}), html: doc },
      carousel: { ...(plainOf(trace.carousel) || {}), html: doc },
      // a fully restored post is back to the agent's design — the next theme
      // takes a fresh snapshot
      ...(stillThemed ? {} : { preTheme: null }),
    };
    record.markModified('content');
    record.markModified('agentTrace');
    await record.save();
    console.log(`[posts] RemoveTheme:${record._id} · restored ${targets.join(',')}${stillThemed ? '' : ' · post back to the carousel agent design'}`);
    return res.json({ post: record, restored: targets });
  } catch (err) {
    console.error(`[posts] remove theme failed for ${record._id}:`, err.message);
    return res.status(500).json({ message: err.message || 'Could not remove the theme.' });
  }
}

async function applyThemeImage(req, res) {
  const record = await PlannedPost.findOne({ _id: req.params.id, user: req.user._id });
  if (!record) return res.status(404).json({ message: 'Post not found' });
  if (!isImageGenConfigured()) return res.status(503).json({ message: 'Image generation is not configured on this server.' });
  if (!isS3Configured()) return res.status(503).json({ message: 'Storage is not configured on this server.' });

  const own = `projects/${req.user._id}/`;
  // Image 2: an uploaded photo (Upload a reference) or a library theme's
  // example board (Choose from library, backend/assets/carousel-themes)
  const referenceImageKey = String(req.body?.referenceImageKey || '').trim();
  const themeId = String(req.body?.themeId || '').trim();
  const libraryTheme = !referenceImageKey && themeId ? themeById(themeId) : null;
  if (referenceImageKey && !referenceImageKey.startsWith(own)) return res.status(400).json({ message: 'Invalid reference image.' });
  if (!referenceImageKey && !libraryTheme) return res.status(400).json({ message: themeId ? 'That theme is not in the library.' : 'Choose a theme or upload a reference.' });
  const referenceLabel = libraryTheme ? `Theme — ${libraryTheme.name}` : 'Your reference photo';
  const referenceImage = libraryTheme
    ? { label: referenceLabel, path: `/carousel-themes/${libraryTheme.image}` }
    : { label: referenceLabel, key: referenceImageKey };

  const current = plainOf(record.content) || {};
  const stored = Array.isArray(current.slides) ? current.slides.map((s) => plainOf(s)) : [];
  if (!stored.length) return res.status(400).json({ message: 'This post has no slides to theme.' });
  const trace = record.agentTrace && typeof record.agentTrace === 'object' ? plainOf(record.agentTrace) : {};
  const curDoc = current.carouselHtml || trace.carousel?.html || trace.layout?.html || '';
  if (!curDoc) return res.status(400).json({ message: 'This carousel has no layout yet — run Fix layout first.' });

  const asked = Array.isArray(req.body?.slideIndexes) ? req.body.slideIndexes : [req.body?.slideIndex];
  const indexes = [...new Set(asked.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= stored.length))];
  if (!indexes.length) return res.status(400).json({ message: 'Say which slide to theme.' });

  let reference;
  try {
    if (libraryTheme) {
      const board = themeImageOf(libraryTheme);
      if (!board?.data) throw new Error(`no example image for ${libraryTheme.name}`);
      reference = { buffer: Buffer.from(board.data, 'base64') };
    } else {
      const { buffer, contentType } = await getObjectBytes(referenceImageKey);
      reference = await toVisionImage(buffer, contentType, referenceImageKey);
    }
  } catch (err) {
    return res.status(422).json({ message: `Could not read ${libraryTheme ? 'that theme' : 'that reference photo'} — ${err.message}` });
  }

  const runStarted = Date.now();
  const snapshots = req.body?.snapshots && typeof req.body.snapshots === 'object' ? req.body.snapshots : {};
  const label = record.day || record.date || record._id.toString();
  // what a themed slide keeps behind its picture: its real photo, never an
  // earlier themed render of it
  const photoKeysOf = (s) => [...(Array.isArray(s?.assetKeys) ? s.assetKeys : []), s?.assetKey]
    .map((k) => String(k || '').trim())
    .filter((k, i, all) => k.startsWith(own) && !/\/themed-/.test(k) && all.indexOf(k) === i);


  const captureErrors = req.body?.captureErrors && typeof req.body.captureErrors === 'object' ? req.body.captureErrors : {};
  // the Brand Kit colour set the studio chose for each slide ({ [index]: { name, ground, fg, accent } })
  const brandColors = req.body?.brandColors && typeof req.body.brandColors === 'object' ? req.body.brandColors : {};
  // the Brand Kit's Typography ({ heading, body, detail } family names), for every slide
  const brandFonts = req.body?.brandFonts && typeof req.body.brandFonts === 'object' ? req.body.brandFonts : null;
  // No capture from the studio: a slide already re-themed is a full picture of
  // itself (its themed key leads its keys); else the slide's last publish render.
  const hasBaseDesign = Boolean(record.agentTrace?.preTheme?.carouselHtml);
  const storedSlidePicture = async (idx) => {
    const slide = stored[idx - 1] || {};
    const lead = String((Array.isArray(slide.assetKeys) && slide.assetKeys[0]) || slide.assetKey || '');
    const published = Array.isArray(record.publishImageKeys) ? String(record.publishImageKeys[idx - 1] || '') : '';
    // a slide already themed: its base design is the source (the studio renders
    // it from agentTrace.preTheme) — the previous render is used only when the
    // post has no saved base design (themed before it was kept)
    const themedLead = /\/themed-/.test(lead);
    if (themedLead && hasBaseDesign) return null;
    const key = (lead.startsWith(own) && themedLead && lead) || (published.startsWith(own) && published) || '';
    if (!key) return null;
    try {
      const { buffer, contentType } = await getObjectBytes(key);
      const img = await toVisionImage(buffer, contentType, key);
      return { buffer: img.buffer };
    } catch (err) {
      console.warn(`[posts] ThemeApply:${label}#${idx} stored picture unreadable — ${err.message}`);
      return null;
    }
  };

  const results = {};
  const queue = [...indexes];
  const worker = async () => {
    while (queue.length) {
      const idx = queue.shift();
      try {
        const snapshot = snapshotOf(snapshots[idx]) || await storedSlidePicture(idx);
        if (!snapshot) {
          const why = String(captureErrors[idx] || '').slice(0, 200);
          throw new Error(`Could not capture slide ${idx} to re-theme it${why ? ` (${why})` : ''} — try again.`);
        }
        // the slide's primary photo — kept exactly as it is (pasted back in)
        const photoKey = photoKeysOf(stored[idx - 1])[0];
        let photo = null;
        if (photoKey) {
          try {
            const { buffer, contentType } = await getObjectBytes(photoKey);
            photo = { buffer: (await toVisionImage(buffer, contentType, photoKey)).buffer };
          } catch (err) {
            console.warn(`[posts] ThemeApply:${label}#${idx} photo unreadable — ${err.message}`);
          }
        }
        results[idx] = await applyThemeToSlide({
          slideIndex: idx,
          slide: stored[idx - 1],
          photo,
          userId: req.user._id,
          reference,
          snapshot,
          brandColors: brandColors[idx] || brandColors.all || null,
          brandFonts,
        });
      } catch (err) {
        console.error(`[posts] ThemeApply:${label}#${idx} failed:`, err.message);
        results[idx] = { error: err.message || 'failed' };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(THEME_IMAGE_CONCURRENCY, indexes.length) }, worker));

  const done = indexes.filter((i) => results[i] && !results[i].error);
  const failed = indexes.filter((i) => !done.includes(i)).map((i) => ({ index: i, message: results[i]?.error || 'failed' }));
  // the whole run for the summary row: every call's tokens and cost, wall time
  const runRows = done.map((i) => results[i].usage).filter(Boolean);
  const runUsage = runRows.reduce((acc, u) => ({
    inputTokens: acc.inputTokens + (Number(u.inputTokens) || 0),
    outputTokens: acc.outputTokens + (Number(u.outputTokens) || 0),
    totalTokens: acc.totalTokens + (Number(u.totalTokens) || 0),
    estimatedCostUsd: acc.estimatedCostUsd + (Number(u.estimatedCostUsd) || 0),
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 });
  const regionRows = wantsPromptDebug(req)
    ? (await Promise.all(done.map((i) => regionMapDebugEntry(results[i].regionsDebug, req.user._id, i)))).filter(Boolean)
    : [];
  const debugOf = () => (wantsPromptDebug(req) ? {
    debug: {
      mode: 'theme-apply',
      elapsedMs: Date.now() - runStarted,
      usage: runUsage,
      agents: [
        ...regionRows,
        ...done.map((i) => ({
          ...results[i].debugEntry,
          usage: results[i].usage,
          ...results[i].usage,
          inputImage: referenceImage,
          outputImage: { label: `Themed slide ${i}`, key: results[i].key },
        })),
      ],
    },
  } : {});
  if (!done.length) {
    return res.status(502).json({ message: failed[0]?.message || 'Could not apply the reference.', failed, ...debugOf() });
  }

  try {
    // each rendered slide moves into a section of its own, one at a time
    let doc = curDoc;
    const dirs = {};
    done.forEach((i) => {
      const merged = applySlideTheme({
        currentDoc: doc,
        newDoc: themedSlideDocument({ slideIndex: i, key: results[i].key, src: results[i].src }),
        slideIndex: i,
      });
      doc = merged.html;
      dirs[i] = merged.dir;
    });
    const parsed = parseCarouselDocument(doc, stored.length);
    const next = applyLayoutToContent(
      { ...current, slides: stored },
      { status: 'ready', html: parsed.html, slides: parsed.slides, themeId: current.themeId || '' },
    );
    next.slides = next.slides.map((sl, n) => {
      const i = n + 1;
      if (!dirs[i]) return sl;
      const was = stored[n] || {};
      const keep = Object.fromEntries(COPY_FIELDS.filter((k) => was[k] !== undefined).map((k) => [k, was[k]]));
      // the words now painted on the slide become its copy (plan list, captions)
      const lines = Array.isArray(results[i].textLines) ? results[i].textLines : [];
      const head = lines.find((l) => /head/i.test(l.role));
      const rest = lines.filter((l) => l !== head).map((l) => l.text);
      if (head || rest.length) {
        keep.title = head?.text || keep.title || '';
        keep.subtitle = rest[0] || '';
        keep.body = rest.slice(1).join('\n');
        keep.items = [];
      }
      const key = results[i].key;
      // the words stay on the record (plan list, caption context); the picture
      // leads the slide's keys, its real photo stays behind it for a re-theme
      return {
        ...sl,
        ...keep,
        layout: 'dynamic',
        layoutTheme: dirs[i],
        layoutOptions: [],
        assetKey: key,
        assetKeys: [key, ...photoKeysOf(was)],
        themeRegions: results[i].regions || null,
      };
    });
    // the carousel agent's design, kept for Themes › Remove theme: taken when
    // the post is not themed yet — a second theme keeps the original snapshot
    const themedBefore = stored.some((sl) => isThemedSlide(sl));
    const preTheme = themedBefore
      ? (trace.preTheme || null)
      : { at: new Date().toISOString(), carouselHtml: curDoc, themeId: current.themeId || '', slides: stored.map(preThemeSlide) };
    record.content = { ...current, ...next, slides: next.slides, carouselHtml: doc };
    // a library theme on every slide is the post's theme (the library marks it)
    if (libraryTheme && done.length === stored.length) record.content.themeId = libraryTheme.id;
    record.agentTrace = {
      ...trace,
      lastRun: lastRunOf('theme', ['themeApply']),
      layout: { ...(plainOf(trace.layout) || {}), html: doc },
      carousel: { ...(plainOf(trace.carousel) || {}), html: doc },
      ...(preTheme ? { preTheme } : {}),
      themeApply: [
        ...(Array.isArray(trace.themeApply) ? trace.themeApply : []).slice(-19),
        {
          at: new Date().toISOString(),
          referenceKey: referenceImageKey,
          referenceTheme: libraryTheme ? { id: libraryTheme.id, name: libraryTheme.name, path: referenceImage.path } : null,
          // each step's prompt, output and cost — the post's Debug tab reads these
          slides: done.map((i) => ({
            index: i,
            key: results[i].key,
            renderPrompt: results[i].renderPrompt,
            renderModel: results[i].debugEntry?.model || '',
            primaryImage: results[i].primaryImage || null,
            check: results[i].check || null,
            textLines: results[i].textLines,
            ...(results[i].brandColors ? { brandColors: results[i].brandColors } : {}),
            ...(results[i].brandFonts ? { brandFonts: results[i].brandFonts } : {}),
            usage: results[i].usage,
          })),
          failed,
        },
      ],
    };
    record.markModified('content');
    record.markModified('agentTrace');
    await record.save();
    console.log(`[posts] ThemeApply:${label} · themed ${done.join(',')}${failed.length ? ` · failed ${failed.map((f) => f.index).join(',')}` : ''}`);
    return res.json({
      post: record,
      applied: done.map((i) => ({ index: i, key: results[i].key, src: results[i].src })),
      failed,
      ...debugOf(),
    });
  } catch (err) {
    console.error(`[posts] ThemeApply:${label} merge failed:`, err.message);
    return res.status(500).json({ message: err.message || 'Could not place the themed slide.', ...debugOf() });
  }
}

// POST /posts/:id/slide/:slideIndex/layout-variations — on-demand variations for
// one slide (the Change layout picker). Composes four fresh layouts in the
// slide's current theme, stored on that slide's layoutOptions.
async function rerunSlideLayoutVariations(req, res) {
  const slideParam = Number(req.params.slideIndex);
  const record = await PlannedPost.findOne({ _id: req.params.id, user: req.user._id });
  if (!record) return res.status(404).json({ message: 'Post not found' });

  const trace = record.agentTrace && typeof record.agentTrace === 'object' ? record.agentTrace : {};
  const stored = Array.isArray(record?.content?.slides) ? record.content.slides.map((s) => plainOf(s)) : [];
  if (!stored.length) {
    return res.status(400).json({ message: 'This post has no slides to lay out.' });
  }

  const slideIndex = Number.isFinite(slideParam) && slideParam > 0 ? slideParam : 1;
  const targetIdx = stored.findIndex((s, i) => ((Number(s?.index) > 0 ? Number(s.index) : i + 1) === slideIndex));
  if (targetIdx < 0) return res.status(404).json({ message: 'Slide not found on this post.' });

  const storedTarget = stored[targetIdx] || {};
  const currentHtml = String(storedTarget?.layoutHtml || '');
  const post = { format: record.format, status: 'ready', content: { slides: [storedTarget] } };
  const label = record.day || (record.date ? record.date.toISOString().slice(0, 10) : record._id.toString());
  const dna = await loadBrandDna(req.user._id, record.instagramUsername).catch(() => null);
  const brand = compileBrandMemory(dna);

  try {
    const result = await writeLayoutVariations({
      source: `LayoutVariations:${label}#${slideIndex}`,
      post,
      index: slideIndex,
      brand,
      currentHtml,
    });
    const bakedImage = copyFromLayoutHtml(currentHtml)?.image || null;
    const planSlide = (result.parsed?.slides || [])[0];
    const options = (Array.isArray(planSlide?.options) ? planSlide.options : [])
      .map((o, i) => ({
        rank: Number(o?.rank) > 0 ? Number(o.rank) : i + 1,
        label: String(o?.label || ''),
        reason: String(o?.reason || ''),
        html: injectImageIntoSlots(String(o?.html || ''), bakedImage),
        direction: String(o?.direction || ''),
      }))
      .filter((o) => o.html);
    if (result.parsed?.status === 'failed' || !options.length) {
      return res.status(422).json({
        message: result.parsed?.failureReason || 'Layout agent could not compose this slide.',
      });
    }

    const originalOption = currentHtml ? {
      rank: 0,
      label: 'Original',
      reason: 'The layout this slide started with',
      html: currentHtml,
      direction: String(storedTarget?.layoutTheme || ''),
      original: true,
    } : null;
    const storedOptions = originalOption ? [originalOption, ...options] : options;

    const slides = Array.isArray(record.content?.slides) ? record.content.slides.map((s) => plainOf(s)) : [];
    const writeIdx = slides.findIndex((s, i) => ((Number(s?.index) > 0 ? Number(s.index) : i + 1) === slideIndex));
    if (writeIdx >= 0) {
      const prev = slides[writeIdx] || {};
      slides[writeIdx] = {
        ...prev,
        layout: 'dynamic',
        layoutHtml: String(prev.layoutHtml || '') || options[0].html,
        layoutOptions: storedOptions,
      };
      record.content = { ...(plainOf(record.content) || {}), slides };
      record.markModified('content');
      await record.save();
    }

    return res.json({
      options: storedOptions,
      slideIndex,
      ...(wantsPromptDebug(req) ? {
        debug: {
          mode: 'layout-variations-debug',
          model: result.usage?.model || result.debugEntry?.model,
          usage: result.usage || result.debugEntry?.usage || null,
          agents: [{
            source: result.debugEntry?.source || `LayoutVariations:${label}#${slideIndex}`,
            model: result.debugEntry?.model,
            provider: result.debugEntry?.provider || '',
            prompt: result.debugEntry?.prompt,
            output: result.debugEntry?.output || '',
            elapsedMs: Number(result.debugEntry?.elapsedMs || result.usage?.elapsedMs) || 0,
            usage: result.usage || result.debugEntry?.usage || null,
          }],
          elapsedMs: Number(result.debugEntry?.elapsedMs || result.usage?.elapsedMs) || 0,
        },
      } : {}),
    });
  } catch (err) {
    const status = err.statusCode || err.status || 502;
    console.error(`[posts] layout variations failed for ${label}#${slideIndex}:`, err.message);
    return res.status(status).json({ message: err.message || 'Could not run the layout agent.' });
  }
}

// POST /posts/:id/cover — Animated Carousel Cover agent for this post's hook.
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');

async function renderCover(req, res) {
  const record = await PlannedPost.findOne({ _id: req.params.id, user: req.user._id });
  if (!record) return res.status(404).json({ message: 'Post not found' });

  const trace = record.agentTrace && typeof record.agentTrace === 'object' ? plainOf(record.agentTrace) : {};
  const structure = trace.structure || {};
  const brief = trace.strategyBrief || {};
  const label = record.day || (record.date ? record.date.toISOString().slice(0, 10) : record._id.toString());
  if (!structure || !Array.isArray(structure.slidesOrScenes) || !structure.slidesOrScenes.length) {
    return res.status(400).json({ message: 'This post has no content structure to build a cover from.' });
  }

  const dna = await loadBrandDna(req.user._id, record.instagramUsername).catch(() => null);
  const brand = dna ? { offer: dna.whatYouOffer, voice: dna.howYouSound, visualStyle: dna.visualStyle } : {};
  const visual = req.body && typeof req.body.visual === 'object' ? req.body.visual : null;

  const hookSlide = (Array.isArray(record.content?.slides) ? record.content.slides : [])[0] || {};
  const hookImageKey = optionalText(hookSlide.assetKey)
    || (Array.isArray(hookSlide.assetKeys) ? hookSlide.assetKeys.find(Boolean) : '')
    || '';
  let image = null;
  if (hookImageKey) {
    try {
      const url = await getMediaUrl(hookImageKey);
      if (url) {
        image = {
          url,
          description: optionalText(hookSlide.imagePrompt)
            || optionalText(hookSlide.visualNeed?.visualCommunicationNeed)
            || optionalText(hookSlide.title)
            || 'the post’s hook photo',
        };
      }
    } catch (err) {
      console.warn(`[posts] Cover:${label} could not resolve hook image — ${err.message}`);
    }
  }

  const started = Date.now();
  const outPath = path.join(os.tmpdir(), `cover-${crypto.randomUUID()}.mp4`);
  try {
    const { spec, model, usage } = await generateCoverSpec({ brief, structure, brand, visual, image });
    await renderCoverVideo({ spec, outPath, timeoutMs: 180000 });
    const buffer = fs.readFileSync(outPath);

    let videoKey = '';
    let videoUrl = '';
    if (isS3Configured()) {
      videoKey = `projects/${req.user._id}/cover-${crypto.randomUUID()}.mp4`;
      await uploadBytes(videoKey, buffer, 'video/mp4');
    } else {
      videoUrl = `data:video/mp4;base64,${buffer.toString('base64')}`;
    }

    const cover = { spec, videoKey, model, updatedAt: new Date().toISOString() };
    record.agentTrace = { ...trace, cover };
    record.markModified('agentTrace');
    await record.save();

    console.log(
      `[posts] Cover:${label} · ${Math.round((Date.now() - started) / 100) / 10}s` +
        ` · ${videoKey ? `s3 ${videoKey}` : 'inline'} · ${usage?.total_tokens || usage?.output_tokens || '?'} tok`,
    );
    return res.json({ post: record, cover: { spec, videoKey, videoUrl } });
  } catch (err) {
    const status = err.statusCode || err.status || 502;
    console.error(`[posts] cover render failed for ${label}:`, err.message);
    return res.status(status).json({ message: err.message || 'Could not create the video cover.' });
  } finally {
    try { fs.unlinkSync(outPath); } catch { /* ignore */ }
  }
}

module.exports = {
  deletePost,
  generateAndSavePosts,
  getPosts,
  getPostById,
  getPostOptions,
  getPostDebug,
  generatePlan,
  clearUpcoming,
  distributePosts,
  getDistribution,
  setDistribution,
  shiftPosts,
  updatePost,
  polishCaption,
  refinePost,
  addSlideToPost,
  getPostProject,
  rerunLayout,
  rerunSlideLayoutVariations,
  applyThemeImage,
  removeTheme,
  getPreTheme,
  mapThemeRegions,
  editThemeRegion,
  renderCover,
};
