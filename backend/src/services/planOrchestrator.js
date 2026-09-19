const fs = require('fs');
const path = require('path');
const { extractJson, estimatePlanCostUsd, assignToEmptyDates, normalizeLens } = require('./weeklyPlan');
const { compileStrategyContext, assetsForDay, allocatedAssetsOf, applyAssetAllocation, knownAssetIndexOf, json } = require('./planContext');
const { completeText, resolvePlanAgentLlm, splitPromptTemplate, reasoningEffortFor } = require('./llmComplete');
const { ANNOTATIONS_ENABLED, asStoredText, asStoredLines, flattenSlide, layoutForStructure, mediaKeysOf, projectMediaKeysIn } = require('./slideContent');
const { boxOf, matchSubject, regionFromBox } = require('./subjectBox');
const { layoutById } = require('./layoutCatalog');
const { extractLayoutHtml, extractHtmlDocument, parseCarouselDocument, hasImageSlot, shareLayoutStyles, copyFromLayoutHtml, injectImageIntoSlots } = require('./layoutHtml');
const { publicMediaUrl, isCdnConfigured, getMediaUrl, isS3Configured } = require('./s3Client');
const { isImageGenConfigured: isOpenAIImageConfigured, generateImage: renderOpenAIImage } = require('./openaiImage');
const { buildImagePrompt, persistGeneratedImage } = require('./generatedImage');
const { themeById, themeReferenceForPrompt, themesForStrategistPrompt, resolveThemeId } = require('../data/carouselThemes');

const PROMPTS_DIR = path.join(__dirname, '..', '..', 'prompts');
const cache = {};

function loadPrompt(name) {
  if (!cache[name]) {
    cache[name] = fs.readFileSync(path.join(PROMPTS_DIR, name), 'utf8');
  }
  return cache[name];
}

function fillTemplate(template, vars) {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    const token = `{{${key}}}`;
    out = out.split(token).join(typeof value === 'function' ? value() : String(value ?? ''));
  }
  return out;
}

function assembleAgentPrompt(name, vars) {
  const raw = loadPrompt(name);
  const { system, userTemplate } = splitPromptTemplate(raw);
  const filledSystem = fillTemplate(system, vars);
  const filledUser = fillTemplate(userTemplate || raw, vars);
  return {
    system: filledSystem,
    user: filledUser,
    prompt: [filledSystem, filledUser].filter(Boolean).join('\n\n'),
  };
}

function agentModel(kind) {
  return resolvePlanAgentLlm(kind).model;
}

const GOAL_TAG = { discovery: 'Get noticed', credibility: 'Show expertise', trust: 'Build confidence' };
const PILLAR_JOB = {
  discovery: 'Make the audience recognise the problem and care. Stay with tension, curiosity, and recognition. Do not teach the method, walk through how the brand works, or prove expertise as the body of this post. Brand may appear only as a recognisable stance, not a process.',
  credibility: 'Show how this brand thinks and works. Reasoning, process, judgment, or first-hand experience — supported by the brief. Do not stop at naming the problem.',
  trust: 'Reduce uncertainty. Care, reliability, transparency, guidance, or a supported outcome. Never invent proof. Do not leave this as a Discovery hook with no reliability landing.',
};

function lockedPillarOf(planned) {
  return normalizeLens(planned?.lens || planned?.pillar) || '';
}
const FORMATS = ['Reel', 'Carousel', 'Post', 'Story'];
const WRITER_FORMATS = ['Reel', 'Carousel', 'Post', 'Story', 'Before/After', 'Annotated Visual'];

const AVAILABLE_ELEMENTS = {
  text: ['Title', 'Subtitle', 'Body', 'Short_Statement', 'Question', 'Quote', 'Supporting_Text', 'Label'],
  structured: [
    'List', 'Numbered_Items', 'Steps', 'Sequence', 'Comparison', 'Before_After',
    'Pros_Cons', 'Do_Dont', 'Problem_Solution', 'Cause_Effect', 'Options',
    'Example', 'Reason_Rationale', 'Number_Stat', 'Data_Chart', 'Ranking', 'Checklist',
    'Timeline', 'Process_Flow', 'Framework', 'Categories_Groups', 'Hierarchy',
    'Diagram', 'Map_Spatial', 'Annotated_Visual', 'Multiple_Visuals', 'Progression', 'Testimonial',
  ],
  action: ['Action'],
  visual: [
    'Image', 'Multiple_Images', 'Detail_Closeup', 'Screenshot', 'Document_Source',
    'Plan_Drawing', 'Illustration', 'Graphic_Artwork', 'Product_Object', 'People_Context',
    'Environment_Space', 'Video_Motion', 'Screen_Recording', 'Animation', 'Caption_Label',
    ...(ANNOTATIONS_ENABLED ? ['Annotation'] : []),
  ],
};

const VISUAL_PRIORITIES = ['required', 'recommended', 'optional', 'none'];
const VISUAL_ROLES = ['evidence', 'explanation', 'recognition', 'demonstration', 'context', 'none'];
const VISUAL_TYPES = new Set([...AVAILABLE_ELEMENTS.visual, 'none']);
const SOURCE_VISUAL_TYPES = new Set([
  'Image', 'Multiple_Images', 'Detail_Closeup', 'Screenshot', 'Document_Source',
  'Plan_Drawing', 'Product_Object', 'People_Context', 'Environment_Space',
  'Video_Motion', 'Screen_Recording', 'Annotated_Visual', 'Multiple_Visuals',
]);

const AVAILABLE_ELEMENT_SET = new Set([
  ...AVAILABLE_ELEMENTS.text,
  ...AVAILABLE_ELEMENTS.structured,
  ...AVAILABLE_ELEMENTS.action,
  ...AVAILABLE_ELEMENTS.visual,
]);

const PLATFORM_CONSTRAINTS = {
  platform: 'instagram',
  nativeBehaviors: [
    'continue/swipe', 'read/learn-more', 'save', 'share', 'comment', 'reply',
    'follow', 'visit', 'open-link', 'reflect/consider',
  ],
  actionExpressions: ['none', 'CTA-text', 'question', 'native-behavior', 'link-reference'],
  formatRules: {
    Post: 'One visual surface for one narrative unit. Distinct units are not caption leftovers. If two or more units need a visual beat, use Carousel.',
    Carousel: 'One slide per distinct narrative unit. Swipe is native. Do not merge Problem, Decision, and Result onto one slide.',
    Reel: 'Map units to scenes/beats. Motion may carry meaning. Do not drop meaningful units to keep the sequence short.',
    Story: 'Lightweight sequential scenes/beats. Keep each scene one clear thought.',
    'Before/After': 'Requires genuine supporting evidence of both states. Do not fake a transformation.',
    'Annotated Visual': 'Requires a real visual that can carry supported factual annotations.',
  },
};

function stringList(value) {
  return Array.isArray(value) ? value.map((x) => String(x || '').trim()).filter(Boolean) : [];
}

function hashtagList(value) {
  const parts = Array.isArray(value)
    ? value.flatMap((x) => (Array.isArray(x) ? x : String(x || '').split(/[\s,]+/)))
    : String(value || '').split(/[\s,]+/);
  return [...new Set(parts.map((h) => String(h || '').replace(/^#/, '').trim()).filter(Boolean))];
}

function optionalText(value) {
  return String(value || '').trim();
}

function unmarkedText(value) {
  return optionalText(value).replace(/\{\{(?:fg|accent|ground)\|([^{}]*)\}\}/g, '$1');
}

function optionalTextOrList(value) {
  if (Array.isArray(value)) return stringList(value);
  return optionalText(value);
}

function sourceTraceOf(value) {
  if (!Array.isArray(value)) return [];
  return value.map((row) => ({
    fact: optionalText(row?.fact),
    sourceType: optionalText(row?.sourceType),
    sourceReference: optionalText(row?.sourceReference),
  })).filter((row) => row.fact).slice(0, 24);
}

function narrativeUnitsOf(brief) {
  if (!Array.isArray(brief?.narrativeUnits)) return [];
  return brief.narrativeUnits.map((u, i) => {
    const unit = {
      id: String(u?.id || `u${i + 1}`).trim() || `u${i + 1}`,
      index: Number(u?.index) > 0 ? Number(u.index) : i + 1,
      role: String(u?.role || '').trim(),
      purpose: String(u?.purpose || '').trim(),
      support: String(u?.support || '').trim(),
    };
    const placement = String(u?.placement || '').trim().toLowerCase();
    if (['visual', 'caption', 'cta'].includes(placement)) unit.placement = placement;
    const rel = u?.relationship && typeof u.relationship === 'object' ? u.relationship : null;
    if (rel) {
      const type = optionalText(rel.type);
      const connectsFrom = optionalText(rel.connectsFrom);
      const connectsTo = optionalText(rel.connectsTo);
      if (type && type !== 'none') {
        unit.relationship = { type, connectsFrom, connectsTo };
      }
    }
    return unit;
  }).filter((u) => u.purpose || u.support || u.role);
}

function withUnitIds(units) {
  return (Array.isArray(units) ? units : []).map((u, i) => ({
    ...u,
    id: String(u?.id || `u${i + 1}`).trim() || `u${i + 1}`,
    index: Number(u?.index) > 0 ? Number(u.index) : i + 1,
  }));
}

function platformConstraintsOf(format) {
  const locked = lockedFormat(format);
  return {
    ...PLATFORM_CONSTRAINTS,
    format: locked,
    formatRule: PLATFORM_CONSTRAINTS.formatRules[locked] || PLATFORM_CONSTRAINTS.formatRules.Post,
  };
}

function visualSlidesOf(structure) {
  return (Array.isArray(structure?.slidesOrScenes) ? structure.slidesOrScenes : [])
    .filter((s) => {
      const placement = String(s?.placement || 'visual').trim().toLowerCase();
      const actionPlacement = String(s?.action?.placement || '').trim().toLowerCase();
      return placement === 'visual' || placement === '' || actionPlacement === 'dedicated-surface';
    });
}

function persistFormat(label) {
  const s = String(label || '').trim();
  if (/before/i.test(s)) return 'Carousel';
  if (/annotat/i.test(s)) return 'Post';
  if (FORMATS.includes(s)) return s;
  if (/carousel/i.test(s)) return 'Carousel';
  if (/reel/i.test(s)) return 'Reel';
  if (/stor/i.test(s)) return 'Story';
  if (/post|static|feed|photo/i.test(s)) return 'Post';
  return 'Post';
}

function lockedFormat(briefFormat) {
  const s = String(briefFormat || '').trim();
  if (WRITER_FORMATS.includes(s)) return s;
  return persistFormat(s);
}

function briefFieldsOf(b) {
  const lens = normalizeLens(b.lens || b.pillar);
  const themeId = resolveThemeId(b.themeId || b.theme || b.carouselTheme, { pillar: lens });
  return {
    source: b.source || '',
    captureId: optionalText(b.captureId),
    sourceCaptureId: optionalText(b.sourceCaptureId) || optionalText(b.captureId),
    sourceInternalStoryIds: stringList(b.sourceInternalStoryIds),
    sourceTrace: sourceTraceOf(b.sourceTrace),
    sourceStoryId: optionalText(b.sourceStoryId),
    project: optionalText(b.project),
    originalCapture: optionalText(b.originalCapture),
    angle: b.angle || '',
    verifiedTruth: stringList(b.verifiedTruth),
    observableDetails: stringList(b.observableDetails),
    relevantAssetContext: stringList(b.relevantAssetContext),
    allocatedAssets: allocatedAssetsOf(b.allocatedAssets || b.allocatedAssetKeys),
    visualLimitations: stringList(b.visualLimitations),
    uniqueJob: optionalText(b.uniqueJob),
    audienceTension: optionalText(b.audienceTension),
    hookTerritory: optionalText(b.hookTerritory),
    centralFact: optionalText(b.centralFact),
    ownedTerritory: optionalText(b.ownedTerritory),
    doNotRepeat: optionalTextOrList(b.doNotRepeat),
    format: optionalText(b.format),
    formatReason: optionalText(b.formatReason),
    themeId,
    themeReason: optionalText(b.themeReason),
    narrativeUnits: narrativeUnitsOf(b),
    approvedGenerationRoute: optionalText(b.approvedGenerationRoute),
    knownLimitation: optionalText(b.knownLimitation),
    hashtags: stringList(b.hashtags),
    recommendedTime: optionalText(b.recommendedTime),
    pillarJob: optionalText(b.pillarJob),
    ...(lens ? { lens, pillar: lens } : {}),
  };
}

function maxTokensFor(kind) {
  if (kind === 'strategist') {
    const n = Number(process.env.PLAN_STRATEGIST_MAX_TOKENS);
    return Number.isFinite(n) && n > 0 ? n : 32000;
  }
  if (kind === 'structure') {
    const n = Number(process.env.PLAN_STRUCTURE_MAX_TOKENS);
    return Number.isFinite(n) && n > 0 ? n : 16384;
  }
  if (kind === 'layout') {
    const n = Number(process.env.PLAN_LAYOUT_MAX_TOKENS);
    return Number.isFinite(n) && n > 0 ? n : 16384;
  }
  if (kind === 'layoutVariations') {
    const n = Number(process.env.PLAN_LAYOUT_VARIATIONS_MAX_TOKENS);
    return Number.isFinite(n) && n > 0 ? n : 16384;
  }
  if (kind === 'carousel') {
    const n = Number(process.env.PLAN_CAROUSEL_MAX_TOKENS);
    return Number.isFinite(n) && n > 0 ? n : 32768;
  }
  if (kind === 'visual') {
    const n = Number(process.env.PLAN_VISUAL_MAX_TOKENS);
    return Number.isFinite(n) && n > 0 ? n : 2048;
  }
  const n = Number(process.env.PLAN_AGENT_MAX_TOKENS);
  return Number.isFinite(n) && n > 0 ? n : 16384;
}

function envFlagOn(name, fallback) {
  const v = String(process.env[name] ?? fallback).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

function envFlagOff(name, fallback) {
  const v = String(process.env[name] ?? fallback).trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'off' || v === 'no';
}

function layoutAgentEnabled() {
  return envFlagOn('PLAN_LAYOUT_AGENT', '0');
}

function carouselAgentEnabled() {
  return !envFlagOff('PLAN_CAROUSEL_AGENT', '1');
}

// Content Structure agent is OFF by default — Strategist brief goes straight to Carousel.
function contentStructureAgentEnabled() {
  return envFlagOn('PLAN_CONTENT_STRUCTURE_AGENT', '0');
}

function layoutSlideParallelEnabled() {
  return !envFlagOff('PLAN_LAYOUT_SLIDE_PARALLEL', '1');
}

// Visual Generator agent — fills empty image slots with generated pictures.
// Off by default. Set PLAN_VISUAL_AGENT=1 (and OpenAI + S3) to enable.
function visualAgentEnabled() {
  if (!envFlagOn('PLAN_VISUAL_AGENT', '0')) return false;
  return isOpenAIImageConfigured() && isS3Configured();
}

function visualSlideConcurrency() {
  return envPositiveInt('PLAN_VISUAL_SLIDE_CONCURRENCY', 3);
}

// Auto-generation fills ANY empty image slot (a slide the carousel agent kept an
// image slot for, with no supplied asset) by default — that is the intent of
// "generate a visual where the asset is missing". Set PLAN_VISUAL_STRICT=1 to
// restrict it to only the structure agent's `generate-conceptual-support` slides.
function visualFillEmptyEnabled() {
  return !envFlagOn('PLAN_VISUAL_STRICT', '0');
}

function envPositiveInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function dayConcurrency() {
  return envPositiveInt('PLAN_DAY_CONCURRENCY', 8);
}

function layoutSlideConcurrency() {
  return envPositiveInt('PLAN_LAYOUT_SLIDE_CONCURRENCY', 4);
}

function layoutTimeoutMs() {
  return envPositiveInt('PLAN_LAYOUT_TIMEOUT_MS', 60000);
}

// One slide × four compositions is a larger single generation than one layout
// option, but far smaller than a full multi-theme carousel — give it its own
// budget so an on-demand Change-layout request never inherits the carousel's.
function layoutVariationsTimeoutMs() {
  return envPositiveInt('PLAN_LAYOUT_VARIATIONS_TIMEOUT_MS', 120000);
}

// The carousel HTML is a big generation, and a reasoning model makes it far
// slower: Claude at 'high' effort routinely runs 2–5 minutes on a full post
// (most of the time is thinking). Sizing the timeout for the fast GPT default
// aborted those runs mid-generation, which surfaced in the UI as "no
// generation". Scale the budget to the chosen provider and reasoning effort so a
// deliberately slow model is given room to finish. Env override still wins.
function carouselTimeoutMs() {
  const override = envPositiveInt('PLAN_CAROUSEL_TIMEOUT_MS', 0);
  if (override) return override;
  let provider = 'openai';
  let effort = 'low';
  try {
    provider = resolvePlanAgentLlm('carousel').provider || 'openai';
    effort = reasoningEffortFor('carousel');
  } catch { /* fall back to defaults below */ }
  if (provider === 'anthropic') {
    // Opus at high effort is the slowest path — give it a wide budget.
    if (effort === 'high') return 480000;
    if (effort === 'medium') return 300000;
    return 180000;
  }
  return effort === 'high' ? 240000 : 150000;
}

const layoutWaiters = [];
let layoutActive = 0;

function withLayoutSlot(fn) {
  const max = layoutSlideConcurrency();
  return new Promise((resolve, reject) => {
    const start = () => {
      layoutActive += 1;
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          layoutActive -= 1;
          const next = layoutWaiters.shift();
          if (next) next();
        });
    };
    if (layoutActive < max) start();
    else layoutWaiters.push(start);
  });
}

async function mapPool(items, limit, mapper) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const cap = Math.max(1, Math.min(Number(limit) || list.length, list.length));
  const out = new Array(list.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= list.length) return;
      out[i] = await mapper(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: cap }, () => worker()));
  return out;
}

