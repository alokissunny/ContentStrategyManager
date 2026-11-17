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
const User = require('../models/User');
const { completeToolCall, completeText, providerOf } = require('./llmComplete');
const { loadBrandDna } = require('./planInputs');
const { loadRemixPosts } = require('./postRemix');
const { isS3Configured, getPresignedMediaUrl } = require('./s3Client');
const { LANGUAGES } = require('../utils/appLocale');

const PROMPT_FILE = path.join(__dirname, '..', '..', 'prompts', 'next-post-idea.md');
const PILLARS = ['passion', 'skills', 'story'];
const MISSIONS = ['attract', 'nurture', 'position', 'convert'];
// bump when the prompt / output shape changes: stored batches made before are not served again
const PROMPT_VERSION = 2;
const MAX_IDEAS = 3;
const MAX_QUESTIONS = 2;
const MAX_ASSETS = 4;
const BAUHLY_POSTS = 20;
const CAPTURES = 30;
const ASSETS_PER_CAPTURE = 8;
const DISMISSED = 20;

// Claude Sonnet 5.5 at the studio's request (2026-11-17) — an exception to the
// OpenAI-by-default rule; NEXT_IDEA_MODEL still overrides it.
function ideaModel() {
  return process.env.NEXT_IDEA_MODEL || 'claude-sonnet-5-5';
}

let promptCache = null;
const loadPrompt = () => (promptCache ||= fs.readFileSync(PROMPT_FILE, 'utf8'));

const clip = (v, max) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const str = (v, max = 400) => (typeof v === 'string' ? clip(v, max) : '');
const pillarOf = (v) => (PILLARS.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : '');
const missionOf = (v) => (MISSIONS.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : '');
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
    .select('date title direction format published igMediaId contentPillar contentMission updatedAt content.caption content.strategy')
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
  const [memory, igPosts, bauhly, captures, dismissed, report, user] = await Promise.all([
    loadBrandDna(userId, username).catch(() => null),
    loadInstagramPosts(userId, username),
    loadBauhlyPosts(userId, username),
    loadCaptures(userId, username),
    loadDismissed(userId, username),
    BrandAnalysisReport.findOne({ user: userId, instagramUsername: username })
      .sort({ createdAt: -1 }).select('igPillarTags igMissionTags').lean(),
    User.findById(userId).select('business').lean(),
  ]);
  return {
    memory, igPosts, bauhly, captures, dismissed,
    business: user?.business || {},
    igTags: report?.igPillarTags || {},
    igMissions: report?.igMissionTags || {},
  };
}

/** The JSON the model reads, plus the lookups the code checks its answer against. */
function contextOf(material) {
  const { memory, igPosts, bauhly, captures, dismissed, igTags, igMissions = {}, business = {} } = material;
  const igIds = new Set(igPosts.map(igIdOf).filter(Boolean));

  const instagramPosts = igPosts.map((p) => ({
    id: igIdOf(p),
    type: p.type || 'post',
    date: dayOf(p.timestamp),
    caption: clip(p.caption, 700),
    likes: Number(p.likesCount) || 0,
    comments: Number(p.commentsCount) || 0,
    ...(pillarOf(igTags[tagKey(igIdOf(p))]) ? { pillar: pillarOf(igTags[tagKey(igIdOf(p))]) } : {}),
    ...(missionOf(igMissions[tagKey(igIdOf(p))]) ? { mission: missionOf(igMissions[tagKey(igIdOf(p))]) } : {}),
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
      ...(missionOf(p.contentMission) ? { mission: p.contentMission } : {}),
    }));

  const brandMemory = {};
  if (memory) {
    for (const k of ['whatYouOffer', 'whoYouHelp', 'firstProblem', 'position', 'proof', 'howYouSound', 'neverDo']) {
      if (memory[k]) brandMemory[k] = clip(memory[k], 600);
    }
  }

  // the studio's own words at sign-up: what the business wants from Instagram
  const businessObjective = {};
  for (const k of ['goals', 'audience', 'positioning']) {
    if (business[k]) businessObjective[k] = clip(business[k], 400);
  }

  const ctx = {
    today: dayOf(new Date()),
    businessObjective,
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
    // a post missing either tag goes back to the agent; only the missing one is stored
    untaggedIg: instagramPosts.filter((p) => !p.pillar || !p.mission).map((p) => p.id),
    untaggedBauhly: bauhlyPosts.filter((p) => !p.pillar || !p.mission).map((p) => p.id),
    igTagged: new Map(instagramPosts.map((p) => [p.id, { pillar: p.pillar, mission: p.mission }])),
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
    v: PROMPT_VERSION,
    locale,
    o: ctx.businessObjective,
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
            mission: { type: 'string', enum: MISSIONS },
          },
          required: ['kind', 'id', 'pillar', 'mission'],
        },
      },
      balanceNote: { type: 'string', description: 'One sentence: what the recent mix of missions and pillars looks like.' },
      ideas: {
        type: 'array',
        maxItems: MAX_IDEAS,
        items: {
          type: 'object',
          properties: {
            rank: { type: 'integer' },
            mission: { type: 'string', enum: MISSIONS },
            missionWhy: { type: 'string', description: 'Short: why this mission now, e.g. "Convert is missing."' },
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
                objective: { type: 'number' },
                audience: { type: 'number' },
                balance: { type: 'number' },
                captureFit: { type: 'number' },
                novelty: { type: 'number' },
                info: { type: 'number' },
              },
            },
          },
          required: ['mission', 'pillar', 'title', 'why', 'opening', 'sources'],
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

