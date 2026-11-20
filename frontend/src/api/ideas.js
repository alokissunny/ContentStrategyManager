import client from './client';
import { ingestPlanDebug } from './posts';

// Next-post ideas ("What could you share next?") — backend services/nextPostIdea.js.
// → { ideas: [{ id, pillar, title, eyebrow, why, opening, questions, assets:[{url,…}], … }], cached, empty? }
// `handle` = the account the card is for (after a header switch the server may not know yet).
export function getNextIdeas({ refresh = false, handle = '' } = {}) {
  const params = { ...(refresh ? { refresh: 1 } : {}), ...(handle ? { handle } : {}) };
  return client.get('/ideas/next', { params, timeout: 3 * 60 * 1000 })
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
