import client from './client';
import { ingestPlanDebug } from './posts';

// Analysis › Mission coverage — the last 10 Instagram posts across Attract / Nurture / Position / Convert.
// → { total, counts, percents, focus, lead, note, posts: [{ id, image, caption, mission, pillar, reason, … }], analysedAt }
export function getMissionCoverage({ refresh = false } = {}) {
  return client.get('/analysis/missions', { params: refresh ? { refresh: 1 } : {}, timeout: 4 * 60 * 1000 })
    .then((res) => {
      const data = res.data || { posts: [] };
      ingestPlanDebug('Mission coverage', data);
      return data;
    });
}
