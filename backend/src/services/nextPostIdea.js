/*
 * Next-post idea agent — "What could you share next?" after a plan run.
 *
 * Reads what Bauhly already knows about the account:
 *   - Brand memory (planInputs.loadBrandDna)
 *   - the last 10 Instagram posts (postRemix.loadRemixPosts — month cache,
 *     the same list Post remix shows; no extra Instagram fetch most of the time)
 *   - the latest Bauhly posts (PlannedPost); one already published on Instagram
 *     is counted once, under Instagram (matched by igMediaId)
 *   - the captures (their words, used-in-post state, open questions, photos)
 *   - ideas the studio dismissed
 * and asks one model call to tag untagged posts Passion / Skills / Story and
 * return up to 3 ranked ideas, each citing its sources.
 *
 * Code-side guardrails: sources and assets are checked against what was sent
 * (unknown ids/keys are dropped); an idea left with no source becomes
 * question-led; at most 2 questions. While nothing it read has changed
 * (`basedOn` fingerprint) the stored batch is served again — no model call.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PostIdea = require('../models/PostIdea');
const PlannedPost = require('../models/PlannedPost');
const Project = require('../models/Project');
const BrandAnalysisReport = require('../models/BrandAnalysisReport');
const { completeToolCall } = require('./llmComplete');
const { loadBrandDna } = require('./planInputs');
const { loadRemixPosts } = require('./postRemix');
const { isS3Configured, getPresignedMediaUrl } = require('./s3Client');
const { LANGUAGES } = require('../utils/appLocale');

const PROMPT_FILE = path.join(__dirname, '..', '..', 'prompts', 'next-post-idea.md');
const PILLARS = ['passion', 'skills', 'story'];
const MAX_IDEAS = 3;
const MAX_QUESTIONS = 2;
const MAX_ASSETS = 4;
const BAUHLY_POSTS = 20;
const CAPTURES = 30;
const ASSETS_PER_CAPTURE = 8;
const DISMISSED = 20;

function ideaModel() {
  return process.env.NEXT_IDEA_MODEL || 'gpt-6-luna';
}

let promptCache = null;
const loadPrompt = () => (promptCache ||= fs.readFileSync(PROMPT_FILE, 'utf8'));

const clip = (v, max) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const str = (v, max = 400) => (typeof v === 'string' ? clip(v, max) : '');
const pillarOf = (v) => (PILLARS.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : '');
const igIdOf = (p) => String(p?.externalId || p?.url || '').trim();
// Mongo field names can't hold '.' or a leading '$' (ids may be URLs)
const tagKey = (id) => String(id).replace(/[.$]/g, '_');
const dayOf = (d) => {
  const t = d ? new Date(d) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toISOString().slice(0, 10) : '';
};

// ── what the agent reads ──────────────────────────────────────────────────────

async function loadInstagramPosts(userId, username) {
  try {
    const snap = await loadRemixPosts(userId, username);
    return snap.posts || [];
  } catch (err) {
    // a failed Instagram read must not sink the idea — Bauhly's own posts still count
    console.warn(`[nextPostIdea] @${username} Instagram posts unavailable:`, err.message);
    return [];
  }
}

async function loadBauhlyPosts(userId, username) {
  return PlannedPost.find({ user: userId, instagramUsername: username })
    .sort({ date: -1 })
    .limit(BAUHLY_POSTS)
    .select('date title direction format published igMediaId contentPillar updatedAt content.caption content.strategy')
    .lean();
}

function captureWords(c) {
  return String(c.understanding?.originalCapture || c.text || c.sessionSummary || '').trim();
}

async function loadCaptures(userId, username) {
  const projects = await Project.find({ user: userId, instagramUsername: username })
    .sort({ updatedAt: -1 })
    .limit(20)
    .select('name captures')
    .lean();
  const rows = [];
  for (const p of projects) {
    for (const c of p.captures || []) {
      if (c.excluded) continue;
      const words = captureWords(c);
      const assets = (c.attachments || [])
        .filter((a) => a.key && (a.type === 'image' || a.type === 'video'))
        .slice(0, ASSETS_PER_CAPTURE)
        .map((a) => ({
          key: a.key,
          type: a.type,
          shows: clip(a.analysis?.summary || a.analysis?.description || '', 160),
        }));
      if (!words && !assets.length) continue;
      rows.push({
        id: String(c._id),
        project: p.name || '',
        createdAt: c.createdAt,
        words,
        usedInPosts: (c.usedInPosts || []).length,
        openQuestions: (c.clarifyQuestions || []).slice(0, 3),
        assets,
      });
    }
  }
  rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return rows.slice(0, CAPTURES);
}

async function loadDismissed(userId, username) {
  return PostIdea.find({ user: userId, instagramUsername: username, status: 'dismissed' })
    .sort({ decidedAt: -1 })
    .limit(DISMISSED)
    .select('title pillar')
    .lean();
}

async function loadMaterial(userId, username) {
  const [memory, igPosts, bauhly, captures, dismissed, report] = await Promise.all([
    loadBrandDna(userId, username).catch(() => null),
    loadInstagramPosts(userId, username),
    loadBauhlyPosts(userId, username),
    loadCaptures(userId, username),
    loadDismissed(userId, username),
    BrandAnalysisReport.findOne({ user: userId, instagramUsername: username })
      .sort({ createdAt: -1 }).select('igPillarTags').lean(),
  ]);
  return { memory, igPosts, bauhly, captures, dismissed, igTags: report?.igPillarTags || {} };
}

/** The JSON the model reads, plus the lookups the code checks its answer against. */
function contextOf(material) {
  const { memory, igPosts, bauhly, captures, dismissed, igTags } = material;
  const igIds = new Set(igPosts.map(igIdOf).filter(Boolean));

  const instagramPosts = igPosts.map((p) => ({
    id: igIdOf(p),
    type: p.type || 'post',
    date: dayOf(p.timestamp),
    caption: clip(p.caption, 700),
    likes: Number(p.likesCount) || 0,
    comments: Number(p.commentsCount) || 0,
    ...(pillarOf(igTags[tagKey(igIdOf(p))]) ? { pillar: pillarOf(igTags[tagKey(igIdOf(p))]) } : {}),
  })).filter((p) => p.id);

  // a published Bauhly post that is also among the Instagram posts counts once
  const bauhlyPosts = bauhly
    .filter((p) => !(p.igMediaId && igIds.has(String(p.igMediaId))))
    .map((p) => ({
      id: String(p._id),
      date: p.date,
      state: p.published ? 'published' : 'planned',
      format: p.format || '',
      title: clip(p.title, 140),
      direction: clip(p.direction || p.content?.strategy, 300),
      caption: clip(p.content?.caption, 300),
      ...(pillarOf(p.contentPillar) ? { pillar: p.contentPillar } : {}),
    }));

  const brandMemory = {};
  if (memory) {
    for (const k of ['whatYouOffer', 'whoYouHelp', 'firstProblem', 'position', 'proof', 'howYouSound', 'neverDo']) {
      if (memory[k]) brandMemory[k] = clip(memory[k], 600);
    }
  }

  const ctx = {
    today: dayOf(new Date()),
    brandMemory,
    instagramPosts,
    bauhlyPosts,
    captures: captures.map((c) => ({
      id: c.id,
      project: c.project,
      date: dayOf(c.createdAt),
      words: clip(c.words, 900),
      usedInPosts: c.usedInPosts,
      ...(c.openQuestions.length ? { openQuestions: c.openQuestions } : {}),
      assets: c.assets.map((a) => ({ key: a.key, type: a.type, ...(a.shows ? { shows: a.shows } : {}) })),
    })),
    dismissed: dismissed.map((d) => ({ title: d.title, pillar: d.pillar })),
  };

  const lookups = {
    captureIds: new Set(captures.map((c) => c.id)),
    postIds: new Set(bauhlyPosts.map((p) => p.id)),
    allBauhlyIds: new Set(bauhly.map((p) => String(p._id))),
    igIds,
    memoryFields: new Set(Object.keys(brandMemory)),
    assets: new Map(captures.flatMap((c) => c.assets.map((a) => [a.key, { ...a, captureId: c.id }]))),
    untaggedIg: instagramPosts.filter((p) => !p.pillar).map((p) => p.id),
    untaggedBauhly: bauhlyPosts.filter((p) => !p.pillar).map((p) => p.id),
    labels: new Map([
      // the catch-all projects ("No project", "Content ideas") are not a project name to show
      ...captures.map((c) => [`capture:${c.id}`,
        c.project && !/^(no project|content ideas)$/i.test(c.project) ? `${c.project} capture` : 'Your capture']),
      ...bauhlyPosts.map((p) => [`post:${p.id}`, p.title || `Post · ${p.date}`]),
      ...instagramPosts.map((p) => [`igPost:${p.id}`, clip(p.caption, 60) || `Instagram post · ${p.date}`]),
    ]),
  };
  return { ctx, lookups };
}