/** The first balanced {...} in a model's text answer (fences and prose around it ignored). */
function parseJsonAnswer(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start < 0) throw new Error('No JSON object in the answer');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(s.slice(start, i + 1));
    }
  }
  throw new Error('The JSON answer was cut off');
}

/*
 * Claude Sonnet 5.5 refuses a forced tool call (tool_choice "tool"), so on a
 * Claude model the schema goes in the system prompt and the answer is read as
 * JSON text — the same way the Strategist gets its JSON from Claude. A cut-off
 * or unreadable answer is asked for once more.
 */
async function completeClaudeJson({ model, system, user }) {
  const sys = `${system}\n\n## Output\n\nReturn ONLY one JSON object (no prose, no code fences) matching this JSON Schema:\n${JSON.stringify(IDEA_TOOL.input_schema)}`;
  const run = (text, maxTokens) => completeText({
    model, system: sys, user: text, maxTokens, kind: 'strategist', reasoningEffort: 'low', timeoutMs: 180000,
  });
  let res = await run(user, 8000);
  let usage = { ...res.usage };
  const add = (u) => {
    for (const k of ['input_tokens', 'output_tokens', 'cached_tokens', 'cache_write_tokens']) usage[k] = (usage[k] || 0) + (u?.[k] || 0);
  };
  let parsed;
  try {
    if (res.stopReason === 'max_tokens') throw new Error('cut off');
    parsed = parseJsonAnswer(res.text);
  } catch {
    res = await run(`${user}\n\nYour last answer was not one complete JSON object. Return ONLY the JSON object, shorter if needed.`, 16000);
    add(res.usage);
    parsed = parseJsonAnswer(res.text);
  }
  return { parsed, model: res.model || model, output: res.text, usage };
}

async function callModel(ctx, locale) {
  const model = ideaModel();
  const system = loadPrompt().split('{{LANGUAGE_RULE}}').join(languageRule(locale));
  const user = JSON.stringify(ctx, null, 1);
  const started = Date.now();
  const res = providerOf(model) === 'anthropic' ? await completeClaudeJson({ model, system, user }) : await completeToolCall({
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
  const costUsd = estimatePlanCostUsd(res.model || model, usage.input_tokens || 0, usage.output_tokens || 0, usage.cached_tokens || 0, usage.cache_write_tokens || 0);
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
    const mission = missionOf(r?.mission);
    const title = str(r?.title, 120);
    if (!pillar || !mission || !title) continue;
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
      mission,
      missionWhy: str(r.missionWhy, 160),
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
      scores: r.scores && typeof r.scores === 'object'
        ? Object.fromEntries(['objective', 'audience', 'balance', 'captureFit', 'relevance', 'novelty', 'info']
          .filter((k) => r.scores[k] != null).map((k) => [k, Number(r.scores[k]) || 0]))
        : null,
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
  const igSet = {};
  const posts = [];
  for (const t of tags) {
    const pillar = pillarOf(t?.pillar);
    const mission = missionOf(t?.mission);
    const id = String(t?.id || '').trim();
    if ((!pillar && !mission) || !id) continue;
    if (t.kind === 'igPost' && untaggedIg.has(id)) {
      // a tag already stored is kept; only the missing one is filled
      if (pillar && !lookups.igTagged.get(id)?.pillar) igSet[`igPillarTags.${tagKey(id)}`] = pillar;
      if (mission && !lookups.igTagged.get(id)?.mission) igSet[`igMissionTags.${tagKey(id)}`] = mission;
    }
    if (t.kind === 'post' && untaggedBauhly.has(id)) posts.push({ id, pillar, mission });
  }
  const jobs = [];
  if (Object.keys(igSet).length) {
    jobs.push(BrandAnalysisReport.findOne({ user: userId, instagramUsername: username }).sort({ createdAt: -1 }).select('_id').lean()
      .then((r) => r && BrandAnalysisReport.updateOne({ _id: r._id }, { $set: igSet })));
  }
  const writes = posts.flatMap((p) => [
    p.pillar && { updateOne: { filter: { _id: p.id, user: userId, contentPillar: '' }, update: { $set: { contentPillar: p.pillar } } } },
    p.mission && { updateOne: { filter: { _id: p.id, user: userId, contentMission: { $in: ['', null] } }, update: { $set: { contentMission: p.mission } } } },
  ].filter(Boolean));
  if (writes.length) jobs.push(PlannedPost.bulkWrite(writes));
  await Promise.all(jobs).catch((err) => console.warn('[nextPostIdea] could not store post tags:', err.message));
  return { instagram: Object.keys(igSet).length, bauhly: posts.length };
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
    mission: doc.mission,
    missionWhy: doc.missionWhy || '',
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
  ideaModel,
  parseJsonAnswer,
  // exported for tests / dry runs (scripts/test-next-post-idea.js)
  loadMaterial,
  callModel,
  contextOf,
  cleanIdeas,
  fingerprintOf,
  IDEA_TOOL,
};
