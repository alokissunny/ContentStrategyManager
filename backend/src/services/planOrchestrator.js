const fs = require('fs');
const path = require('path');
const getAnthropicClient = require('./anthropicClient');
const { extractJson, estimatePlanCostUsd, assignToEmptyDates } = require('./weeklyPlan');
const { compileStrategyContext, assetsForDay, json } = require('./planContext');

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
    // Function replacement so `$` in content is literal.
    out = out.split(token).join(typeof value === 'function' ? value() : String(value ?? ''));
  }
  return out;
}

function agentModel(kind) {
  if (kind === 'day') {
    return process.env.PLAN_DAY_MODEL || process.env.PLAN_AGENT_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  }
  return process.env.PLAN_AGENT_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
}

const GOAL_TAG = { discovery: 'Get noticed', credibility: 'Show expertise', trust: 'Build confidence' };
const FORMATS = ['Reel', 'Carousel', 'Post', 'Story'];

function formatFromLabel(label) {
  const s = String(label || '');
  if (/carousel/i.test(s)) return 'Carousel';
  if (/reel/i.test(s)) return 'Reel';
  if (/stor/i.test(s)) return 'Story';
  if (/post|static|feed|photo/i.test(s)) return 'Post';
  return '';
}

function preferFormat(index, competitorFormats) {
  const cycle = [...new Set(
    (competitorFormats || []).map(formatFromLabel).filter((f) => FORMATS.includes(f)),
  )];
  const list = cycle.length ? cycle : ['Carousel', 'Reel', 'Post'];
  return list[index % list.length];
}

function maxTokensFor(kind) {
  if (kind === 'strategist') {
    const n = Number(process.env.PLAN_STRATEGIST_MAX_TOKENS);
    return Number.isFinite(n) && n > 0 ? n : 8192;
  }
  const n = Number(process.env.PLAN_DAY_MAX_TOKENS);
  return Number.isFinite(n) && n > 0 ? n : 8192;
}

function retryMaxTokens(current) {
  const bumped = Math.min(Math.max(current, 1) * 2, 32000);
  return bumped > current ? bumped : current;
}

function textOf(response) {
  return (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function usageOf(response, model) {
  const inputTokens = Number(response.usage?.input_tokens) || 0;
  const outputTokens = Number(response.usage?.output_tokens) || 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: estimatePlanCostUsd(model, inputTokens, outputTokens),
    model,
  };
}

function mergeUsage(parts, model) {
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    model,
  };
  for (const p of parts) {
    usage.inputTokens += p.inputTokens || 0;
    usage.outputTokens += p.outputTokens || 0;
    usage.totalTokens += p.totalTokens || 0;
    usage.estimatedCostUsd += p.estimatedCostUsd || 0;
  }
  usage.estimatedCostUsd = Math.round(usage.estimatedCostUsd * 1e6) / 1e6;
  return usage;
}

async function callAgent({ source, kind, prompt, validate }) {
  const model = agentModel(kind);
  const client = getAnthropicClient();
  let maxTokens = maxTokensFor(kind);
  const maxAttempts = 2;
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    const fullText = textOf(response);
    const usage = usageOf(response, model);
    const debugEntry = { source, model, prompt, kind };

    if (response.stop_reason === 'max_tokens') {
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
      return { parsed, usage, debugEntry: { ...debugEntry, output: fullText } };
    } catch (err) {
      lastErr = err;
      console.warn(`[planOrchestrator] ${source} attempt ${attempt}: validation failed — ${err.message}`);
    }
  }

  throw new Error(`${source} failed after ${maxAttempts} attempts: ${lastErr?.message || 'unknown error'}`);
}

function validateStrategist(parsed, emptyDates) {
  if (!parsed?.focus || typeof parsed.focus !== 'object') throw new Error('missing focus');
  const briefs = Array.isArray(parsed.briefs)
    ? parsed.briefs
    : (Array.isArray(parsed.plannedDays) ? parsed.plannedDays : null);
  if (!Array.isArray(briefs)) throw new Error('missing briefs');
  const max = Array.isArray(emptyDates) ? emptyDates.length : 31;
  const lenses = ['discovery', 'credibility', 'trust'];
  parsed.briefs = briefs.slice(0, max).map((b) => {
    const lens = String(b.lens || b.pillar || '').toLowerCase();
    return {
      source: b.source || '',
      angle: b.angle || '',
      ...(lenses.includes(lens) ? { lens } : {}),
    };
  });
  parsed.plannedDays = parsed.briefs;
}

