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

// The recommended reel for an explored idea (backend services/ideaReelPlan.js):
// → { plan: { format, priority, title, formatSummary, formatWhy, estimatedSec, caption, sequences }, idea, cached }
// `format` re-plans the same story in another reel format (Explore alternatives).
export function getIdeaReelPlan(id, { captureId = '', format = '', refresh = false } = {}) {
  return client.post(`/ideas/${id}/reel-plan`, { captureId, format, refresh }, { timeout: 3 * 60 * 1000 })
    .then((res) => {
      const data = res.data || {};
      ingestPlanDebug('Idea reel plan', data);
      return data;
    });
}

// Captures › Generate reel: the capture's own idea, so the same reel planner
// (ReelPlanner) runs on it → { idea, captureId }
export function ideaFromCapture(captureIds) {
  return client.post('/ideas/from-capture', { captureIds }).then((res) => res.data);
}