function retryMaxTokens(current) {
  const bumped = Math.min(Math.max(current, 1) * 2, 64000);
  return bumped > current ? bumped : current;
}

function usageOf(response, model) {
  const inputTokens = Number(response.usage?.input_tokens) || 0;
  const outputTokens = Number(response.usage?.output_tokens) || 0;
  const cachedTokens = Number(response.usage?.cached_tokens) || 0;
  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: estimatePlanCostUsd(model, inputTokens, outputTokens, cachedTokens),
    model,
  };
}

function mergeUsage(parts, model) {
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    model,
  };
  for (const p of parts) {
    usage.inputTokens += p.inputTokens || 0;
    usage.outputTokens += p.outputTokens || 0;
    usage.cachedTokens += p.cachedTokens || 0;
    usage.totalTokens += p.totalTokens || 0;
    usage.estimatedCostUsd += p.estimatedCostUsd || 0;
  }
  usage.estimatedCostUsd = Math.round(usage.estimatedCostUsd * 1e6) / 1e6;
  return usage;
}

async function callAgent({ source, kind, prompt, system, user, validate, parse, htmlDirection }) {
  const llm = resolvePlanAgentLlm(kind);
  const model = llm.model;
  let maxTokens = maxTokensFor(kind);
  const asHtml = parse === 'html';
  const maxAttempts = asHtml ? 3 : 2;
  let lastErr;
  const baseUser = user || prompt || '';
  let userContent = baseUser;
  const debugPrompt = [system, baseUser].filter(Boolean).join('\n\n');
  const started = Date.now();
  const sectionDir = String(htmlDirection || 'architectural-minimal').trim() || 'architectural-minimal';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt === 1) {
      console.log(`[planOrchestrator] ${source} · ${llm.provider}/${model}`);
    }
    const response = await completeText({
      model,
      system,
      user: userContent,
      prompt: userContent,
      maxTokens,
      cacheKey: `igsignal-plan-${kind}`,
      kind,
      timeoutMs: kind === 'layout' ? layoutTimeoutMs()
        : (kind === 'carousel' ? carouselTimeoutMs()
          : (kind === 'layoutVariations' ? layoutVariationsTimeoutMs() : 0)),
    });
    const fullText = response.text || '';
    const usage = usageOf(response, model);
    const debugEntry = { source, model, provider: llm.provider, prompt: debugPrompt, kind };

    if (response.stopReason === 'max_tokens') {
      lastErr = new Error(`${source} response truncated (max_tokens=${maxTokens})`);
      const next = retryMaxTokens(maxTokens);
      console.warn(
        `[planOrchestrator] ${source} attempt ${attempt}: truncated at ${maxTokens}` +
          (next > maxTokens ? ` — retrying with ${next}` : ''),
      );
      maxTokens = next;
      continue;
    }

    let parsed;
    try {
      if (asHtml) {
        const html = extractHtmlDocument(fullText);
        if (!html || !/<article|<html|<section/i.test(html)) {
          throw new Error('missing carousel html');
        }
        parsed = { status: 'ready', html };
      } else {
        parsed = extractJson(fullText);
      }
    } catch (err) {
      lastErr = err;
      console.warn(
        `[planOrchestrator] ${source} attempt ${attempt}: ` +
          `${asHtml ? 'HTML' : 'JSON'} parse failed — ${err.message}`,
      );
      if (asHtml && attempt < maxAttempts) {
        userContent = `${baseUser}\n\n---\nPrevious attempt was not a usable HTML document (${err.message}). ` +
          'Return ONLY a complete HTML document with one theme section ' +
          `(\`<section data-direction="${sectionDir}">\`) containing ` +
          '`<article class="slide" data-index="N">` for every slide. Do not nest other sections inside it.';
      }
      continue;
    }

    try {
      if (typeof validate === 'function') validate(parsed);
      const elapsedMs = Date.now() - started;
      if (usage.cachedTokens) {
        console.log(`[planOrchestrator] ${source} cache hit ${usage.cachedTokens}/${usage.inputTokens} input tokens`);
      }
      console.log(
        `[planOrchestrator] ${source} done · ${Math.round(elapsedMs / 100) / 10}s` +
          ` · ${usage.totalTokens} tok (${usage.outputTokens} out)`,
      );
      return {
        parsed,
        usage,
        debugEntry: { ...debugEntry, output: fullText, elapsedMs, usage },
      };
    } catch (err) {
      lastErr = err;
      console.warn(
        `[planOrchestrator] ${source} attempt ${attempt}: validation failed — ${err.message} ` +
          `(out=${usage.outputTokens} tok, stop=${response.stopReason || 'stop'}, chars=${fullText.length})`,
      );
      if (asHtml && attempt < maxAttempts) {
        userContent = `${baseUser}\n\n---\nPrevious attempt failed validation: ${err.message}. ` +
          'Return ONLY a complete HTML document. Required markers: one ' +
          `\`<section data-direction="${sectionDir}">\` ` +
          'wrapping `<article class="slide" data-index="1..N">` for every slide. ' +
          'Emit exactly one theme section; put data-direction on it (not on buttons alone). ' +
          'Do not nest <section> inside the theme section — use <div> for preview chrome.';
      }
    }
  }

  throw new Error(`${source} failed after ${maxAttempts} attempts: ${lastErr?.message || 'unknown error'}`);
}

function validateStrategist(parsed) {
  if (!parsed?.focus || typeof parsed.focus !== 'object') throw new Error('missing focus');
  const briefs = Array.isArray(parsed.briefs)
    ? parsed.briefs
    : (Array.isArray(parsed.plannedDays) ? parsed.plannedDays : null);
  if (!Array.isArray(briefs)) throw new Error('missing briefs');
  // Strategist briefs are always carousel posts.
  parsed.briefs = briefs.map((b) => briefFieldsOf({ ...b, format: 'Carousel' }));
  parsed.plannedDays = parsed.briefs;
}

function captureByBriefId(conversationCaptures, brief) {
  const ids = [brief?.captureId, brief?.sourceCaptureId, brief?.sourceStoryId]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  const sourceToken = String(brief?.source || '').trim().split(/\s+/)[0];
  if (sourceToken) ids.push(sourceToken);
  if (!ids.length) return null;
  return (conversationCaptures || []).find((c) => (
    ids.includes(String(c.id || ''))
    || ids.includes(String(c.captureId || ''))
    || ids.includes(String(c.sourceStoryId || ''))
  )) || null;
}

function enrichBriefsFromCaptures(briefs, conversationCaptures, ctx = {}) {
  const known = knownAssetIndexOf(ctx.projectsList || ctx.projects, ctx.assetContext);
  return (briefs || []).map((b) => {
    const src = captureByBriefId(conversationCaptures, b);
    const filled = src ? {
      ...b,
      captureId: b.captureId || src.id || src.captureId,
      sourceCaptureId: b.sourceCaptureId || b.captureId || src.id || src.captureId,
      sourceInternalStoryIds: (b.sourceInternalStoryIds && b.sourceInternalStoryIds.length)
        ? b.sourceInternalStoryIds
        : [],
      originalCapture: b.originalCapture || src.originalCapture,
      sourceStoryId: b.sourceStoryId || src.sourceStoryId,
      project: b.project || src.project,
      knownLimitation: b.knownLimitation || src.knownLimitation,
      relevantAssetContext: (b.relevantAssetContext && b.relevantAssetContext.length)
        ? b.relevantAssetContext
        : (src.assets || src.attachedAssets || []).map((a) => a.summary).filter(Boolean),
      visualLimitations: (b.visualLimitations && b.visualLimitations.length)
        ? b.visualLimitations
        : (src.assets || []).flatMap((a) => a.limitations || []),
    } : b;
    return { ...filled, ...applyAssetAllocation(filled, src, known) };
  });
}

function writerFailed(parsed) {
  const status = String(parsed?.status || '').toLowerCase();
  return status === 'failed' || status === 'cannot_generate';
}

function isSourceVisualType(type) {
  return SOURCE_VISUAL_TYPES.has(String(type || '').trim());
}

function photoLayoutOf(s) {
  const layout = optionalText(s.layout);
  if (layout && layoutById(layout)) return layout;
  if (layout && layout !== 'e-hook-statement') return layout;
  return 'n-hook-band';
}

function textLedResolution(resolution) {
  const type = String(resolution?.type || '').trim().toLowerCase();
  return ['text-only-fallback', 'request-missing-asset', 'reject-surface-or-narrative'].includes(type);
}

function textNeedOf(raw) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const type = optionalText(t.type) || 'Title';
  const none = type === 'None';
  return {
    required: none ? false : (t.required === false ? false : true),
    type,
    communicationFunction: optionalText(t.communicationFunction),
  };
}

function visualNeedOf(raw) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const priority = VISUAL_PRIORITIES.includes(String(t.priority || '').trim().toLowerCase())
    ? String(t.priority).trim().toLowerCase()
    : 'none';
  const role = VISUAL_ROLES.includes(String(t.role || '').trim().toLowerCase())
    ? String(t.role).trim().toLowerCase()
    : 'none';
  return {
    priority,
    role: priority === 'none' ? 'none' : role,
    requiredEvidence: optionalText(t.requiredEvidence),
    visualCommunicationNeed: optionalText(t.visualCommunicationNeed),
    preferredType: optionalText(t.preferredType) || 'none',
    truthBoundary: optionalText(t.truthBoundary),
  };
}

const EVIDENCE_STATUSES = [
  'available-exact', 'available-sufficient', 'available-partial', 'available-irrelevant',
  'available-multiple', 'derivable', 'missing-generatable', 'missing-not-generatable', 'unknown',
];
const EVIDENCE_RESOLUTIONS = [
  'no-adaptation', 'use-available-alternative', 'derive-from-existing',
  'generate-conceptual-support', 'adapt-content-structure', 'text-only-fallback',
  'reduce-visual-requirement', 'request-missing-asset', 'flag-limitation',
  'reject-surface-or-narrative',
];

function evidenceAvailabilityOf(raw) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const status = EVIDENCE_STATUSES.includes(String(t.status || '').trim())
    ? String(t.status).trim()
    : 'unknown';
  return { status, reason: optionalText(t.reason) };
}

function evidenceResolutionOf(raw) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const type = EVIDENCE_RESOLUTIONS.includes(String(t.type || '').trim())
    ? String(t.type).trim()
    : 'no-adaptation';
  return { type, reason: optionalText(t.reason) };
}

function mentionedAssetKeyOf(s, allocated) {
  const named = projectMediaKeysIn(
    s?.assetKey,
    s?.visual?.assetKey,
    s?.evidenceAvailability?.reason,
    s?.visualNeed?.reason,
    s?.evidenceAvailability,
  );
  if (allocated.length) {
    return named.find((k) => allocated.includes(k))
      || allocated.find((k) => named.includes(k))
      || '';
  }
  return named[0] || '';
}

function bindAllocatedAssets(slides, dayBrief) {
  const allocated = allocatedAssetsOf(dayBrief?.allocatedAssets).map((a) => a.key).filter(Boolean);
  if (!Array.isArray(slides) || !slides.length) return slides;
  const used = new Set();
  const take = () => allocated.find((k) => k && !used.has(k)) || '';
  const claim = (key) => { if (key) used.add(key); };
  const withAsset = (s, key, type) => ({
    ...s,
    assetKey: key,
    image: s.image || 'placeholder',
    layout: photoLayoutOf(s),
    visual: {
      ...(s.visual || {}),
      ...(type ? { type } : {}),
      execution: 'supplied-asset',
      assetKey: key,
      priority: String(s?.visual?.priority || '').toLowerCase() || 'recommended',
    },
  });
  const skipBind = (s) => {
    const priority = String(s?.visual?.priority || '').toLowerCase();
    if (priority === 'none') return true;
    return textLedResolution(s?.evidenceResolution);
  };

  const next = slides.map((s) => {
    if (skipBind(s)) return s;
    const existing = optionalText(s.assetKey) || optionalText(s.visual?.assetKey)
      || projectMediaKeysIn(s?.assetKey, s?.visual?.assetKey)[0]
      || '';
    if (existing) {
      claim(existing);
      return { ...s, assetKey: existing, layout: photoLayoutOf(s) };
    }
    const named = mentionedAssetKeyOf(s, allocated);
    if (named) {
      claim(named);
      return withAsset(s, named);
    }
    const priority = String(s?.visual?.priority || '').toLowerCase();
    const type = optionalText(s?.visual?.type);
    const wants = (priority && priority !== 'none') || isSourceVisualType(type);
    if (!wants || !isSourceVisualType(type) || !allocated.length) return s;
    const key = take();
    if (!key) return s;
    claim(key);
    return withAsset(s, key);
  });

  for (let i = 0; i < next.length && used.size < allocated.length; i += 1) {
    const s = next[i];
    if (skipBind(s)) continue;
    if (optionalText(s.assetKey) || optionalText(s.visual?.assetKey)) continue;
    const priority = String(s?.visual?.priority || '').toLowerCase();
    if (!priority || priority === 'none') continue;
    const key = take();
    if (!key) break;
    claim(key);
    const type = isSourceVisualType(s.visual?.type) ? s.visual.type : 'Image';
    next[i] = withAsset(s, key, type);
  }
  return next;
}

function attachAnnotationBox(annotation, slide, dayAssets) {
  if (!annotation || !optionalText(annotation.text)) return annotation || null;
  const keys = mediaKeysOf(slide?.assetKey, slide?.visual?.assetKey, slide?.assetKeys, slide?.visual?.assetKeys);
  const assets = Array.isArray(dayAssets) ? dayAssets : [];
  const asset = assets.find((a) => keys.includes(a.key))
    || assets.find((a) => a.preferred)
    || assets[0];
  const query = annotation.targetSubject || annotation.text;
  const hit = matchSubject(asset?.subjects, query);
  const existing = boxOf(annotation.targetBox);
  const preferHit = hit?.box && (!existing || (hit.box.w * hit.box.h) < (existing.w * existing.h) * 0.7);
  const box = preferHit ? hit.box : existing;
  if (!box) return annotation;
  const region = optionalText(annotation.targetRegion).toLowerCase();
  return {
    ...annotation,
    targetBox: box,
    ...(hit?.point ? { targetPoint: hit.point } : {}),
    targetRegion: (region && region !== 'center') ? region : (regionFromBox(box) || region || 'center'),
  };
}

function normalizeWriterPost(parsed, dayBrief, dayAssets) {
  const content = { ...(parsed?.content || {}) };
  const slides = bindAllocatedAssets(Array.isArray(content.slides) ? content.slides.map((s) => {
    const visual = s?.visual && typeof s.visual === 'object' ? s.visual : {};
    const priority = String(visual.priority || '').toLowerCase();
    const execution = String(visual.execution || '').toLowerCase();
    const wantsVisual = !textLedResolution(s?.evidenceResolution)
      && ((priority && priority !== 'none') || /supplied|generated/.test(execution));
    const flat = flattenSlide(s);
    return {
      ...s,
      image: wantsVisual ? (s.image || 'placeholder') : (s.image || ''),
      assetKey: wantsVisual ? (optionalText(s.assetKey) || optionalText(visual.assetKey)) : '',
      imagePrompt: wantsVisual ? (optionalText(s.imagePrompt) || optionalText(visual.imagePrompt)) : '',
      annotation: ANNOTATIONS_ENABLED ? (flat.annotation || null) : null,
      visual,
    };
  }) : [], dayBrief);
  content.slides = slides.map((s) => ({
    ...s,
    annotation: ANNOTATIONS_ENABLED ? attachAnnotationBox(s.annotation, s, dayAssets) : null,
  }));
  content.caption = optionalText(parsed.caption || content.caption);
  content.cta = optionalText(parsed.cta || content.cta);
  const writerTags = hashtagList(parsed.hashtags || content.hashtags);
  const briefTags = hashtagList(dayBrief.hashtags);
  content.hashtags = writerTags.length ? writerTags : briefTags;
  content.executionRationale = optionalText(parsed.executionRationale || content.executionRationale);
  content.strategy = content.executionRationale || content.strategy || '';
  const needs = Array.isArray(parsed.productionNeeds)
    ? parsed.productionNeeds
    : (Array.isArray(content.productionNeeds) ? content.productionNeeds : []);
  content.productionNeeds = asStoredLines(needs);
  content.prompts = content.productionNeeds;
  content.plan = asStoredText(parsed.plan != null ? parsed.plan : content.plan);
  content.notes = asStoredText(parsed.notes != null ? parsed.notes : content.notes);
  return content;
}

function approvedGenerationRouteOf() {
  const v = String(process.env.PLAN_IMAGE_GENERATION ?? '1').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return 'assets-only';
  // The Visual Generator agent renders through OpenAI (gpt-image-1); the legacy
  // "Create image" flow uses Gemini/Vertex. Either backend authorises the
  // structure agent to pick `generate-conceptual-support`.
  if (process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_CLOUD_PROJECT) {
    return 'generate';
  }
  return 'assets-only';
}

