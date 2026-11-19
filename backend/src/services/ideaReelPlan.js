/*
 * Idea → Reel plan. After the studio explores a next-post idea in Capture, this
 * agent turns the idea + the saved capture into ONE recommended Instagram Reel:
 * the strategic priority it serves, the format (Faceless · Text, Faceless ·
 * Voiceover, Talking head, Talking head + B-roll, Music-led), and 2–4 story
 * sequences with what to say, what to record and how — the Capture recording
 * guide (frontend components/ReelPlanner.jsx).
 *
 * Recommended posts are always reels (studio's rule, 2026-11-18). "Explore
 * alternatives" re-plans the same story in another reel format (FORCED_FORMAT),
 * or falls back to a carousel through the normal plan generation (no call here).
 *
 * The plan is stored on the idea (PostIdea.reelPlan, keyed by capture + format)
 * so reopening it, or "I'll upload later", costs nothing.
 */

const fs = require('fs');
const path = require('path');
const PostIdea = require('../models/PostIdea');
const Project = require('../models/Project');
const { completeToolCall, providerOf } = require('./llmComplete');
const { loadBrandDna } = require('./planInputs');
const { estimatePlanCostUsd } = require('./weeklyPlan');
const { LANGUAGES } = require('../utils/appLocale');

const PROMPT_FILE = path.join(__dirname, '..', '..', 'prompts', 'idea-reel-plan.md');
const FORMATS = ['faceless_text', 'faceless_voiceover', 'talking_head', 'talking_head_broll', 'music_led'];
const ROLES = ['hook', 'context', 'value', 'proof', 'payoff'];
const SHOTS = ['talking_head', 'broll', 'talking_head_broll', 'text', 'voiceover'];
const PLAN_VERSION = 3; // 2: per-sequence B-roll shot list · 3: Claude Sonnet 5.5 (2026-11-19)

// Claude Sonnet 5.5 at the studio's request (2026-11-19) — an exception to the
// OpenAI-by-default rule, like the next-post idea agent; IDEA_REEL_MODEL overrides.
const reelPlanModel = () => process.env.IDEA_REEL_MODEL || 'claude-sonnet-5-5';

let promptCache = null;
const loadPrompt = () => (promptCache ||= fs.readFileSync(PROMPT_FILE, 'utf8'));

const clip = (v, max) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const str = (v, max = 400) => (typeof v === 'string' ? clip(v, max) : '');
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const secs = (v, lo, hi) => {
  const arr = Array.isArray(v) ? v : [v, v];
  let a = Math.round(Math.max(1, Math.min(hi, num(arr[0], lo))));
  let b = Math.round(Math.max(1, Math.min(hi, num(arr[1], a))));
  if (b < a) [a, b] = [b, a];
  return [a, b];
};

const S = (description, extra = {}) => ({ type: 'string', description, ...extra });
const TOOL = {
  name: 'plan_idea_reel',
  description: 'The recommended reel for this idea, sequence by sequence.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['priority', 'title', 'format', 'formatSummary', 'formatWhy', 'estimatedSec', 'sequences', 'caption'],
    properties: {
      priority: {
        type: 'object',
        additionalProperties: false,
        required: ['headline', 'body'],
        properties: { headline: S('one sentence'), body: S('1–2 sentences') },
      },
      title: S('the reel title, ≤ 10 words'),
      format: S('reel format id', { enum: FORMATS }),
      formatSummary: S('one sentence: how the reel is made'),
      formatWhy: S('why this format fits'),
      estimatedSec: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
      caption: S('short draft caption, no hashtags'),
      sequences: {
        type: 'array',
        minItems: 2,
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'role', 'shot', 'say', 'onScreenText', 'record', 'broll', 'guidance', 'targetSec', 'existing'],
          properties: {
            title: S('2–5 words'),
            role: S('story role', { enum: ROLES }),
            shot: S('shot type', { enum: SHOTS }),
            say: S('exact words to say, or ""'),
            onScreenText: S('≤ 8 words, or ""'),
            record: S('what to record / show'),
            broll: S('B-roll to film for this sequence (the space, the detail), or ""'),
            guidance: S('one recording tip'),
            targetSec: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
            existing: { type: 'boolean' },
          },
        },
      },
    },
  },
};