/**
 * Multi-agent plan: Strategist → parallel Day writers
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
      ` · brand=${ctx.versions.brand} · competitor=${ctx.versions.competitor}`,
  );

  // ── 1. Strategist ────────────────────────────────────────────────────────
  const strategistPrompt = fillTemplate(loadPrompt('plan-strategist.md'), {
    LIMITS_JSON: json({
      maxBriefs: emptyDates.length,
      month: ctx.calendar.month,
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
  const strategist = await callAgent({
    source: 'Strategist',
    kind: 'strategist',
    prompt: strategistPrompt,
    validate: (p) => validateStrategist(p, emptyDates),
  });
  debugAgents.push(strategist.debugEntry);
  usages.push(strategist.usage);
  const briefs = Array.isArray(strategist.parsed.briefs)
    ? strategist.parsed.briefs
    : (strategist.parsed.plannedDays || []);
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
  const lastThree = Array.isArray(ctx.projects?.lastThree) ? ctx.projects.lastThree : [];
  const noteCount = lastThree.filter((c) => c.text).length;
  const shownCount = lastThree.reduce((n, c) => n + (c.shown || []).length, 0);
  const latest = ctx.projects?.latestCapture?.text
    ? String(ctx.projects.latestCapture.text).slice(0, 80)
    : '';
  const whyEmpty = String(strategist.parsed.constraints?.insufficientContext || '').trim();

  if (plannedDays.length === 0) {
    console.log(
      `[planOrchestrator] @${username}: strategist planned 0 days` +
        ` · lastThree=${noteCount} shownPhotos=${shownCount}` +
        (latest ? ` · latest=${JSON.stringify(latest)}` : '') +
        (whyEmpty ? ` · insufficientContext=${JSON.stringify(whyEmpty)}` : '') +
        ` — skipping day writers`,
    );
  }

  const competitorJson = json({
    confidence: ctx.competitor.confidence,
    formats: ctx.competitor.formats,
    hooks: ctx.competitor.hooks,
    peakTimes: ctx.competitor.peakTimes,
    signals: ctx.competitor.signals,
  });
  const brandJson = json(ctx.brandVoice);

  // ── 2. Day writers (parallel) ────────────────────────────────────────────
  const dayResults = await Promise.all(
    plannedDays.map(async (planned, index) => {
      const brief = {
        index,
        date: planned.date,
        dayOfMonth: planned.dayOfMonth,
        day: planned.day,
        pillar: planned.pillar,
        lens: planned.lens || planned.pillar,
        source: planned.source || '',
        angle: planned.angle || '',
        preferFormat: preferFormat(index, ctx.competitor.formats),
      };
      let dayAssets = assetsForDay(projects, brief);
      if (dayAssets[0]?.key) {
        brief.suggestedAssetKey = dayAssets[0].key;
        dayAssets = dayAssets.map((a, i) => ({ ...a, preferred: i === 0 }));
      }
      const dayPrompt = fillTemplate(loadPrompt('plan-day-writer.md'), {
        DAY_JSON: json(brief),
        CONSTRAINTS_JSON: constraintsJson,
        BRAND_JSON: brandJson,
        COMPETITOR_JSON: competitorJson,
        DAY_ASSETS: json(dayAssets),
      });
      const source = `Day:${brief.date || brief.day || `D${index + 1}`}`;
      const result = await callAgent({
        source,
        kind: 'day',
        prompt: dayPrompt,
        validate: (p) => {
          if (!p?.content || typeof p.content !== 'object') throw new Error('missing content');
        },
      });
      return { index, dayBrief: brief, result };
    }),
  );

  dayResults
    .sort((a, b) => a.index - b.index)
    .forEach(({ result }) => {
      debugAgents.push(result.debugEntry);
      usages.push(result.usage);
    });

  const rawDays = dayResults
    .sort((a, b) => a.index - b.index)
    .map(({ dayBrief, result }) => {
      const parsed = result.parsed || {};
      const content = { ...(parsed.content || {}) };
      const slides = Array.isArray(content.slides) ? content.slides.map((s) => ({ ...s })) : [];
      const suggested = String(dayBrief.suggestedAssetKey || '').trim();
      if (suggested && slides[0] && !slides[0].assetKey) {
        slides[0] = { ...slides[0], assetKey: suggested };
      }
      content.slides = slides;
      const pillar = dayBrief.pillar;
      const format = FORMATS.includes(parsed.format) ? parsed.format : dayBrief.preferFormat;
      return {
        day: dayBrief.day,
        date: dayBrief.date,
        dayOfMonth: dayBrief.dayOfMonth,
        time: parsed.time || '',
        format,
        contentType: parsed.contentType || '',
        pillar,
        goalTag: GOAL_TAG[pillar] || '',
        title: parsed.title || slides[0]?.title || '',
        direction: parsed.direction || dayBrief.angle || '',
        content,
      };
    });

  const model = agentModel('strategist');
  const usage = mergeUsage(usages, model);

  console.log(
    `[planOrchestrator] @${username}: strategist+${rawDays.length} days · ` +
      `${usage.totalTokens} tokens (~$${usage.estimatedCostUsd.toFixed(4)})` +
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
