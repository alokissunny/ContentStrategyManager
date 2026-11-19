/*
 * Content territory (topic map) — what the studio could genuinely talk about,
 * by pillar (Skills / Passion / Story), and which topics its posts already cover.
 *
 * Reads: Brand memory, the business objective, projects, captures (words + what
 * the photos show), and the posts — the Analysis history (up to 60 Instagram
 * posts, with their pillar/mission tags) when there is one, else the last 10
 * Instagram posts — plus the latest Bauhly posts. One model call
 * (prompts/content-territory.md) returns 12–18 topics with grounding, the posts
 * that cover each, best-fit missions, who each reaches, and what is still needed.
 *
 * Code-side: post ids / grounding ids are checked against what was sent (a topic
 * left with no grounding is dropped); `status` is worked out from coveredBy
 * (0 = missing, 1 = thin, 2+ = covered); each topic gets a stable id (tp_…)
 * that the Next-post idea agent cites. Stored on BrandAnalysisReport.contentTerritory
 * with a fingerprint of what was read — served again while nothing changed.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Project = require('../models/Project');
const BrandAnalysisReport = require('../models/BrandAnalysisReport');
const { completeToolCall, providerOf } = require('./llmComplete');
const { loadMaterial, completeClaudeJson } = require('./nextPostIdea');
const { LANGUAGES } = require('../utils/appLocale');
const { MISSION_TAG_V, withMissionRules } = require('../utils/contentMissions');

const PROMPT_FILE = path.join(__dirname, '..', '..', 'prompts', 'content-territory.md');
const PILLARS = ['skills', 'passion', 'story'];
const MISSIONS = ['attract', 'nurture', 'position', 'convert'];
const VERSION = 1; // bump when the prompt / output shape changes
const MAX_TOPICS = 20;
const MAX_POSTS = 60;

function territoryModel() {
  // same family as the other Analysis agents (Claude Sonnet 5.5) unless overridden
  return process.env.CONTENT_TERRITORY_MODEL || process.env.NEXT_IDEA_MODEL || 'claude-sonnet-5-5';
}

let promptCache = null;
const loadPrompt = () => (promptCache ||= withMissionRules(fs.readFileSync(PROMPT_FILE, 'utf8')));
const clip = (v, max) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};
const str = (v, max = 300) => (typeof v === 'string' ? clip(v, max) : '');
const tagKey = (id) => String(id).replace(/[.$]/g, '_');
const igIdOf = (p) => String(p?.externalId || p?.url || '').trim();
const dayOf = (d) => {
  const t = d ? new Date(d) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toISOString().slice(0, 10) : '';
};
const oneOf = (list, v) => (list.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : '');
const topicIdOf = (pillar, topic) => `tp_${crypto.createHash('sha1').update(`${pillar}:${topic.toLowerCase()}`).digest('hex').slice(0, 8)}`;

const TERRITORY_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    pillarNotes: {
      type: 'object',
      properties: { skills: { type: 'string' }, passion: { type: 'string' }, story: { type: 'string' } },
    },
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pillar: { type: 'string', enum: PILLARS },
          topic: { type: 'string' },
          detail: { type: 'string' },
          coveredBy: { type: 'array', items: { type: 'string' } },
          grounding: {
            type: 'array',
            items: {
              type: 'object',
              properties: { kind: { type: 'string', enum: ['capture', 'igPost', 'post', 'project', 'memory'] }, id: { type: 'string' } },
              required: ['kind', 'id'],
            },
          },
          missions: { type: 'array', items: { type: 'string', enum: MISSIONS } },
          audience: { type: 'string' },
          needs: { type: 'string' },
        },
        required: ['pillar', 'topic', 'detail', 'grounding'],
      },
    },
  },
  required: ['summary', 'topics'],
};

function languageRule(locale) {
  if (!locale || locale === 'en' || !LANGUAGES[locale]) return 'Write every text field in English.';
  return `Write every text field (summary, pillarNotes, topic, detail, audience, needs) in ${LANGUAGES[locale]}. Keep names, places and quoted words as they are.`;
}

/** The Instagram posts to map: the Analysis history with its tags, else the last 10 with the idea agent's tags. */
function instagramRowsOf(report, material) {
  const cov = report?.missionCoverage;
  const tags = cov?.posts || {};
  const history = Array.isArray(cov?.history) && cov.history.length ? cov.history : null;
  const igPillars = report?.igPillarTags || {};
  const igMissions = report?.igMissionTagsV === MISSION_TAG_V ? (report?.igMissionTags || {}) : {};
  return (history || material.igPosts).slice(0, MAX_POSTS).map((p) => {
    const id = igIdOf(p);
    const k = tagKey(id);
    const t = tags[k]?.v === MISSION_TAG_V ? tags[k] : null;
    const pillar = oneOf(PILLARS, t?.pillar || igPillars[k]);
    const mission = oneOf(MISSIONS, t?.mission || igMissions[k]);
    return {
      kind: 'igPost',
      id,
      date: dayOf(p.timestamp),
      caption: clip(p.caption, 350),
      likes: Number(p.likesCount) || 0,
      comments: Number(p.commentsCount) || 0,
      ...(pillar ? { pillar } : {}),
      ...(mission ? { mission } : {}),
    };
  }).filter((p) => p.id);
}

