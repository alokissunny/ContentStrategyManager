const {
  KEYS,
  CAROUSEL_MODEL_OPTIONS,
  REASONING_OPTIONS,
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
  THEME_APPLY_PHOTO_MODES,
  isValidThemeApplyPhotoMode,
  themeApplyPhotoMode,
  artDirectorEnabled,
  ART_DIRECTOR_VERSIONS,
  isValidArtDirectorVersion,
  artDirectorVersion,
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

function currentStrategistModel() {
  const resolved = resolvePlanAgentLlm('strategist');
  return {
    model: resolved.model,
    provider: resolved.provider,
    overridden: Boolean(getRuntimeSetting(KEYS.strategistModel)),
    modelOptions: STRATEGIST_MODEL_OPTIONS,
  };
}

// GET /api/settings/strategist-model
async function getStrategistModel(req, res) {
  res.json(currentStrategistModel());
}

// PUT /api/settings/strategist-model  (admin only)
async function updateStrategistModel(req, res) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Only an admin can change the strategist model.' });
  }
  const model = String(req.body?.model || '').trim();
  if (!isValidStrategistModel(model)) {
    return res.status(400).json({ message: `Unsupported strategist model: ${req.body?.model}` });
  }
  await setRuntimeSetting(KEYS.strategistModel, model);
  return res.json(currentStrategistModel());
}

function currentBrandVoiceModel() {
  const { id, model } = brandVoiceLlm();
  return {
    provider: id,
    model,
    options: BRAND_VOICE_PROVIDERS.map(({ id: pid, label, model: m }) => ({ id: pid, label, model: m })),
  };
}

// GET /api/settings/brand-voice-model
async function getBrandVoiceModel(req, res) {
  res.json(currentBrandVoiceModel());
}

// PUT /api/settings/brand-voice-model  (admin only)
async function updateBrandVoiceModel(req, res) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Only an admin can change the brand voice model.' });
  }
  const provider = String(req.body?.provider || '').trim().toLowerCase();
  if (!isValidBrandVoiceProvider(provider)) {
    return res.status(400).json({ message: `Unsupported brand voice provider: ${req.body?.provider}` });
  }
  await setRuntimeSetting(KEYS.brandVoiceProvider, provider);
  return res.json(currentBrandVoiceModel());
}

function currentThemeRegionsModel() {
  const { id, model } = themeRegionsLlm();
  return {
    provider: id,
    model,
    options: THEME_REGIONS_PROVIDERS.map(({ id: pid, label, model: m }) => ({ id: pid, label, model: m })),
  };
}

// GET /api/settings/theme-regions-model
async function getThemeRegionsModel(req, res) {
  res.json(currentThemeRegionsModel());
}

// PUT /api/settings/theme-regions-model  (admin only)
async function updateThemeRegionsModel(req, res) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Only an admin can change the theme slide model.' });
  }
  const provider = String(req.body?.provider || '').trim().toLowerCase();
  if (!isValidThemeRegionsProvider(provider)) {
    return res.status(400).json({ message: `Unsupported provider: ${req.body?.provider}` });
  }
  await setRuntimeSetting(KEYS.themeRegionsProvider, provider);
  return res.json(currentThemeRegionsModel());
}

function currentThemeApplyPhotoMode() {
  return { mode: themeApplyPhotoMode(), options: THEME_APPLY_PHOTO_MODES };
}

// GET /api/settings/theme-apply-photo
async function getThemeApplyPhotoMode(req, res) {
  res.json(currentThemeApplyPhotoMode());
}

// PUT /api/settings/theme-apply-photo  (admin only)
async function updateThemeApplyPhotoMode(req, res) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Only an admin can change how Theme Apply handles photos.' });
  }
  const mode = String(req.body?.mode || '').trim().toLowerCase();
  if (!isValidThemeApplyPhotoMode(mode)) {
    return res.status(400).json({ message: `Unsupported photo mode: ${req.body?.mode}` });
  }
  await setRuntimeSetting(KEYS.themeApplyPhotoMode, mode);
  return res.json(currentThemeApplyPhotoMode());
}

function currentArtDirector() {
  return {
    enabled: artDirectorEnabled(),
    version: artDirectorVersion().id,
    versions: ART_DIRECTOR_VERSIONS.map(({ id, label, hint }) => ({ id, label, hint })),
    model: resolvePlanAgentLlm('artDirector').model,
  };
}

// GET /api/settings/art-director
async function getArtDirector(req, res) {
  res.json(currentArtDirector());
}

// PUT /api/settings/art-director  (admin only) — { enabled?: boolean, version?: 'director' | 'restyle' }
async function updateArtDirector(req, res) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Only an admin can change the Art Director agent.' });
  }
  const { enabled, version } = req.body || {};
  if (enabled == null && version == null) {
    return res.status(400).json({ message: 'Send enabled and/or version.' });
  }
  if (enabled != null && typeof enabled !== 'boolean') {
    return res.status(400).json({ message: 'enabled must be true or false.' });
  }
  if (version != null && !isValidArtDirectorVersion(version)) {
    return res.status(400).json({ message: `Unknown Art Director version: ${version}` });
  }
  if (version != null) await setRuntimeSetting(KEYS.artDirectorVersion, version);
  if (enabled != null) await setRuntimeSetting(KEYS.artDirectorEnabled, enabled);
  return res.json(currentArtDirector());
}

module.exports = {
  getArtDirector, updateArtDirector,
  getThemeApplyPhotoMode, updateThemeApplyPhotoMode,
  getCarouselModel, updateCarouselModel, getBrandVoiceModel, updateBrandVoiceModel,
  getThemeRegionsModel, updateThemeRegionsModel, getStrategistModel, updateStrategistModel,
};
