import client from './client';

// The carousel agent's model + reasoning level. Read by anyone signed in;
// updated only by an admin (enforced server-side).
export function getCarouselModel() {
  return client.get('/settings/carousel-model').then((res) => res.data);
}

export function updateCarouselModel({ model, reasoningEffort } = {}) {
  return client.put('/settings/carousel-model', { model, reasoningEffort }).then((res) => res.data);
}

// The plan Strategist's model (GPT-6 Luna default, Astra optional).
export function getStrategistModel() {
  return client.get('/settings/strategist-model').then((res) => res.data);
}

export function updateStrategistModel(model) {
  return client.put('/settings/strategist-model', { model }).then((res) => res.data);
}

// Which provider reads posts for Business memory › Fetch brand voice.
export function getBrandVoiceModel() {
  return client.get('/settings/brand-voice-model').then((res) => res.data);
}

export function updateBrandVoiceModel(provider) {
  return client.put('/settings/brand-voice-model', { provider }).then((res) => res.data);
}

// Which provider finds the text + pictures on a theme-applied slide (Editor mode).
export function getThemeRegionsModel() {
  return client.get('/settings/theme-regions-model').then((res) => res.data);
}

export function updateThemeRegionsModel(provider) {
  return client.put('/settings/theme-regions-model', { provider }).then((res) => res.data);
}

// How Theme Apply handles the slide's photo: 'placeholder' (paste the original) | 'model' (model paints it).
export function getThemeApplyPhotoMode() {
  return client.get('/settings/theme-apply-photo').then((res) => res.data);
}

export function updateThemeApplyPhotoMode(mode) {
  return client.put('/settings/theme-apply-photo', { mode }).then((res) => res.data);
}
