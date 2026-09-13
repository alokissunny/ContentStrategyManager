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
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', provider: 'openai', reasoning: true, tier: 'mid' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic', reasoning: false, tier: 'cheapest' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'anthropic', reasoning: true, tier: 'mid' },
  { id: 'claude-opus-5', label: 'Claude Opus 5', provider: 'anthropic', reasoning: true, tier: 'priciest' },
];

const REASONING_OPTIONS = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

const KEYS = {
  carouselModel: 'carousel.model',
  carouselReasoningEffort: 'carousel.reasoningEffort',
};

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

function isValidReasoning(id) {
  return REASONING_OPTIONS.some((r) => r.id === id);
}

module.exports = {
  KEYS,
  CAROUSEL_MODEL_OPTIONS,
  REASONING_OPTIONS,
  loadRuntimeSettings,
  getRuntimeSetting,
  setRuntimeSetting,
  isValidCarouselModel,
  isValidReasoning,
};
