import client from './client';

export function getBrandDna() {
  return client.get('/analysis/reports/latest/brand-dna').then((res) => res.data);
}

export function updateBrandDna(reportId, sections) {
  return client.patch(`/analysis/reports/${reportId}/brand-dna`, { sections }).then((res) => res.data);
}
