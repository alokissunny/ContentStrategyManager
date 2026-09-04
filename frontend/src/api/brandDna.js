import client from './client';

export function getBrandDna() {
  return client.get('/analysis/reports/latest/brand-dna').then((res) => res.data);
}

export function updateBrandDna(reportId, sections) {
  return client.patch(`/analysis/reports/${reportId}/brand-dna`, { sections }).then((res) => res.data);
}

/** Merge a free-text note into Business memory (AI revises the right sections). */
export function reviseBrandDna(reportId, note) {
  return client.post(`/analysis/reports/${reportId}/brand-dna/revise`, { note }).then((res) => res.data);
}