async function loadInputs(userId, handle) {
  const [material, report, projects] = await Promise.all([
    loadMaterial(userId, handle),
    BrandAnalysisReport.findOne({ user: userId, instagramUsername: handle }).sort({ createdAt: -1 })
      .select('missionCoverage.history missionCoverage.posts igPillarTags igMissionTags igMissionTagsV contentTerritory').lean(),
    Project.find({ user: userId, instagramUsername: handle }).sort({ updatedAt: -1 }).limit(40).select('name captures._id captures.excluded').lean(),
  ]);
  const igPosts = instagramRowsOf(report, material);
  const igIds = new Set(igPosts.map((p) => p.id));
  const bauhlyPosts = (material.bauhly || [])
    .filter((p) => !(p.igMediaId && igIds.has(String(p.igMediaId))))
    .map((p) => ({
      kind: 'post',
      id: String(p._id),
      date: p.date,
      state: p.published ? 'published' : 'planned',
      title: clip(p.title, 140),
      direction: clip(p.direction || p.content?.strategy, 240),
      ...(oneOf(PILLARS, p.contentPillar) ? { pillar: p.contentPillar } : {}),
      ...(oneOf(MISSIONS, p.contentMission) && p.contentMissionV === MISSION_TAG_V ? { mission: p.contentMission } : {}),
    }));

  const memory = material.memory || {};
  const brandMemory = {};
  for (const k of ['whatYouOffer', 'whoYouHelp', 'firstProblem', 'position', 'proof', 'howYouSound', 'visualStyle', 'neverDo']) {
    if (memory[k]) brandMemory[k] = clip(memory[k], 700);
  }
  const businessObjective = {};
  for (const k of ['goals', 'audience', 'positioning']) {
    if (material.business?.[k]) businessObjective[k] = clip(material.business[k], 400);
  }
  const projectRows = projects
    .filter((p) => p.name && !/^(no project|content ideas)$/i.test(p.name))
    .map((p) => ({ name: p.name, captures: (p.captures || []).filter((c) => !c.excluded).length }));
  const captures = (material.captures || []).map((c) => ({
    id: c.id,
    project: c.project,
    date: dayOf(c.createdAt),
    words: clip(c.words, 600),
    ...(c.assets.some((a) => a.shows) ? { photosShow: c.assets.map((a) => a.shows).filter(Boolean).slice(0, 5) } : {}),
  }));

  const ctx = { businessObjective, brandMemory, projects: projectRows, captures, posts: [...igPosts, ...bauhlyPosts] };
  const lookups = {
    postIds: new Set(ctx.posts.map((p) => p.id)),
    captureIds: new Set(captures.map((c) => c.id)),
    projectNames: new Set(projectRows.map((p) => p.name)),
    memoryFields: new Set(Object.keys(brandMemory)),
    igCount: igPosts.length,
  };
  return { ctx, lookups, report };
}

function fingerprintOf(ctx, locale) {
  const basis = {
    v: VERSION,
    tv: MISSION_TAG_V,
    locale,
    o: ctx.businessObjective,
    m: ctx.brandMemory,
    pr: ctx.projects.map((p) => p.name),
    c: ctx.captures.map((c) => `${c.id}:${c.words.length}:${(c.photosShow || []).length}`),
    p: ctx.posts.map((p) => `${p.id}:${p.pillar || ''}:${p.mission || ''}`),
  };
  return crypto.createHash('sha1').update(JSON.stringify(basis)).digest('hex');
}

