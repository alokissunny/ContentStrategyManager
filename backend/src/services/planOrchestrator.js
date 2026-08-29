const fs = require('fs');
const path = require('path');
const { extractJson, estimatePlanCostUsd, assignToEmptyDates, normalizeLens } = require('./weeklyPlan');
const { compileStrategyContext, assetsForDay, allocatedAssetsOf, applyAssetAllocation, knownAssetIndexOf, json } = require('./planContext');
const { completeText, resolvePlanAgentLlm, splitPromptTemplate } = require('./llmComplete');
const { asStoredText, asStoredLines, flattenSlide, layoutForStructure, mediaKeysOf } = require('./slideContent');
const { boxOf, matchSubject, regionFromBox } = require('./subjectBox');
const { layoutById } = require('./layoutCatalog');
const { extractLayoutHtml, hasImageSlot } = require('./layoutHtml');

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
  const user = fillTemplate(userTemplate || raw, vars);
  return {
    system,
    user,
    prompt: [system, user].filter(Boolean).join('\n\n'),
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
    'Annotation',
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

const UI_SCHEMA = {
  slideFields: [
    'role', 'structure', 'title', 'subtitle', 'body', 'items', 'comparisonA', 'comparisonB',
    'stat', 'quote', 'action', 'labels', 'annotation', 'image', 'imagePrompt', 'assetKey',
  ],
  visualFields: [
    'priority', 'role', 'type', 'communicationFunction', 'truthBoundary',
    'execution', 'productionInstruction', 'assetKey', 'imagePrompt',
  ],
  postFields: ['format', 'contentType', 'title', 'direction', 'caption', 'cta', 'hashtags', 'notes'],
};

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
    Post: 'One visual/post surface. Map the strongest core unit to the visual; supporting units go to caption or CTA.',
    Carousel: 'Map complete narrative meaning across slides. Swipe is native. Count follows meaning, not a default length.',
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

function generationSignalsOf(competitor) {
  const signals = {};
  const hook = optionalText((competitor?.hooks || [])[0]);
  const framing = optionalText(
    (competitor?.signals || []).find((s) => !/dominate packaging|hooks are common/i.test(String(s))),
  );
  const presentation = stringList(competitor?.formats).join(', ');
  if (hook) signals.hookPattern = hook;
  if (framing) signals.framingPattern = framing;
  if (presentation) signals.presentationApproach = presentation;
  if (competitor?.confidence) signals.confidence = competitor.confidence;
  return signals;
}

function briefFieldsOf(b) {
  const lens = normalizeLens(b.lens || b.pillar);
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
  if (kind === 'quality') {
    const n = Number(process.env.PLAN_QUALITY_MAX_TOKENS);
    return Number.isFinite(n) && n > 0 ? n : 3072;
  }
  if (kind === 'layout') {
    const n = Number(process.env.PLAN_LAYOUT_MAX_TOKENS);
    return Number.isFinite(n) && n > 0 ? n : 16384;
  }
  const n = Number(process.env.PLAN_DAY_MAX_TOKENS);
  return Number.isFinite(n) && n > 0 ? n : 16384;
}

function qualityAgentEnabled() {
  const v = String(process.env.PLAN_QUALITY_AGENT ?? '0').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

function qualityMaxRewrites() {
  const n = Number(process.env.PLAN_QUALITY_MAX_REWRITES);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

function layoutAgentEnabled() {
  const v = String(process.env.PLAN_LAYOUT_AGENT ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
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

async function callAgent({ source, kind, prompt, system, user, validate }) {
  const llm = resolvePlanAgentLlm(kind);
  const model = llm.model;
  let maxTokens = maxTokensFor(kind);
  const maxAttempts = 2;
  let lastErr;
  const userContent = user || prompt || '';
  const debugPrompt = [system, userContent].filter(Boolean).join('\n\n');

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
      parsed = extractJson(fullText);
    } catch (err) {
      lastErr = err;
      console.warn(`[planOrchestrator] ${source} attempt ${attempt}: JSON parse failed — ${err.message}`);
      continue;
    }

    try {
      if (typeof validate === 'function') validate(parsed);
      if (usage.cachedTokens) {
        console.log(`[planOrchestrator] ${source} cache hit ${usage.cachedTokens}/${usage.inputTokens} input tokens`);
      }
      return { parsed, usage, debugEntry: { ...debugEntry, output: fullText } };
    } catch (err) {
      lastErr = err;
      console.warn(`[planOrchestrator] ${source} attempt ${attempt}: validation failed — ${err.message}`);
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
  parsed.briefs = briefs.map(briefFieldsOf);
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

function validateQuality(parsed) {
  const decision = String(parsed?.decision || '').toUpperCase();
  if (!['APPROVE', 'REVISE', 'REGENERATE'].includes(decision)) {
    throw new Error('missing quality decision');
  }
  parsed.decision = decision;
  const score = Number(parsed.score);
  parsed.score = Number.isFinite(score) ? score : 0;
}

function qualityFeedbackOf(review) {
  if (!review) return { status: 'first_draft' };
  return {
    decision: review.decision,
    score: review.score,
    summary: optionalText(review.summary),
    centralMessage: optionalText(review.centralMessage),
    audienceTakeaway: optionalText(review.audienceTakeaway),
    finalSlideResolution: review.checks?.finalSlideResolution || null,
    issues: Array.isArray(review.issues) ? review.issues.slice(0, 8) : [],
    revisionPriority: stringList(review.revisionPriority).slice(0, 8),
    lockedStructure: 'Slide/scene count, unit mapping, primaryStructure, supporting elements, resolved visual after evidence fallback, and action are locked. Repair copy inside those structures. Do not add, remove, merge, or split slides, or silently drop visual requirements.',
  };
}

function validateDayWriter(parsed) {
  const status = String(parsed?.status || '').toLowerCase();
  if (status === 'cannot_generate' || status === 'failed') {
    parsed.status = 'failed';
    parsed.failureReason = optionalText(parsed.failureReason || parsed.reason || parsed.conflict);
    return;
  }
  if (!parsed?.content || typeof parsed.content !== 'object') throw new Error('missing content');
  parsed.status = status || 'ready';
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

function bindAllocatedAssets(slides, dayBrief) {
  const allocated = allocatedAssetsOf(dayBrief?.allocatedAssets).map((a) => a.key).filter(Boolean);
  if (!Array.isArray(slides) || !slides.length || !allocated.length) return slides;
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
    const existing = optionalText(s.assetKey) || optionalText(s.visual?.assetKey);
    if (existing) {
      claim(existing);
      return { ...s, assetKey: existing, layout: photoLayoutOf(s) };
    }
    const priority = String(s?.visual?.priority || '').toLowerCase();
    const type = optionalText(s?.visual?.type);
    const wants = (priority && priority !== 'none') || isSourceVisualType(type);
    if (!wants || !isSourceVisualType(type)) return s;
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
  const existing = boxOf(annotation.targetBox);
  if (existing) return { ...annotation, targetBox: existing };
  const keys = mediaKeysOf(slide?.assetKey, slide?.visual?.assetKey, slide?.assetKeys, slide?.visual?.assetKeys);
  const assets = Array.isArray(dayAssets) ? dayAssets : [];
  const asset = assets.find((a) => keys.includes(a.key))
    || assets.find((a) => a.preferred)
    || assets[0];
  const hit = matchSubject(asset?.subjects, annotation.targetSubject || annotation.text);
  if (!hit?.box) return annotation;
  const region = optionalText(annotation.targetRegion).toLowerCase();
  return {
    ...annotation,
    targetBox: hit.box,
    targetRegion: (region && region !== 'center') ? region : (regionFromBox(hit.box) || region || 'center'),
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
      annotation: flat.annotation || null,
      visual,
    };
  }) : [], dayBrief);
  content.slides = slides.map((s) => ({
    ...s,
    annotation: attachAnnotationBox(s.annotation, s, dayAssets),
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
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_CLOUD_PROJECT) return 'generate';
  return 'assets-only';
}

function visualPlanOf(visual, resolution) {
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
  return {
    priority,
    role: priority === 'none' ? 'none' : role,
    type: priority === 'none' ? 'none' : type,
    communicationFunction: optionalText(raw.communicationFunction),
    truthBoundary: optionalText(raw.truthBoundary),
    noneReason: optionalText(raw.noneReason),
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

function validateContentStructure(parsed) {
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
    const primary = normalizeStructureType(s?.primaryStructure);
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
      evidenceAvailability: evidenceAvailabilityOf(s?.evidenceAvailability),
      evidenceResolution,
      informationShape: optionalText(s?.informationShape),
      primaryStructure: primary,
      supportingElements: supporting.map((el) => ({
        type: normalizeStructureType(el?.type),
        function: optionalText(el?.function),
        supportReference: stringList(el?.supportReference).length
          ? stringList(el.supportReference)
          : (optionalText(el?.supportReference) ? [optionalText(el.supportReference)] : []),
        ...(optionalText(el?.targetSubject) ? { targetSubject: optionalText(el.targetSubject) } : {}),
      })).filter((el) => el.type && AVAILABLE_ELEMENT_SET.has(el.type) && el.type !== primary),
      selectionReason: optionalText(s?.selectionReason),
      contentGuidance: optionalText(s?.contentGuidance),
      visual: visualPlanOf(visual, evidenceResolution),
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

function strategyBriefPayload(brief) {
  return {
    date: brief.date,
    day: brief.day,
    pillar: brief.pillar,
    lens: brief.lens,
    pillarJob: brief.pillarJob,
    source: brief.source,
    captureId: brief.captureId,
    sourceCaptureId: brief.sourceCaptureId || brief.captureId,
    sourceInternalStoryIds: brief.sourceInternalStoryIds || [],
    sourceTrace: brief.sourceTrace || [],
    sourceStoryId: brief.sourceStoryId,
    project: brief.project,
    originalCapture: brief.originalCapture,
    angle: brief.angle,
    verifiedTruth: brief.verifiedTruth,
    observableDetails: brief.observableDetails,
    relevantAssetContext: brief.relevantAssetContext,
    allocatedAssets: brief.allocatedAssets || [],
    visualLimitations: brief.visualLimitations,
    uniqueJob: brief.uniqueJob,
    audienceTension: brief.audienceTension,
    hookTerritory: brief.hookTerritory,
    centralFact: brief.centralFact,
    ownedTerritory: brief.ownedTerritory,
    doNotRepeat: brief.doNotRepeat,
    format: brief.format,
    formatReason: brief.formatReason,
    narrativeUnits: brief.narrativeUnits,
    knownLimitation: brief.knownLimitation,
  };
}

async function writeContentStructure({ source, brief, dayAssets }) {
  const visuals = Array.isArray(dayAssets) ? dayAssets.slice(0, 6) : [];
  const assembled = assembleAgentPrompt('plan-content-structure.md', {
    AVAILABLE_ELEMENTS_JSON: json(AVAILABLE_ELEMENTS),
    STRATEGIST_BRIEF_JSON: json(strategyBriefPayload(brief)),
    ALLOCATED_VISUALS_JSON: json(visuals),
    PLATFORM_CONSTRAINTS_JSON: json(platformConstraintsOf(brief.format)),
  });
  return callAgent({
    source,
    kind: 'structure',
    system: assembled.system,
    user: assembled.user,
    prompt: assembled.prompt,
    validate: validateContentStructure,
  });
}

async function writeDayPost({
  source, brief, constraintsJson, dayAssets, generationSignalsJson, authorityFocusJson, brandJson, qualityFeedback,
  structureJson,
}) {
  const assembled = assembleAgentPrompt('plan-day-writer.md', {
    DAY_JSON: json(brief),
    STRUCTURE_JSON: structureJson || json({}),
    CONSTRAINTS_JSON: constraintsJson,
    DAY_ASSETS: json(dayAssets),
    GENERATION_SIGNALS_JSON: generationSignalsJson,
    AUTHORITY_FOCUS_JSON: authorityFocusJson,
    BRAND_JSON: brandJson || json({}),
    PLATFORM_CONSTRAINTS_JSON: json(platformConstraintsOf(brief.format)),
    UI_SCHEMA_JSON: json(UI_SCHEMA),
    QUALITY_FEEDBACK_JSON: json(qualityFeedback || { status: 'first_draft' }),
  });
  return callAgent({
    source,
    kind: 'day',
    system: assembled.system,
    user: assembled.user,
    prompt: assembled.prompt,
    validate: validateDayWriter,
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
  ];
  if (keys.some(Boolean)) return true;
  const image = raw?.image;
  if (image && typeof image === 'object' && (optionalText(image.key) || optionalText(image.url))) return true;
  return false;
}

function filledElementTypes(flat, visual) {
  const types = [];
  const add = (type) => {
    const name = optionalText(type);
    if (name && !types.includes(name)) types.push(name);
  };
  if (optionalText(flat.title)) add('Title');
  if (optionalText(flat.subtitle)) add('Subtitle');
  if (optionalText(flat.body)) add('Body');
  if ((flat.items || []).length) add('List');
  if (optionalText(flat.comparisonA) && optionalText(flat.comparisonB)) add('Comparison');
  if (optionalText(flat.stat)) add('Number_Stat');
  if (optionalText(flat.quote)) add('Quote');
  if (optionalText(flat.action)) add('Action');
  const priority = String(visual?.priority || '').toLowerCase();
  const type = optionalText(visual?.type);
  if (visual?.hasAsset || (priority && priority !== 'none')) add(type && type !== 'none' ? type : 'Image');
  if (optionalText(flat?.annotation?.text || flat?.annotation)) add('Annotation');
  return types;
}

function photographHintOf(assetKey, dayBrief) {
  const key = optionalText(assetKey);
  if (!key) return null;
  const asset = allocatedAssetsOf(dayBrief?.allocatedAssets).find((a) => optionalText(a?.key) === key) || {};
  const hint = {
    assigned: true,
    visibleContent: optionalText(asset.visibleContent),
    why: optionalText(asset.why),
    evidenceLevel: optionalText(asset.evidenceLevel),
  };
  if (!hint.visibleContent && !hint.why && !hint.evidenceLevel) return { assigned: true };
  return hint;
}

function layoutVisualOf(visual, hasAsset, assetKey, photograph) {
  const none = (value) => !optionalText(value) || optionalText(value).toLowerCase() === 'none';
  if (hasAsset) {
    return {
      priority: none(visual?.priority) ? 'recommended' : optionalText(visual.priority),
      role: none(visual?.role) ? 'recognition' : optionalText(visual.role),
      type: none(visual?.type) ? 'Image' : optionalText(visual.type),
      execution: optionalText(visual?.execution) || 'supplied-asset',
      productionInstruction: optionalText(visual?.productionInstruction),
      hasAsset: true,
      assetKey: optionalText(assetKey) || optionalText(visual?.assetKey),
      photograph: photograph || { assigned: true },
    };
  }
  return {
    priority: optionalText(visual?.priority) || 'none',
    role: optionalText(visual?.role) || 'none',
    type: optionalText(visual?.type) || 'none',
    execution: optionalText(visual?.execution),
    productionInstruction: optionalText(visual?.productionInstruction),
    hasAsset: false,
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
      supportingElements: (s?.supportingElements || []).map((el) => optionalText(el?.type || el)).filter(Boolean),
    })),
  };
}

function wordCount(value) {
  return optionalText(value).split(/\s+/).filter(Boolean).length;
}

function copyMetricsOf(flat) {
  return {
    titleWords: wordCount(flat?.title),
    titleChars: optionalText(flat?.title).length,
    bodyChars: optionalText(flat?.body).length,
  };
}

function compositionNoteOf(flat, visual) {
  const titleWords = wordCount(flat?.title);
  const hasAnnote = optionalText(flat?.annotation?.text || flat?.annotation);
  if (visual?.hasAsset && hasAnnote) {
    return 'Photograph with a subject callout: handwritten label + curved arrow on the photo, pointing at the named subject. Keep the label off the title band and off the subject.';
  }
  if (visual?.hasAsset && titleWords >= 12) {
    return 'Long title on a photograph: bottom band + light type + scrim, or a split. Do not put dark type over the photo. Keep the room visible.';
  }
  if (visual?.hasAsset) {
    return 'A real photograph will be injected into img[data-slot=image]. Include that img. Compose around the photo. Do not invent shapes, bars, or a black void instead of the photograph.';
  }
  return 'No photograph. Text on #f4f1ec. Do not use a black ground.';
}

function layoutInputOf(post, structure, dayBrief) {
  const slides = Array.isArray(post?.content?.slides) ? post.content.slides : [];
  return {
    format: lockedFormat(post?.format),
    slides: slides.map((raw, i) => {
      const index = Number(raw?.index) > 0 ? Number(raw.index) : i + 1;
      const structured = structureSlideOf(structure, index);
      const flat = flattenSlide(raw);
      const hasAsset = slideHasAsset(raw, flat, raw?.visual || flat.visual);
      const assetKey = optionalText(flat.assetKey) || optionalText(raw?.assetKey) || optionalText(raw?.visual?.assetKey);
      const visual = layoutVisualOf(
        raw?.visual && typeof raw.visual === 'object' ? raw.visual : (flat.visual || {}),
        hasAsset,
        assetKey,
        hasAsset ? photographHintOf(assetKey, dayBrief) : null,
      );
      return {
        index,
        role: optionalText(flat.role || structured?.role) || 'other',
        purpose: optionalText(structured?.purpose),
        primaryStructure: optionalText(structured?.primaryStructure || flat.structure),
        supportingElements: (structured?.supportingElements || []).map((el) => optionalText(el?.type)).filter(Boolean),
        contentStructure: filledElementTypes(flat, visual),
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
          annotation: flat.annotation && optionalText(flat.annotation.text)
            ? {
              text: optionalText(flat.annotation.text),
              targetSubject: optionalText(flat.annotation.targetSubject),
              targetRegion: optionalText(flat.annotation.targetRegion) || 'center',
              ...(flat.annotation.targetBox ? { targetBox: flat.annotation.targetBox } : {}),
            }
            : null,
        },
        copyMetrics: copyMetricsOf(flat),
        compositionNote: compositionNoteOf(flat, visual),
        visual,
        evidenceResolution: optionalText(raw?.evidenceResolution?.type || structured?.evidenceResolution?.type),
      };
    }),
  };
}

function validateLayout(parsed, post) {
  const status = String(parsed?.status || '').toLowerCase();
  const incoming = Array.isArray(parsed?.slides) ? parsed.slides : [];
  const hasHtml = incoming.some((s) => extractLayoutHtml(s?.html || s?.layoutHtml || ''));
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
    const html = extractLayoutHtml(s?.html || s?.layoutHtml || '');
    if (!html) throw new Error(`slide ${s?.index || i + 1} missing layout html`);
    const raw = Array.isArray(post?.content?.slides) ? (post.content.slides[i] || {}) : {};
    const flat = flattenSlide(raw);
    if (slideHasAsset(raw, flat, raw?.visual || flat.visual) && !hasImageSlot(html)) {
      throw new Error(`slide ${s?.index || i + 1} missing img[data-slot=image] for assigned photograph`);
    }
    const hierarchy = s?.visualHierarchy && typeof s.visualHierarchy === 'object' ? s.visualHierarchy : {};
    return {
      index: Number(s?.index) > 0 ? Number(s.index) : i + 1,
      role: optionalText(s?.role),
      contentStructure: stringList(s?.contentStructure),
      layoutIntent: optionalText(s?.layoutIntent),
      visualHierarchy: {
        primary: optionalText(hierarchy.primary),
        secondary: stringList(hierarchy.secondary),
        supporting: stringList(hierarchy.supporting),
      },
      arrangement: stringList(s?.arrangement),
      html,
      reason: optionalText(s?.reason),
    };
  });
}

function applyLayoutToContent(content, layoutParsed) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const plans = layoutParsed?.status === 'ready' ? (layoutParsed.slides || []) : [];
  if (!slides.length || !plans.length) return content;
  const byIndex = new Map(plans.map((s) => [Number(s.index), s]));
  content.slides = slides.map((raw, i) => {
    const index = Number(raw?.index) > 0 ? Number(raw.index) : i + 1;
    const plan = byIndex.get(index);
    const html = extractLayoutHtml(plan?.html);
    if (!html) {
      const flat = flattenSlide(raw);
      return { ...raw, layout: optionalText(raw.layout) || layoutForStructure(flat) || '' };
    }
    return { ...raw, layout: 'dynamic', layoutHtml: html };
  });
  return content;
}

async function writeLayout({ source, structure, post, dayBrief }) {
  const assembled = assembleAgentPrompt('plan-layout.md', {
    STRUCTURE_JSON: json(layoutStructureOf(structure)),
    POST_JSON: json(layoutInputOf(post, structure, dayBrief)),
  });
  return callAgent({
    source,
    kind: 'layout',
    system: assembled.system,
    user: assembled.user,
    prompt: assembled.prompt,
    validate: (parsed) => validateLayout(parsed, post),
  });
}

function runLayoutForPost(opts) {
  return writeLayout(opts);
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
    collect(layout);
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

async function reviewDayPost({ source, brief, post, structure }) {
  const assembled = assembleAgentPrompt('plan-quality.md', {
    BRIEF_JSON: json({
      pillar: brief.pillar,
      lens: brief.lens,
      pillarJob: brief.pillarJob,
      format: brief.format,
      angle: brief.angle,
      uniqueJob: brief.uniqueJob,
      verifiedTruth: brief.verifiedTruth,
      observableDetails: brief.observableDetails,
      relevantAssetContext: brief.relevantAssetContext,
      visualLimitations: brief.visualLimitations,
      narrativeUnits: brief.narrativeUnits,
      audienceTension: brief.audienceTension,
      hookTerritory: brief.hookTerritory,
      centralFact: brief.centralFact,
      ownedTerritory: brief.ownedTerritory,
      doNotRepeat: brief.doNotRepeat,
      knownLimitation: brief.knownLimitation,
      sourceStoryId: brief.sourceStoryId,
    }),
    STRUCTURE_JSON: json(structure || {}),
    POST_JSON: json(post),
  });
  return callAgent({
    source,
    kind: 'quality',
    system: assembled.system,
    user: assembled.user,
    prompt: assembled.prompt,
    validate: validateQuality,
  });
}

/**
 * Multi-agent plan: Strategist → Content Structure → Day Writer → Quality → Layout
 * (only for empty month days the strategist grounded in notes/assets).
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
}) {
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

  console.log(
    `[planOrchestrator] multi-agent plan for @${username} · focus=${ctx.authority.priority}` +
      ` · emptyMonthDays=${emptyDates.length}` +
      ` · conversationCaptures=${(ctx.projects?.conversationCaptures || []).length}` +
      ` · captureAssets=${(ctx.projects?.conversationCaptures || []).reduce((n, c) => n + (c.assets || []).length, 0)}` +
      ` · projectAssets=${(ctx.assetContext?.projectAssets || []).reduce((n, r) => n + (r.assets || []).length, 0)}` +
      (sessionId ? ` · session=${sessionId}` : '') +
      ` · brand=${ctx.versions.brand} · competitor=${ctx.versions.competitor}`,
  );

  // ── 1. Strategist ────────────────────────────────────────────────────────
  const strategistAssembled = assembleAgentPrompt('plan-strategist.md', {
    LIMITS_JSON: json({
      month: ctx.calendar.month,
      maxBriefs: Math.max(emptyDates.length, 1),
      supportedFormats: WRITER_FORMATS,
      planFrom: (sessionId || (captureIds && captureIds.length))
        ? 'this conversation session only — conversationCaptures and attached/project visuals from that sitting; decide whether internal stories become one post or several, capped by maxBriefs'
        : 'latest chat session only — every conversationCaptures item from that sitting, plus conversation-attached and same-project library visuals; decide whether internal stories become one post or several, capped by maxBriefs',
    }),
    OCCUPIED_TOPICS_JSON: json(ctx.calendar.occupiedTopics || []),
    AUTHORITY_JSON: json(ctx.authority),
    BRAND_JSON: json({
      audience: ctx.brand.audience,
      position: ctx.brand.position,
      offer: ctx.brand.offer,
      voice: ctx.brand.voice,
      guardrails: ctx.brand.guardrails,
    }),
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
      ` · allocatedAssets=${briefs.reduce((n, b) => n + (b.allocatedAssets || []).length, 0)}`,
  );
  const constraintsJson = json({
    mustUseProjects: strategist.parsed.constraints?.mustUseProjects || [],
    voiceNotes: strategist.parsed.constraints?.voiceNotes || [],
    avoid: strategist.parsed.constraints?.avoid || [],
  });
  const generationSignalsJson = json(generationSignalsOf(ctx.competitor));
  const brandJson = json(ctx.brandVoice || ctx.brand || {});
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
        ` — skipping content structure and day writers`,
    );
  }

  // ── 2. Content Structure → Day writers + Quality + Layout ─────────────────
  // First brief primes the provider prompt cache for Structure then Day Writer;
  // the rest run in parallel so they reuse the same system instructions.
  const gateOn = qualityAgentEnabled();
  const maxRewrites = qualityMaxRewrites();
  const layoutOn = layoutAgentEnabled();
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
      const writerOpts = {
        brief,
        constraintsJson,
        dayAssets,
        generationSignalsJson,
        authorityFocusJson: json({
          lockedLens: pillar,
          lockedPillar: pillar,
          pillarJob: optionalText(planned.pillarJob) || PILLAR_JOB[pillar] || '',
          accountPriority: ctx.authority.priority,
          objective: optionalText(strategist.parsed.focus?.objective),
          headline: optionalText(strategist.parsed.focus?.headline),
        }),
        brandJson,
      };
      const debugEntries = [];
      const runUsages = [];
      const collect = (agent) => {
        if (!agent) return;
        debugEntries.push(agent.debugEntry);
        runUsages.push(agent.usage);
      };

      let structure;
      try {
        structure = await writeContentStructure({
          source: `Structure:${label}`,
          brief,
          dayAssets,
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

      writerOpts.structureJson = json(structure.parsed);
      const visualCount = visualSlidesOf(structure.parsed).length;
      console.log(
        `[planOrchestrator] Structure:${label} ${structure.parsed.format}` +
          ` · ${visualCount} visual ${visualCount === 1 ? 'slide' : 'slides'}`,
      );

      let writer;
      try {
        writer = await writeDayPost({
          ...writerOpts,
          source: `Day:${label}`,
          qualityFeedback: { status: 'first_draft' },
        });
        collect(writer);
      } catch (err) {
        console.warn(`[planOrchestrator] Day:${label} skipped — ${err.message}`);
        return { index, dayBrief: brief, result: null, skipped: err.message, debugEntries, runUsages, structure: structure.parsed };
      }

      const finishDay = async (finalWriter, quality = null) => {
        const layout = await attachLayout({
          label,
          structure: structure.parsed,
          writer: finalWriter,
          dayBrief: brief,
          dayAssets,
          collect,
        });
        return {
          index,
          dayBrief: brief,
          result: finalWriter,
          quality,
          layout: layout?.parsed || null,
          debugEntries,
          runUsages,
          structure: structure.parsed,
          dayAssets,
        };
      };

      if (writerFailed(writer.parsed)) {
        return { index, dayBrief: brief, result: writer, quality: null, layout: null, debugEntries, runUsages, structure: structure.parsed };
      }

      if (!gateOn) {
        return finishDay(writer);
      }

      let review;
      try {
        review = await reviewDayPost({
          source: `Quality:${label}`,
          brief,
          post: writer.parsed,
          structure: structure.parsed,
        });
        collect(review);
      } catch (err) {
        console.warn(`[planOrchestrator] Quality:${label} skipped — ${err.message}`);
        return finishDay(writer);
      }

      let rewrites = 0;
      while (review.parsed.decision !== 'APPROVE' && rewrites < maxRewrites) {
        rewrites += 1;
        const pass = review.parsed.decision === 'REGENERATE' ? 'regen' : 'revise';
        try {
          writer = await writeDayPost({
            ...writerOpts,
            source: `Day:${label}:${pass}${rewrites}`,
            qualityFeedback: qualityFeedbackOf(review.parsed),
          });
          collect(writer);
        } catch (err) {
          console.warn(`[planOrchestrator] Day:${label}:${pass}${rewrites} skipped — ${err.message}`);
          break;
        }
        if (writerFailed(writer.parsed)) {
          return { index, dayBrief: brief, result: writer, quality: review.parsed, debugEntries, runUsages, structure: structure.parsed };
        }
        try {
          review = await reviewDayPost({
            source: `Quality:${label}:${pass}${rewrites}`,
            brief,
            post: writer.parsed,
            structure: structure.parsed,
          });
          collect(review);
        } catch (err) {
          console.warn(`[planOrchestrator] Quality:${label}:${pass}${rewrites} skipped — ${err.message}`);
          break;
        }
      }

      const decision = review?.parsed?.decision || '';
      console.log(
        `[planOrchestrator] Quality:${label} ${decision || 'n/a'}` +
          (review?.parsed ? ` score=${review.parsed.score}` : '') +
          (rewrites ? ` rewrites=${rewrites}` : ''),
      );
      if (decision === 'REGENERATE') {
        return {
          index,
          dayBrief: brief,
          result: null,
          quality: review.parsed,
          layout: null,
          skipped: `quality ${decision} score=${review.parsed.score}`,
          debugEntries,
          runUsages,
          structure: structure.parsed,
        };
      }
      return finishDay(writer, review?.parsed || null);
  };

  let dayResults = [];
  if (plannedDays.length === 1) {
    dayResults = [await writeOneDay(plannedDays[0], 0)];
  } else if (plannedDays.length > 1) {
    const first = await writeOneDay(plannedDays[0], 0);
    const rest = await Promise.all(plannedDays.slice(1).map((p, i) => writeOneDay(p, i + 1)));
    dayResults = [first, ...rest];
  }

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
    .map(({ dayBrief, result, skipped, structure, layout, dayAssets }) => {
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
      const content = applyLayoutToContent(normalizeWriterPost(parsed, dayBrief, dayAssets), layout);
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
          structure: structure || null,
          dayWriter: parsed,
          layout: layout || null,
        },
        content,
      };
    })
    .filter(Boolean);

  const model = agentModel('strategist');
  const usage = mergeUsage(usages, model);

  console.log(
      `[planOrchestrator] @${username}: strategist+structure+${rawDays.length} days` +
      (gateOn ? '+quality' : '') +
      (layoutOn ? '+layout' : '') +
      ` · ${usage.totalTokens} tokens` +
      (usage.cachedTokens ? ` (${usage.cachedTokens} cached)` : '') +
      ` (~$${usage.estimatedCostUsd.toFixed(4)})` +
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
      // Keep a lead prompt for older clients; full list lives in agents.
      finalPrompt: strategistPrompt,
      agents: debugAgents.map((a) => ({
        source: a.source,
        model: a.model,
        provider: a.provider || '',
        prompt: a.prompt,
        output: a.output || '',
      })),
    },
  };
}

module.exports = { runMultiAgentPlan, runLayoutForPost, applyLayoutToContent };
