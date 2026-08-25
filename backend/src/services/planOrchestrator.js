const fs = require('fs');
const path = require('path');
const { extractJson, estimatePlanCostUsd, assignToEmptyDates, normalizeLens } = require('./weeklyPlan');
const { compileStrategyContext, assetsForDay, json } = require('./planContext');
const { completeText, planTextModel, splitPromptTemplate } = require('./llmComplete');

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
  return planTextModel(kind);
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

function stringList(value) {
  return Array.isArray(value) ? value.map((x) => String(x || '').trim()).filter(Boolean) : [];
}

function optionalText(value) {
  return String(value || '').trim();
}

function optionalTextOrList(value) {
  if (Array.isArray(value)) return stringList(value);
  return optionalText(value);
}

function narrativeUnitsOf(brief) {
  if (!Array.isArray(brief?.narrativeUnits)) return [];
  return brief.narrativeUnits.map((u) => {
    const unit = {
      role: String(u?.role || '').trim(),
      purpose: String(u?.purpose || '').trim(),
      support: String(u?.support || '').trim(),
    };
    const placement = String(u?.placement || '').trim().toLowerCase();
    if (['visual', 'caption', 'cta'].includes(placement)) unit.placement = placement;
    return unit;
  }).filter((u) => u.purpose || u.support || u.role);
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
    sourceStoryId: optionalText(b.sourceStoryId),
    angle: b.angle || '',
    verifiedTruth: stringList(b.verifiedTruth),
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
    ...(lens ? { lens, pillar: lens } : {}),
  };
}

function maxTokensFor(kind) {
  if (kind === 'strategist') {
    const n = Number(process.env.PLAN_STRATEGIST_MAX_TOKENS);
    return Number.isFinite(n) && n > 0 ? n : 32000;
  }
  if (kind === 'quality') {
    const n = Number(process.env.PLAN_QUALITY_MAX_TOKENS);
    return Number.isFinite(n) && n > 0 ? n : 3072;
  }
  const n = Number(process.env.PLAN_DAY_MAX_TOKENS);
  return Number.isFinite(n) && n > 0 ? n : 8192;
}