async function loadCapture(userId, captureId) {
  const project = await Project.findOne({ user: userId, 'captures._id': captureId }).select('name instagramUsername captures');
  const capture = project?.captures?.id(captureId);
  if (!capture) return null;
  const u = capture.understanding || {};
  const assets = (capture.attachments || []).filter((a) => a.key).slice(0, 16).map((a) => ({
    type: a.type,
    ...(a.analysis?.summary ? { summary: str(a.analysis.summary, 200) } : {}),
    ...(a.type === 'video' && a.analysis?.durationSec ? { durationSec: Math.round(num(a.analysis.durationSec)) } : {}),
    ...(a.type === 'video' && a.analysis?.transcript ? { transcript: str(a.analysis.transcript, 400) } : {}),
  }));
  return {
    project,
    capture,
    forPrompt: {
      project: project.name,
      words: str(capture.text, 3000) || str(capture.sessionSummary, 3000),
      understanding: Object.fromEntries(Object.entries({
        happened: str(u.happened, 600), intent: str(u.intent, 400), difficulty: str(u.difficulty, 400),
        actionTaken: str(u.actionTaken, 600), outcome: str(u.outcome, 600),
        verifiedFacts: (u.verifiedFacts || []).slice(0, 12),
      }).filter(([, v]) => (Array.isArray(v) ? v.length : v))),
      conversation: (capture.conversationTurns || []).filter((t) => str(t.text)).slice(-16)
        .map((t) => ({ role: t.role, text: str(t.text, 500) })),
      assets,
    },
  };
}

function cleanPlan(raw, forced) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const format = forced || (FORMATS.includes(p.format) ? p.format : 'talking_head_broll');
  const faceless = format === 'faceless_text' || format === 'faceless_voiceover' || format === 'music_led';
  const sequences = (Array.isArray(p.sequences) ? p.sequences : []).slice(0, 4).map((s, i, all) => {
    let shot = SHOTS.includes(s?.shot) ? s.shot : 'broll';
    if (faceless && (shot === 'talking_head' || shot === 'talking_head_broll')) shot = format === 'faceless_voiceover' ? 'voiceover' : 'text';
    if (format === 'talking_head') shot = 'talking_head';
    const silent = shot === 'text' || format === 'music_led';
    return {
      title: str(s?.title, 60) || `Sequence ${i + 1}`,
      role: ROLES.includes(s?.role) ? s.role : (i === 0 ? 'hook' : i === all.length - 1 ? 'payoff' : 'value'),
      shot,
      say: silent ? '' : str(s?.say, 500),
      onScreenText: str(s?.onScreenText, 80),
      record: str(s?.record, 400),
      // B-roll is filmed apart from the spoken line (back camera, no talking)
      broll: format === 'talking_head' ? '' : str(s?.broll, 300),
      guidance: str(s?.guidance, 300),
      targetSec: secs(s?.targetSec, 3, 20),
      existing: Boolean(s?.existing),
    };
  }).filter((s) => s.record || s.say);
  if (sequences.length < 2) throw new Error('The reel plan came back with fewer than two sequences.');
  sequences[0].role = 'hook';
  const total = sequences.reduce((n, s) => [n[0] + s.targetSec[0], n[1] + s.targetSec[1]], [0, 0]);
  return {
    version: PLAN_VERSION,
    format,
    priority: { headline: str(p.priority?.headline, 200), body: str(p.priority?.body, 500) },
    title: str(p.title, 120),
    formatSummary: str(p.formatSummary, 300),
    formatWhy: str(p.formatWhy, 400),
    estimatedSec: total[0] ? total : secs(p.estimatedSec, 15, 90),
    caption: str(p.caption, 1200),
    sequences,
  };
}

/**
 * The reel plan for an explored idea. Served from the idea when it was already
 * made for this capture + format (unless refresh).
 * → { plan, idea: { id, mission, missionWhy, title }, cached }
 */
