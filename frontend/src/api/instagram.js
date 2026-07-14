import client from './client';

export function fetchInstagram(username) {
  return client.post('/instagram/fetch', { username }).then((res) => res.data);
}

export function listInstagramProfiles() {
  return client.get('/instagram').then((res) => res.data);
}

export function getReportDownloadUrl(reportId) {
  return client.get(`/analysis/reports/${reportId}/download`).then((res) => res.data.downloadUrl);
}

export function confirmReport(reportId, summary) {
  return client.patch(`/analysis/reports/${reportId}`, summary).then((res) => res.data);
}