/** Changes whenever anything the agent reads changes. Dismissals are left out:
 *  turning one idea down moves along the batch, it doesn't pay for a new run. */
function fingerprintOf(ctx, locale) {
  const basis = {
    locale,
    m: ctx.brandMemory,
    ig: ctx.instagramPosts.map((p) => p.id),
    b: ctx.bauhlyPosts.map((p) => `${p.id}:${p.state}:${p.title}`),
    c: ctx.captures.map((c) => `${c.id}:${c.usedInPosts}:${c.words.length}:${c.assets.length}`),
  };
  return crypto.createHash('sha1').update(JSON.stringify(basis)).digest('hex');
}

// ── the model call ────────────────────────────────────────────────────────────

const IDEA_TOOL = {
  name: 'suggest_next_posts',
  description: 'Tag untagged past posts by pillar and return up to 3 ranked next-post ideas.',
  input_schema: {
    type: 'object',
    properties: {
      pillarTags: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['igPost', 'post'] },
            id: { type: 'string' },
            pillar: { type: 'string', enum: PILLARS },
          },
          required: ['kind', 'id', 'pillar'],
        },
      },
      balanceNote: { type: 'string', description: 'One sentence: what the recent mix of pillars looks like.' },
      ideas: {
        type: 'array',
        maxItems: MAX_IDEAS,
        items: {
          type: 'object',
          properties: {
            rank: { type: 'integer' },
            pillar: { type: 'string', enum: PILLARS },
            title: { type: 'string' },
            eyebrow: { type: 'string' },
            why: { type: 'string' },
            opening: { type: 'string' },
            known: { type: 'array', items: { type: 'string' } },
            questions: { type: 'array', items: { type: 'string' }, maxItems: MAX_QUESTIONS },
            sources: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  kind: { type: 'string', enum: ['capture', 'post', 'igPost', 'memory'] },
                  id: { type: 'string' },
                },
                required: ['kind', 'id'],
              },
            },
            questionLed: { type: 'boolean' },
            assets: {
              type: 'array',
              items: {
                type: 'object',
                properties: { key: { type: 'string' }, reason: { type: 'string' } },
                required: ['key'],
              },
            },
            scores: {
              type: 'object',
              properties: {
                relevance: { type: 'number' },
                balance: { type: 'number' },
                novelty: { type: 'number' },
                info: { type: 'number' },
              },
            },
          },
          required: ['pillar', 'title', 'why', 'opening', 'sources'],
        },
      },
    },
    required: ['pillarTags', 'ideas'],
  },
};

