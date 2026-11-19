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
const FORMATS = ['faceless_text', 'faceless_voiceover', 'talking_head', 'talking_head_broll', 'music_led', 'motion_graphics'];
const ROLES = ['hook', 'context', 'value', 'proof', 'payoff'];
const SHOTS = ['talking_head', 'broll', 'talking_head_broll', 'text', 'voiceover'];
const PLAN_VERSION = 4; // 4: motion graphics planned from the pictures on file · 2: per-sequence B-roll shot list · 3: Claude Sonnet 5.5 (2026-11-19)

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
  const faceless = ['faceless_text', 'faceless_voiceover', 'music_led', 'motion_graphics'].includes(format);
  const sequences = (Array.isArray(p.sequences) ? p.sequences : []).slice(0, 4).map((s, i, all) => {
    let shot = SHOTS.includes(s?.shot) ? s.shot : 'broll';
    if (faceless && (shot === 'talking_head' || shot === 'talking_head_broll')) shot = format === 'faceless_voiceover' ? 'voiceover' : 'text';
    if (format === 'talking_head') shot = 'talking_head';
    if (format === 'motion_graphics') shot = 'text';
    const silent = shot === 'text' || format === 'music_led' || format === 'motion_graphics';
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
async function saveMotionPlan(userId, idea, cid, { kept, brief, refresh, debug }) {
  // served again while the same pictures are on file (a photo added → re-planned)
  const own = cid ? await Project.findOne({ user: userId, 'captures._id': cid }).select('captures._id captures.attachments.key').lean() : null;
  const capKeys = ((own?.captures || []).find((c) => String(c._id) === cid)?.attachments || []).map((a) => a.key).filter(Boolean);
  const sourceSig = [...capKeys, ...(await reelBrollKeys(userId, idea))].sort().join('|');
  if (!refresh && kept?.format === 'motion_graphics' && kept.motionPlan && kept.captureId === cid && kept.version === PLAN_VERSION && kept.sourceSig === sourceSig) {
    return { plan: kept, idea: brief, cached: true };
  }
  const plan = { ...(await motionReelPlanFor(userId, idea, cid, { kept, debug })), sourceSig };
  idea.reelPlan = plan;
  if (cid && !idea.captureId) idea.captureId = cid;
  idea.markModified('reelPlan');
  await idea.save();
  return { plan, idea: brief, cached: false };
}

async function ideaReelPlan(userId, ideaId, { captureId, format = '', refresh = false, locale = 'en', debug = null } = {}) {
  const idea = await PostIdea.findOne({ _id: ideaId, user: userId });
  if (!idea) return null;
  const cid = String(captureId || idea.captureId || '');
  const forced = FORMATS.includes(format) ? format : '';
  const kept = idea.reelPlan;
  const brief = { id: String(idea._id), mission: idea.mission, missionWhy: idea.missionWhy || '', title: idea.title };
  if (!refresh && kept?.version === PLAN_VERSION && kept.captureId === cid && (!forced || kept.format === forced)
    && !(forced === 'motion_graphics' && !kept.motionPlan)) {
    return { plan: kept, idea: brief, cached: true };
  }

  if (forced === 'motion_graphics') return saveMotionPlan(userId, idea, cid, { kept, brief, refresh, debug });

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
  // the producer chose Motion graphics: rebuild it from the pictures on file
  if (plan.format === 'motion_graphics') return saveMotionPlan(userId, idea, cid, { kept: plan, brief, refresh: true, debug });
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

/*
 * The media a recommended reel may use beyond its capture: the idea's suggested
 * photos, then its source captures' photos/clips (shared with
 * captureReelController.createReel so the plan and the render see the same set).
 */
async function reelBrollKeys(userId, idea) {
  let keys = (idea?.assets || []).map((a) => a.key).filter(Boolean);
  const srcIds = (idea?.sources || []).filter((x) => x.kind === 'capture' && /^[a-f0-9]{24}$/i.test(String(x.id))).map((x) => String(x.id));
  if (srcIds.length) {
    const srcProjects = await Project.find({ user: userId, 'captures._id': { $in: srcIds } }).select('captures._id captures.attachments.key captures.attachments.type').lean();
    srcProjects.forEach((p) => (p.captures || []).forEach((c) => {
      if (srcIds.includes(String(c._id))) (c.attachments || []).forEach((a) => a.key && keys.push(a.key));
    }));
  }
  keys = [...new Set(keys)].slice(0, 12);
  return keys;
}

const say = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const FORMAT_SAY = {
  before_after_wipe: 'a before → after wipe',
  ken_burns: 'slow camera moves and captions',
  stat_counter: 'numbers that count up',
  listicle_tips: 'numbered tips',
  hotspot_callouts: 'tagged details on a finished photo',
  palette_extract: "the room's colour palette pulled from a photo",
  grid_build: 'a four-photo grid',
  kinetic_hook: 'animated headlines and moving shapes',
};

/*
 * Motion graphics (studio, 2026-11-19): the reel plan IS the motion planner's
 * plan (motionReelSelector → motionReelPlanner), built only from the photos,
 * plans and renders already on file — nothing to film, nothing asked for. It is
 * stored on the plan (`motionPlan`) and the render reuses it.
 */
async function motionReelPlanFor(userId, idea, cid, { kept, debug }) {
  const agent = require('./captureReelAgent');
  const project = cid ? await Project.findOne({ user: userId, 'captures._id': cid }).select('_id instagramUsername') : null;
  if (!project) {
    const err = new Error('Save the capture first — the motion reel is made from its photos.');
    err.statusCode = 400;
    throw err;
  }
  const handle = idea.instagramUsername || project.instagramUsername || '';
  const brollKeys = await reelBrollKeys(userId, idea);
  const rows = [];
  const material = await agent._loadMaterial({
    _id: 'plan', user: userId, projectId: project._id, captureIds: [cid], instagramUsername: handle, takes: [], brollKeys, storyPlan: { sequences: [] }, graphicsOk: true,
  }, { add: (r) => rows.push(r) });
  const { brandKitColors, brandKitFonts } = require('./brandKitColors');
  const [dna, colors, fonts] = await Promise.all([
    handle ? loadBrandDna(userId, handle).catch(() => null) : null,
    brandKitColors(userId, handle),
    brandKitFonts(userId, handle).catch(() => null),
  ]);
  const started = Date.now();
  const mp = await require('./motionReelPlanner').planMotionReel({
    material,
    brand: { accent: colors?.accent, ground: colors?.ground, fg: colors?.fg, headlineFont: fonts?.heading?.family, bodyFont: fonts?.body?.family },
    dna, handle, idea, storyPlan: null, language: 'English',
  });
  mp.debugRows.forEach((r) => debug?.push({ ...r, elapsedMs: r.elapsedMs || Date.now() - started }));
  const m = mp.plan;
  const A = new Map(mp.ctx.capture.assets.map((a) => [a.assetId, a]));
  const pic = (id) => (!id ? 'your brand colours' : A.get(id)?.summary ? `your photo of ${A.get(id).summary.replace(/\.$/, '').toLowerCase()}` : 'one of your photos');
  const secs = (seg) => { const d = Math.max(1, Math.round(seg.endSec - seg.startSec)); return [d, d]; };
  const cap = (seg) => seg.accents?.find((a) => a.kind === 'fact_captions')?.items || [];
  const NOTHING = 'Nothing to film — made from the photos you already shared.';
  const row = (title, role, onScreenText, record, targetSec) => ({
    title, role, shot: 'text', say: '', onScreenText: say(onScreenText).slice(0, 80), record: say(record).slice(0, 400), broll: '', guidance: NOTHING, targetSec, existing: true,
  });
  const sequences = [];
  m.segments.forEach((seg) => {
    const q = seg.props || {};
    if (seg.type === 'intro') { sequences.push(row('Stop the scroll', 'hook', (q.words || []).join(' '), `A bold animated headline over ${pic(q.backgroundAssetId)}.`, secs(seg))); return; }
    if (seg.type === 'outro') { sequences.push(row('Call to action', 'payoff', q.cta, `An end card in your brand colours${q.handle ? ` with ${q.handle}` : ''}.`, secs(seg))); return; }
    const c = cap(seg);
    const per = (n) => { const d = Math.max(1, Math.round((seg.endSec - seg.startSec) / Math.max(1, n))); return [d, d]; };
    if (seg.formatId === 'ken_burns') {
      (q.assetIds || []).forEach((id, i) => sequences.push(row(i === 0 ? 'Set the scene' : i === q.assetIds.length - 1 ? 'The hero shot' : 'The detail', i === 0 ? 'context' : i === q.assetIds.length - 1 ? 'proof' : 'value', c[i] || '', `A slow camera move across ${pic(id)}${i === q.assetIds.length - 1 && seg.accents?.some((a) => a.kind === 'palette_strip') ? ', with its colour palette drawn in' : ''}.`, per(q.assetIds.length))));
    } else if (seg.formatId === 'before_after_wipe') {
      sequences.push(row('Before → after', 'proof', c.join(' · '), `A wipe from ${pic(q.beforeAssetId)} to ${pic(q.afterAssetId)}, with Before / After labels.`, secs(seg)));
    } else if (seg.formatId === 'stat_counter') {
      (q.stats || []).forEach((st) => sequences.push(row(`Count up ${st.value}`, 'proof', st.label, `${st.value} counts up on screen${q.backgroundAssetId ? ` over ${pic(q.backgroundAssetId)}` : ''}.`, per(q.stats.length))));
    } else if (seg.formatId === 'listicle_tips') {
      (q.tips || []).forEach((t, i) => sequences.push(row(`Tip ${i + 1}`, 'value', t.title, `Numbered tip card in your brand colours${q.backgroundAssetId ? ` over ${pic(q.backgroundAssetId)}` : ''}.`, per(q.tips.length))));
    } else if (seg.formatId === 'hotspot_callouts') {
      const names = (q.productIds || []).map((id) => mp.ctx.project.products.find((x) => x.productId === id)?.name).filter(Boolean);
      sequences.push(row('Tag the details', 'value', c[0] || names.join(' · '), `Pins and labels on ${pic(q.assetId)}: ${names.join(', ')}.`, secs(seg)));
    } else if (seg.formatId === 'palette_extract') {
      sequences.push(row('The colour story', 'value', c.join(' · '), `The room's colours are pulled out of ${pic(q.assetId)} as swatches.`, secs(seg)));
    } else if (seg.formatId === 'grid_build') {
      sequences.push(row('Build the grid', 'value', (q.tiles || []).map((t) => t.label).filter(Boolean).join(' · '), `Four of your photos land one by one into a grid${seg.accents?.some((a) => a.kind === 'poll_sticker') ? ', then a "Which one?" poll' : ''}.`, secs(seg)));
    } else {
      const lines = q.lines?.length ? q.lines : [(q.words || []).join(' ')];
      lines.forEach((l, i) => sequences.push(row(i === 0 ? 'The headline' : `Line ${i + 1}`, i === 0 ? 'hook' : i === lines.length - 1 ? 'proof' : 'value', l, `Animated type with moving shapes over ${pic(q.backgroundAssetId)}.`, per(lines.length))));
    }
  });
  const used = new Set();
  m.segments.forEach((seg) => { const q = seg.props || {}; [q.backgroundAssetId, q.beforeAssetId, q.afterAssetId, q.assetId, ...(q.assetIds || []), ...(q.tiles || []).map((t) => t.assetId)].forEach((id) => id && used.add(id)); });
  const total = Math.round(m.durationSec);
  const plan = {
    version: PLAN_VERSION,
    format: 'motion_graphics',
    priority: kept?.priority?.headline ? kept.priority : { headline: 'Show your work at its best.', body: '' },
    title: say(idea.title).slice(0, 120) || (m.segments[0]?.props?.words || []).join(' '),
    formatSummary: (used.size
      ? `${FORMAT_SAY[m.mainFormat] || 'Animated graphics'} over ${used.size} of your photos — nothing to film.`
      : `${FORMAT_SAY[m.mainFormat] || 'Animated graphics'} on your brand colours — no photos needed, nothing to film.`).replace(/^./, (x) => x.toUpperCase()),
    formatWhy: used.size
      ? `Built only from what you already shared (${used.size} of the ${mp.ctx.capture.assets.length} pictures on file), so there is nothing new to record or upload.`
      : 'This capture has no photos, so the reel is pure graphics drawn from what you told Bauhly — nothing to record or upload.',
    estimatedSec: [total, total],
    caption: m.caption,
    sequences,
    motionPlan: m,
    assetSig: [...mp.ctx.internal.values()].map((p) => p.key).sort().join('|'),
    captureId: cid,
    madeAt: new Date().toISOString(),
  };
  return plan;
}

/* The plan as a director note for the reel pipeline (captureReelAgent). */
function storyPlanDirection(plan) {
  if (!plan?.sequences?.length) return '';
  const lines = plan.sequences.map((s, i) => `${i + 1}. ${s.title} (${s.role}, ${s.shot}, ${s.targetSec.join('–')} s)`
    + `${s.say ? ` — says: "${s.say}"` : ''}${s.onScreenText ? ` — on screen: "${s.onScreenText}"` : ''}`);
  return [`Reel: ${plan.title} · format ${plan.format}. Follow these sequences in order:`, ...lines].join('\n').slice(0, 2400);
}

const TALKING_FORMATS = new Set(['talking_head', 'talking_head_broll', 'faceless_voiceover']);

module.exports = { ideaReelPlan, reelBrollKeys, motionReelPlanFor, storyPlanDirection, cleanPlan, FORMATS, TALKING_FORMATS, TOOL };
