import client from './client';
import { ingestPlanDebug } from './posts';

// Next-post ideas ("What could you share next?") — backend services/nextPostIdea.js.
// → { ideas: [{ id, pillar, title, eyebrow, why, opening, questions, assets:[{url,…}], … }], cached, empty? }
export function getNextIdeas({ refresh = false } = {}) {
  return client.get('/ideas/next', { params: refresh ? { refresh: 1 } : {}, timeout: 3 * 60 * 1000 })
    .then((res) => {
      const data = res.data || { ideas: [] };
      ingestPlanDebug('Next-post idea', data);
      return data;
    });
}

// status: 'accepted' (explored, a capture came of it) | 'saved' | 'dismissed'
export function updateIdea(id, status, captureId = '') {
  return client.patch(`/ideas/${id}`, { status, ...(captureId ? { captureId } : {}) })
    .then((res) => res.data?.idea || null);
}