async function ideaReelPlan(userId, ideaId, { captureId, format = '', refresh = false, locale = 'en', debug = null } = {}) {
  const idea = await PostIdea.findOne({ _id: ideaId, user: userId });
  if (!idea) return null;
  const cid = String(captureId || idea.captureId || '');
  const forced = FORMATS.includes(format) ? format : '';
  const kept = idea.reelPlan;
  const brief = { id: String(idea._id), mission: idea.mission, missionWhy: idea.missionWhy || '', title: idea.title };
  if (!refresh && kept?.version === PLAN_VERSION && kept.captureId === cid && (!forced || kept.format === forced)) {
    return { plan: kept, idea: brief, cached: true };
  }

  const cap = cid ? await loadCapture(userId, cid) : null;
  const handle = idea.instagramUsername || cap?.project?.instagramUsername || '';
  const dna = handle ? await loadBrandDna(userId, handle).catch(() => null) : null;
  const brand = dna ? Object.fromEntries(Object.entries({
    whatYouOffer: dna.whatYouOffer, whoYouHelp: dna.whoYouHelp, position: dna.position,
    howYouSound: dna.howYouSound, neverDo: dna.neverDo,
  }).filter(([, v]) => v)) : {};

  const system = loadPrompt().replace('{{LANGUAGE}}', LANGUAGES[locale] || 'English');
  const user = [
    `IDEA:\n${JSON.stringify({
      title: idea.title, mission: idea.mission, missionWhy: idea.missionWhy, why: idea.why,
      pillar: idea.pillar, known: idea.known, questions: idea.questions,
    }, null, 2)}`,
    `CAPTURE (what the studio just told Bauhly):\n${JSON.stringify(cap?.forPrompt || { words: '(no capture saved)' }, null, 2)}`,
    `BRAND MEMORY:\n${JSON.stringify(brand, null, 2)}`,
    `FORCED_FORMAT: ${forced || '(none — choose)'}`,
  ].join('\n\n');

  const started = Date.now();
  const model = reelPlanModel();
  // Sonnet 5.5 refuses a forced tool call: on Claude the schema goes in the
  // system prompt and the answer is read as JSON (same path as the idea agent)
  const res = providerOf(model) === 'anthropic'
    ? await require('./nextPostIdea').completeClaudeJson({ model, system, user, schema: TOOL.input_schema, kind: 'ideaReelPlan' })
    : await completeToolCall({
      model,
      system,
      userParts: [{ type: 'text', text: user }],
      tool: TOOL,
      maxTokens: 6000,
      kind: 'ideaReelPlan',
      reasoningEffort: 'low',
      cacheKey: 'idea-reel-plan',
      timeoutMs: 120000,
      retryHint: 'Return ONLY the JSON object for plan_idea_reel, matching the schema exactly.',
    });
  const plan = { ...cleanPlan(res.parsed, forced), captureId: cid, madeAt: new Date().toISOString() };
  const usage = res.usage || {};
  const costUsd = estimatePlanCostUsd(res.model, num(usage.input_tokens), num(usage.output_tokens), num(usage.cached_tokens), num(usage.cache_write_tokens));
  debug?.push({
    source: 'Idea reel plan',
    model: res.model,
    prompt: `${system}\n\n---\n\n${user}`,
    output: JSON.stringify(res.parsed, null, 2),
    elapsedMs: Date.now() - started,
    usage: { input_tokens: num(usage.input_tokens), output_tokens: num(usage.output_tokens), estimatedCostUsd: costUsd },
  });

  idea.reelPlan = plan;
  if (cid && !idea.captureId) idea.captureId = cid;
  idea.markModified('reelPlan');
  await idea.save();
  return { plan, idea: brief, cached: false };
}

/* The plan as a director note for the reel pipeline (captureReelAgent). */
function storyPlanDirection(plan) {
  if (!plan?.sequences?.length) return '';
  const lines = plan.sequences.map((s, i) => `${i + 1}. ${s.title} (${s.role}, ${s.shot}, ${s.targetSec.join('–')} s)`
    + `${s.say ? ` — says: "${s.say}"` : ''}${s.onScreenText ? ` — on screen: "${s.onScreenText}"` : ''}`);
  return [`Reel: ${plan.title} · format ${plan.format}. Follow these sequences in order:`, ...lines].join('\n').slice(0, 2400);
}

const TALKING_FORMATS = new Set(['talking_head', 'talking_head_broll', 'faceless_voiceover']);

module.exports = { ideaReelPlan, storyPlanDirection, cleanPlan, FORMATS, TALKING_FORMATS, TOOL };
