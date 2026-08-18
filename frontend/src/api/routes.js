import client from './client';
import { addAiDebugEntry } from '../lib/aiDebug';

function ingestPlanDebug(label, data = {}) {
  const debug = data.debug;
  if (!debug) return;
  const agents = Array.isArray(debug.agents) ? debug.agents : null;
  if (agents?.length) {
    // Prepends reverse chronological; ingest bottom→top so Strategist stays first.
    [...agents].reverse().forEach((agent, i) => {
      addAiDebugEntry({
        source: agent.source || `${label} · step ${agents.length - i}`,
        model: agent.model || debug.model,
        prompt: agent.prompt,
        note: debug.mode ? `mode: ${debug.mode}` : '',
      });
    });
    return;
  }
  if (debug.finalPrompt) {
    addAiDebugEntry({
      source: label,
      model: debug.model,
      prompt: debug.finalPrompt,
      note: debug.mode ? `mode: ${debug.mode}` : '',
    });
  }
}

// The current week's plan for the *current* handle.
// → { route, preparing, username } — `preparing` is true while the background
//   chain is still building a plan for a freshly (re)connected account.
export function getCurrentRoute() {
  return client.get('/routes/current').then((res) => res.data);
}

// Every plan the user has — newest week first. Drives the Plans list history.
export function getRoutes() {
  return client.get('/routes').then((res) => res.data.routes || []);
}

// (Re)generate this month's plan from the latest Instagram analysis.
// → { route, expectedWeeks, filling, dataSource, fetchedAt }
// Optional `trigger` is logged on the server (e.g. replan-month, checkin).
export function generateRoute(trigger = 'generate') {
  return client.post('/routes/generate', { trigger }).then((res) => {
    const data = res.data || {};
    ingestPlanDebug(`Generate plan (${trigger})`, data);
    return data;
  });
}

// Replan one existing week in place (Brand DNA + projects + cohort + that week's pillar).
// → { route }
export function replanWeek(routeId, trigger = 'replan-week') {
  return client.post(`/routes/${routeId}/replan`, { trigger }).then((res) => {
    const data = res.data || {};
    ingestPlanDebug(`Replan week (${trigger})`, data);
    return data.route;
  });
}

// Toggle (or set) a day's published state.
export function markDayPublished(routeId, index, published) {
  return client
    .patch(`/routes/${routeId}/day/${index}`, published === undefined ? {} : { published })
    .then((res) => res.data.route);
}

// Schedule (or unschedule) a day's post. Pass an ISO string to set the slot,
// or null to clear it.
export function scheduleDay(routeId, index, scheduledAt) {
  return client
    .patch(`/routes/${routeId}/day/${index}`, { scheduledAt })
    .then((res) => res.data.route);
}

// Set a day's publish time and/or the plan's weekly time preference. Pass
// `time` (24h "HH:MM", '' to clear) for this post, and/or `postAtPref` for the
// whole plan's "use this time every week".
export function setDayTime(routeId, index, { time, postAtPref } = {}) {
  const body = {};
  if (time !== undefined) body.time = time;
  if (postAtPref !== undefined) body.postAtPref = postAtPref;
  return client
    .patch(`/routes/${routeId}/day/${index}`, body)
    .then((res) => res.data.route);
}

// Persist slide / caption / notes edits for one day.
export function updateDayContent(routeId, index, content) {
  return client
    .patch(`/routes/${routeId}/day/${index}`, { content })
    .then((res) => res.data.route);
}

// Rewrite a day's caption with Claude / OpenAI. Returns { caption } for the
// draft — Done still persists it.
export function polishCaption(routeId, index, { caption, instruction, kind, role, fills }) {
  return client
    .post(`/routes/${routeId}/day/${index}/polish-caption`, { caption, instruction, kind, role, fills })
    .then((res) => {
      const data = res.data || {};
      if (data.debug?.finalPrompt) {
        addAiDebugEntry({
          source: kind === 'words' ? 'Polish words' : 'Polish caption',
          model: data.model || data.debug.model,
          prompt: data.debug.finalPrompt,
          note: data.debug.systemPrompt ? 'System prompt attached on server.' : '',
        });
      }
      return data;
    });
}
