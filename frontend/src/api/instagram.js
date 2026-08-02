import client from './client';

export function fetchInstagram(username) {
  return client.post('/instagram/fetch', { username }).then((res) => res.data);
}

export function listInstagramProfiles() {
  return client.get('/instagram').then((res) => res.data);
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