async function callModel(ctx, locale) {
  const model = territoryModel();
  const system = loadPrompt().split('{{LANGUAGE_RULE}}').join(languageRule(locale));
  const user = JSON.stringify(ctx, null, 1);
  const started = Date.now();
  const res = providerOf(model) === 'anthropic'
    ? await completeClaudeJson({ model, system, user, schema: TERRITORY_SCHEMA })
    : await completeToolCall({
      model,
      system,
      userParts: [{ type: 'text', text: user }],
      tool: { name: 'map_content_territory', description: 'Map the studio\'s content topics by pillar.', input_schema: TERRITORY_SCHEMA },
      maxTokens: 8000,
      cacheKey: 'content-territory',
      kind: 'strategist',
      reasoningEffort: 'low',
      timeoutMs: 180000,
      retryHint: 'Your last answer was not valid JSON for the schema. Return ONLY the JSON object.',
    });
  const usage = res.usage || {};
  const { estimatePlanCostUsd } = require('./weeklyPlan');
  const costUsd = estimatePlanCostUsd(res.model || model, usage.input_tokens || 0, usage.output_tokens || 0, usage.cached_tokens || 0, usage.cache_write_tokens || 0);
  const elapsedMs = Date.now() - started;
  const debugRow = {
    source: 'Content territory',
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

/** Checks the answer against what was sent; status comes from the posts that cover a topic. */
function cleanTerritory(parsed, lookups) {
  const seen = new Set();
  const topics = [];
  for (const t of Array.isArray(parsed.topics) ? parsed.topics : []) {
    const pillar = oneOf(PILLARS, t?.pillar);
    const topic = str(t?.topic, 90);
    if (!pillar || !topic) continue;
    const id = topicIdOf(pillar, topic);
    if (seen.has(id)) continue;
    const grounding = [];
    for (const g of Array.isArray(t.grounding) ? t.grounding : []) {
      const kind = String(g?.kind || '');
      const gid = String(g?.id || '').trim();
      const ok = (kind === 'capture' && lookups.captureIds.has(gid))
        || ((kind === 'igPost' || kind === 'post') && lookups.postIds.has(gid))
        || (kind === 'project' && lookups.projectNames.has(gid))
        || (kind === 'memory' && lookups.memoryFields.has(gid));
      if (ok && !grounding.some((x) => x.kind === kind && x.id === gid)) grounding.push({ kind, id: gid });
    }
    const coveredBy = [...new Set((Array.isArray(t.coveredBy) ? t.coveredBy : []).map((x) => String(x).trim()))]
      .filter((x) => lookups.postIds.has(x));
    // a topic with nothing behind it is not the studio's to talk about
    if (!grounding.length && !coveredBy.length) continue;
    seen.add(id);
    topics.push({
      id,
      pillar,
      topic,
      detail: str(t.detail, 260),
      coveredBy,
      status: coveredBy.length >= 2 ? 'covered' : coveredBy.length === 1 ? 'thin' : 'missing',
      grounding,
      missions: [...new Set((Array.isArray(t.missions) ? t.missions : []).map((m) => oneOf(MISSIONS, m)).filter(Boolean))].slice(0, 2),
      audience: str(t.audience, 200),
      needs: str(t.needs, 160),
    });
    if (topics.length >= MAX_TOPICS) break;
  }
  const notes = parsed.pillarNotes && typeof parsed.pillarNotes === 'object' ? parsed.pillarNotes : {};
  return {
    summary: str(parsed.summary, 500),
    pillarNotes: Object.fromEntries(PILLARS.map((p) => [p, str(notes[p], 300)])),
    topics,
  };
}

/**
 * The studio's topic map. Served from the report while nothing it reads has
 * changed (and not `refresh`); `stale: true` allows the stored map even when
 * its inputs changed (no model call) — the idea agent uses that.
 * → { summary, pillarNotes, topics: [...], at, model, cached }
 */
async function contentTerritory(userId, username, { refresh = false, locale = 'en', debug = null, allowStale = false } = {}) {
  const handle = String(username || '').toLowerCase();
  const { ctx, lookups, report } = await loadInputs(userId, handle);
  const basedOn = fingerprintOf(ctx, locale);
  const kept = report?.contentTerritory;
  if (!refresh && kept?.topics?.length && kept.v === VERSION && (kept.basedOn === basedOn || allowStale)) {
    return { ...kept, cached: true, fresh: kept.basedOn === basedOn };
  }
  if (allowStale) return null; // the caller doesn't wait for a model call
  if (!ctx.captures.length && !ctx.posts.length && !Object.keys(ctx.brandMemory).length) {
    return { summary: '', pillarNotes: {}, topics: [], empty: true };
  }

  const { parsed, model, debugRow } = await callModel(ctx, locale);
  debug?.push(debugRow);
  const map = cleanTerritory(parsed, lookups);
  const stored = { ...map, v: VERSION, basedOn, locale, model, at: new Date(), posts: lookups.igCount };
  console.log(`[contentTerritory] @${handle} ${model} · ${map.topics.length} topics (${map.topics.filter((t) => t.status !== 'covered').length} new/thin) · ${debugRow.usage.inputTokens}+${debugRow.usage.outputTokens} tok · ~$${debugRow.usage.estimatedCostUsd.toFixed(4)} · ${debugRow.elapsedMs}ms`);
  if (report?._id) {
    await BrandAnalysisReport.updateOne({ _id: report._id }, { $set: { contentTerritory: stored } })
      .catch((err) => console.warn('[contentTerritory] could not store:', err.message));
  }
  return { ...stored, cached: false, fresh: true };
}

module.exports = { contentTerritory, cleanTerritory, loadInputs, fingerprintOf, territoryModel, VERSION };