function visualPlanOf(visual, resolution, evidence) {
  const raw = visual && typeof visual === 'object' ? visual : {};
  let priority = VISUAL_PRIORITIES.includes(String(raw.priority || '').trim().toLowerCase())
    ? String(raw.priority).trim().toLowerCase()
    : (optionalText(raw.need) && optionalText(raw.need) !== 'none' ? 'recommended' : 'none');
  if (textLedResolution(resolution)) priority = 'none';
  const role = VISUAL_ROLES.includes(String(raw.role || '').trim().toLowerCase())
    ? String(raw.role).trim().toLowerCase()
    : 'none';
  let type = normalizeStructureType(raw.type) || optionalText(raw.type) || 'none';
  if (type && type !== 'none' && !VISUAL_TYPES.has(type)) type = 'Image';
  if (priority === 'none') type = 'none';
  const assetKey = optionalText(raw.assetKey)
    || projectMediaKeysIn(raw.assetKey, evidence?.reason, evidence, raw)[0]
    || '';
  return {
    priority,
    role: priority === 'none' ? 'none' : role,
    type: priority === 'none' ? 'none' : type,
    communicationFunction: optionalText(raw.communicationFunction),
    truthBoundary: optionalText(raw.truthBoundary),
    noneReason: optionalText(raw.noneReason),
    ...(assetKey && priority !== 'none' ? { assetKey } : {}),
  };
}

const STRUCTURE_ALIASES = {
  supporting_text: 'Supporting_Text',
  numbered_items: 'Numbered_Items',
  reason: 'Reason_Rationale',
  rational: 'Reason_Rationale',
  beforeafter: 'Before_After',
  before_after: 'Before_After',
  number: 'Number_Stat',
  stat: 'Number_Stat',
  caption_label: 'Caption_Label',
  annotation: 'Annotation',
  short_statement: 'Short_Statement',
  multiple_images: 'Multiple_Images',
  process_flow: 'Process_Flow',
  categories_groups: 'Categories_Groups',
  proscons: 'Pros_Cons',
  do_dont: 'Do_Dont',
  problem_solution: 'Problem_Solution',
  cause_effect: 'Cause_Effect',
  data_chart: 'Data_Chart',
  hierarchy: 'Hierarchy',
  diagram: 'Diagram',
  map_spatial: 'Map_Spatial',
  annotated_visual: 'Annotated_Visual',
  multiple_visuals: 'Multiple_Visuals',
  illustration: 'Illustration',
  graphic_artwork: 'Graphic_Artwork',
  testimonial: 'Testimonial',
};

function normalizeStructureType(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (AVAILABLE_ELEMENT_SET.has(raw)) return raw;
  const compact = raw.toLowerCase().replace(/[\s/-]+/g, '_');
  if (STRUCTURE_ALIASES[compact]) return STRUCTURE_ALIASES[compact];
  for (const name of AVAILABLE_ELEMENT_SET) {
    if (name.toLowerCase() === compact) return name;
  }
  return raw;
}

function validateContentStructure(parsed, brief) {
  const status = String(parsed?.status || '').trim().toLowerCase();
  if (!['ready', 'unresolved'].includes(status)) throw new Error('missing structure status');
  parsed.status = status;
  parsed.format = lockedFormat(parsed.format);
  parsed.structureReason = optionalText(parsed.structureReason);
  parsed.captionUnits = stringList(parsed.captionUnits);
  parsed.unmappedUnits = stringList(parsed.unmappedUnits);
  parsed.ctaUnit = parsed.ctaUnit == null || parsed.ctaUnit === '' ? null : parsed.ctaUnit;
  parsed.limitations = Array.isArray(parsed.limitations) ? parsed.limitations : [];
  const slides = Array.isArray(parsed.slidesOrScenes) ? parsed.slidesOrScenes : [];
  parsed.slidesOrScenes = slides.map((s, i) => {
    const supporting = Array.isArray(s?.supportingElements) ? s.supportingElements : [];
    const visual = s?.visual && typeof s.visual === 'object' ? s.visual : {};
    const action = s?.action && typeof s.action === 'object' ? s.action : {};
    let primary = normalizeStructureType(s?.primaryStructure);
    if (!ANNOTATIONS_ENABLED && primary === 'Annotation') primary = 'Image';
    const evidenceAvailability = evidenceAvailabilityOf(s?.evidenceAvailability);
    const evidenceResolution = evidenceResolutionOf(s?.evidenceResolution);
    return {
      index: Number(s?.index) > 0 ? Number(s.index) : i + 1,
      role: optionalText(s?.role) || 'other',
      coversUnits: stringList(s?.coversUnits),
      purpose: optionalText(s?.purpose),
      placement: ['visual', 'caption', 'cta'].includes(String(s?.placement || '').trim().toLowerCase())
        ? String(s.placement).trim().toLowerCase()
        : 'visual',
      textNeed: textNeedOf(s?.textNeed),
      visualNeed: visualNeedOf(s?.visualNeed || visual),
      evidenceAvailability,
      evidenceResolution,
      informationShape: optionalText(s?.informationShape),
      primaryStructure: primary,
      supportingElements: supporting.map((el) => ({
        type: normalizeStructureType(el?.type),
        function: optionalText(el?.function),
        supportReference: stringList(el?.supportReference).length
          ? stringList(el.supportReference)
          : (optionalText(el?.supportReference) ? [optionalText(el.supportReference)] : []),
        ...(ANNOTATIONS_ENABLED && optionalText(el?.targetSubject) ? { targetSubject: optionalText(el.targetSubject) } : {}),
      })).filter((el) => el.type && AVAILABLE_ELEMENT_SET.has(el.type) && el.type !== primary
        && (ANNOTATIONS_ENABLED || el.type !== 'Annotation')),
      selectionReason: optionalText(s?.selectionReason),
      contentGuidance: optionalText(s?.contentGuidance),
      visual: visualPlanOf(visual, evidenceResolution, evidenceAvailability),
      action: (() => {
        const type = optionalText(action.type) || 'none';
        const expression = optionalText(action.expression) || 'none';
        const rawPlacement = String(action.placement || '').trim().toLowerCase();
        const allowed = ['none', 'current-surface', 'dedicated-surface', 'caption'];
        let placement = allowed.includes(rawPlacement) ? rawPlacement : 'none';
        if (expression === 'none' || expression === 'native-behavior') placement = 'none';
        return { type, expression, placement };
      })(),
    };
  });
  if (status === 'unresolved') return;
  const visualSlides = visualSlidesOf(parsed);
  if (!visualSlides.length) throw new Error('missing visual slidesOrScenes');
  const missingPrimary = visualSlides.find((s) => !s.primaryStructure);
  if (missingPrimary) throw new Error(`slide ${missingPrimary.index} missing primaryStructure`);
  const unsupported = visualSlides.find((s) => !AVAILABLE_ELEMENT_SET.has(s.primaryStructure));
  if (unsupported) throw new Error(`unsupported primaryStructure ${unsupported.primaryStructure}`);
  if (parsed.unmappedUnits.length) throw new Error('ready structure has unmappedUnits');
  assertUnitsNotCompressed(parsed, brief);
  if (visualSlides.length > 1 && (parsed.format === 'Post' || parsed.format === 'Annotated Visual')) {
    parsed.format = 'Carousel';
  }
  parsed.totalSlidesOrScenes = visualSlides.length;
  const suff = parsed.validation?.communicationSufficiency;
  parsed.validation = {
    status: optionalText(parsed.validation?.status) || 'pass',
    correctionPasses: Number(parsed.validation?.correctionPasses) || 0,
    monotonyReviewed: Boolean(parsed.validation?.monotonyReviewed),
    communicationSufficiency: suff && typeof suff === 'object' ? {
      narrativeComplete: Boolean(suff.narrativeComplete),
      audienceValueClear: Boolean(suff.audienceValueClear),
      choicesExplained: Boolean(suff.choicesExplained),
      closurePresent: Boolean(suff.closurePresent),
      visualsNecessary: Boolean(suff.visualsNecessary),
    } : null,
    problems: Array.isArray(parsed.validation?.problems) ? parsed.validation.problems : [],
  };
}

function assertUnitsNotCompressed(parsed, brief) {
  const visual = visualSlidesOf(parsed);
  const compressed = visual.find((s) => (s.coversUnits || []).length > 1);
  if (compressed) {
    throw new Error(`slide ${compressed.index} compressed units ${compressed.coversUnits.join(',')}`);
  }
  const units = Array.isArray(brief?.narrativeUnits) ? brief.narrativeUnits : [];
  if (!units.length) return;
  const captioned = new Set(stringList(parsed.captionUnits));
  const ctaId = optionalText(parsed.ctaUnit);
  units.forEach((u, i) => {
    const id = optionalText(u?.id) || `u${i + 1}`;
    const role = String(u?.role || '').trim().toLowerCase();
    if (id === ctaId || role === 'cta') return;
    if (captioned.has(id)) throw new Error(`unit ${id} parked in caption`);
    const hits = visual.filter((s) => (s.coversUnits || []).includes(id));
    if (!hits.length) throw new Error(`unit ${id} has no visual surface`);
  });
}

function mergeAllocatedVisuals(brief, dayAssets) {
  const allocated = allocatedAssetsOf(brief?.allocatedAssets);
  const extras = Array.isArray(dayAssets) ? dayAssets : [];
  const byKey = new Map();
  extras.forEach((row) => {
    const key = optionalText(row?.key);
    if (key) byKey.set(key, row);
  });
  const out = [];
  const seen = new Set();
  allocated.forEach((a, i) => {
    const extra = byKey.get(a.key) || {};
    seen.add(a.key);
    out.push({
      key: a.key,
      project: optionalText(extra.project),
      summary: optionalText(extra.summary) || optionalText(a.visibleContent),
      subjects: Array.isArray(extra.subjects) ? extra.subjects : [],
      allocated: true,
      preferred: Boolean(extra.preferred) || i === 0,
      source: optionalText(a.source),
      evidenceLevel: optionalText(a.evidenceLevel),
      visibleContent: optionalText(a.visibleContent) || optionalText(extra.summary),
      communicationPotential: optionalText(a.communicationPotential),
      limitations: Array.isArray(a.limitations) ? a.limitations : [],
      why: optionalText(a.why),
      supportsUnitIds: Array.isArray(a.supportsUnitIds) ? a.supportsUnitIds : [],
    });
  });
  extras.forEach((extra) => {
    const key = optionalText(extra?.key);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      key,
      project: optionalText(extra.project),
      summary: optionalText(extra.summary),
      subjects: Array.isArray(extra.subjects) ? extra.subjects : [],
      allocated: Boolean(extra.allocated),
      preferred: Boolean(extra.preferred),
    });
  });
  return out.slice(0, 6);
}

function strategyBriefPayload(brief) {
  return {
    pillar: brief.pillar,
    lens: brief.lens,
    pillarJob: brief.pillarJob,
    source: brief.source,
    captureId: brief.captureId,
    sourceStoryId: brief.sourceStoryId,
    project: brief.project,
    originalCapture: brief.originalCapture,
    angle: brief.angle,
    verifiedTruth: brief.verifiedTruth,
    observableDetails: brief.observableDetails,
    relevantAssetContext: brief.relevantAssetContext,
    visualLimitations: brief.visualLimitations,
    uniqueJob: brief.uniqueJob,
    audienceTension: brief.audienceTension,
    hookTerritory: brief.hookTerritory,
    centralFact: brief.centralFact,
    ownedTerritory: brief.ownedTerritory,
    doNotRepeat: brief.doNotRepeat,
    format: brief.format,
    formatReason: brief.formatReason,
    themeId: brief.themeId,
    themeReason: brief.themeReason,
    narrativeUnits: brief.narrativeUnits,
    approvedGenerationRoute: brief.approvedGenerationRoute,
    knownLimitation: brief.knownLimitation,
  };
}

const TITLE_ELEMENT_TYPES = new Set(['Title', 'Short_Statement', 'Question']);
const SUBTITLE_ELEMENT_TYPES = new Set(['Subtitle', 'Supporting_Text', 'Label', 'Caption_Label']);
const BODY_ELEMENT_TYPES = new Set(['Body', 'Reason_Rationale', 'Example']);
const LIST_ELEMENT_TYPES = new Set([
  'List', 'Numbered_Items', 'Steps', 'Sequence', 'Checklist', 'Ranking',
  'Timeline', 'Process_Flow', 'Framework', 'Categories_Groups', 'Progression',
  'Options', 'Hierarchy', 'Diagram',
]);
const COMPARE_ELEMENT_TYPES = new Set([
  'Comparison', 'Pros_Cons', 'Do_Dont', 'Problem_Solution', 'Cause_Effect', 'Before_After',
]);
const QUOTE_ELEMENT_TYPES = new Set(['Quote', 'Testimonial']);
const STAT_ELEMENT_TYPES = new Set(['Number_Stat', 'Data_Chart']);

function elementCopy(el, fallback = '') {
  const refs = stringList(el?.supportReference);
  if (refs.length) return refs.join(' · ');
  return optionalText(el?.function) || fallback;
}

function listCopy(el, fallback = '') {
  const refs = stringList(el?.supportReference);
  if (refs.length) return refs;
  const one = optionalText(el?.function) || fallback;
  return one ? [one] : [];
}

