const PlannedPost = require('../models/PlannedPost');
const { generateWeeklyPlan, buildEmptySlots, isoDate } = require('../services/weeklyPlan');
const { rewriteCaption } = require('../services/captionPolish');
const { runLayoutForPost, writeLayoutVariations, applyLayoutToContent, normalizeWriterPost } = require('../services/planOrchestrator');
const { copyFromLayoutHtml, injectImageIntoSlots } = require('../services/layoutHtml');
const { compileBrandMemory } = require('../services/planContext');
const { generateCoverSpec, renderCoverVideo } = require('../services/carouselCoverAgent');
const { isS3Configured, uploadBytes, getMediaUrl } = require('../services/s3Client');
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
function plainOf(value) {
  if (value == null) return value;
  if (typeof value.toObject === 'function') return value.toObject();
  try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
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
    agentTrace: plainOf(d.agentTrace) || null,
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
  const emptySlots = buildEmptySlots({ fromDate: today, occupiedDates: existingPosts.map((p) => p.date) });
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
    return { posts: [], count: 0, debug: plan.debug || null, emptyReason };
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
async function getPosts(req, res) {
  const profile = await currentProfile(req.user._id);
  if (!profile) return res.json({ posts: [], username: null, preparing: false });

  const posts = await PlannedPost.find({
    user: req.user._id,
    instagramUsername: profile.username,
  }).sort({ date: 1 }).select('-content -agentTrace').lean();

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
  console.log(`[posts] POST /posts/generate trigger=${trigger} user=${req.user._id} @${profile.username}` +
    (sessionId ? ` session=${sessionId}` : ''));

  const { posts, count, debug, emptyReason } = await generateAndSavePosts(req.user._id, profile, trigger, {
    sessionId,
    captureIds,
  });
  if (emptyReason && !count) {
    const out = { message: emptyReason };
    if (wantsPromptDebug(req) && (debug?.agents?.length || debug?.finalPrompt)) out.debug = debug;
    return res.status(422).json(out);
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

// DELETE /posts — clear upcoming (unpublished, today onward) posts for the
// current handle. Past and already-published posts stay. Replaces the old
// "clear this month" action now that there is no month grouping.
async function clearUpcoming(req, res) {
  const profile = await currentProfile(req.user._id);
  if (!profile) return res.status(404).json({ message: 'No Instagram profile found.' });

  const result = await PlannedPost.deleteMany({
    user: req.user._id,
    instagramUsername: profile.username,
    published: { $ne: true },
    date: { $gte: isoDate(startOfDay()) },
  });
  console.log(`[posts] clear-upcoming @${profile.username} · deleted=${result.deletedCount}`);
  res.json({ deleted: result.deletedCount });
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

// POST /posts/:id/layout — run the Carousel agent on this post only.
async function rerunLayout(req, res) {
  const record = await PlannedPost.findOne({ _id: req.params.id, user: req.user._id });
  if (!record) return res.status(404).json({ message: 'Post not found' });

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
  const brand = compileBrandMemory(dna);
  const dayWriterOutput = plainOf(trace.dayWriter)
    || (Array.isArray(post.content?.slides) ? { content: { slides: post.content.slides } } : '');

  try {
    const result = await runLayoutForPost({
      source: `Carousel:${label}:debug`,
      structure,
      post,
      dayBrief: plainOf(trace.strategyBrief) || {},
      brand,
      dayWriterOutput,
    });
    if (result.parsed?.status === 'failed') {
      return res.status(422).json({
        message: result.parsed.failureReason || 'Carousel agent could not compose this post.',
        layout: result.parsed,
      });
    }

    const current = plainOf(record.content) || {};
    const next = applyLayoutToContent({ ...current, slides: post.content.slides }, result.parsed);
    record.content = { ...current, ...next, slides: next.slides };
    record.agentTrace = { ...trace, layout: result.parsed, carousel: result.parsed };
    record.markModified('content');
    record.markModified('agentTrace');
    await record.save();

    const debugEntry = result.debugEntry || {};
    return res.json({
      post: record,
      layout: result.parsed,
      carousel: result.parsed,
      ...(wantsPromptDebug(req) ? {
        debug: {
          mode: 'carousel-debug',
          model: result.usage?.model || debugEntry.model,
          usage: result.usage || debugEntry.usage || null,
          agents: [{
            source: debugEntry.source || `Carousel:${label}:debug`,
            model: debugEntry.model,
            provider: debugEntry.provider || '',
            prompt: debugEntry.prompt,
            output: debugEntry.output || '',
            elapsedMs: Number(debugEntry.elapsedMs || result.usage?.elapsedMs) || 0,
            usage: result.usage || debugEntry.usage || null,
            inputTokens: Number(result.usage?.inputTokens || debugEntry.usage?.inputTokens) || 0,
            outputTokens: Number(result.usage?.outputTokens || debugEntry.usage?.outputTokens) || 0,
            totalTokens: Number(result.usage?.totalTokens || debugEntry.usage?.totalTokens) || 0,
            estimatedCostUsd: Number(result.usage?.estimatedCostUsd || debugEntry.usage?.estimatedCostUsd) || 0,
          }],
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
  generateAndSavePosts,
  getPosts,
  getPostById,
  getPostOptions,
  getPostDebug,
  generatePlan,
  clearUpcoming,
  updatePost,
  polishCaption,
  rerunLayout,
  rerunSlideLayoutVariations,
  renderCover,
};
