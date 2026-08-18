const fs = require('fs');
const path = require('path');
const getAnthropicClient = require('./anthropicClient');
const {
  extractJson,
  estimatePlanCostUsd,
  buildSnapshot,
  renderCompetitorInsights,
  renderProjectAssets,
} = require('./weeklyPlan');

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

function maxTokensFor(kind) {
  if (kind === 'strategist') {
    const n = Number(process.env.PLAN_STRATEGIST_MAX_TOKENS);
    return Number.isFinite(n) && n > 0 ? n : 4096;
  }
  if (kind === 'calendar') {
    const n = Number(process.env.PLAN_CALENDAR_MAX_TOKENS);
    return Number.isFinite(n) && n > 0 ? n : 8192;
  }
  const n = Number(process.env.PLAN_DAY_MAX_TOKENS);
  return Number.isFinite(n) && n > 0 ? n : 8192;
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
  const maxTokens = maxTokensFor(kind);
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
      console.warn(`[planOrchestrator] ${source} attempt ${attempt}: truncated`);
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
      return { parsed, usage, debugEntry };
    } catch (err) {
      lastErr = err;
      console.warn(`[planOrchestrator] ${source} attempt ${attempt}: validation failed — ${err.message}`);
    }
  }

  throw new Error(`${source} failed after ${maxAttempts} attempts: ${lastErr?.message || 'unknown error'}`);
}

