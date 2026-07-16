import client from './client';

// Runs competitor discovery for a handle (defaults to the latest analysed one).
// Returns { username, baseRegion, baseFollowers, cohorts: { similar, higher }, competitorSet }.
export function fetchCompetitors(username, { verify = true } = {}) {
  return client
    .post('/competitors/fetch', { username, verify })
    .then((res) => res.data);
}

// Reads the last-saved competitor set without re-running the analysis.
export function getCompetitors(username) {
  return client
    .get('/competitors', { params: username ? { username } : undefined })
    .then((res) => res.data);
}
