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

// Fetch recent — adds only the posts published after the newest one already analysed. → coverage + { added }
export function fetchRecentMissionPosts() {
  return client.post('/analysis/missions/fetch', {}, { timeout: 5 * 60 * 1000 })
    .then((res) => {
      const data = res.data || { posts: [] };
      ingestPlanDebug('Mission coverage · fetch recent', data);
      return data;
    });
}

// Analysis › Topic map — Skills / Passion / Story topics the studio could talk about, covered or not.
// → { summary, pillarNotes: { skills, passion, story }, topics: [{ id, pillar, topic, detail, status, coveredBy, missions, audience, needs }], at }
export function getContentTopics({ refresh = false } = {}) {
  return client.get('/analysis/topics', { params: refresh ? { refresh: 1 } : {}, timeout: 4 * 60 * 1000 })
    .then((res) => {
      const data = res.data || { topics: [] };
      ingestPlanDebug('Topic map', data);
      return data;
    });
}
