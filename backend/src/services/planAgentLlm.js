/**
 * Per-agent LLM routing for the weekly plan pipeline.
 *
 * Change a model in one of three places (first match wins):
 *   1. PLAN_<KIND>_MODEL / PLAN_<KIND>_PROVIDER in .env
 *   2. The AGENTS table below (default provider per kind)
 *   3. Shared fallbacks: PLAN_AGENT_MODEL (OpenAI) or ANTHROPIC_MODEL (Claude)
 *
 * Provider is inferred from the model id when omitted
 * (gpt* / terra / o1–o4 → openai; claude / sonnet / haiku / opus → anthropic).
 */

const PROVIDERS = ['openai', 'anthropic'];

const AGENTS = {
  strategist: {
    defaultProvider: 'openai',
    modelEnv: 'PLAN_STRATEGIST_MODEL',
    providerEnv: 'PLAN_STRATEGIST_PROVIDER',
  },
  structure: {
    defaultProvider: 'openai',
    modelEnv: 'PLAN_STRUCTURE_MODEL',
    providerEnv: 'PLAN_STRUCTURE_PROVIDER',
  },
  day: {
    defaultProvider: 'openai',
    modelEnv: 'PLAN_DAY_MODEL',
    providerEnv: 'PLAN_DAY_PROVIDER',
  },
  quality: {
    defaultProvider: 'openai',
    modelEnv: 'PLAN_QUALITY_MODEL',
    providerEnv: 'PLAN_QUALITY_PROVIDER',
  },
  layout: {
    defaultProvider: 'openai',
    modelEnv: 'PLAN_LAYOUT_MODEL',
    providerEnv: 'PLAN_LAYOUT_PROVIDER',
  },
};

function envText(name) {
  return String(process.env[name] || '').trim();
}

function inferProvider(model) {
  const m = String(model || '').toLowerCase();
  if (!m) return '';
  if (/claude|sonnet|haiku|opus/.test(m)) return 'anthropic';
  if (/gpt|o1|o3|o4|terra/.test(m)) return 'openai';
  return '';
}

function namedProvider(value) {
  const v = String(value || '').trim().toLowerCase();
  return PROVIDERS.includes(v) ? v : '';
}

function defaultModelFor(provider, kind) {
  if (provider === 'anthropic') {
    // Layout is constrained HTML, not strategy. Haiku is the speed default;
    // do not inherit ANTHROPIC_MODEL (often Sonnet 5, adaptive thinking).
    if (kind === 'layout') return 'claude-haiku-4-5';
    return envText('ANTHROPIC_MODEL') || 'claude-sonnet-5';
  }
  return envText('PLAN_AGENT_MODEL')
    || envText('OPENAI_MODEL')
    || envText('COMPETITOR_MODEL')
    || 'gpt-5.6-terra';
}

function providerOf(model, explicit) {
  return namedProvider(explicit) || inferProvider(model) || '';
}

function resolvePlanAgentLlm(kind = 'strategist') {
  const spec = AGENTS[kind] || AGENTS.strategist;
  const explicitModel = envText(spec.modelEnv);
  const explicitProvider = namedProvider(envText(spec.providerEnv));
  const provider = inferProvider(explicitModel)
    || explicitProvider
    || spec.defaultProvider;
  const model = explicitModel || defaultModelFor(provider, kind);
  return { kind: AGENTS[kind] ? kind : 'strategist', provider, model };
}

function planTextModel(kind) {
  return resolvePlanAgentLlm(kind).model;
}

function isOpenAIModel(model) {
  return providerOf(model) === 'openai';
}

function isAnthropicModel(model) {
  return providerOf(model) === 'anthropic';
}

module.exports = {
  AGENTS,
  PROVIDERS,
  inferProvider,
  providerOf,
  resolvePlanAgentLlm,
  planTextModel,
  isOpenAIModel,
  isAnthropicModel,
};
