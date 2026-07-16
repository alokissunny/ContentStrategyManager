import client from './client';

// The current week's generated plan (focus + funnel + 7 days), or null.
export function getCurrentRoute() {
  return client.get('/routes/current').then((res) => res.data.route);
}

// (Re)generate this week's plan from the latest Instagram analysis.
export function generateRoute() {
  return client.post('/routes/generate').then((res) => res.data.route);
}

// Toggle (or set) a day's published state.
export function markDayPublished(routeId, index, published) {
  return client
    .patch(`/routes/${routeId}/day/${index}`, published === undefined ? {} : { published })
    .then((res) => res.data.route);
}
