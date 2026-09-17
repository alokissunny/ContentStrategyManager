/**
 * Per-agent LLM routing for the weekly plan pipeline.
 *
 * Change a model in one of three places (first match wins):
 *   1. PLAN_<KIND>_MODEL / PLAN_<KIND>_PROVIDER in .env
 *   2. The AGENTS table below (default provider per kind)
 *   3. Shared fallbacks: PLAN_AGENT_MODEL (OpenAI) or ANTHROPIC_MODEL (Claude)
 *
 * Provider is inferred from the model id when omitted
 * (gpt* / terra / astra / o1–o4 → openai; claude / sonnet / haiku / opus → anthropic).
 */

const { getRuntimeSetting, KEYS } = require('./runtimeSettings');

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
  layout: {
    defaultProvider: 'openai',
    modelEnv: 'PLAN_LAYOUT_MODEL',
    providerEnv: 'PLAN_LAYOUT_PROVIDER',
  },
  // On-demand per-slide layout variations (Change layout). Cheap by design — it
  // composes one slide, not a whole multi-theme carousel.
  layoutVariations: {
    defaultProvider: 'openai',
    modelEnv: 'PLAN_LAYOUT_VARIATIONS_MODEL',
    providerEnv: 'PLAN_LAYOUT_VARIATIONS_PROVIDER',
    defaultModel: 'gpt-5.6-terra',
  },
  carousel: {
    defaultProvider: 'openai',
    modelEnv: 'PLAN_CAROUSEL_MODEL',
    providerEnv: 'PLAN_CAROUSEL_PROVIDER',
    defaultModel: 'gpt-6-astra',
  },
  cover: {
    defaultProvider: 'openai',
    modelEnv: 'PLAN_COVER_MODEL',
    providerEnv: 'PLAN_COVER_PROVIDER',
  },
  // Visual Generator — writes ONE image-generation prompt for a slide that needs
  // a conceptual visual it has no supplied asset for. Cheap by design: it emits a
  // short JSON prompt, not a whole document. The rendered image comes from
  // services/openaiImage.js (gpt-image-1), not from this text model.
  visual: {
    defaultProvider: 'openai',
    modelEnv: 'PLAN_VISUAL_MODEL',
    providerEnv: 'PLAN_VISUAL_PROVIDER',
    defaultModel: 'gpt-5.6-terra',
  },
  // Experimental Reel Editor — a three-agent short-form video edit pipeline
  // (director → caption stylist → motion graphics). See services/reelEditorAgent.
  reelDirector: {
    defaultProvider: 'openai',
    modelEnv: 'PLAN_REEL_DIRECTOR_MODEL',
    providerEnv: 'PLAN_REEL_DIRECTOR_PROVIDER',
    defaultModel: 'gpt-5.6-terra',
  },
  reelCaptions: {
    defaultProvider: 'openai',
    modelEnv: 'PLAN_REEL_CAPTIONS_MODEL',
    providerEnv: 'PLAN_REEL_CAPTIONS_PROVIDER',
    defaultModel: 'gpt-5.6-terra',
  },
  reelAnimations: {
    defaultProvider: 'openai',
    modelEnv: 'PLAN_REEL_ANIMATIONS_MODEL',
    providerEnv: 'PLAN_REEL_ANIMATIONS_PROVIDER',
    defaultModel: 'gpt-5.6-terra',
  },
};

function envText(name) {
  return String(process.env[name] || '').trim();
}

function inferProvider(model) {
  const m = String(model || '').toLowerCase();
  if (!m) return '';
  if (/claude|sonnet|haiku|opus/.test(m)) return 'anthropic';
  if (/gpt|o1|o3|o4|terra|astra/.test(m)) return 'openai';
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
    if (kind === 'layout' || kind === 'carousel' || kind === 'layoutVariations') return 'claude-haiku-4-5';
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

// A model chosen at runtime through Settings wins over env and the AGENTS table.
// Only the carousel agent is switchable from the UI today.
function runtimeModelFor(kind) {
  if (kind === 'carousel') {
    const value = getRuntimeSetting(KEYS.carouselModel);
    return typeof value === 'string' ? value.trim() : '';
  }
  return '';
}

function resolvePlanAgentLlm(kind = 'strategist') {
  const spec = AGENTS[kind] || AGENTS.strategist;
  const explicitModel = runtimeModelFor(kind) || envText(spec.modelEnv);
  const explicitProvider = namedProvider(envText(spec.providerEnv));
  const provider = inferProvider(explicitModel)
    || explicitProvider
    || spec.defaultProvider;
  const model = explicitModel || spec.defaultModel || defaultModelFor(provider, kind);
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
