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
 * return up to 7 ranked ideas, each citing its sources.
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
const { isS3Configured, getMediaUrl } = require('./s3Client');
const { LANGUAGES } = require('../utils/appLocale');
const { MISSION_TAG_V, withMissionRules } = require('../utils/contentMissions');

const PROMPT_FILE = path.join(__dirname, '..', '..', 'prompts', 'next-post-idea.md');
const PILLARS = ['passion', 'skills', 'story'];
const MISSIONS = ['attract', 'nurture', 'position', 'convert'];
// bump when the prompt / output shape changes: stored batches made before are not served again
const PROMPT_VERSION = 9; // 9: gaps recounted with the agent's own tags before ranking · 8: 8: content audit (last 20 posts, gaps) + gap-first ranking (2026-11-21) · 7: 7: Convert = the studio's real service + a client problem + one next step, no finished project required (studio, 2026-11-21) · 6: 6: 7 ideas per batch (5: topic map + computed mix) (2026-11-19)
const MAX_IDEAS = 7;
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
const loadPrompt = () => (promptCache ||= withMissionRules(fs.readFileSync(PROMPT_FILE, 'utf8')));

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
    .select('date title direction format published igMediaId contentPillar contentMission contentMissionV updatedAt content.caption content.strategy')
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
        .filter((a) => a.key && (a.type === 'image' || a.type === 'video') && a.reelTake !== 'say')
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
      .sort({ createdAt: -1 }).select('igPillarTags igMissionTags igMissionTagsV contentTerritory missionCoverage.history missionCoverage.posts').lean(),
    User.findById(userId).select('business').lean(),
  ]);
  // the content audit's posts (Analysis history): the last AUDIT_WINDOW published
  // posts and their current-rule tags — the same posts Analysis counts
  const { AUDIT_WINDOW } = require('./missionCoverage');
  const history = report?.missionCoverage?.history || [];
  const covTags = report?.missionCoverage?.posts || {};
  const auditPosts = history.length ? history.slice(0, AUDIT_WINDOW) : igPosts;
  const igTags = { ...(report?.igPillarTags || {}) };
  const igMissions0 = report?.igMissionTagsV === MISSION_TAG_V ? { ...(report?.igMissionTags || {}) } : {};
  Object.entries(covTags).forEach(([k, t]) => {
    if (t?.v !== MISSION_TAG_V) return;
    if (t.pillar) igTags[k] = t.pillar;
    if (t.mission) igMissions0[k] = t.mission;
  });
  return {
    memory, igPosts: auditPosts, bauhly, captures, dismissed,
    business: user?.business || {},
    igTags,
    // tags made under older mission rules count as missing (re-tagged by the agent)
    igMissions: igMissions0,
    igMissionsStale: (report?.igMissionTagsV || 0) !== MISSION_TAG_V,
    territory: report?.contentTerritory?.topics?.length ? report.contentTerritory : null,
  };
}