function comparisonCopy(el, fallbackA = '', fallbackB = '') {
  const refs = stringList(el?.supportReference);
  if (refs.length >= 2) return { a: refs[0], b: refs[1] };
  if (refs.length === 1) return { a: refs[0], b: fallbackB };
  const raw = optionalText(el?.function) || fallbackA;
  const parts = raw.split(/\s+(?:vs\.?|versus|→|->|\/)\s+/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { a: parts[0], b: parts[1] };
  return { a: fallbackA || raw, b: fallbackB };
}

function assignElementCopy(slide, type, el, fallback) {
  const kind = normalizeStructureType(type);
  if (!kind) return;
  if (TITLE_ELEMENT_TYPES.has(kind)) {
    if (!slide.title) slide.title = elementCopy(el, fallback);
    return;
  }
  if (SUBTITLE_ELEMENT_TYPES.has(kind)) {
    if (!slide.subtitle) slide.subtitle = elementCopy(el, fallback);
    return;
  }
  if (BODY_ELEMENT_TYPES.has(kind)) {
    if (!slide.body) slide.body = elementCopy(el, fallback);
    return;
  }
  if (LIST_ELEMENT_TYPES.has(kind)) {
    if (!slide.items.length) slide.items = listCopy(el, fallback);
    return;
  }
  if (COMPARE_ELEMENT_TYPES.has(kind)) {
    if (!slide.comparisonA && !slide.comparisonB) {
      const sides = comparisonCopy(el, fallback, '');
      slide.comparisonA = sides.a;
      slide.comparisonB = sides.b;
    }
    return;
  }
  if (QUOTE_ELEMENT_TYPES.has(kind)) {
    if (!slide.quote) slide.quote = elementCopy(el, fallback);
    return;
  }
  if (STAT_ELEMENT_TYPES.has(kind)) {
    if (!slide.stat) slide.stat = elementCopy(el, fallback);
    return;
  }
  if (kind === 'Action' && !slide.action) slide.action = elementCopy(el, fallback);
}

function slideFromStructure(s) {
  const primary = normalizeStructureType(s?.primaryStructure);
  const purpose = optionalText(s?.purpose);
  const guidance = optionalText(s?.contentGuidance);
  const comm = optionalText(s?.textNeed?.communicationFunction);
  const supporting = Array.isArray(s?.supportingElements) ? s.supportingElements : [];
  const hasBodySupport = supporting.some((el) => BODY_ELEMENT_TYPES.has(normalizeStructureType(el?.type)));
  const primaryFallback = TITLE_ELEMENT_TYPES.has(primary) && hasBodySupport
    ? (purpose || guidance || comm)
    : (guidance || purpose || comm);
  const slide = {
    index: Number(s?.index) > 0 ? Number(s.index) : 0,
    role: optionalText(s?.role) || 'other',
    structure: primary,
    purpose,
    placement: optionalText(s?.placement) || 'visual',
    title: '',
    subtitle: '',
    body: '',
    items: [],
    itemsA: [],
    itemsB: [],
    comparisonA: '',
    comparisonB: '',
    stat: '',
    quote: '',
    action: '',
    visual: s?.visual && typeof s.visual === 'object' ? { ...s.visual } : {},
    evidenceAvailability: s?.evidenceAvailability || null,
    evidenceResolution: s?.evidenceResolution || null,
    contentGuidance: guidance,
    elements: [],
  };

  const primaryEl = {
    type: primary,
    text: primaryFallback,
    function: comm,
    supportReference: stringList(s?.textNeed?.supportReference),
  };
  assignElementCopy(slide, primary, primaryEl, primaryFallback);
  slide.elements.push({
    type: primary,
    text: primaryFallback,
    function: comm,
  });
  supporting.forEach((el) => {
    const type = normalizeStructureType(el?.type);
    if (!type) return;
    const text = elementCopy(el);
    assignElementCopy(slide, type, el, text);
    slide.elements.push({
      type,
      text,
      function: optionalText(el?.function),
      ...(stringList(el?.supportReference).length ? { supportReference: stringList(el.supportReference) } : {}),
    });
  });

  if (!slide.title && !slide.body && !slide.items.length && !slide.comparisonA && !slide.quote && !slide.stat) {
    if (LIST_ELEMENT_TYPES.has(primary)) slide.items = primaryFallback ? [primaryFallback] : [];
    else if (BODY_ELEMENT_TYPES.has(primary)) slide.body = primaryFallback;
    else slide.title = primaryFallback;
  }

  if (hasBodySupport && guidance) slide.body = guidance;

  const act = s?.action && typeof s.action === 'object' ? s.action : {};
  const actionPlacement = String(act.placement || '').trim().toLowerCase();
  const actionExpression = String(act.expression || '').trim().toLowerCase();
  if (['current-surface', 'dedicated-surface'].includes(actionPlacement)
    && actionExpression === 'cta-text'
    && !slide.action) {
    slide.action = optionalText(act.type) || primaryFallback;
  }
  if (/before/i.test(primary) && !slide.labels) {
    slide.labels = ['Before', 'After'];
  }
  return slide;
}

function captionFromStructure(structure, dayBrief) {
  const units = Array.isArray(dayBrief?.narrativeUnits) ? dayBrief.narrativeUnits : [];
  const captionIds = new Set(stringList(structure?.captionUnits));
  const fromUnits = units
    .filter((u) => captionIds.has(optionalText(u?.id)))
    .map((u) => optionalText(u?.purpose) || optionalText(u?.support))
    .filter(Boolean);
  if (fromUnits.length) return fromUnits.join('\n');
  return optionalText(dayBrief?.hookTerritory)
    || optionalText(dayBrief?.uniqueJob)
    || optionalText(dayBrief?.angle);
}

function ctaFromStructure(structure) {
  const slides = Array.isArray(structure?.slidesOrScenes) ? structure.slidesOrScenes : [];
  const hit = slides.find((s) => {
    const placement = String(s?.action?.placement || '').trim().toLowerCase();
    const expression = String(s?.action?.expression || '').trim().toLowerCase();
    return placement === 'caption' && expression === 'cta-text';
  });
  if (!hit) return '';
  return optionalText(hit.action?.type) || optionalText(hit.contentGuidance);
}

function postFromStructure(structure, dayBrief) {
  const slides = visualSlidesOf(structure).map((s, i) => {
    const slide = slideFromStructure(s);
    if (!slide.index) slide.index = i + 1;
    return slide;
  });
  const caption = captionFromStructure(structure, dayBrief);
  const cta = ctaFromStructure(structure);
  const hashtags = hashtagList(dayBrief?.hashtags);
  const title = optionalText(slides[0]?.title)
    || optionalText(dayBrief?.angle)
    || optionalText(dayBrief?.uniqueJob);
  return {
    status: 'ready',
    format: lockedFormat(structure?.format || dayBrief?.format),
    title,
    direction: optionalText(dayBrief?.angle),
    caption,
    cta,
    hashtags,
    content: {
      slides,
      caption,
      cta,
      hashtags,
    },
  };
}

// Build a Day Writer–shaped post from the Strategist brief when Content Structure is skipped.
// One visual slide per narrative unit (CTA units become caption/cta, not slides).
// Spread every allocated asset across slides: supportsUnitIds first, then leftover assets.
function postFromBrief(dayBrief) {
  const units = Array.isArray(dayBrief?.narrativeUnits) ? dayBrief.narrativeUnits : [];
  const allocated = allocatedAssetsOf(dayBrief?.allocatedAssets);
  const visualUnits = units.filter((u) => {
    const role = String(u?.role || '').trim().toLowerCase();
    const placement = String(u?.placement || '').trim().toLowerCase();
    if (role === 'cta' || placement === 'cta' || placement === 'caption') return false;
    return true;
  });
  const outline = visualUnits.length
    ? visualUnits
    : [{
      id: 'u1',
      index: 1,
      role: 'hook',
      purpose: optionalText(dayBrief?.hookTerritory)
        || optionalText(dayBrief?.angle)
        || optionalText(dayBrief?.uniqueJob),
      support: optionalText(dayBrief?.centralFact),
    }];
  const usedKeys = new Set();
  const slides = outline.map((u, i) => {
    const id = optionalText(u?.id) || `u${i + 1}`;
    const purpose = optionalText(u?.purpose);
    const support = optionalText(u?.support);
    const matched = allocated.find((a) => (
      !usedKeys.has(optionalText(a?.key))
      && Array.isArray(a?.supportsUnitIds)
      && a.supportsUnitIds.map(optionalText).includes(id)
    ));
    const assetKey = optionalText(matched?.key);
    if (assetKey) usedKeys.add(assetKey);
    const hasAsset = Boolean(assetKey);
    return {
      index: Number(u?.index) > 0 ? Number(u.index) : i + 1,
      role: optionalText(u?.role) || 'other',
      purpose,
      placement: 'visual',
      coversUnits: [id],
      title: purpose,
      subtitle: '',
      body: support,
      items: [],
      contentGuidance: [purpose, support].filter(Boolean).join(' — '),
      assetKey: hasAsset ? assetKey : '',
      image: hasAsset ? 'placeholder' : '',
      visual: hasAsset
        ? {
          priority: 'recommended',
          role: 'evidence',
          type: 'Image',
          execution: 'supplied-asset',
          assetKey,
          communicationFunction: optionalText(matched?.visibleContent) || optionalText(matched?.why),
        }
        : { priority: 'none', role: 'none', type: 'none' },
      elements: [
        ...(purpose ? [{ type: 'Title', text: purpose }] : []),
        ...(support ? [{ type: 'Body', text: support }] : []),
      ],
    };
  });

  // Assign remaining allocated assets onto slides that still have none, so a
  // before/after pair (or any multi-photo set) is not collapsed to a single hero.
  const leftover = allocated.filter((a) => {
    const key = optionalText(a?.key);
    return key && !usedKeys.has(key);
  });
  if (leftover.length) {
    const preferRole = (role) => {
      const r = String(role || '').toLowerCase();
      if (/(result|after|outcome)/.test(r)) return 0;
      if (/(problem|before|context|hook)/.test(r)) return 1;
      if (/(decision|reason|process)/.test(r)) return 2;
      return 3;
    };
    const open = slides
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => !optionalText(s.assetKey))
      .sort((a, b) => preferRole(a.s.role) - preferRole(b.s.role));
    leftover.forEach((asset, n) => {
      const slot = open[n];
      if (!slot) return;
      const key = optionalText(asset.key);
      usedKeys.add(key);
      const next = {
        ...slot.s,
        assetKey: key,
        image: 'placeholder',
        visual: {
          priority: 'recommended',
          role: 'evidence',
          type: 'Image',
          execution: 'supplied-asset',
          assetKey: key,
          communicationFunction: optionalText(asset.visibleContent) || optionalText(asset.why),
        },
      };
      slides[slot.i] = next;
    });
  }

  const ctaUnit = units.find((u) => {
    const role = String(u?.role || '').trim().toLowerCase();
    const placement = String(u?.placement || '').trim().toLowerCase();
    return role === 'cta' || placement === 'cta';
  });
  const caption = optionalText(dayBrief?.hookTerritory)
    || optionalText(dayBrief?.uniqueJob)
    || optionalText(dayBrief?.angle);
  const cta = optionalText(ctaUnit?.purpose) || optionalText(ctaUnit?.support);
  const hashtags = hashtagList(dayBrief?.hashtags);
  const title = optionalText(slides[0]?.title)
    || optionalText(dayBrief?.angle)
    || optionalText(dayBrief?.uniqueJob);
  return {
    status: 'ready',
    format: lockedFormat(dayBrief?.format),
    title,
    direction: optionalText(dayBrief?.angle),
    caption,
    cta,
    hashtags,
    content: {
      slides,
      caption,
      cta,
      hashtags,
    },
  };
}

function carouselBriefInputOf(dayBrief, post) {
  const postSlides = Array.isArray(post?.content?.slides) ? post.content.slides : [];
  const allocated = allocatedAssetsOf(dayBrief?.allocatedAssets);
  return {
    ...strategyBriefPayload(dayBrief),
    allocatedVisuals: allocated.map((a) => ({
      key: a.key,
      visibleContent: optionalText(a.visibleContent),
      why: optionalText(a.why),
      evidenceLevel: optionalText(a.evidenceLevel),
      supportsUnitIds: Array.isArray(a.supportsUnitIds) ? a.supportsUnitIds : [],
      communicationPotential: optionalText(a.communicationPotential),
      limitations: Array.isArray(a.limitations) ? a.limitations : [],
    })),
    slides: postSlides.map((raw, i) => {
      const flat = flattenSlide(raw);
      const index = Number(raw?.index) > 0 ? Number(raw.index) : i + 1;
      const assetKey = optionalText(flat.assetKey)
        || optionalText(raw?.assetKey)
        || optionalText(raw?.visual?.assetKey);
      const hasAsset = Boolean(assetKey) || slideHasAsset(raw, flat, raw?.visual);
      return {
        index,
        role: optionalText(raw?.role) || 'other',
        purpose: optionalText(raw?.purpose) || optionalText(flat.title),
        coversUnits: stringList(raw?.coversUnits),
        contentGuidance: optionalText(raw?.contentGuidance)
          || [flat.title, flat.subtitle, flat.body].filter(Boolean).join(' — '),
        draftCopy: {
          title: optionalText(flat.title),
          subtitle: optionalText(flat.subtitle),
          body: optionalText(flat.body),
          items: Array.isArray(flat.items) ? flat.items : [],
        },
        visual: layoutVisualOf(
          (raw?.visual && typeof raw.visual === 'object') ? raw.visual : {},
          hasAsset,
          assetKey,
          hasAsset ? photographHintOf(assetKey, dayBrief) : null,
          hasAsset || slideWantsVisual(raw, flat, raw?.visual),
        ),
      };
    }),
  };
}

async function writeContentStructure({ source, brief, dayAssets, brandJson }) {
  const visuals = mergeAllocatedVisuals(brief, dayAssets);
  const assembled = assembleAgentPrompt('plan-content-structure.md', {
    AVAILABLE_ELEMENTS_JSON: json(AVAILABLE_ELEMENTS),
    STRATEGIST_BRIEF_JSON: json(strategyBriefPayload(brief)),
    ALLOCATED_VISUALS_JSON: json(visuals),
    PLATFORM_CONSTRAINTS_JSON: json(platformConstraintsOf(brief.format)),
    BRAND_JSON: brandJson || json({}),
  });
  return callAgent({
    source,
    kind: 'structure',
    system: assembled.system,
    user: assembled.user,
    prompt: assembled.prompt,
    validate: (parsed) => validateContentStructure(parsed, brief),
  });
}

function structureSlideOf(structure, index) {
  const slides = Array.isArray(structure?.slidesOrScenes) ? structure.slidesOrScenes : [];
  return slides.find((s) => Number(s?.index) === Number(index)) || slides[index - 1] || null;
}

function slideHasAsset(raw, flat, visual) {
  const keys = [
    optionalText(flat?.assetKey),
    optionalText(visual?.assetKey),
    optionalText(raw?.assetKey),
    ...((Array.isArray(flat?.assetKeys) ? flat.assetKeys : []).map(optionalText)),
    ...((Array.isArray(raw?.assetKeys) ? raw.assetKeys : []).map(optionalText)),
    ...((Array.isArray(visual?.assetKeys) ? visual.assetKeys : []).map(optionalText)),
    ...projectMediaKeysIn(
      raw?.evidenceAvailability?.reason,
      raw?.evidenceAvailability,
      visual,
    ),
  ];
  if (keys.some(Boolean)) return true;
  const image = raw?.image;
  if (image && typeof image === 'object' && (optionalText(image.key) || optionalText(image.url))) return true;
  return false;
}

function slideWantsVisual(raw, flat, visual) {
  if (slideHasAsset(raw, flat, visual)) return true;
  const v = visual && typeof visual === 'object' ? visual : {};
  const priority = String(v.priority || '').trim().toLowerCase();
  const type = String(v.type || '').trim().toLowerCase();
  const execution = String(v.execution || '').trim().toLowerCase();
  const source = String(v.source || '').trim().toLowerCase();
  if (priority && priority !== 'none') return true;
  if (type && type !== 'none') return true;
  if (source && source !== 'none') return true;
  if (/supplied|generated|graphic|unresolved/.test(execution)) return true;
  if (String(flat?.image || '').toLowerCase() === 'placeholder') return true;
  if (typeof raw?.image === 'string' && raw.image.toLowerCase() === 'placeholder') return true;
  return false;
}

function photographSrcOf(key) {
  const k = optionalText(key);
  if (!k) return '';
  try {
    if (isCdnConfigured()) return publicMediaUrl(k) || '';
  } catch { /* ignore */ }
  return '';
}

function photographHintOf(assetKey, dayBrief) {
  const key = optionalText(assetKey);
  if (!key) return null;
  const asset = allocatedAssetsOf(dayBrief?.allocatedAssets).find((a) => optionalText(a?.key) === key) || {};
  const src = photographSrcOf(key);
  const hint = {
    assigned: true,
    visibleContent: optionalText(asset.visibleContent),
    why: optionalText(asset.why),
    evidenceLevel: optionalText(asset.evidenceLevel),
    ...(src ? { src } : {}),
  };
  if (!hint.visibleContent && !hint.why && !hint.evidenceLevel && !src) return { assigned: true };
  return hint;
}

function layoutVisualOf(visual, hasAsset, assetKey, photograph, includeImageSlot) {
  const none = (value) => !optionalText(value) || optionalText(value).toLowerCase() === 'none';
  if (hasAsset) {
    return {
      priority: none(visual?.priority) ? 'recommended' : optionalText(visual.priority),
      role: none(visual?.role) ? 'recognition' : optionalText(visual.role),
      type: none(visual?.type) ? 'Image' : optionalText(visual.type),
      execution: optionalText(visual?.execution) || 'supplied-asset',
      productionInstruction: optionalText(visual?.productionInstruction),
      hasAsset: true,
      includeImageSlot: true,
      assetKey: optionalText(assetKey) || optionalText(visual?.assetKey),
      photograph: photograph || { assigned: true },
      ...(optionalText(photograph?.src) ? { src: optionalText(photograph.src) } : {}),
    };
  }
  if (includeImageSlot) {
    return {
      priority: none(visual?.priority) ? 'recommended' : optionalText(visual.priority),
      role: none(visual?.role) ? 'context' : optionalText(visual.role),
      type: none(visual?.type) ? 'Image' : optionalText(visual.type),
      execution: optionalText(visual?.execution),
      productionInstruction: optionalText(visual?.productionInstruction),
      hasAsset: false,
      includeImageSlot: true,
      assetKey: '',
    };
  }
  return {
    priority: optionalText(visual?.priority) || 'none',
    role: optionalText(visual?.role) || 'none',
    type: optionalText(visual?.type) || 'none',
    execution: optionalText(visual?.execution),
    productionInstruction: optionalText(visual?.productionInstruction),
    hasAsset: false,
    includeImageSlot: false,
    assetKey: '',
  };
}

function layoutStructureOf(structure) {
  const slides = Array.isArray(structure?.slidesOrScenes) ? structure.slidesOrScenes : [];
  return {
    format: optionalText(structure?.format),
    slidesOrScenes: slides.map((s) => ({
      index: s?.index,
      role: optionalText(s?.role),
      purpose: optionalText(s?.purpose),
      placement: optionalText(s?.placement) || 'visual',
      primaryStructure: optionalText(s?.primaryStructure),
      supportingElements: (s?.supportingElements || []).map((el) => ({
        type: optionalText(el?.type || el),
        function: optionalText(el?.function),
      })).filter((el) => el.type),
      contentGuidance: optionalText(s?.contentGuidance),
      textNeed: s?.textNeed || null,
      visual: {
        priority: optionalText(s?.visual?.priority) || 'none',
        type: optionalText(s?.visual?.type) || 'none',
        communicationFunction: optionalText(s?.visual?.communicationFunction),
      },
    })),
  };
}

function wordCount(value) {
  return unmarkedText(value).split(/\s+/).filter(Boolean).length;
}

function copyMetricsOf(flat) {
  return {
    titleWords: wordCount(flat?.title),
    titleChars: unmarkedText(flat?.title).length,
    bodyChars: unmarkedText(flat?.body).length,
  };
}

function compositionNoteOf(_flat, visual) {
  if (visual?.hasAsset) {
    return 'Include <img data-slot="image" alt=""> with empty src. Give it a real flex/grid area. Use visual.photograph.visibleContent when present so the subject stays in frame.';
  }
  if (visual?.includeImageSlot) {
    return 'Include <img data-slot="image" alt=""> with empty src. Give it a real flex/grid area. Do not invent graphics.';
  }
  return 'No image slot. Text-led composition only.';
}