function languageRule(locale) {
  if (!locale || locale === 'en' || !LANGUAGES[locale]) return 'Write every text field in English.';
  return `Write every text field (title, eyebrow, why, opening, known, questions, asset reasons) in ${LANGUAGES[locale]}. Keep names, places and quoted words as they are.`;
}

async function callModel(ctx, locale) {
  const model = ideaModel();
  const system = loadPrompt().split('{{LANGUAGE_RULE}}').join(languageRule(locale));
  const user = JSON.stringify(ctx, null, 1);
  const started = Date.now();
  const res = await completeToolCall({
    model,
    system,
    userParts: [{ type: 'text', text: user }],
    tool: IDEA_TOOL,
    maxTokens: 6000,
    cacheKey: 'next-post-idea',
    kind: 'strategist',
    reasoningEffort: 'low',
    timeoutMs: 120000,
    retryHint: 'Your last answer was not valid JSON for the schema. Return ONLY the JSON object.',
  });
  const elapsedMs = Date.now() - started;
  const usage = res.usage || {};
  // lazy: weeklyPlan is large and pulls in the whole planner
  const { estimatePlanCostUsd } = require('./weeklyPlan');
  const costUsd = estimatePlanCostUsd(res.model || model, usage.input_tokens || 0, usage.output_tokens || 0, usage.cached_tokens || 0);
  const debugRow = {
    source: 'Next-post idea',
    model: res.model || model,
    prompt: `${system}\n\n--- USER ---\n${user}`,
    output: res.output || JSON.stringify(res.parsed, null, 2),
    elapsedMs,
    usage: {
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cachedTokens: usage.cached_tokens || 0,
      totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      estimatedCostUsd: costUsd,
    },
  };
  return { parsed: res.parsed || {}, model: res.model || model, debugRow };
}

// ── checking the answer ───────────────────────────────────────────────────────

