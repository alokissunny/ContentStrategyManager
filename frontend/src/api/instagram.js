import client from './client';

// AnalyzeScreen's useEffect runs twice in React Strict Mode (dev). Scraping is
// expensive (1–2 min), so concurrent calls for the same handle share one request.
const inflightFetches = new Map();

export function fetchInstagram(username) {
  const key = String(username || '').trim().toLowerCase();
  if (inflightFetches.has(key)) return inflightFetches.get(key);

  const promise = client
    .post('/instagram/fetch', { username })
    .then((res) => res.data)
    .finally(() => {
      inflightFetches.delete(key);
    });

  inflightFetches.set(key, promise);
  return promise;
}

export function listInstagramProfiles() {
  return client.get('/instagram').then((res) => res.data);
}

// Make an already-connected handle the current one across the app. Returns
// { profile, profiles } with the now-current handle first.
export function activateInstagramProfile(username) {
  return client.post('/instagram/activate', { username }).then((res) => res.data);
}

export function getAuthorityFunnel(username) {
  return client
    .get('/instagram/authority', { params: username ? { username } : undefined })
    .then((res) => res.data);
}

// Full analysis modal: verdict, account summary, strengths, opportunities,
// similar accounts (when cohort assigned), strategic focus, shapes-week.
export function getAnalysisOverview(username) {
  return client
    .get('/instagram/analysis-overview', { params: username ? { username } : undefined })
    .then((res) => res.data);
}

export function getReportDownloadUrl(reportId) {
  return client.get(`/analysis/reports/${reportId}/download`).then((res) => res.data.downloadUrl);
}

export function confirmReport(reportId, summary) {
  return client.patch(`/analysis/reports/${reportId}`, summary).then((res) => res.data);
}