/** The JSON the model reads, plus the lookups the code checks its answer against. */
function contextOf(material) {
  const { memory, igPosts, bauhly, captures, dismissed, igTags, igMissions = {}, igMissionsStale = false, territory = null, business = {} } = material;
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
      ...(missionOf(p.contentMission) && p.contentMissionV === MISSION_TAG_V ? { mission: p.contentMission } : {}),
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
  // the content audit (shared with Analysis): last published posts → shares, grid, gaps;
  // `upcoming` = what is already planned in Bauhly, so a gap isn't filled twice
  const { auditOf } = require('./missionCoverage');
  const audit = auditOf(instagramPosts.filter((p) => p.mission), {
    topics: (territory?.topics || []),
    objective: [business.goals, business.positioning].filter(Boolean).join(' '),
  });
  ctx.audit = {
    posts: audit.window,
    missions: audit.missions,
    pillars: { counts: audit.pillars.counts, percents: audit.pillars.percents, grid: audit.pillars.matrix },
    topicsNotPostedYet: audit.openTopics,
    gaps: audit.gaps.map((g) => g.say),
    untaggedPosts: instagramPosts.filter((p) => !p.mission).length,
  };
  const planned = bauhlyPosts.filter((p) => p.state === 'planned');
  ctx.upcoming = mixOf(planned);
  // the studio's Skills / Passion / Story topics, covered or not (services/contentTerritory.js)
  const topics = (territory?.topics || []).map((t) => ({
    id: t.id,
    pillar: t.pillar,
    topic: t.topic,
    detail: t.detail,
    status: t.status,
    postsOnIt: (t.coveredBy || []).length,
    missions: t.missions || [],
    audience: t.audience || '',
    ...(t.needs ? { needs: t.needs } : {}),
    grounding: t.grounding || [],
  }));
  if (topics.length) ctx.topicMap = { summary: territory.summary || '', topics };

  const lookups = {
    gaps: audit.gaps,
    auditOpts: {
      topics: (territory?.topics || []),
      objective: [business.goals, business.positioning].filter(Boolean).join(' '),
    },
    auditPosts: instagramPosts.map((p) => ({ id: p.id, mission: p.mission || '', pillar: p.pillar || '' })),
    captureIds: new Set(captures.map((c) => c.id)),
    postIds: new Set(bauhlyPosts.map((p) => p.id)),
    allBauhlyIds: new Set(bauhly.map((p) => String(p._id))),
    igIds,
    memoryFields: new Set(Object.keys(brandMemory)),
    topicIds: new Set(topics.map((t) => t.id)),
    territoryAt: territory?.basedOn || '',
    assets: new Map(captures.flatMap((c) => c.assets.map((a) => [a.key, { ...a, captureId: c.id }]))),
    // a post missing either tag goes back to the agent; only the missing one is stored
    untaggedIg: instagramPosts.filter((p) => !p.pillar || !p.mission).map((p) => p.id),
    untaggedBauhly: bauhlyPosts.filter((p) => !p.pillar || !p.mission).map((p) => p.id),
    igTagged: new Map(instagramPosts.map((p) => [p.id, { pillar: p.pillar, mission: p.mission }])),
    igMissionsStale,
    labels: new Map([
      // the catch-all projects ("No project", "Content ideas") are not a project name to show
      ...captures.map((c) => [`capture:${c.id}`,
        c.project && !/^(no project|content ideas)$/i.test(c.project) ? `${c.project} capture` : 'Your capture']),
      ...bauhlyPosts.map((p) => [`post:${p.id}`, p.title || `Post · ${p.date}`]),
      ...instagramPosts.map((p) => [`igPost:${p.id}`, clip(p.caption, 60) || `Instagram post · ${p.date}`]),
      ...topics.map((t) => [`topic:${t.id}`, t.topic]),
    ]),
  };
  return { ctx, lookups };
}

/** Mission / pillar counts of the posts already tagged (worked out here, not by the model). */
function mixOf(posts) {
  const tagged = posts.filter((p) => p.mission || p.pillar);
  const count = (key, list) => Object.fromEntries(list.map((v) => [v, tagged.filter((p) => p[key] === v).length]));
  return {
    postsTagged: tagged.length,
    postsUntagged: posts.length - tagged.length,
    missions: count('mission', MISSIONS),
    pillars: count('pillar', PILLARS),
    pillarMissions: Object.fromEntries(PILLARS.map((pl) => [pl,
      Object.fromEntries(MISSIONS.map((m) => [m, tagged.filter((p) => p.pillar === pl && p.mission === m).length]))])),
  };
}

/**
 * Gap first (studio, 2026-11-21): the #1 idea fills the biggest gap of the audit
 * (a missing mission, then a weak pillar, then a thin mission) when the batch has
 * an honest idea for it; every idea that fills a gap says so in numbers
 * (`missionWhy` = the audit's own line, e.g. "Convert is 0 of your last 20 posts.").
 */
