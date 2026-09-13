import client from './client';

// The carousel agent's model + reasoning level. Read by anyone signed in;
// updated only by an admin (enforced server-side).
export function getCarouselModel() {
  return client.get('/settings/carousel-model').then((res) => res.data);
}

export function updateCarouselModel({ model, reasoningEffort } = {}) {
  return client.put('/settings/carousel-model', { model, reasoningEffort }).then((res) => res.data);
}