function cleanSources(list, lookups) {
  const seen = new Set();
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    const kind = String(s?.kind || '');
    const id = String(s?.id || '').trim();
    const ok = (kind === 'capture' && lookups.captureIds.has(id))
      || (kind === 'post' && lookups.allBauhlyIds.has(id))
      || (kind === 'igPost' && lookups.igIds.has(id))
      || (kind === 'memory' && lookups.memoryFields.has(id));
    const k = `${kind}:${id}`;
    if (!ok || seen.has(k)) continue;
    seen.add(k);
    out.push({ kind, id, label: kind === 'memory' ? 'Business memory' : (lookups.labels.get(k) || '') });
  }
  return out;
}

function cleanAssets(list, lookups) {
  const seen = new Set();
  const out = [];
  for (const a of Array.isArray(list) ? list : []) {
    const key = String(a?.key || '').trim();
    const known = lookups.assets.get(key);
    if (!known || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, captureId: known.captureId, type: known.type, reason: str(a.reason, 200) });
    if (out.length >= MAX_ASSETS) break;
  }
  return out;
}

function cleanIdeas(parsed, lookups) {
  const raw = Array.isArray(parsed.ideas) ? parsed.ideas : [];
  const usedCaptures = new Set();
  const ideas = [];
  for (const r of raw) {
    const pillar = pillarOf(r?.pillar);
    const title = str(r?.title, 120);
    if (!pillar || !title) continue;
    const sources = cleanSources(r.sources, lookups);
    // never the same capture twice in one batch
    const lead = sources.find((s) => s.kind === 'capture');
    if (lead && usedCaptures.has(lead.id)) continue;
    if (lead) usedCaptures.add(lead.id);
    const questionLed = !sources.length || Boolean(r.questionLed);
    const questions = (Array.isArray(r.questions) ? r.questions : [])
      .map((q) => str(q, 220)).filter(Boolean).slice(0, MAX_QUESTIONS);
    ideas.push({
      rank: Number(r.rank) || ideas.length + 1,
      pillar,
      title,
      eyebrow: str(r.eyebrow, 80),
      why: str(r.why, 400),
      opening: str(r.opening, 400) || title,
      known: (Array.isArray(r.known) ? r.known : []).map((k) => str(k, 240)).filter(Boolean).slice(0, 6),
      // a question-led idea has nothing on file: it must ask at least once
      questions: questionLed && !questions.length ? [str(r.opening, 220) || title] : questions,
      sources,
      questionLed,
      assets: cleanAssets(r.assets, lookups),
      scores: r.scores && typeof r.scores === 'object' ? {
        relevance: Number(r.scores.relevance) || 0,
        balance: Number(r.scores.balance) || 0,
        novelty: Number(r.scores.novelty) || 0,
        info: Number(r.scores.info) || 0,
      } : null,
    });
  }
  ideas.sort((a, b) => a.rank - b.rank);
  return ideas.slice(0, MAX_IDEAS).map((idea, i) => ({ ...idea, rank: i + 1 }));
}

/** Stores the Passion / Skills / Story tags the agent gave untagged posts. */
async function saveTags(userId, username, parsed, lookups) {
  const tags = Array.isArray(parsed.pillarTags) ? parsed.pillarTags : [];
  const untaggedIg = new Set(lookups.untaggedIg);
  const untaggedBauhly = new Set(lookups.untaggedBauhly);
  const ig = {};
  const posts = [];
  for (const t of tags) {
    const pillar = pillarOf(t?.pillar);
    const id = String(t?.id || '').trim();
    if (!pillar || !id) continue;
    if (t.kind === 'igPost' && untaggedIg.has(id)) ig[id] = pillar;
    if (t.kind === 'post' && untaggedBauhly.has(id)) posts.push({ id, pillar });
  }
  const jobs = [];
  if (Object.keys(ig).length) {
    const set = Object.fromEntries(Object.entries(ig).map(([id, p]) => [`igPillarTags.${tagKey(id)}`, p]));
    jobs.push(BrandAnalysisReport.findOne({ user: userId, instagramUsername: username }).sort({ createdAt: -1 }).select('_id').lean()
      .then((r) => r && BrandAnalysisReport.updateOne({ _id: r._id }, { $set: set })));
  }
  if (posts.length) {
    jobs.push(PlannedPost.bulkWrite(posts.map((p) => ({
      updateOne: { filter: { _id: p.id, user: userId, contentPillar: '' }, update: { $set: { contentPillar: p.pillar } } },
    }))));
  }
  await Promise.all(jobs).catch((err) => console.warn('[nextPostIdea] could not store pillar tags:', err.message));
  return { instagram: Object.keys(ig).length, bauhly: posts.length };
}

// ── what the client gets ──────────────────────────────────────────────────────