function layoutInputOf(post, structure, dayBrief) {
  const slides = Array.isArray(post?.content?.slides) ? post.content.slides : [];
  return {
    format: lockedFormat(post?.format),
    slides: slides.map((raw, i) => {
      const index = Number(raw?.index) > 0 ? Number(raw.index) : i + 1;
      const structured = structureSlideOf(structure, index);
      const flat = flattenSlide(raw);
      const sourceVisual = raw?.visual && typeof raw.visual === 'object' ? raw.visual : (flat.visual || {});
      const includeImageSlot = slideWantsVisual(raw, flat, sourceVisual);
      const assetKey = optionalText(flat.assetKey)
        || optionalText(raw?.assetKey)
        || optionalText(raw?.visual?.assetKey)
        || mentionedAssetKeyOf({
          assetKey: raw?.assetKey,
          visual: sourceVisual,
          evidenceAvailability: raw?.evidenceAvailability || structured?.evidenceAvailability,
          visualNeed: raw?.visualNeed || structured?.visualNeed,
        }, allocatedAssetsOf(dayBrief?.allocatedAssets).map((a) => a.key).filter(Boolean));
      const hasAsset = Boolean(assetKey) || slideHasAsset(raw, flat, sourceVisual);
      const visual = layoutVisualOf(
        sourceVisual,
        hasAsset,
        assetKey,
        hasAsset ? photographHintOf(assetKey, dayBrief) : null,
        includeImageSlot,
      );
      return {
        index,
        role: optionalText(flat.role || structured?.role) || 'other',
        purpose: optionalText(structured?.purpose),
        primaryStructure: optionalText(flat.structure || structured?.primaryStructure),
        filled: {
          title: optionalText(flat.title),
          subtitle: optionalText(flat.subtitle),
          body: optionalText(flat.body),
          items: Array.isArray(flat.items) ? flat.items : [],
          itemsA: Array.isArray(flat.itemsA) ? flat.itemsA : [],
          itemsB: Array.isArray(flat.itemsB) ? flat.itemsB : [],
          comparisonA: optionalText(flat.comparisonA),
          comparisonB: optionalText(flat.comparisonB),
          stat: optionalText(flat.stat),
          quote: optionalText(flat.quote),
          action: optionalText(flat.action),
          ...(ANNOTATIONS_ENABLED && flat.annotation && optionalText(flat.annotation.text)
            ? {
              annotation: {
                text: optionalText(flat.annotation.text),
                targetSubject: optionalText(flat.annotation.targetSubject),
                targetRegion: optionalText(flat.annotation.targetRegion) || 'center',
                ...(flat.annotation.targetBox ? { targetBox: flat.annotation.targetBox } : {}),
              },
            }
            : {}),
        },
        copyMetrics: copyMetricsOf(flat),
        compositionNote: compositionNoteOf(flat, visual),
        visual,
        evidenceResolution: optionalText(raw?.evidenceResolution?.type || structured?.evidenceResolution?.type),
      };
    }),
  };
}

function carouselInputOf(structure, post, dayBrief) {
  const postSlides = Array.isArray(post?.content?.slides) ? post.content.slides : [];
  let visual = visualSlidesOf(structure);
  // Layout reruns / partial traces may lack slidesOrScenes — build from the post.
  if (!visual.length && postSlides.length) {
    visual = postSlides.map((raw, i) => {
      const flat = flattenSlide(raw);
      return {
        index: Number(raw?.index) > 0 ? Number(raw.index) : i + 1,
        role: optionalText(raw?.role) || 'other',
        purpose: optionalText(raw?.purpose) || optionalText(flat.title),
        placement: 'visual',
        primaryStructure: optionalText(raw?.primaryStructure),
        supportingElements: Array.isArray(raw?.supportingElements) ? raw.supportingElements : [],
        contentGuidance: optionalText(raw?.contentGuidance)
          || [flat.title, flat.subtitle, flat.body].filter(Boolean).join(' — '),
        textNeed: raw?.textNeed || null,
        informationShape: optionalText(raw?.informationShape),
        action: raw?.action || {},
        visualNeed: raw?.visualNeed || null,
        evidenceAvailability: raw?.evidenceAvailability || null,
        evidenceResolution: raw?.evidenceResolution || null,
        visual: (raw?.visual && typeof raw.visual === 'object') ? raw.visual : {},
      };
    });
  }
  const allocated = allocatedAssetsOf(dayBrief?.allocatedAssets);
  const allocatedKeys = allocated.map((a) => a.key).filter(Boolean);
  return {
    format: lockedFormat(structure?.format || post?.format),
    allocatedVisuals: allocated.map((a) => ({
      key: a.key,
      visibleContent: optionalText(a.visibleContent),
      why: optionalText(a.why),
      evidenceLevel: optionalText(a.evidenceLevel),
      supportsUnitIds: Array.isArray(a.supportsUnitIds) ? a.supportsUnitIds : [],
    })),
    slides: visual.map((s, i) => {
      const index = Number(s?.index) > 0 ? Number(s.index) : i + 1;
      const raw = postSlides.find((p) => (
        (Number(p?.index) > 0 ? Number(p.index) : 0) === index
      )) || postSlides[i] || {};
      const flat = flattenSlide(raw);
      const sourceVisual = (raw?.visual && typeof raw.visual === 'object')
        ? raw.visual
        : (s?.visual && typeof s.visual === 'object' ? s.visual : {});
      const mentioned = mentionedAssetKeyOf({
        assetKey: raw?.assetKey || s?.visual?.assetKey,
        visual: sourceVisual,
        evidenceAvailability: s?.evidenceAvailability || raw?.evidenceAvailability,
        visualNeed: s?.visualNeed,
      }, allocatedKeys);
      const assetKey = optionalText(flat.assetKey)
        || optionalText(raw?.assetKey)
        || optionalText(raw?.visual?.assetKey)
        || optionalText(s?.visual?.assetKey)
        || mentioned;
      const hasAsset = Boolean(assetKey) || slideHasAsset(raw, flat, sourceVisual);
      const includeImageSlot = hasAsset
        || slideWantsVisual(raw, flat, sourceVisual)
        || slideWantsVisual(s, flattenSlide(s), sourceVisual);
      return {
        index,
        role: optionalText(s?.role) || optionalText(raw?.role) || 'other',
        purpose: optionalText(s?.purpose) || optionalText(raw?.purpose),
        placement: optionalText(s?.placement) || 'visual',
        primaryStructure: optionalText(s?.primaryStructure),
        supportingElements: (s?.supportingElements || []).map((el) => ({
          type: optionalText(el?.type || el),
          function: optionalText(el?.function),
          supportReference: stringList(el?.supportReference),
        })).filter((el) => el.type),
        contentGuidance: optionalText(s?.contentGuidance)
          || [flat.title, flat.subtitle, flat.body].filter(Boolean).join(' — '),
        textNeed: s?.textNeed || null,
        informationShape: optionalText(s?.informationShape),
        action: s?.action || {},
        visualNeed: s?.visualNeed || null,
        evidenceAvailability: s?.evidenceAvailability || null,
        evidenceResolution: s?.evidenceResolution || raw?.evidenceResolution || null,
        visual: layoutVisualOf(
          sourceVisual,
          hasAsset,
          assetKey,
          hasAsset ? photographHintOf(assetKey, dayBrief) : null,
          includeImageSlot,
        ),
        // Pass drafted copy so the carousel agent is never structure-blind.
        draftCopy: {
          title: optionalText(flat.title),
          subtitle: optionalText(flat.subtitle),
          body: optionalText(flat.body),
          items: Array.isArray(flat.items) ? flat.items : [],
        },
      };
    }),
  };
}

const MAX_LAYOUT_OPTIONS = 4;

// A slide entry from the layout agent may carry several ranked composition
// options (new shape) or a single `html` (legacy). Normalise to a ranked list
// of extracted, valid-HTML options, best-first, renumbered 1..n.
function rawLayoutOptions(s) {
  const list = Array.isArray(s?.options) && s.options.length
    ? s.options
    : [{ rank: 1, label: '', reason: optionalText(s?.reason), html: s?.html || s?.layoutHtml }];
  const out = [];
  list.forEach((o, i) => {
    const html = extractLayoutHtml(o?.html || o?.layoutHtml || '');
    if (!html) return;
    out.push({
      rank: Number(o?.rank) > 0 ? Number(o.rank) : i + 1,
      label: optionalText(o?.label),
      reason: optionalText(o?.reason),
      html,
    });
  });
  out.sort((a, b) => a.rank - b.rank);
  return out.slice(0, MAX_LAYOUT_OPTIONS);
}

function validateLayout(parsed, post, { shareAcrossOptions = true } = {}) {
  const status = String(parsed?.status || '').toLowerCase();
  const incoming = Array.isArray(parsed?.slides) ? parsed.slides : [];
  const hasHtml = incoming.some((s) => rawLayoutOptions(s).length);
  if ((status === 'failed' || status === 'cannot_generate') && !hasHtml) {
    parsed.status = 'failed';
    parsed.failureReason = optionalText(parsed.failureReason || parsed.reason);
    return;
  }
  if (!incoming.length) throw new Error('missing layout slides');
  const expected = Array.isArray(post?.content?.slides) ? post.content.slides.length : parsed.slides.length;
  if (parsed.slides.length !== expected) throw new Error(`layout slide count ${parsed.slides.length} != ${expected}`);
  parsed.status = 'ready';
  parsed.slides = parsed.slides.map((s, i) => {
    const raw = Array.isArray(post?.content?.slides) ? (post.content.slides[i] || {}) : {};
    const flat = flattenSlide(raw);
    const wantsVisual = slideWantsVisual(raw, flat, raw?.visual || flat.visual);
    // Keep only options that carry the required image slot — a broken variant
    // is dropped rather than failing the whole slide, as long as one survives.
    const options = rawLayoutOptions(s)
      .filter((o) => !wantsVisual || hasImageSlot(o.html))
      .map((o, idx) => ({ ...o, rank: idx + 1 }));
    if (!options.length) {
      const had = rawLayoutOptions(s).length;
      throw new Error(had
        ? `slide ${s?.index || i + 1} missing img[data-slot=image]`
        : `slide ${s?.index || i + 1} missing layout html`);
    }
    const hierarchy = s?.visualHierarchy && typeof s.visualHierarchy === 'object' ? s.visualHierarchy : {};
    const primary = Array.isArray(hierarchy.primary)
      ? stringList(hierarchy.primary)
      : (optionalText(hierarchy.primary) ? [optionalText(hierarchy.primary)] : []);
    return {
      index: Number(s?.index) > 0 ? Number(s.index) : i + 1,
      role: optionalText(s?.role),
      contentStructure: stringList(s?.contentStructure),
      layoutIntent: optionalText(s?.layoutIntent),
      visualHierarchy: {
        primary,
        secondary: stringList(hierarchy.secondary),
        supporting: stringList(hierarchy.supporting),
      },
      arrangement: stringList(s?.arrangement),
      options,
      // The top-ranked option is the applied composition; keep `html`/`reason`
      // at the top level for backward compatibility with existing consumers.
      html: options[0].html,
      reason: options[0].reason,
    };
  });
  // Agent often puts one shared <style> on slide 1 (or option 1) only — each
  // slide/option is stored and previewed alone, so copy style blocks onto any
  // that lack them. One pass over every option keeps them all self-contained.
  //
  // NOT for layout VARIATIONS of a single slide: those are four alternative
  // compositions that intentionally carry different CSS. Prepending option 1's
  // style to the others (when the model leans on a shared block) would make all
  // four render identically — exactly the bug we are avoiding — so skip sharing
  // and let each variation stand on its own <style>.
  if (shareAcrossOptions) {
    const flatHtml = [];
    parsed.slides.forEach((s) => s.options.forEach((o) => flatHtml.push(o.html)));
    const sharedHtml = shareLayoutStyles(flatHtml);
    let k = 0;
    parsed.slides = parsed.slides.map((s) => {
      const options = s.options.map((o) => ({ ...o, html: sharedHtml[k++] || o.html }));
      return { ...s, options, html: options[0].html };
    });
  }
}

function applyLayoutToContent(content, layoutParsed) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const plans = layoutParsed?.status === 'ready' ? (layoutParsed.slides || []) : [];
  if (!slides.length || !plans.length) return content;
  const byIndex = new Map(plans.map((s) => [Number(s.index), s]));
  content.slides = slides.map((raw, i) => {
    const index = Number(raw?.index) > 0 ? Number(raw.index) : i + 1;
    const plan = byIndex.get(index);
    // Options are already extracted, ranked, and style-shared by validateLayout.
    const options = (Array.isArray(plan?.options) ? plan.options : [])
      .map((o, idx) => ({
        rank: Number(o?.rank) > 0 ? Number(o.rank) : idx + 1,
        label: optionalText(o?.label),
        reason: optionalText(o?.reason),
        html: extractLayoutHtml(o?.html),
        direction: optionalText(o?.direction),
      }))
      .filter((o) => o.html);
    const html = options[0]?.html || extractLayoutHtml(plan?.html) || '';
    if (!html) {
      const flat = flattenSlide(raw);
      return {
        ...raw,
        layout: optionalText(raw.layout) || layoutForStructure(flat) || '',
        layoutOptions: [],
      };
    }
    return {
      ...raw,
      layout: 'dynamic',
      layoutHtml: html,
      layoutOptions: options,
      layoutTheme: options[0]?.direction || '',
    };
  });
  if (layoutParsed?.html) content.carouselHtml = layoutParsed.html;
  if (layoutParsed?.themeId) content.themeId = layoutParsed.themeId;
  return content;
}

function layoutSlideIndexOf(raw, i) {
  return Number(raw?.index) > 0 ? Number(raw.index) : i + 1;
}

function sliceLayoutStructure(structure, index) {
  const full = layoutStructureOf(structure);
  return {
    ...full,
    slidesOrScenes: (full.slidesOrScenes || []).filter((s) => Number(s.index) === Number(index)),
  };
}

function layoutNeighborOf(row) {
  return {
    index: row.index,
    role: row.role,
    purpose: row.purpose,
    includeImageSlot: Boolean(row.visual?.includeImageSlot),
    titleWords: Number(row.copyMetrics?.titleWords) || 0,
  };
}

function collectLayoutParts(layout, collect) {
  if (!layout) return;
  if (Array.isArray(layout.parts) && layout.parts.length) {
    layout.parts.forEach(collect);
    return;
  }
  collect(layout);
}

async function writeOneLayoutSlide({ source, structure, post, dayBrief, raw, index, neighbors, totalSlides }) {
  const slicedPost = { ...post, content: { ...(post.content || {}), slides: [raw] } };
  const assembled = assembleAgentPrompt('plan-layout.md', {
    STRUCTURE_JSON: json(sliceLayoutStructure(structure, index)),
    POST_JSON: json({
      ...layoutInputOf(slicedPost, structure, dayBrief),
      carousel: { totalSlides, thisIndex: index, neighbors },
    }),
  });
  return withLayoutSlot(() => callAgent({
    source: `${source}#${index}`,
    kind: 'layout',
    system: assembled.system,
    user: assembled.user,
    prompt: assembled.prompt,
    validate: (parsed) => validateLayout(parsed, slicedPost),
  }));
}

async function writeLayout({ source, structure, post, dayBrief }) {
  const slides = Array.isArray(post?.content?.slides) ? post.content.slides : [];
  if (layoutSlideParallelEnabled() && slides.length > 1) {
    const fullInput = layoutInputOf(post, structure, dayBrief);
    const parts = (await mapPool(slides, slides.length, async (raw, i) => {
      const index = layoutSlideIndexOf(raw, i);
      try {
        return await writeOneLayoutSlide({
          source,
          structure,
          post,
          dayBrief,
          raw,
          index,
          totalSlides: slides.length,
          neighbors: (fullInput.slides || []).filter((s) => s.index !== index).map(layoutNeighborOf),
        });
      } catch (err) {
        console.warn(`[planOrchestrator] ${source}#${index} skipped — ${err.message}`);
        return null;
      }
    })).filter(Boolean);
    const mergedSlides = parts
      .filter((p) => p?.parsed?.status === 'ready')
      .flatMap((p) => p.parsed?.slides || [])
      .sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0));
    const model = parts[0]?.debugEntry?.model || agentModel('layout');
    const usage = mergeUsage(parts.map((p) => p.usage).filter(Boolean), model);
    const elapsedMs = Math.max(0, ...parts.map((p) => Number(p.debugEntry?.elapsedMs) || 0));
    if (!mergedSlides.length) {
      const failed = parts.find((p) => p?.parsed?.status === 'failed') || parts[0];
      return failed ? { ...failed, parts, usage } : {
        parsed: { status: 'failed', failureReason: 'all layout slides failed', slides: [] },
        usage,
        debugEntry: { source, model, kind: 'layout', prompt: '', output: '', elapsedMs, usage },
        parts,
      };
    }
    return {
      parsed: { status: 'ready', slides: mergedSlides },
      usage,
      debugEntry: {
        source,
        model,
        provider: parts[0]?.debugEntry?.provider || '',
        prompt: parts.map((p) => p.debugEntry?.prompt).filter(Boolean).join('\n\n---\n\n'),
        output: parts.map((p) => p.debugEntry?.output).filter(Boolean).join('\n\n'),
        kind: 'layout',
        elapsedMs,
        usage,
      },
      parts,
    };
  }

  const assembled = assembleAgentPrompt('plan-layout.md', {
    STRUCTURE_JSON: json(layoutStructureOf(structure)),
    POST_JSON: json(layoutInputOf(post, structure, dayBrief)),
  });
  return withLayoutSlot(() => callAgent({
    source,
    kind: 'layout',
    system: assembled.system,
    user: assembled.user,
    prompt: assembled.prompt,
    validate: (parsed) => validateLayout(parsed, post),
  }));
}

// The ONLY input the layout-variation agent gets: the parent slide's own visible
// copy and its image decision — nothing from Content Structure (no purpose,
// role, unit id, evidence type, or contentGuidance).
//
// IMPORTANT: the parent slide's REAL copy lives baked in its applied layoutHtml
// (the carousel agent bakes words into the composition). The slide's title /
// subtitle FIELDS often hold structure purpose + metadata ("Name the
// constrained hall situation…", "u1 support · verifiedTruth") — NOT copy. So the
// copy source is `currentHtml` (read back per data-slot); the flattened fields
// are used only as a fallback when there is no current composition.
function mergeFilledCopy(fromHtml, flat) {
  const filled = { ...(fromHtml?.filled || {}) };
  const take = (key, value) => {
    const next = optionalText(value);
    if (!next) return;
    if (!optionalText(filled[key])) filled[key] = next;
  };
  const takeList = (key, value) => {
    const list = Array.isArray(value) ? value.map(optionalText).filter(Boolean) : [];
    if (!list.length) return;
    const cur = Array.isArray(filled[key]) ? filled[key].map(optionalText).filter(Boolean) : [];
    if (!cur.length) filled[key] = list;
    else {
      const seen = new Set(cur.map((x) => x.toLowerCase()));
      list.forEach((x) => { if (!seen.has(x.toLowerCase())) cur.push(x); });
      filled[key] = cur;
    }
  };
  take('title', flat.title);
  take('subtitle', flat.subtitle);
  take('body', flat.body);
  take('stat', flat.stat);
  take('quote', flat.quote);
  take('action', flat.action);
  take('comparisonA', flat.comparisonA);
  take('comparisonB', flat.comparisonB);
  takeList('items', flat.items);
  takeList('itemsA', flat.itemsA);
  takeList('itemsB', flat.itemsB);
  takeList('labels', flat.labels);
  if (optionalText(flat.stat) && Array.isArray(filled.stats) && filled.stats.length) {
    const seen = new Set(filled.stats.map((x) => String(x).toLowerCase()));
    if (!seen.has(String(flat.stat).toLowerCase())) filled.stats = [...filled.stats, flat.stat];
  }
  return filled;
}

