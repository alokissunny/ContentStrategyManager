import client from './client';

// The competitor cohort overview assigned to this user by an operator: the same
// analysis the back office Overview shows, scoped to the user's cohort.
// Returns { cohort, scopeUsed, dashboard, generatedAt, accountsAnalyzed, postsAnalyzed }.
export function getCompetitorOverview() {
  return client.get('/competitors/overview').then((res) => res.data);
}
