const {
  KEYS,
  CAROUSEL_MODEL_OPTIONS,
  REASONING_OPTIONS,
  getRuntimeSetting,
  setRuntimeSetting,
  isValidCarouselModel,
  isValidReasoning,
} = require('../services/runtimeSettings');
const { resolvePlanAgentLlm } = require('../services/planAgentLlm');

function currentCarouselModel() {
  const resolved = resolvePlanAgentLlm('carousel');
  const chosen = getRuntimeSetting(KEYS.carouselModel);
  const reasoning = String(getRuntimeSetting(KEYS.carouselReasoningEffort) || '').trim().toLowerCase();
  return {
    model: resolved.model,
    provider: resolved.provider,
    // Whether the current value came from a Settings choice (vs env / default).
    overridden: Boolean(chosen),
    reasoningEffort: isValidReasoning(reasoning) ? reasoning : 'low',
    modelOptions: CAROUSEL_MODEL_OPTIONS,
    reasoningOptions: REASONING_OPTIONS,
  };
}

// GET /api/settings/carousel-model
async function getCarouselModel(req, res) {
  res.json(currentCarouselModel());
}

// PUT /api/settings/carousel-model  (admin only)
async function updateCarouselModel(req, res) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Only an admin can change the carousel model.' });
  }
  const { model, reasoningEffort } = req.body || {};

  if (model != null) {
    if (!isValidCarouselModel(model)) {
      return res.status(400).json({ message: `Unsupported carousel model: ${model}` });
    }
    await setRuntimeSetting(KEYS.carouselModel, model);
  }

  if (reasoningEffort != null) {
    const effort = String(reasoningEffort).trim().toLowerCase();
    if (!isValidReasoning(effort)) {
      return res.status(400).json({ message: `Unsupported reasoning level: ${reasoningEffort}` });
    }
    await setRuntimeSetting(KEYS.carouselReasoningEffort, effort);
  }

  return res.json(currentCarouselModel());
}

module.exports = { getCarouselModel, updateCarouselModel };