function countPillars(days) {
  return (days || []).reduce((acc, d) => {
    const p = d.pillar;
    if (p) acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, { discovery: 0, credibility: 0, trust: 0 });
}

function validateCalendar(parsed, dayAllocation) {
  const days = parsed?.days;
  if (!Array.isArray(days) || days.length !== 7) {
    throw new Error(`calendar must have exactly 7 days (got ${days?.length ?? 0})`);
  }
  const actual = countPillars(days);
  for (const pillar of ['discovery', 'credibility', 'trust']) {
    if ((actual[pillar] || 0) !== (dayAllocation[pillar] || 0)) {
      throw new Error(
        `dayAllocation mismatch: want ${JSON.stringify(dayAllocation)}, got ${JSON.stringify(actual)}`,
      );
    }
  }
}

function voiceFromDna(brandDna) {
  if (!brandDna || typeof brandDna !== 'object') return {};
  return {
    howYouSound: brandDna.howYouSound || '',
    whatYouOffer: brandDna.whatYouOffer || '',
    whoYouHelp: brandDna.whoYouHelp || '',
    position: brandDna.position || '',
    neverDo: brandDna.neverDo || '',
  };
}

function assetsBrief(projects, preferredKey) {
  const rows = [];
  for (const p of projects || []) {
    for (const a of p.assets || []) {
      if (!a?.key) continue;
      rows.push({
        key: a.key,
        project: p.name,
        note: a.note || '',
        vision: a.vision || null,
        preferred: preferredKey && a.key === preferredKey,
      });
    }
  }
  // Prefer listing the suggested key first; keep the list compact.
  rows.sort((a, b) => Number(b.preferred) - Number(a.preferred));
  return rows.slice(0, 12);
}

/**
 * Multi-agent weekly plan: Strategist → Calendar → 7 parallel Day writers.
 * Returns the same shape fields weeklyPlan needs to assemble a route:
 *   { focusOut, rawDays, usage, model, debug }
 */
async function runMultiAgentPlan({
  profile,
  brandDna,
  competitorInsights,
  projects,
  focusSummary,
}) {
  const snapshot = buildSnapshot(profile, brandDna);
  const competitorText = renderCompetitorInsights(competitorInsights);
  const projectsText = renderProjectAssets(projects);
  const focusJson = JSON.stringify(focusSummary);
  const snapshotJson = JSON.stringify(snapshot);
  const debugAgents = [];
  const usages = [];

  console.log(
    `[planOrchestrator] multi-agent plan for @${snapshot.username} · focus=${focusSummary.pillar}`,
  );

  // ── 1. Strategist ────────────────────────────────────────────────────────
  const strategistPrompt = fillTemplate(loadPrompt('plan-strategist.md'), {
    FOCUS_JSON: focusJson,
    SNAPSHOT_JSON: snapshotJson,
    COMPETITOR_INSIGHTS: competitorText,
    PROJECT_ASSETS: projectsText,
  });
  const strategist = await callAgent({
    source: 'Strategist',
    kind: 'strategist',
    prompt: strategistPrompt,
    validate: (p) => {
      if (!p?.focus || typeof p.focus !== 'object') throw new Error('missing focus');
    },
  });
  debugAgents.push(strategist.debugEntry);
  usages.push(strategist.usage);
  const strategistJson = JSON.stringify(strategist.parsed);

  // ── 2. Calendar ──────────────────────────────────────────────────────────
  const calendarPrompt = fillTemplate(loadPrompt('plan-calendar.md'), {
    STRATEGIST_JSON: strategistJson,
    FOCUS_JSON: focusJson,
    SNAPSHOT_JSON: snapshotJson,
    COMPETITOR_INSIGHTS: competitorText,
    PROJECT_ASSETS: projectsText,
  });
  const calendar = await callAgent({
    source: 'Calendar',
    kind: 'calendar',
    prompt: calendarPrompt,
    validate: (p) => validateCalendar(p, focusSummary.dayAllocation),
  });
  debugAgents.push(calendar.debugEntry);
  usages.push(calendar.usage);

  const calendarDays = calendar.parsed.days;
  const voiceJson = JSON.stringify(voiceFromDna(brandDna));

  // ── 3. Day writers (parallel) ────────────────────────────────────────────
  const dayResults = await Promise.all(
    calendarDays.map(async (dayBrief, index) => {
      const preferred = String(dayBrief.suggestedAssetKey || '').trim();
      const dayAssets = assetsBrief(projects, preferred);
      const dayPrompt = fillTemplate(loadPrompt('plan-day-writer.md'), {
        DAY_JSON: JSON.stringify({ index, ...dayBrief }),
        STRATEGIST_JSON: strategistJson,
        VOICE_JSON: voiceJson,
        DAY_ASSETS: JSON.stringify(dayAssets),
      });
      const source = `Day:${dayBrief.day || `D${index + 1}`}`;
      const result = await callAgent({
        source,
        kind: 'day',
        prompt: dayPrompt,
        validate: (p) => {
          if (!p?.content || typeof p.content !== 'object') throw new Error('missing content');
        },
      });
      return { index, dayBrief, result };
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
    .map(({ dayBrief, result }) => ({
      day: dayBrief.day,
      time: dayBrief.time,
      format: dayBrief.format,
      contentType: dayBrief.contentType,
      pillar: dayBrief.pillar,
      goalTag: dayBrief.goalTag,
      title: dayBrief.title,
      direction: dayBrief.direction,
      // Prefer writer content; if lead slide has no assetKey, seed suggested one.
      content: (() => {
        const content = { ...(result.parsed.content || {}) };
        const slides = Array.isArray(content.slides) ? content.slides.map((s) => ({ ...s })) : [];
        const suggested = String(dayBrief.suggestedAssetKey || '').trim();
        if (suggested && slides[0] && !slides[0].assetKey) {
          slides[0] = { ...slides[0], assetKey: suggested };
        }
        content.slides = slides;
        return content;
      })(),
    }));

  const model = agentModel('strategist');
  const usage = mergeUsage(usages, model);

  console.log(
    `[planOrchestrator] @${snapshot.username}: strategist+calendar+${rawDays.length} days · ` +
      `${usage.totalTokens} tokens (~$${usage.estimatedCostUsd.toFixed(4)})`,
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
      })),
    },
  };
}

module.exports = { runMultiAgentPlan };