function requiredCopyOf(filled) {
  const out = [];
  const seen = new Set();
  const push = (v) => {
    const t = optionalText(v);
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  [
    filled?.title, filled?.subtitle, filled?.body, filled?.quote, filled?.action,
    filled?.stat, filled?.comparisonA, filled?.comparisonB,
  ].forEach(push);
  (Array.isArray(filled?.stats) ? filled.stats : []).forEach(push);
  (Array.isArray(filled?.items) ? filled.items : []).forEach(push);
  (Array.isArray(filled?.itemsA) ? filled.itemsA : []).forEach(push);
  (Array.isArray(filled?.itemsB) ? filled.itemsB : []).forEach(push);
  (Array.isArray(filled?.labels) ? filled.labels : []).forEach(push);
  // Unslotted metric/label lines recovered from the parent HTML (e.g. dual
  // "5.4 inches" / "7.6 inches" blocks) — these are what variations drop most.
  (Array.isArray(filled?.extras) ? filled.extras : []).forEach(push);
  return out;
}

function parentSlideCopyInput(slide, currentHtml) {
  const flat = flattenSlide(slide);
  const sourceVisual = slide?.visual && typeof slide.visual === 'object' ? slide.visual : (flat.visual || {});
  const fromHtml = copyFromLayoutHtml(currentHtml);

  // Prefer baked layoutHtml copy (the real on-slide words), then merge any
  // structured slide fields the HTML extractor missed — dual stats, comparison
  // columns, and unslotted metric labels must not disappear in variations.
  const filled = mergeFilledCopy(fromHtml, flat);
  Object.keys(filled).forEach((k) => {
    if (Array.isArray(filled[k]) && !filled[k].length) delete filled[k];
    if (!Array.isArray(filled[k]) && !optionalText(filled[k])) delete filled[k];
  });

  // Image: the real photograph is baked into the layoutHtml's <img> (the slide's
  // asset fields are usually empty). Prefer that; fall back to the slide fields.
  const bakedImg = fromHtml?.image;
  const bakedSrc = optionalText(bakedImg?.src);
  const bakedKey = optionalText(bakedImg?.assetKey);
  const fieldKey = optionalText(flat.assetKey) || optionalText(slide?.assetKey) || optionalText(slide?.visual?.assetKey);
  const assetKey = bakedKey || fieldKey;
  const hasImage = Boolean(bakedImg?.present) || Boolean(bakedSrc) || Boolean(assetKey)
    || slideWantsVisual(slide, flat, sourceVisual);
  let visual;
  let compositionNote;
  if (hasImage) {
    visual = {
      priority: 'recommended',
      role: optionalText(sourceVisual?.role) || 'context',
      type: 'Image',
      hasAsset: true,
      includeImageSlot: true,
      assetKey,
      photograph: { assigned: true, ...(bakedSrc ? { src: bakedSrc } : {}) },
      ...(bakedSrc ? { src: bakedSrc } : {}),
      ...(bakedImg?.alt ? { alt: optionalText(bakedImg.alt) } : {}),
    };
    compositionNote = 'This slide HAS a photograph. Include exactly one '
      + '<img data-slot="image" alt=""> and give it a real, prominent flex/grid area in every '
      + 'variation. The application injects the exact photo file, so leave src empty — never omit '
      + 'the image slot and never replace it with a placeholder box.';
  } else {
    visual = layoutVisualOf(sourceVisual, false, '', null, false);
    compositionNote = 'No image slot. Text-led composition only.';
  }

  const requiredCopy = requiredCopyOf(filled);
  return {
    index: Number(slide?.index) > 0 ? Number(slide.index) : 1,
    filled,
    ...(requiredCopy.length ? { requiredCopy } : {}),
    ...(fromHtml?.fullText ? { fullText: fromHtml.fullText } : {}),
    compositionNote,
    visual,
  };
}

// On-demand layout variations for ONE slide (Week View · Change layout). The
// agent is fed ONLY the parent slide's copy + image decision (parentSlideCopyInput)
// and the slide's current composition as a visual reference — never the Content
// Structure. It keeps the slide's theme and only re-composes it: no new facts,
// no whole-carousel cost. Returns the same { parsed:{ slides:[{options}] } }
// shape as writeLayout, so the same validation/consumers apply.
async function writeLayoutVariations({
  source, post, index, brand, currentHtml,
}) {
  const allSlides = Array.isArray(post?.content?.slides) ? post.content.slides : [];
  const target = (Number(index) > 0
    ? allSlides.find((s, i) => (Number(s?.index) > 0 ? Number(s.index) : i + 1) === Number(index))
    : allSlides[0]) || allSlides[0];
  if (!target) throw new Error(`${source}: no slide to compose`);
  const slideInput = parentSlideCopyInput(target, currentHtml);
  // If the parent slide carries a photograph, mark the validation slide so
  // validateLayout enforces an image slot on every option (drops any that omit
  // it) — the real src is injected server-side after generation.
  const validationSlide = slideInput.visual?.includeImageSlot
    ? { ...target, visual: { ...(target?.visual || {}), priority: 'recommended', type: 'Image', includeImageSlot: true } }
    : target;
  const slicedPost = { ...post, content: { ...(post.content || {}), slides: [validationSlide] } };
  const assembled = assembleAgentPrompt('plan-layout-variations.md', {
    POST_JSON: json({ format: lockedFormat(post?.format), slides: [slideInput] }),
    CURRENT_LAYOUT_HTML: optionalText(currentHtml) || 'None supplied.',
    BRAND_STYLE: optionalPromptJson(brandStyleOf(brand)),
    BRAND_JSON: optionalPromptJson(brandMemoryOf(brand)),
  });
  return withLayoutSlot(() => callAgent({
    source,
    kind: 'layoutVariations',
    system: assembled.system,
    user: assembled.user,
    prompt: assembled.prompt,
    validate: (parsed) => validateLayout(parsed, slicedPost, { shareAcrossOptions: false }),
  }));
}

function brandStyleOf(brand) {
  const b = brand && typeof brand === 'object' ? brand : {};
  const visualStyle = optionalText(b.visualStyle || b.mood);
  const palette = b.palette && typeof b.palette === 'object' ? b.palette : null;
  const fonts = b.fonts && typeof b.fonts === 'object' ? b.fonts : null;
  if (!visualStyle && !palette && !fonts) return '';
  return { ...(visualStyle ? { visualStyle } : {}), ...(palette ? { palette } : {}), ...(fonts ? { fonts } : {}) };
}

function brandMemoryOf(brand) {
  const b = brand && typeof brand === 'object' ? brand : {};
  const memory = {
    offer: optionalText(b.offer),
    audience: optionalText(b.audience),
    firstProblem: optionalText(b.firstProblem),
    position: optionalText(b.position),
    proof: optionalText(b.proof),
    voice: optionalText(b.voice),
    visualStyle: optionalText(b.visualStyle || b.mood),
    neverDo: optionalText(b.neverDo),
    guardrails: Array.isArray(b.guardrails) ? b.guardrails.map(optionalText).filter(Boolean) : [],
  };
  const filled = ['offer', 'audience', 'firstProblem', 'position', 'proof', 'voice', 'visualStyle', 'neverDo']
    .some((k) => memory[k]) || memory.guardrails.length > 0;
  return filled ? memory : '';
}

function optionalPromptJson(value) {
  if (value == null || value === '') return 'None supplied.';
  if (typeof value === 'string') {
    const t = value.trim();
    return t || 'None supplied.';
  }
  return json(value);
}

function validateCarousel(parsed, post) {
  const expected = Array.isArray(post?.content?.slides) ? post.content.slides.length : 0;
  const raw = String(parsed?.html || '');
  if (/content structure (was )?not included|awaiting content|role not supplied/i.test(raw)) {
    throw new Error('carousel html is an empty shell (structure missing from model input)');
  }
  const doc = parseCarouselDocument(raw, expected);
  if (!doc.html || !doc.slides.length) {
    const articles = (raw.match(/<article\b/gi) || []).length;
    const slideClass = (raw.match(/class=["'][^"']*\bslide\b/gi) || []).length;
    const dirs = [...raw.matchAll(/\bdata-direction=["']([^"']+)["']/gi)].map((m) => m[1]);
    const uniqDirs = [...new Set(dirs)].slice(0, 8).join(',') || 'none';
    throw new Error(
      `carousel html missing slides (chars=${raw.length} articles=${articles} ` +
        `slideClass=${slideClass} directions=${uniqDirs} expected=${expected || 'any'})`,
    );
  }
  if (expected && doc.slides.length !== expected) {
    throw new Error(`carousel slide count ${doc.slides.length} != ${expected}`);
  }
  parsed.status = 'ready';
  parsed.html = doc.html;
  parsed.slides = doc.slides;
}

function runLayoutForPost(opts) {
  if (carouselAgentEnabled()) return writeCarousel(opts);
  return writeLayout(opts);
}

async function writeCarousel({ source, structure, post, dayBrief, brand, dayWriterOutput, themeId }) {
  const hasStructure = Array.isArray(structure?.slidesOrScenes) && structure.slidesOrScenes.length > 0;
  const carouselInput = hasStructure
    ? carouselInputOf(structure, post, dayBrief)
    : carouselBriefInputOf(dayBrief, post);
  const structureSlides = visualSlidesOf(structure).length;
  const postSlideCount = Array.isArray(post?.content?.slides) ? post.content.slides.length : 0;
  // Studio Change-theme wins when passed; otherwise use the Strategist's brief pick.
  const resolvedThemeId = resolveThemeId(
    themeId || dayBrief?.themeId || post?.content?.themeId,
    { pillar: dayBrief?.pillar || dayBrief?.lens },
  );
  const theme = themeById(resolvedThemeId);
  console.log(
    `[planOrchestrator] ${source} input · structureSlides=${structureSlides} ` +
      `postSlides=${postSlideCount} inputSlides=${carouselInput.slides?.length || 0} ` +
      `from=${hasStructure ? 'structure' : 'strategy-brief'}` +
      ` theme=${theme?.id || 'default'}`,
  );
  if (!(carouselInput.slides || []).length && !carouselInput.narrativeUnits?.length) {
    throw new Error(
      `${source}: no slides to send to carousel agent ` +
        `(structureSlides=${structureSlides} postSlides=${postSlideCount})`,
    );
  }
  const assembled = assembleAgentPrompt('plan-carousel.md', {
    CONTENT_STRUCTURE_JSON: json(carouselInput),
    DAY_WRITER_OUTPUT: optionalPromptJson(dayWriterOutput),
    BRAND_STYLE: optionalPromptJson(brandStyleOf(brand)),
    BRAND_JSON: optionalPromptJson(brandMemoryOf(brand)),
    THEME_REFERENCE: themeReferenceForPrompt(theme),
    contentStructure: json(carouselInput),
    dayWriterOutput: optionalPromptJson(dayWriterOutput),
    brandStyle: optionalPromptJson(brandStyleOf(brand)),
  });
  const userHead = String(assembled.user || '').slice(0, 180).replace(/\s+/g, ' ');
  console.log(`[planOrchestrator] ${source} userHead · ${userHead}`);
  if (!/\{\s*"/.test(assembled.user || '') && !/slides|narrativeUnits/i.test(assembled.user || '')) {
    throw new Error(`${source}: strategy brief / content structure missing from assembled user prompt`);
  }
  const result = await withLayoutSlot(() => callAgent({
    source,
    kind: 'carousel',
    system: assembled.system,
    user: assembled.user,
    prompt: assembled.prompt,
    parse: 'html',
    htmlDirection: theme?.direction || 'architectural-minimal',
    validate: (parsed) => validateCarousel(parsed, post),
  }));
  if (result?.parsed && theme?.id) {
    result.parsed.themeId = theme.id;
  }
  return result;
}

async function attachCarousel({ label, structure, writer, collect, dayBrief, dayAssets, brand }) {
  if (!carouselAgentEnabled() || !writer || writerFailed(writer.parsed)) return null;
  try {
    const parsed = writer.parsed || {};
    const post = {
      ...parsed,
      content: dayBrief ? normalizeWriterPost(parsed, dayBrief, dayAssets) : parsed.content,
    };
    const carousel = await writeCarousel({
      source: `Carousel:${label}`,
      structure,
      post,
      dayBrief,
      brand,
      dayWriterOutput: '',
      themeId: dayBrief?.themeId || '',
    });
    collectLayoutParts(carousel, collect);
    const htmlCount = (carousel.parsed?.slides || []).filter((s) => s.html).length;
    console.log(
      `[planOrchestrator] Carousel:${label}` +
        (carousel.parsed?.status === 'failed'
          ? ` failed${carousel.parsed.failureReason ? ` — ${carousel.parsed.failureReason}` : ''}`
          : ` · ${htmlCount} html ${htmlCount === 1 ? 'slide' : 'slides'}`) +
        (carousel.parsed?.themeId ? ` · theme=${carousel.parsed.themeId}` : ''),
    );
    return carousel;
  } catch (err) {
    console.warn(`[planOrchestrator] Carousel:${label} skipped — ${err.message}`);
    return null;
  }
}

async function attachLayout({ label, structure, writer, collect, dayBrief, dayAssets }) {
  if (!layoutAgentEnabled() || !writer || writerFailed(writer.parsed)) return null;
  try {
    const parsed = writer.parsed || {};
    const post = {
      ...parsed,
      content: dayBrief ? normalizeWriterPost(parsed, dayBrief, dayAssets) : parsed.content,
    };
    const layout = await writeLayout({
      source: `Layout:${label}`,
      structure,
      post,
      dayBrief,
    });
    collectLayoutParts(layout, collect);
    const htmlCount = (layout.parsed?.slides || []).filter((s) => s.html).length;
    console.log(
      `[planOrchestrator] Layout:${label}` +
        (layout.parsed?.status === 'failed'
          ? ` failed${layout.parsed.failureReason ? ` — ${layout.parsed.failureReason}` : ''}`
          : ` · ${htmlCount} html ${htmlCount === 1 ? 'slide' : 'slides'}`),
    );
    return layout;
  } catch (err) {
    console.warn(`[planOrchestrator] Layout:${label} skipped — ${err.message}`);
    return null;
  }
}

// ── Visual Generator agent ───────────────────────────────────────────────────
// Fills the empty image slot of a slide that needs a visual but has no supplied
// asset. Content Structure decides this (evidenceResolution = generate-
// conceptual-support); this agent writes ONE art-direction prompt, renders it
// with OpenAI (gpt-image-1), stores the bytes on S3, and injects the picture
// into the slide's applied layout and every layout option. Runs after the layout/
// carousel agent, per day, so it only ever sees the composed slides.

// Map a slide's evidence resolution + image slot onto "needs a generated visual".
// Strict by default: only slides the structure agent explicitly routed to
// generate-conceptual-support are filled, so a generated picture never stands in
// for missing factual proof. PLAN_VISUAL_FILL_EMPTY=1 broadens it to any empty
// image slot the layout kept for a slide that wants a visual.
function slideNeedsGeneratedVisual(slide, { fillEmpty = false } = {}) {
  const html = optionalText(slide?.layoutHtml);
  if (!html || !hasImageSlot(html)) return false;
  const flat = flattenSlide(slide);
  const visual = slide?.visual && typeof slide.visual === 'object' ? slide.visual : (flat.visual || {});
  if (slideHasAsset(slide, flat, visual)) return false;
  // Already carries a baked picture URL.
  const baked = copyFromLayoutHtml(html)?.image;
  if (optionalText(baked?.src)) return false;
  // Real project photo keys belong to the binder, not the image generator.
  const supplied = suppliedKeysForSlide(slide).filter((k) => !isGeneratedAssetKey(k));
  if (supplied.length) return false;
  const resolution = String(slide?.evidenceResolution?.type || '').trim().toLowerCase();
  if (resolution === 'generate-conceptual-support') return true;
  // Fill any remaining empty image slot the carousel reserved for a concept visual.
  if (fillEmpty || envFlagOn('PLAN_VISUAL_FILL_EMPTY', '0')) return true;
  return false;
}

// The guidance the Visual Generator agent gets for one slide: the structure
// agent's visual decision plus the slide's real on-slide copy (so the image
// complements the words, not repeats them).
function visualSlideInputOf(slide) {
  const flat = flattenSlide(slide);
  const v = slide?.visual && typeof slide.visual === 'object' ? slide.visual : (flat.visual || {});
  const filled = {};
  ['title', 'subtitle', 'body', 'stat', 'quote', 'action', 'comparisonA', 'comparisonB'].forEach((k) => {
    const t = optionalText(flat[k]);
    if (t) filled[k] = t;
  });
  ['items', 'itemsA', 'itemsB', 'labels'].forEach((k) => {
    const list = Array.isArray(flat[k]) ? flat[k].map(optionalText).filter(Boolean) : [];
    if (list.length) filled[k] = list;
  });
  return {
    index: Number(slide?.index) > 0 ? Number(slide.index) : 1,
    role: optionalText(slide?.role || flat.role),
    purpose: optionalText(slide?.purpose),
    contentGuidance: optionalText(slide?.contentGuidance),
    informationShape: optionalText(slide?.informationShape || flat.informationShape),
    primaryStructure: optionalText(slide?.structure || flat.structure),
    visual: {
      role: optionalText(v.role),
      priority: optionalText(v.priority),
      communicationFunction: optionalText(v.communicationFunction),
      truthBoundary: optionalText(v.truthBoundary),
    },
    evidenceResolution: {
      type: optionalText(slide?.evidenceResolution?.type),
      reason: optionalText(slide?.evidenceResolution?.reason),
    },
    filledCopy: filled,
  };
}

function visualPostContextOf(brief) {
  return {
    angle: optionalText(brief?.angle),
    pillar: optionalText(brief?.pillar),
    format: optionalText(brief?.format),
    uniqueJob: optionalText(brief?.uniqueJob),
    centralFact: optionalText(brief?.centralFact),
    verifiedTruth: stringList(brief?.verifiedTruth),
    observableDetails: stringList(brief?.observableDetails),
  };
}

// Flatten brand style into the { accent, primary, neutral, mood } shape
// buildImagePrompt (services/generatedImage.js) appends to the render prompt, so
// generated slides share the palette of the photographed ones.
function brandPaletteOf(brand) {
  const b = brand && typeof brand === 'object' ? brand : {};
  const style = brandStyleOf(brand) || {};
  const palette = style.palette && typeof style.palette === 'object' ? style.palette : {};
  return {
    accent: optionalText(palette.accent || b.accent),
    primary: optionalText(palette.primary || palette.ink || b.primary),
    neutral: optionalText(palette.neutral || palette.background || b.neutral),
    mood: optionalText(b.visualStyle || b.mood || style.visualStyle),
  };
}

function validateVisualPrompt(parsed) {
  const status = String(parsed?.status || '').trim().toLowerCase();
  if (status === 'skip') {
    parsed.status = 'skip';
    parsed.skipReason = optionalText(parsed.skipReason);
    return;
  }
  const prompt = optionalText(parsed?.imagePrompt);
  if (!prompt) throw new Error('visual agent returned no imagePrompt');
  parsed.status = 'ready';
  parsed.imagePrompt = prompt;
  parsed.altText = optionalText(parsed.altText);
}

// Write the image-generation prompt for one slide (the LLM "agent" step).
async function writeVisualPrompt({ source, slide, brief, brand }) {
  const assembled = assembleAgentPrompt('plan-visual.md', {
    SLIDE_JSON: json(visualSlideInputOf(slide)),
    POST_CONTEXT_JSON: optionalPromptJson(visualPostContextOf(brief)),
    BRAND_STYLE: optionalPromptJson(brandStyleOf(brand)),
  });
  return callAgent({
    source,
    kind: 'visual',
    system: assembled.system,
    user: assembled.user,
    prompt: assembled.prompt,
    validate: (parsed) => validateVisualPrompt(parsed),
  });
}

// End to end for ONE slide: prompt agent → OpenAI render → S3. Returns
// { ok, key, src, alt, imagePrompt, finalPrompt, model } on success, or
// { ok:false, skipReason } when the agent declined to art-direct the slide.
async function generateSlideVisual({ source, slide, brief, brand, userId, handle, collect }) {
  const agent = await writeVisualPrompt({ source, slide, brief, brand });
  if (collect) collect(agent);
  const parsed = agent.parsed || {};
  if (parsed.status !== 'ready') {
    const skipReason = optionalText(parsed.skipReason) || 'no prompt';
    console.log(`[planOrchestrator] ${source} skipped — ${skipReason}`);
    return { ok: false, skipReason };
  }
  // The agent's art direction, composed with the brand palette and the shared
  // house guardrails (no text, full-bleed, negative space kept in-scene).
  const finalPrompt = buildImagePrompt(parsed.imagePrompt, brandPaletteOf(brand));
  const {
    buffer, mimeType, model, elapsedMs: imageElapsedMs = 0, estimatedCostUsd: imageCostUsd = 0,
  } = await renderOpenAIImage(finalPrompt);
  const stored = await persistGeneratedImage({
    userId,
    handle,
    buffer,
    mimeType,
    prompt: finalPrompt,
    model,
  });
  let src = '';
  try { src = await getMediaUrl(stored.key); } catch { /* CDN off / presign fail — key still resolves client-side */ }
  // Cost/time for this slide = the prompt agent (LLM tokens) + the image render.
  const promptUsage = agent.usage || {};
  const promptCost = Number(promptUsage.estimatedCostUsd) || 0;
  const promptTokens = Number(promptUsage.totalTokens) || 0;
  const promptElapsedMs = Number(agent.debugEntry?.elapsedMs) || 0;
  return {
    ok: true,
    key: stored.key,
    src,
    alt: optionalText(parsed.altText),
    imagePrompt: optionalText(parsed.imagePrompt),
    finalPrompt,
    model,
    usage: {
      elapsedMs: promptElapsedMs + imageElapsedMs,
      estimatedCostUsd: promptCost + imageCostUsd,
      promptCostUsd: promptCost,
      imageCostUsd,
      totalTokens: promptTokens,
    },
  };
}

// Object keys the Visual Generator agent produced (persistGeneratedImage names
// them `<prefix>/gen-<uuid>.<ext>`). Lets a re-run re-bind a slide's own prior
// generated picture into freshly composed html without paying to regenerate it.
function isGeneratedAssetKey(key) {
  return /\/gen-[0-9a-fA-F-]+\.[a-z0-9]+$/.test(String(key || ''));
}

// Every project media key this slide already owns or references — direct asset
// fields, plus keys the structure agent embedded in element text / support
// references / evidence (where an allocated photo often lives instead of on
// assetKey). Also reads data-asset-key from composed layout HTML (the carousel
// agent often stamps the key on the <img> without setting slide.assetKey).
function keysFromLayoutHtml(html) {
  const keys = [];
  const seen = new Set();
  String(html || '').replace(/<img\b([^>]*?)\/?>/gi, (_, attrs) => {
    if (!/\bdata-slot\s*=\s*["'](?:image|illustration)["']/i.test(attrs)) return _;
    const m = String(attrs).match(/\bdata-asset-key\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const key = optionalText(m?.[2] || m?.[3] || m?.[4]);
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
    return _;
  });
  return keys;
}

function suppliedKeysForSlide(slide) {
  const flat = flattenSlide(slide);
  // `elements` is an array of OBJECTS; projectMediaKeysIn would join it to
  // "[object Object]" and lose the keys, so flatten its text/supportReference to
  // a string first (this is where slideFromStructure puts allocated photo keys).
  const elementsText = (Array.isArray(slide?.elements) ? slide.elements : [])
    .map((el) => {
      const refs = Array.isArray(el?.supportReference) ? el.supportReference : [el?.supportReference];
      return [el?.text, ...refs].filter(Boolean).join(' ');
    })
    .join(' ');
  const fromFields = projectMediaKeysIn(
    slide?.assetKeys, slide?.assetKey, slide?.visual?.assetKeys, slide?.visual?.assetKey,
    flat.assetKey, flat.assetKeys,
    elementsText,
    slide?.body, slide?.items, slide?.itemsA, slide?.itemsB,
    slide?.comparisonA, slide?.comparisonB, slide?.title, slide?.subtitle,
    slide?.visual, slide?.evidenceAvailability,
  );
  const fromHtml = [
    ...keysFromLayoutHtml(slide?.layoutHtml),
    ...(Array.isArray(slide?.layoutOptions)
      ? slide.layoutOptions.flatMap((o) => keysFromLayoutHtml(o?.html))
      : []),
  ];
  const seen = new Set();
  const out = [];
  [...fromFields, ...fromHtml].forEach((k) => {
    const key = optionalText(k);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  });
  return out;
}

// Bind real photos into empty image slots. No model call. Safe to run even when
// the Visual Generator is disabled — this is what makes allocated project assets
// appear in carousel HTML.
function bindSuppliedAssetsInContent(content) {
  const slides = (Array.isArray(content?.slides) ? content.slides : []).map((slide) => {
    const html = optionalText(slide?.layoutHtml);
    if (!html || !hasImageSlot(html)) return slide;
    if (optionalText(copyFromLayoutHtml(html)?.image?.src)) return slide; // already baked
    const keys = suppliedKeysForSlide(slide);
    if (!keys.length) return slide;
    const resolution = String(slide?.evidenceResolution?.type || '').trim().toLowerCase();
    if (resolution === 'generate-conceptual-support') {
      const generated = keys.filter(isGeneratedAssetKey);
      return generated.length ? bindAssetsToSlide(slide, generated) : slide;
    }
    const supplied = keys.filter((k) => !isGeneratedAssetKey(k));
    return bindAssetsToSlide(slide, supplied.length ? supplied : keys);
  });
  return { ...content, slides };
}

// Assign each key to the next image slot, in order — for Multiple_Images slides
// the carousel composes several <img data-slot="image"> and each supplied photo
// fills one. Extra slots (more slots than keys) are left untouched.
function injectMultiImages(html, keys) {
  const list = (Array.isArray(keys) ? keys : []).map((k) => String(k || '').trim()).filter(Boolean);
  if (!list.length) return String(html || '');
  let i = 0;
  return String(html || '').replace(/<img\b([^>]*?)\/?>/gi, (full, attrs) => {
    if (!/\bdata-slot\s*=\s*["'](?:image|illustration)["']/i.test(attrs)) return full;
    const key = list[i];
    i += 1;
    if (!key) return full; // more slots than keys — leave the rest as-is
    const src = photographSrcOf(key);
    const clean = String(attrs)
      .replace(/\s+src\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, '')
      .replace(/\s+data-asset-key\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, '')
      .trim();
    const keyAttr = ` data-asset-key="${key.replace(/"/g, '&quot;')}"`;
    const srcAttr = src ? ` src="${src.replace(/"/g, '&quot;')}"` : '';
    return `<img ${clean}${keyAttr}${srcAttr}>`;
  });
}

// Bind supplied (or previously generated) asset keys onto a slide and inject
// them into its image slots — no model call. `assetKeys` carries every key so a
// Multiple_Images slide renders all of them (the client reads keysOf → all keys).
function bindAssetsToSlide(slide, keys) {
  const list = (Array.isArray(keys) ? keys : []).map((k) => String(k || '').trim()).filter(Boolean);
  if (!list.length) return slide;
  const next = { ...slide };
  next.assetKey = list[0];
  next.assetKeys = list;
  next.visual = {
    ...(next.visual && typeof next.visual === 'object' ? next.visual : {}),
    assetKey: list[0],
    ...(list.length > 1 ? { assetKeys: list } : {}),
  };
  if (next.layoutHtml) next.layoutHtml = injectMultiImages(next.layoutHtml, list);
  if (Array.isArray(next.layoutOptions)) {
    next.layoutOptions = next.layoutOptions.map((o) => ({
      ...o,
      html: injectMultiImages(String(o?.html || ''), list),
    }));
  }
  const firstSrc = photographSrcOf(list[0]);
  next.image = firstSrc || list[0] || optionalText(next.image);
  return next;
}

// Inject a generated picture into a slide's applied layout and every option, and
// bind the S3 key onto the slide so re-runs / layout variations keep it.
function applyVisualToSlide(slide, image) {
  const asset = { src: optionalText(image?.src), assetKey: optionalText(image?.key) };
  const next = { ...slide };
  if (next.layoutHtml) next.layoutHtml = injectImageIntoSlots(next.layoutHtml, asset);
  if (Array.isArray(next.layoutOptions)) {
    next.layoutOptions = next.layoutOptions.map((o) => ({
      ...o,
      html: injectImageIntoSlots(String(o?.html || ''), asset),
    }));
  }
  next.assetKey = asset.assetKey || next.assetKey;
  next.visual = {
    ...(next.visual && typeof next.visual === 'object' ? next.visual : {}),
    assetKey: asset.assetKey || next.visual?.assetKey,
    execution: 'generated-visual',
    ...(image?.alt ? { alt: image.alt } : {}),
  };
  // `slide.image` is a STRING in the PlannedPost/WeeklyRoute schema (an object
  // fails the cast). The picture actually renders from the injected <img src> in
  // layoutHtml + `assetKey`; keep `image` a non-empty string (the src, else the
  // key) so it no longer reads as "placeholder" and `Boolean(slide.image)` holds.
  next.image = asset.src || asset.assetKey || optionalText(next.image);
  if (image?.finalPrompt) next.imagePrompt = image.finalPrompt;
  return next;
}

// Run the Visual Generator agent over one day's composed content, filling every
// slide that needs a generated visual. Mutates and returns `content`. Failures
// on a single slide are logged and skipped — the slide keeps its empty slot
// rather than failing the whole day.
//
// Asset binding (injecting real project photos into empty <img> slots) always
// runs — even when PLAN_VISUAL_AGENT=0 — otherwise carousel slides keep
// data-asset-key with no src.
async function attachGeneratedVisuals({ source, content, brief, brand, userId, handle, collect, fillEmpty = false }) {
  content = bindSuppliedAssetsInContent(content);
  const bound = (content.slides || []).filter((s) => optionalText(copyFromLayoutHtml(s?.layoutHtml)?.image?.src)).length;
  if (bound) {
    console.log(`[planOrchestrator] Assets:${source} · bound photos into ${bound} slide${bound === 1 ? '' : 's'}`);
  }

  if (!visualAgentEnabled()) {
    console.log(`[planOrchestrator] Visual:${source} skipped — PLAN_VISUAL_AGENT off or image stack not configured`);
    return content;
  }
  if (!userId) {
    console.warn(`[planOrchestrator] Visual:${source} skipped — no userId to store generated images`);
    return content;
  }
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const targets = slides
    .map((slide, i) => ({ slide, i }))
    .filter(({ slide }) => slideNeedsGeneratedVisual(slide, { fillEmpty }));
  if (!targets.length) return content;
  console.log(
    `[planOrchestrator] Visual:${source} · ${targets.length} slide${targets.length === 1 ? '' : 's'} need a generated visual`,
  );
  const results = await mapPool(targets, visualSlideConcurrency(), async ({ slide, i }) => {
    const index = Number(slide?.index) > 0 ? Number(slide.index) : i + 1;
    try {
      const image = await generateSlideVisual({
        source: `Visual:${source}#${index}`,
        slide,
        brief,
        brand,
        userId,
        handle,
        collect,
      });
      return { i, index, image };
    } catch (err) {
      console.warn(`[planOrchestrator] Visual:${source}#${index} skipped — ${err.message}`);
      return { i, index, image: { ok: false, skipReason: err.message } };
    }
  });
  // A per-slide record of what the Visual Generator did — surfaced in the Debug
  // panel (agentTrace.visual) so a generated (or skipped) image is inspectable.
  const trace = results
    .sort((a, b) => a.index - b.index)
    .map((r) => (r.image?.ok
      ? {
        index: r.index,
        status: 'generated',
        assetKey: r.image.key,
        model: r.image.model,
        imagePrompt: r.image.imagePrompt || '',
        finalPrompt: r.image.finalPrompt || '',
        altText: r.image.alt || '',
        estimatedCostUsd: Number(r.image.usage?.estimatedCostUsd) || 0,
        elapsedMs: Number(r.image.usage?.elapsedMs) || 0,
      }
      : {
        index: r.index,
        status: 'skipped',
        skipReason: r.image?.skipReason || 'unknown',
      }));
  // Aggregate cost/time for the whole Visual Generator run (LLM prompt agents +
  // image renders). elapsedMs sums per-slide work; renders run concurrently, so
  // this is an upper bound, not wall-clock.
  const generatedResults = results.filter((r) => r?.image?.ok);
  content.visualUsage = {
    images: generatedResults.length,
    elapsedMs: generatedResults.reduce((n, r) => n + (Number(r.image.usage?.elapsedMs) || 0), 0),
    estimatedCostUsd: generatedResults.reduce((n, r) => n + (Number(r.image.usage?.estimatedCostUsd) || 0), 0),
    imageCostUsd: generatedResults.reduce((n, r) => n + (Number(r.image.usage?.imageCostUsd) || 0), 0),
    promptCostUsd: generatedResults.reduce((n, r) => n + (Number(r.image.usage?.promptCostUsd) || 0), 0),
    totalTokens: generatedResults.reduce((n, r) => n + (Number(r.image.usage?.totalTokens) || 0), 0),
  };
  const byIndex = new Map(generatedResults.map((r) => [r.i, r.image]));
  content.visualTrace = trace;
  if (!byIndex.size) return content;
  content.slides = slides.map((slide, i) => (byIndex.has(i) ? applyVisualToSlide(slide, byIndex.get(i)) : slide));
  return content;
}

/**
 * Multi-agent plan: Strategist → [Content Structure] → Carousel → Visual.
 * Content Structure is optional (PLAN_CONTENT_STRUCTURE_AGENT, default off);
 * when off, the Strategist brief feeds Carousel directly.
 * Returns the same shape fields weeklyPlan needs to assemble a route:
 *   { focusOut, rawDays, usage, model, debug }
 */
async function runMultiAgentPlan({
  profile,
  brandDna,
  competitorInsights,
  projects,
  focusSummary,
  monthCalendar = { occupied: [], emptyDates: [] },
  sessionId = '',
  captureIds = [],
  userId = '',
}) {
  const started = Date.now();
  const username = profile?.username || '?';
  const ctx = compileStrategyContext({
    brandDna,
    competitorInsights,
    projects,
    focusSummary,
    monthCalendar,
    sessionId,
    captureIds,
  });
  const emptyDates = Array.isArray(ctx.calendar.emptyDates) ? ctx.calendar.emptyDates : [];
  const debugAgents = [];
  const usages = [];

  const brandFilled = ['offer', 'audience', 'firstProblem', 'position', 'proof', 'voice', 'visualStyle', 'neverDo']
    .filter((k) => String(ctx.brand?.[k] || '').trim())
    .map((k) => `${k}:${String(ctx.brand[k]).length}`);
  console.log(
    `[planOrchestrator] multi-agent plan for @${username} · focus=${ctx.authority.priority}` +
      ` · emptyMonthDays=${emptyDates.length}` +
      ` · conversationCaptures=${(ctx.projects?.conversationCaptures || []).length}` +
      ` · captureAssets=${(ctx.projects?.conversationCaptures || []).reduce((n, c) => n + (c.assets || []).length, 0)}` +
      ` · projectAssets=${(ctx.assetContext?.projectAssets || []).reduce((n, r) => n + (r.assets || []).length, 0)}` +
      (sessionId ? ` · session=${sessionId}` : '') +
      ` · brand=${ctx.versions.brand}` +
      (brandFilled.length ? ` [${brandFilled.join(' ')}]` : ' [empty]') +
      ` · competitor=${ctx.versions.competitor}`,
  );

  // ── 1. Strategist ────────────────────────────────────────────────────────
  const strategistAssembled = assembleAgentPrompt('plan-strategist.md', {
    LIMITS_JSON: json({
      month: ctx.calendar.month,
      maxBriefs: Math.max(emptyDates.length, 3),
      supportedFormats: ['Carousel'],
      optionalPillars: ['discovery', 'credibility', 'trust'],
      planFrom: 'conversationCaptures only — pick the strongest angle(s) the capture supports (usually one); prioritise angles proven by assets; fit every story-aligned provided asset across narrative units; skip weak/obvious/boring angles; do not force Discovery + Credibility + Trust; do not invent facts; capped by maxBriefs',
      requireThemeId: true,
    }),
    CAROUSEL_THEMES_JSON: json(themesForStrategistPrompt()),
    OCCUPIED_TOPICS_JSON: json(ctx.calendar.occupiedTopics || []),
    AUTHORITY_JSON: json(ctx.authority),
    BRAND_JSON: json(ctx.brand),
    COMPETITOR_SIGNALS_JSON: json({
      confidence: ctx.competitor.confidence,
      signals: ctx.competitor.signals,
    }),
    PROJECT_TRUTH_JSON: json(ctx.projects),
    ASSET_CONTEXT_JSON: json(ctx.assetContext || { projectAssets: [] }),
  });
  const strategistPrompt = strategistAssembled.prompt;
  const strategist = await callAgent({
    source: 'Strategist',
    kind: 'strategist',
    system: strategistAssembled.system,
    user: strategistAssembled.user,
    prompt: strategistPrompt,
    validate: (p) => validateStrategist(p),
  });
  debugAgents.push(strategist.debugEntry);
  usages.push(strategist.usage);
  const briefs = enrichBriefsFromCaptures(
    Array.isArray(strategist.parsed.briefs)
      ? strategist.parsed.briefs
      : (strategist.parsed.plannedDays || []),
    ctx.projects?.conversationCaptures,
    { projectsList: projects, assetContext: ctx.assetContext },
  );
  const plannedDays = assignToEmptyDates(briefs, emptyDates);
  strategist.parsed.briefs = briefs;
  strategist.parsed.plannedDays = plannedDays;
  console.log(
    `[planOrchestrator] @${username}: ${briefs.length} briefs → ${plannedDays.length} dated slots` +
      (plannedDays[0]?.date ? ` starting ${plannedDays[0].date}` : '') +
      ` · allocatedAssets=${briefs.reduce((n, b) => n + (b.allocatedAssets || []).length, 0)}` +
      ` · themes=${briefs.map((b) => b.themeId || '?').join(',')}`,
  );
  const brandMemory = ctx.brand || {};
  const brandJson = json(brandMemory);
  const visualBrand = {
    ...brandMemory,
    mood: optionalText(brandMemory.visualStyle),
  };
  const conversationCaptures = Array.isArray(ctx.projects?.conversationCaptures)
    ? ctx.projects.conversationCaptures : [];
  const lastThree = Array.isArray(ctx.projects?.lastThree) ? ctx.projects.lastThree : [];
  const noteCount = lastThree.filter((c) => c.text).length;
  const shownCount = lastThree.reduce((n, c) => n + (c.shown || []).length, 0);
  const latest = conversationCaptures[0]?.captureSummary
    || ctx.projects?.latestCapture?.text
    || '';
  const whyEmpty = String(strategist.parsed.constraints?.insufficientContext || '').trim();

  if (plannedDays.length === 0) {
    console.log(
      `[planOrchestrator] @${username}: strategist planned 0 days` +
        ` · conversationCaptures=${conversationCaptures.length}` +
        ` · lastThree=${noteCount} shownPhotos=${shownCount}` +
        (latest ? ` · latest=${JSON.stringify(String(latest).slice(0, 80))}` : '') +
        (whyEmpty ? ` · insufficientContext=${JSON.stringify(whyEmpty)}` : '') +
        ` — skipping content structure and downstream writers`,
    );
  }

  // ── 2. Content Structure (optional) → Carousel ──────────────────────────
  // When Content Structure is disabled (default), slide outline comes from the
  // Strategist brief's narrative units and Carousel composes HTML from that brief.
  // When enabled, Content Structure still maps units → surfaces first.
  const layoutOn = layoutAgentEnabled();
  const carouselOn = carouselAgentEnabled();
  const structureOn = contentStructureAgentEnabled();
  const writeOneDay = async (planned, index) => {
      const pillar = lockedPillarOf(planned) || planned.pillar;
      const brief = {
        index,
        date: planned.date,
        dayOfMonth: planned.dayOfMonth,
        day: planned.day,
        pillar,
        lens: pillar,
        pillarJob: optionalText(planned.pillarJob) || PILLAR_JOB[pillar] || '',
        source: planned.source || '',
        captureId: planned.captureId || '',
        sourceCaptureId: planned.sourceCaptureId || planned.captureId || '',
        sourceInternalStoryIds: planned.sourceInternalStoryIds || [],
        sourceTrace: planned.sourceTrace || [],
        sourceStoryId: planned.sourceStoryId || '',
        project: planned.project || '',
        originalCapture: planned.originalCapture || '',
        angle: planned.angle || '',
        verifiedTruth: planned.verifiedTruth || [],
        observableDetails: planned.observableDetails || [],
        relevantAssetContext: planned.relevantAssetContext || [],
        allocatedAssets: planned.allocatedAssets || [],
        suggestedAssetKey: planned.suggestedAssetKey || planned.allocatedAssets?.[0]?.key || '',
        visualLimitations: planned.visualLimitations || [],
        uniqueJob: planned.uniqueJob || '',
        audienceTension: planned.audienceTension || '',
        hookTerritory: planned.hookTerritory || '',
        centralFact: planned.centralFact || '',
        ownedTerritory: planned.ownedTerritory || '',
        doNotRepeat: planned.doNotRepeat || '',
        format: lockedFormat(planned.format),
        formatReason: planned.formatReason || '',
        themeId: resolveThemeId(planned.themeId, { pillar }),
        themeReason: optionalText(planned.themeReason),
        narrativeUnits: withUnitIds(planned.narrativeUnits || []),
        approvedGenerationRoute: planned.approvedGenerationRoute || approvedGenerationRouteOf(),
        knownLimitation: planned.knownLimitation || '',
        hashtags: planned.hashtags || [],
        recommendedTime: planned.recommendedTime || '',
      };
      const dayAssets = (() => {
        const rows = assetsForDay(projects, brief);
        if (rows[0]?.key) return rows.map((a, i) => ({ ...a, preferred: i === 0 }));
        return rows;
      })();
      const label = brief.date || brief.day || `D${index + 1}`;
      const debugEntries = [];
      const runUsages = [];
      const collect = (agent) => {
        if (!agent) return;
        debugEntries.push(agent.debugEntry);
        runUsages.push(agent.usage);
      };

      let structure = null;
      if (structureOn) {
        try {
          structure = await writeContentStructure({
            source: `Structure:${label}`,
            brief,
            dayAssets,
            brandJson,
          });
          collect(structure);
        } catch (err) {
          console.warn(`[planOrchestrator] Structure:${label} skipped — ${err.message}`);
          return { index, dayBrief: brief, result: null, skipped: err.message, debugEntries, runUsages, structure: null };
        }

        if (structure.parsed?.status === 'unresolved') {
          const why = optionalText(structure.parsed.limitations?.[0])
            || optionalText(structure.parsed.validation?.problems?.[0]?.detail)
            || optionalText(structure.parsed.structureReason)
            || 'unresolved structure';
          console.warn(`[planOrchestrator] Structure:${label} unresolved — ${why}`);
          return {
            index,
            dayBrief: brief,
            result: null,
            skipped: `structure unresolved: ${why}`,
            debugEntries,
            runUsages,
            structure: structure.parsed,
          };
        }

        if (structure.parsed.format) brief.format = lockedFormat(structure.parsed.format);
        const visualCount = visualSlidesOf(structure.parsed).length;
        console.log(
          `[planOrchestrator] Structure:${label} ${structure.parsed.format}` +
            ` · ${visualCount} visual ${visualCount === 1 ? 'slide' : 'slides'}`,
        );
      } else {
        console.log(
          `[planOrchestrator] Structure:${label} skipped — brief → carousel` +
            ` · ${brief.narrativeUnits.length} narrative unit${brief.narrativeUnits.length === 1 ? '' : 's'}`,
        );
      }

      const writer = {
        parsed: structureOn
          ? postFromStructure(structure.parsed, brief)
          : postFromBrief(brief),
      };
      const layout = carouselAgentEnabled()
        ? await attachCarousel({
          label,
          structure: structure?.parsed || null,
          writer,
          dayBrief: brief,
          dayAssets,
          brand: visualBrand,
          collect,
        })
        : await attachLayout({
          label,
          structure: structure?.parsed || null,
          writer,
          dayBrief: brief,
          dayAssets,
          collect,
        });
      // Compose the day's content here (async), then let the Visual Generator
      // agent fill any slide that needs a picture it has no supplied asset for.
      // Rendering + S3 storage is per-day and concurrent, so it belongs in this
      // pooled worker, not the synchronous assembly below.
      let content = null;
      if (!writerFailed(writer.parsed)) {
        content = applyLayoutToContent(
          normalizeWriterPost(writer.parsed, brief, dayAssets),
          layout?.parsed || null,
        );
        try {
          content = await attachGeneratedVisuals({
            source: label,
            content,
            brief,
            brand: visualBrand,
            userId,
            handle: username,
            collect,
            fillEmpty: visualFillEmptyEnabled(),
          });
        } catch (err) {
          console.warn(`[planOrchestrator] Visual:${label} skipped — ${err.message}`);
        }
      }
      return {
        index,
        dayBrief: brief,
        result: writer,
        layout: layout?.parsed || null,
        content,
        debugEntries,
        runUsages,
        structure: structure?.parsed || null,
        dayAssets,
      };
  };

  const dayResults = await mapPool(plannedDays, dayConcurrency(), (p, i) => writeOneDay(p, i));

  dayResults
    .sort((a, b) => a.index - b.index)
    .forEach(({ debugEntries, runUsages, result }) => {
      (debugEntries || (result ? [result.debugEntry] : [])).forEach((entry) => {
        if (entry) debugAgents.push(entry);
      });
      (runUsages || (result?.usage ? [result.usage] : [])).forEach((u) => {
        if (u) usages.push(u);
      });
    });

  const rawDays = dayResults
    .sort((a, b) => a.index - b.index)
    .map(({ dayBrief, result, skipped, structure, layout, dayAssets, content: precomputed, debugEntries }) => {
      if (!result) {
        console.warn(`[planOrchestrator] @${username}: dropped ${dayBrief.date || dayBrief.day} (${skipped})`);
        return null;
      }
      const parsed = result.parsed || {};
      if (writerFailed(parsed)) {
        console.warn(
          `[planOrchestrator] @${username}: failed ${dayBrief.date || dayBrief.day}` +
            (parsed.failureReason ? ` · ${parsed.failureReason}` : '') +
            (parsed.conflict ? ` · conflict=${JSON.stringify(parsed.conflict)}` : '') +
            (parsed.reason ? ` · ${parsed.reason}` : ''),
        );
        return null;
      }
      // Prefer the content composed (and visually filled) inside writeOneDay;
      // fall back to composing it here if that step produced nothing.
      const content = precomputed || applyLayoutToContent(normalizeWriterPost(parsed, dayBrief, dayAssets), layout);
      if (dayBrief.themeId && !content.themeId) content.themeId = dayBrief.themeId;
      const slides = content.slides;
      const bound = slides.flatMap((s) => [
        s.assetKey,
        s.visual?.assetKey,
      ]).filter(Boolean);
      const alloc = (dayBrief.allocatedAssets || []).map((a) => a.key).filter(Boolean);
      if (alloc.length) {
        console.log(
          `[planOrchestrator] ${dayBrief.date || dayBrief.day}: allocated=${alloc.length} bound=${bound.length}` +
            (bound.length ? ` keys=${bound.length}` : ' (no keys on slides)'),
        );
      }
      const pillar = dayBrief.pillar;
      const format = persistFormat(parsed.format || dayBrief.format);
      const firstTitle = optionalText(parsed.title)
        || optionalText(slides[0]?.title)
        || optionalText(slides[0]?.elements?.[0]?.text);
      const dbg = Array.isArray(debugEntries) ? debugEntries : [];
      const structureDbg = dbg.find((e) => /^Structure:/i.test(String(e?.source || '')));
      const carouselDbg = dbg.find((e) => /^(Carousel|Layout):/i.test(String(e?.source || '')));
      const visualDbg = dbg.filter((e) => /^Visual:/i.test(String(e?.source || '')));
      return {
        day: dayBrief.day,
        date: dayBrief.date,
        dayOfMonth: dayBrief.dayOfMonth,
        time: optionalText(parsed.time) || optionalText(dayBrief.recommendedTime),
        format,
        contentType: parsed.contentType || '',
        pillar,
        goalTag: GOAL_TAG[pillar] || '',
        title: firstTitle,
        direction: parsed.direction || dayBrief.angle || '',
        agentTrace: {
          strategyBrief: strategyBriefPayload(dayBrief),
          strategyPrompt: strategistPrompt,
          themeId: content.themeId || dayBrief.themeId || '',
          structure: structure || null,
          structurePrompt: optionalText(structureDbg?.prompt),
          dayWriter: parsed,
          layout: layout || null,
          layoutPrompt: optionalText(carouselDbg?.prompt),
          carousel: carouselOn ? (layout || null) : null,
          visual: (content && Array.isArray(content.visualTrace) && content.visualTrace.length)
            ? {
              slides: content.visualTrace,
              usage: content.visualUsage || null,
              agents: visualDbg.map((e) => ({
                source: e.source,
                prompt: e.prompt || '',
                output: e.output || '',
              })),
            }
            : null,
        },
        content,
      };
    })
    .filter(Boolean);

  const model = agentModel('strategist');
  const usage = mergeUsage(usages, model);
  const elapsedMs = Date.now() - started;
  usage.elapsedMs = elapsedMs;

  console.log(
      `[planOrchestrator] @${username}: strategist` +
      (structureOn ? '+structure' : '') +
      `+${rawDays.length} days` +
      (carouselOn ? '+carousel' : '') +
      (layoutOn ? '+layout' : '') +
      ` · ${usage.totalTokens} tokens` +
      (usage.cachedTokens ? ` (${usage.cachedTokens} cached)` : '') +
      ` (~$${usage.estimatedCostUsd.toFixed(4)})` +
      ` · ${Math.round(elapsedMs / 100) / 10}s` +
      ` · prompts chars strategist=${strategistPrompt.length}`,
  );

  return {
    focusOut: strategist.parsed.focus || {},
    constraints: strategist.parsed.constraints || {},
    rawDays,
    usage,
    model,
    debug: {
      mode: 'multi-agent',
      model,
      elapsedMs,
      usage,
      // Keep a lead prompt for older clients; full list lives in agents.
      finalPrompt: strategistPrompt,
      agents: debugAgents.map((a) => ({
        source: a.source,
        model: a.model,
        provider: a.provider || '',
        prompt: a.prompt,
        output: a.output || '',
        elapsedMs: Number(a.elapsedMs) || 0,
        usage: a.usage || null,
        inputTokens: Number(a.usage?.inputTokens) || 0,
        outputTokens: Number(a.usage?.outputTokens) || 0,
        totalTokens: Number(a.usage?.totalTokens) || 0,
        estimatedCostUsd: Number(a.usage?.estimatedCostUsd) || 0,
      })),
    },
  };
}

module.exports = {
  runMultiAgentPlan,
  runLayoutForPost,
  writeLayoutVariations,
  applyLayoutToContent,
  normalizeWriterPost,
  attachGeneratedVisuals,
  slideNeedsGeneratedVisual,
  applyVisualToSlide,
  suppliedKeysForSlide,
  bindAssetsToSlide,
};