function gapFirst(ideas, gaps = []) {
  if (!ideas.length || !gaps.length) return ideas;
  const fills = (idea, g) => (g.kind === 'mission' ? idea.mission === g.id : idea.pillar === g.id);
  const out = ideas.map((idea) => {
    const g = gaps.find((x) => fills(idea, x));
    return g ? { ...idea, missionWhy: g.say, gap: `${g.kind}:${g.id}` } : idea;
  });
  for (const g of gaps) {
    const at = out.findIndex((idea) => fills(idea, g));
    if (at < 0) continue;
    if (at > 0) out.unshift(out.splice(at, 1)[0]);
    break;
  }
  return out.map((idea, i) => ({ ...idea, rank: i + 1 }));
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
  description: 'Tag untagged past posts by pillar and return up to 7 ranked next-post ideas.',
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
                  kind: { type: 'string', enum: ['capture', 'post', 'igPost', 'memory', 'topic'] },
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
async function completeClaudeJson({ model, system, user, schema = IDEA_TOOL.input_schema, kind = 'strategist' }) {
  const sys = `${system}\n\n## Output\n\nReturn ONLY one JSON object (no prose, no code fences) matching this JSON Schema:\n${JSON.stringify(schema)}`;
  const run = (text, maxTokens) => completeText({
    model, system: sys, user: text, maxTokens, kind, reasoningEffort: 'low', timeoutMs: 180000,
  });
  let res = await run(user, 14000);
  let usage = { ...res.usage };
  const add = (u) => {
    for (const k of ['input_tokens', 'output_tokens', 'cached_tokens', 'cache_write_tokens']) usage[k] = (usage[k] || 0) + (u?.[k] || 0);
  };
  let parsed;
  try {
    if (res.stopReason === 'max_tokens') throw new Error('cut off');
    parsed = parseJsonAnswer(res.text);
  } catch {
    res = await run(`${user}\n\nYour last answer was not one complete JSON object. Return ONLY the JSON object, shorter if needed.`, 20000);
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
    maxTokens: 14000,
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
      || (kind === 'memory' && lookups.memoryFields.has(id))
      || (kind === 'topic' && lookups.topicIds?.has(id));
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
  const usedCaptures = new Map(); // capture id → pillars it already leads
  const ideas = [];
  for (const r of raw) {
    const pillar = pillarOf(r?.pillar);
    const mission = missionOf(r?.mission);
    const title = str(r?.title, 120);
    if (!pillar || !mission || !title) continue;
    const sources = cleanSources(r.sources, lookups);
    // a capture leads at most two ideas in a batch, and never twice in the same pillar
    const lead = sources.find((s) => s.kind === 'capture');
    const led = lead ? usedCaptures.get(lead.id) || [] : [];
    if (lead && (led.length >= 2 || led.includes(pillar))) continue;
    if (lead) usedCaptures.set(lead.id, [...led, pillar]);
    // a topic-map idea with no capture or post behind it needs the studio's own story first
    const hasMaterial = sources.some((x) => x.kind === 'capture' || x.kind === 'post' || x.kind === 'igPost');
    const questionLed = !sources.length || Boolean(r.questionLed) || (!hasMaterial && sources.some((x) => x.kind === 'topic'));
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
  const igMissions = {};
  const posts = [];
  for (const t of tags) {
    const pillar = pillarOf(t?.pillar);
    const mission = missionOf(t?.mission);
    const id = String(t?.id || '').trim();
    if ((!pillar && !mission) || !id) continue;
    if (t.kind === 'igPost' && untaggedIg.has(id)) {
      // a tag already stored is kept; only the missing one is filled
      if (pillar && !lookups.igTagged.get(id)?.pillar) igSet[`igPillarTags.${tagKey(id)}`] = pillar;
      if (mission && !lookups.igTagged.get(id)?.mission) igMissions[tagKey(id)] = mission;
    }
    if (t.kind === 'post' && untaggedBauhly.has(id)) posts.push({ id, pillar, mission });
  }
  if (lookups.igMissionsStale) {
    // tags made under older mission rules are replaced whole
    if (Object.keys(igMissions).length) Object.assign(igSet, { igMissionTags: igMissions, igMissionTagsV: MISSION_TAG_V });
  } else {
    for (const [k, m] of Object.entries(igMissions)) igSet[`igMissionTags.${k}`] = m;
  }
  const jobs = [];
  if (Object.keys(igSet).length) {
    jobs.push(BrandAnalysisReport.findOne({ user: userId, instagramUsername: username }).sort({ createdAt: -1 }).select('_id').lean()
      .then((r) => r && BrandAnalysisReport.updateOne({ _id: r._id }, { $set: igSet })));
  }
  const writes = posts.flatMap((p) => [
    p.pillar && { updateOne: { filter: { _id: p.id, user: userId, contentPillar: '' }, update: { $set: { contentPillar: p.pillar } } } },
    // empty, or tagged under older mission rules
    p.mission && { updateOne: {
      filter: { _id: p.id, user: userId, $or: [{ contentMission: { $in: ['', null] } }, { contentMissionV: { $ne: MISSION_TAG_V } }] },
      update: { $set: { contentMission: p.mission, contentMissionV: MISSION_TAG_V } },
    } },
  ].filter(Boolean));
  if (writes.length) jobs.push(PlannedPost.bulkWrite(writes));
  await Promise.all(jobs).catch((err) => console.warn('[nextPostIdea] could not store post tags:', err.message));
  return { instagram: new Set([...Object.keys(igMissions), ...Object.keys(igSet).filter((k) => k.startsWith("igPillarTags.")).map((k) => k.slice(13))]).size, bauhly: posts.length };
}

// ── what the client gets ──────────────────────────────────────────────────────

/*
 * The idea's pictures as the card can show them (studio, 2026-11-21: "sometimes a broken or no
 * image"): only media still on a capture (a deleted capture takes its files with it) and never a
 * reel's spoken take; a stable CDN URL (getMediaUrl) instead of an hour-long presigned one the
 * card outlived; a clip's first kept still as its `posterKey`.
 */
async function liveMedia(userId, keys) {
  if (!keys.length) return new Map();
  const rows = await Project.find({ user: userId, 'captures.attachments.key': { $in: keys } })
    .select('captures.attachments.key captures.attachments.type captures.attachments.reelTake captures.attachments.analysis.frames')
    .lean().catch(() => []);
  const out = new Map();
  rows.forEach((p) => (p.captures || []).forEach((c) => (c.attachments || []).forEach((a) => {
    if (keys.includes(a.key) && a.reelTake !== 'say') out.set(a.key, a);
  })));
  return out;
}

/*
 * A picture for an idea with none of its own (a question-led idea built on brand memory or a topic):
 * display only — never one of the idea's assets, so Build Reel does not seed it into the capture.
 * Tried in order: a capture the idea cites, a capture behind the topic it opens, the studio's newest
 * project photo.
 */
async function coverFor(doc) {
  const projects = await Project.find({ user: doc.user, instagramUsername: doc.instagramUsername })
    .select('captures._id captures.createdAt captures.excluded captures.attachments.key captures.attachments.type captures.attachments.reelTake')
    .lean().catch(() => []);
  const caps = projects.flatMap((p) => p.captures || []).filter((c) => !c.excluded);
  const photoOf = (c) => (c?.attachments || []).find((a) => a.type === 'image' && a.key && a.reelTake !== 'say')?.key || '';
  const byId = new Map(caps.map((c) => [String(c._id), c]));
  const cited = (doc.sources || []).filter((x) => x.kind === 'capture').map((x) => byId.get(String(x.id)));
  let key = cited.map(photoOf).find(Boolean) || '';
  if (!key) {
    const topicIds = (doc.sources || []).filter((x) => x.kind === 'topic').map((x) => String(x.id));
    if (topicIds.length) {
      const report = await BrandAnalysisReport.findOne({ user: doc.user, instagramUsername: doc.instagramUsername })
        .sort({ createdAt: -1 }).select('contentTerritory.topics').lean().catch(() => null);
      const grounding = (report?.contentTerritory?.topics || []).filter((t) => topicIds.includes(t.id)).flatMap((t) => t.grounding || []);
      key = grounding.filter((g) => g.kind === 'capture').map((g) => photoOf(byId.get(String(g.id)))).find(Boolean) || '';
    }
  }
  if (!key) {
    key = [...caps].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).map(photoOf).find(Boolean) || '';
  }
  return key ? { key, url: isS3Configured() ? await getMediaUrl(key).catch(() => '') : '' } : null;
}

async function forClient(doc) {
  const canSign = isS3Configured();
  const live = await liveMedia(doc.user, (doc.assets || []).map((a) => a.key).filter(Boolean));
  const assets = await Promise.all((doc.assets || []).filter((a) => live.has(a.key)).map(async (a) => {
    const posterKey = a.type === 'video' ? (live.get(a.key)?.analysis?.frames || []).find((f) => f?.key)?.key || '' : '';
    return {
      key: a.key,
      captureId: a.captureId,
      type: a.type,
      reason: a.reason,
      url: canSign ? await getMediaUrl(a.key).catch(() => '') : '',
      ...(posterKey ? { posterKey, posterUrl: canSign ? await getMediaUrl(posterKey).catch(() => '') : '' } : {}),
    };
  }));
  return {
    id: String(doc._id),
    batchId: doc.batchId,
    rank: doc.rank,
    status: doc.status,
    mission: doc.mission,
    missionWhy: doc.missionWhy || '',
    gap: doc.gap || '',
    ...(assets.length ? {} : { cover: await coverFor(doc).catch(() => null) }),
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
  // the topic map (Skills / Passion / Story topics, covered or not): made once and
  // waited for; afterwards refreshed in the background when what it read has changed
  const { contentTerritory } = require('./contentTerritory'); // lazy: it requires this module
  if (!material.territory) {
    const made = await contentTerritory(userId, handle, { locale, debug })
      .catch((err) => { console.warn('[nextPostIdea] topic map failed:', err.message); return null; });
    material.territory = made?.topics?.length ? made : null;
  } else {
    contentTerritory(userId, handle, { locale })
      .catch((err) => console.warn('[nextPostIdea] topic map refresh failed:', err.message));
  }
  const { ctx, lookups } = contextOf(material);
  const basedOn = fingerprintOf(ctx, locale);

  if (!refresh) {
    // a capture's own idea (Captures › Generate reel) is never a suggestion batch
    const latest = await PostIdea.findOne({ user: userId, instagramUsername: handle, batchId: { $not: /^capture:/ } })
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
  // the audit again, now with the posts the agent tagged in this same answer (posts whose
  // tags were stale or missing — e.g. right after the mission rules changed)
  const fresh = new Map((Array.isArray(parsed.pillarTags) ? parsed.pillarTags : [])
    .filter((t) => t?.kind === 'igPost').map((t) => [String(t.id), t]));
  const auditPosts = lookups.auditPosts.map((p) => ({
    ...p,
    mission: p.mission || missionOf(fresh.get(p.id)?.mission),
    pillar: p.pillar || pillarOf(fresh.get(p.id)?.pillar),
  })).filter((p) => p.mission);
  const { auditOf } = require('./missionCoverage');
  const gaps = auditPosts.length > lookups.auditPosts.filter((p) => p.mission).length
    ? auditOf(auditPosts, lookups.auditOpts).gaps
    : lookups.gaps;
  const ideas = gapFirst(cleanIdeas(parsed, lookups), gaps);
  const tagged = await saveTags(userId, handle, parsed, lookups);
  const pillarsCovered = new Set(ideas.map((i) => i.pillar));
  if (ideas.length >= 3 && pillarsCovered.size < 3) console.warn(`[nextPostIdea] @${handle} ideas miss a pillar: ${PILLARS.filter((p) => !pillarsCovered.has(p)).join(', ')}`);
  console.log(
    `[nextPostIdea] @${handle} ${model} · ${ideas.length} idea(s) · tagged ${tagged.instagram} IG + ${tagged.bauhly} Bauhly`
    + ` · ${debugRow.usage.inputTokens}+${debugRow.usage.outputTokens} tok · ~$${debugRow.usage.estimatedCostUsd.toFixed(4)}`
    + ` · ${debugRow.elapsedMs}ms`,
  );

  const batchId = crypto.randomUUID();
  // an older batch nobody acted on is replaced, not stacked up — marked, never
  // deleted: one of its ideas may be open in Capture right now (Explore idea →
  // capture → reel plan / PATCH look it up by id)
  await PostIdea.updateMany(
    { user: userId, instagramUsername: handle, status: 'suggested', batchId: { $not: /^capture:/ } },
    { $set: { status: 'replaced', decidedAt: new Date() } },
  );
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
  // a replaced idea can still be explored from a card that showed it before the new batch
  replaced: ['accepted', 'dismissed'],
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
  gapFirst,
  decideIdea,
  ideaModel,
  parseJsonAnswer,
  completeClaudeJson,
  // exported for tests / dry runs (scripts/test-next-post-idea.js)
  loadMaterial,
  callModel,
  contextOf,
  cleanIdeas,
  fingerprintOf,
  IDEA_TOOL,
};
