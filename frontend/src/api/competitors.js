import client from './client';

// The competitor cohort overview for the *active* Instagram handle: the same
// analysis the back office Overview shows, scoped to that handle's cohort.
// Returns { username, cohort, scopeUsed, dashboard, generatedAt, otherAssignedHandles, … }.
export function getCompetitorOverview() {
  return client
    .get('/competitors/overview', { params: { _ts: Date.now() } })
    .then((res) => res.data);
}