async function forClient(doc) {
  const canSign = isS3Configured();
  const assets = await Promise.all((doc.assets || []).map(async (a) => ({
    key: a.key,
    captureId: a.captureId,
    type: a.type,
    reason: a.reason,
    url: canSign ? await getPresignedMediaUrl(a.key).catch(() => '') : '',
  })));
  return {
    id: String(doc._id),
    batchId: doc.batchId,
    rank: doc.rank,
    status: doc.status,
    pillar: doc.pillar,
    title: doc.title,
    eyebrow: doc.eyebrow,
    why: doc.why,
    opening: doc.opening,
    questions: doc.questions || [],
    known: doc.known || [],
    sources: doc.sources || [],
    questionLed: Boolean(doc.questionLed),
    assets,
    scores: doc.scores || null,
    createdAt: doc.createdAt,
  };
}

// ── entry points ──────────────────────────────────────────────────────────────

/**
 * The current batch of suggested ideas for the handle. Serves the stored
 * batch while nothing it was based on has changed (unless `refresh`);
 * otherwise runs the agent. Returns { ideas, basedOn, cached, balanceNote, debug? }.
 */
async function nextIdeas(userId, username, { locale = 'en', refresh = false, debug = null } = {}) {
  const handle = String(username || '').toLowerCase();
  const material = await loadMaterial(userId, handle);
  const { ctx, lookups } = contextOf(material);
  const basedOn = fingerprintOf(ctx, locale);

  if (!refresh) {
    const latest = await PostIdea.findOne({ user: userId, instagramUsername: handle })
      .sort({ createdAt: -1 }).select('batchId basedOn').lean();
    if (latest && latest.basedOn === basedOn) {
      const batch = await PostIdea.find({ user: userId, instagramUsername: handle, batchId: latest.batchId, status: 'suggested' })
        .sort({ rank: 1 }).lean();
      // all of them turned down or explored: time for fresh ones
      if (batch.length) return { ideas: await Promise.all(batch.map(forClient)), basedOn, cached: true };
    }
  }

  // nothing to build on at all: say so rather than make something up
  if (!ctx.captures.length && !ctx.instagramPosts.length && !ctx.bauhlyPosts.length && !Object.keys(ctx.brandMemory).length) {
    return { ideas: [], basedOn, cached: false, empty: true };
  }

  const { parsed, model, debugRow } = await callModel(ctx, locale);
  debug?.push(debugRow);
  const ideas = cleanIdeas(parsed, lookups);
  const tagged = await saveTags(userId, handle, parsed, lookups);
  console.log(
    `[nextPostIdea] @${handle} ${model} · ${ideas.length} idea(s) · tagged ${tagged.instagram} IG + ${tagged.bauhly} Bauhly`
    + ` · ${debugRow.usage.inputTokens}+${debugRow.usage.outputTokens} tok · ~$${debugRow.usage.estimatedCostUsd.toFixed(4)}`
    + ` · ${debugRow.elapsedMs}ms`,
  );

  const batchId = crypto.randomUUID();
  // an older batch nobody acted on is replaced, not stacked up
  await PostIdea.deleteMany({ user: userId, instagramUsername: handle, status: 'suggested' });
  const docs = ideas.length
    ? await PostIdea.insertMany(ideas.map((idea) => ({
      ...idea, user: userId, instagramUsername: handle, batchId, basedOn, locale, model,
    })))
    : [];
  return {
    ideas: await Promise.all(docs.map((d) => forClient(d.toObject()))),
    basedOn,
    cached: false,
    balanceNote: str(parsed.balanceNote, 300),
  };
}

const NEXT_STATUS = {
  suggested: ['accepted', 'dismissed'],
  accepted: ['saved', 'dismissed'],
  saved: [],
  dismissed: [],
};

/** Moves an idea on: accepted (explored) / saved (capture kept for later) / dismissed. */
async function decideIdea(userId, ideaId, { status, captureId } = {}) {
  const doc = await PostIdea.findOne({ _id: ideaId, user: userId });
  if (!doc) return null;
  if (!NEXT_STATUS[doc.status]?.includes(status)) {
    const err = new Error(`An idea that is ${doc.status} cannot become ${status}.`);
    err.statusCode = 409;
    throw err;
  }
  doc.status = status;
  doc.decidedAt = new Date();
  if (captureId) doc.captureId = String(captureId).slice(0, 64);
  await doc.save();
  return forClient(doc.toObject());
}

module.exports = {
  nextIdeas,
  decideIdea,
  // exported for tests / dry runs (scripts/test-next-post-idea.js)
  loadMaterial,
  callModel,
  contextOf,
  cleanIdeas,
  fingerprintOf,
  IDEA_TOOL,
};
