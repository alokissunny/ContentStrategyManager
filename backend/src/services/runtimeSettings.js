/**
 * Runtime app settings — a synchronously-readable cache over the AppSetting
 * collection. Model routing and reasoning effort are resolved synchronously deep
 * in the plan pipeline (planAgentLlm / llmComplete), so those resolvers cannot
 * await Mongo. We load every setting into memory at startup and keep the cache in
 * sync on every write, so getRuntimeSetting() is a plain object read.
 *
 * The plan-model catalog lives here so the API, the validator, and the UI all
 * agree on which models can be chosen for the carousel agent.
 */

const AppSetting = require('../models/AppSetting');

// The models a user may route the carousel agent to, and the reasoning levels.
// `id` is the model id passed to the provider; provider is inferred from it.
// `reasoning: false` means the model runs at a fixed speed and ignores the
// reasoning-effort toggle (Haiku). `tier` is a rough cost hint for the UI.
const CAROUSEL_MODEL_OPTIONS = [
  { id: 'gpt-5.6-terra', label: 'GPT 5.6', provider: 'openai', reasoning: true, tier: 'mid' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', provider: 'openai', reasoning: true, tier: 'cheapest' },
  { id: 'gpt-6-sol', label: 'GPT-6 Sol', provider: 'openai', reasoning: true, tier: 'mid' },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', provider: 'openai', reasoning: true, tier: 'priciest' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic', reasoning: false, tier: 'cheapest' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'anthropic', reasoning: true, tier: 'mid' },
  { id: 'claude-opus-5', label: 'Claude Opus 5', provider: 'anthropic', reasoning: true, tier: 'priciest' },
];

// The plan Strategist: Luna by default (cheap + fast); Astra when quality matters more.
const STRATEGIST_MODEL_OPTIONS = [
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', provider: 'openai', tier: 'cheapest' },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', provider: 'openai', tier: 'priciest' },
];

const REASONING_OPTIONS = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

const KEYS = {
  carouselModel: 'carousel.model',
  carouselReasoningEffort: 'carousel.reasoningEffort',
  strategistModel: 'strategist.model',
  brandVoiceProvider: 'brandVoice.provider',
  themeRegionsProvider: 'themeRegions.provider',
};

// Which provider reads the last 10 posts for Business memory › Fetch brand voice.
// Model ids are env-overridable; OpenAI is the default.
const BRAND_VOICE_PROVIDERS = [
  { id: 'openai', label: 'OpenAI', model: process.env.BRAND_VOICE_OPENAI_MODEL || 'gpt-6-luna' },
  { id: 'anthropic', label: 'Claude', model: process.env.BRAND_VOICE_ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5' },
];
const DEFAULT_BRAND_VOICE_PROVIDER = 'openai';

// Which vision model finds the text blocks + pictures on a Theme Apply render
// (Editor mode region map) and rewrites a region's words. OpenAI by default.
const THEME_REGIONS_PROVIDERS = [
  { id: 'openai', label: 'OpenAI', model: process.env.THEME_REGIONS_OPENAI_MODEL || 'gpt-6-luna' },
  { id: 'anthropic', label: 'Claude', model: process.env.THEME_REGIONS_MODEL || 'claude-haiku-4-5-20251001' },
];
const DEFAULT_THEME_REGIONS_PROVIDER = 'openai';

const cache = new Map();
let loaded = false;

async function loadRuntimeSettings() {
  try {
    const docs = await AppSetting.find({}).lean();
    cache.clear();
    docs.forEach((d) => cache.set(d.key, d.value));
    loaded = true;
  } catch (err) {
    // Leave the cache empty on failure — every resolver falls back to env.
    console.warn('[runtimeSettings] load failed — using env defaults:', err.message);
  }
  return loaded;
}

function getRuntimeSetting(key) {
  return cache.has(key) ? cache.get(key) : undefined;
}

async function setRuntimeSetting(key, value) {
  await AppSetting.findOneAndUpdate(
    { key },
    { key, value },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  cache.set(key, value);
  return value;
}

function isValidCarouselModel(id) {
  return CAROUSEL_MODEL_OPTIONS.some((m) => m.id === id);
}

function isValidStrategistModel(id) {
  return STRATEGIST_MODEL_OPTIONS.some((m) => m.id === id);
}

function isValidReasoning(id) {
  return REASONING_OPTIONS.some((r) => r.id === id);
}

function isValidBrandVoiceProvider(id) {
  return BRAND_VOICE_PROVIDERS.some((p) => p.id === id);
}

/** The provider + model Fetch brand voice runs on right now. */
function brandVoiceLlm() {
  const chosen = getRuntimeSetting(KEYS.brandVoiceProvider);
  const id = isValidBrandVoiceProvider(chosen) ? chosen : DEFAULT_BRAND_VOICE_PROVIDER;
  return BRAND_VOICE_PROVIDERS.find((p) => p.id === id);
}

function isValidThemeRegionsProvider(id) {
  return THEME_REGIONS_PROVIDERS.some((p) => p.id === id);
}

/** The provider + model the theme-slide region map runs on right now. */
function themeRegionsLlm() {
  const chosen = getRuntimeSetting(KEYS.themeRegionsProvider);
  const id = isValidThemeRegionsProvider(chosen) ? chosen : DEFAULT_THEME_REGIONS_PROVIDER;
  return THEME_REGIONS_PROVIDERS.find((p) => p.id === id);
}

module.exports = {
  KEYS,
  CAROUSEL_MODEL_OPTIONS,
  REASONING_OPTIONS,
  loadRuntimeSettings,
  getRuntimeSetting,
  setRuntimeSetting,
  isValidCarouselModel,
  STRATEGIST_MODEL_OPTIONS,
  isValidStrategistModel,
  isValidReasoning,
  BRAND_VOICE_PROVIDERS,
  isValidBrandVoiceProvider,
  brandVoiceLlm,
  THEME_REGIONS_PROVIDERS,
  isValidThemeRegionsProvider,
  themeRegionsLlm,
};