function qualityAgentEnabled() {
  const v = String(process.env.PLAN_QUALITY_AGENT ?? '0').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

function qualityMaxRewrites() {
  const n = Number(process.env.PLAN_QUALITY_MAX_REWRITES);
  return Number.isFinite(n) && n >= 0 ? n : 1;
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
  const model = agentModel(kind);
  let maxTokens = maxTokensFor(kind);
  const maxAttempts = 2;
  let lastErr;
  const userContent = user || prompt || '';
  const debugPrompt = [system, userContent].filter(Boolean).join('\n\n');

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
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
    const debugEntry = { source, model, prompt: debugPrompt, kind };

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
  const ids = [brief?.captureId, brief?.sourceStoryId]
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

function enrichBriefsFromCaptures(briefs, conversationCaptures) {
  return (briefs || []).map((b) => {
    const src = captureByBriefId(conversationCaptures, b);
    if (!src) return b;
    return {
      ...b,
      captureId: b.captureId || src.id || src.captureId,
      sourceStoryId: b.sourceStoryId || src.sourceStoryId,
      knownLimitation: b.knownLimitation || src.knownLimitation,
    };
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
  };
}

function validateDayWriter(parsed) {
  if (parsed?.status === 'cannot_generate') return;
  if (!parsed?.content || typeof parsed.content !== 'object') throw new Error('missing content');
}

async function writeDayPost({
  source, brief, constraintsJson, dayAssets, generationSignalsJson, authorityFocusJson, brandJson, qualityFeedback,
}) {
  const assembled = assembleAgentPrompt('plan-day-writer.md', {
    DAY_JSON: json(brief),
    CONSTRAINTS_JSON: constraintsJson,
    DAY_ASSETS: json(dayAssets),
    GENERATION_SIGNALS_JSON: generationSignalsJson,
    AUTHORITY_FOCUS_JSON: authorityFocusJson,
    BRAND_JSON: brandJson || json({}),
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

async function reviewDayPost({ source, brief, post }) {
  const assembled = assembleAgentPrompt('plan-quality.md', {
    BRIEF_JSON: json({
      pillar: brief.pillar,
      lens: brief.lens,
      pillarJob: brief.pillarJob,
      format: brief.format,
      angle: brief.angle,
      uniqueJob: brief.uniqueJob,
      verifiedTruth: brief.verifiedTruth,
      narrativeUnits: brief.narrativeUnits,
      audienceTension: brief.audienceTension,
      hookTerritory: brief.hookTerritory,
      centralFact: brief.centralFact,
      ownedTerritory: brief.ownedTerritory,
      doNotRepeat: brief.doNotRepeat,
      knownLimitation: brief.knownLimitation,
      sourceStoryId: brief.sourceStoryId,
    }),
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
 * Multi-agent plan: Strategist → parallel Day writers → Quality gate
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
}) {
  const username = profile?.username || '?';
  const ctx = compileStrategyContext({
    brandDna,
    competitorInsights,
    projects,
    focusSummary,
    monthCalendar,
  });
  const emptyDates = Array.isArray(ctx.calendar.emptyDates) ? ctx.calendar.emptyDates : [];
  const debugAgents = [];
  const usages = [];

  console.log(
    `[planOrchestrator] multi-agent plan for @${username} · focus=${ctx.authority.priority}` +
      ` · emptyMonthDays=${emptyDates.length}` +
      ` · conversationCaptures=${(ctx.projects?.conversationCaptures || []).length}` +
      ` · brand=${ctx.versions.brand} · competitor=${ctx.versions.competitor}`,
  );

  // ── 1. Strategist ────────────────────────────────────────────────────────
  const strategistAssembled = assembleAgentPrompt('plan-strategist.md', {
    LIMITS_JSON: json({
      month: ctx.calendar.month,
      planFrom: 'latest chat session only — every conversationCaptures item from that sitting; produce Discovery, Credibility, and Trust briefs per capture when genuinely supported',
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
  );
  const plannedDays = assignToEmptyDates(briefs, emptyDates);
  strategist.parsed.briefs = briefs;
  strategist.parsed.plannedDays = plannedDays;
  console.log(
    `[planOrchestrator] @${username}: ${briefs.length} briefs → ${plannedDays.length} dated slots` +
      (plannedDays[0]?.date ? ` starting ${plannedDays[0].date}` : ''),
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
    || conversationCaptures[0]?.whatHappened
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
        ` — skipping day writers`,
    );
  }

  // ── 2. Day writers + Quality gate ────────────────────────────────────────
  // First Day Writer primes the provider prompt cache; the rest run in parallel
  // so they reuse the same system instructions at cached-input rates.
  const gateOn = qualityAgentEnabled();
  const maxRewrites = qualityMaxRewrites();
  const writeOneDay = async (planned, index) => {
      const pillar = lockedPillarOf(planned) || planned.pillar;
      const brief = {
        index,
        date: planned.date,
        dayOfMonth: planned.dayOfMonth,
        day: planned.day,
        pillar,
        lens: pillar,
        pillarJob: PILLAR_JOB[pillar] || '',
        source: planned.source || '',
        captureId: planned.captureId || '',
        sourceStoryId: planned.sourceStoryId || '',
        angle: planned.angle || '',
        verifiedTruth: planned.verifiedTruth || [],
        uniqueJob: planned.uniqueJob || '',
        audienceTension: planned.audienceTension || '',
        hookTerritory: planned.hookTerritory || '',
        centralFact: planned.centralFact || '',
        ownedTerritory: planned.ownedTerritory || '',
        doNotRepeat: planned.doNotRepeat || '',
        format: lockedFormat(planned.format),
        formatReason: planned.formatReason || '',
        narrativeUnits: planned.narrativeUnits || [],
        approvedGenerationRoute: planned.approvedGenerationRoute || '',
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
          pillarJob: PILLAR_JOB[pillar] || '',
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
        return { index, dayBrief: brief, result: null, skipped: err.message, debugEntries, runUsages };
      }

      if (writer.parsed?.status === 'cannot_generate') {
        return { index, dayBrief: brief, result: writer, quality: null, debugEntries, runUsages };
      }

      if (!gateOn) {
        return { index, dayBrief: brief, result: writer, quality: null, debugEntries, runUsages };
      }

      let review;
      try {
        review = await reviewDayPost({
          source: `Quality:${label}`,
          brief,
          post: writer.parsed,
        });
        collect(review);
      } catch (err) {
        console.warn(`[planOrchestrator] Quality:${label} skipped — ${err.message}`);
        return { index, dayBrief: brief, result: writer, quality: null, debugEntries, runUsages };
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
        if (writer.parsed?.status === 'cannot_generate') {
          return { index, dayBrief: brief, result: writer, quality: review.parsed, debugEntries, runUsages };
        }
        try {
          review = await reviewDayPost({
            source: `Quality:${label}:${pass}${rewrites}`,
            brief,
            post: writer.parsed,
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
          skipped: `quality ${decision} score=${review.parsed.score}`,
          debugEntries,
          runUsages,
        };
      }
      return { index, dayBrief: brief, result: writer, quality: review?.parsed || null, debugEntries, runUsages };
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
    .map(({ dayBrief, result, skipped }) => {
      if (!result) {
        console.warn(`[planOrchestrator] @${username}: dropped ${dayBrief.date || dayBrief.day} (${skipped})`);
        return null;
      }
      const parsed = result.parsed || {};
      if (parsed.status === 'cannot_generate') {
        console.warn(
          `[planOrchestrator] @${username}: cannot_generate ${dayBrief.date || dayBrief.day}` +
            (parsed.conflict ? ` · conflict=${JSON.stringify(parsed.conflict)}` : '') +
            (parsed.reason ? ` · ${parsed.reason}` : ''),
        );
        return null;
      }
      const content = { ...(parsed.content || {}) };
      const slides = Array.isArray(content.slides) ? content.slides.map((s) => ({ ...s })) : [];
      content.slides = slides;
      content.strategy = content.executionRationale || content.strategy || '';
      content.prompts = Array.isArray(content.productionNeeds)
        ? content.productionNeeds
        : (Array.isArray(content.prompts) ? content.prompts : []);
      content.hashtags = stringList(dayBrief.hashtags);
      const pillar = dayBrief.pillar;
      const format = persistFormat(parsed.format || dayBrief.format);
      return {
        day: dayBrief.day,
        date: dayBrief.date,
        dayOfMonth: dayBrief.dayOfMonth,
        time: optionalText(dayBrief.recommendedTime),
        format,
        contentType: parsed.contentType || '',
        pillar,
        goalTag: GOAL_TAG[pillar] || '',
        title: parsed.title || slides[0]?.title || '',
        direction: parsed.direction || dayBrief.angle || '',
        content,
      };
    })
    .filter(Boolean);

  const model = agentModel('strategist');
  const usage = mergeUsage(usages, model);

  console.log(
    `[planOrchestrator] @${username}: strategist+${rawDays.length} days` +
      (gateOn ? '+quality' : '') +
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
        prompt: a.prompt,
        output: a.output || '',
      })),
    },
  };
}

module.exports = { runMultiAgentPlan };
