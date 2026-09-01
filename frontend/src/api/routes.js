import client from './client';
import { addAiDebugEntry, fmtElapsed } from '../lib/aiDebug';

function ingestPlanDebug(label, data = {}) {
  const debug = data.debug;
  if (!debug) return;
  const elapsedMs = Number(debug.elapsedMs || data.usage?.elapsedMs) || 0;
  const agents = Array.isArray(debug.agents) ? debug.agents : null;
  if (agents?.length) {
    // Prepends reverse chronological; ingest bottom→top so Strategist stays first.
    [...agents].reverse().forEach((agent, i) => {
      addAiDebugEntry({
        source: agent.source || `${label} · step ${agents.length - i}`,
        model: agent.model || debug.model,
        prompt: agent.prompt,
        output: agent.output,
        elapsedMs: Number(agent.elapsedMs) || 0,
        note: debug.mode ? `mode: ${debug.mode}` : '',
      });
    });
    addAiDebugEntry({
      source: label,
      model: debug.model,
      elapsedMs,
      note: [
        debug.mode ? `mode: ${debug.mode}` : '',
        elapsedMs ? `complete generation ${fmtElapsed(elapsedMs)}` : '',
        `${agents.length} agent ${agents.length === 1 ? 'call' : 'calls'}`,
      ].filter(Boolean).join(' · '),
    });
    return;
  }
  if (debug.finalPrompt || debug.output) {
    addAiDebugEntry({
      source: label,
      model: debug.model,
      prompt: debug.finalPrompt,
      output: debug.output,
      systemPrompt: debug.systemPrompt,
      elapsedMs,
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

// Delete the running month's written weeks and next-month placeholders.
export function clearCurrentMonth() {
  return client.delete('/routes/current-month').then((res) => res.data);
}

// (Re)generate this month's plan from the latest Instagram analysis.
// → { route, expectedWeeks, filling, dataSource, fetchedAt }
// Optional `trigger` is logged on the server (e.g. replan-month, checkin).
export function generateRoute(trigger = 'generate', extras = {}) {
  const body = { trigger };
  const sessionId = String(extras.sessionId || '').trim();
  if (sessionId) body.sessionId = sessionId;
  if (Array.isArray(extras.captureIds) && extras.captureIds.length) {
    body.captureIds = extras.captureIds.map((id) => String(id || '').trim()).filter(Boolean);
  }
  return client.post('/routes/generate', body, { timeout: 10 * 60 * 1000 }).then((res) => {
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
      if (data.debug) {
        addAiDebugEntry({
          source: kind === 'words' ? 'Polish words' : 'Polish caption',
          model: data.model || data.debug.model,
          prompt: data.debug.finalPrompt,
          output: data.debug.output || data.caption,
          systemPrompt: data.debug.systemPrompt,
        });
      }
      return data;
    });
}

// Run the Layout agent on one post without regenerating the week.
export function runDayLayout(routeId, index) {
  return client
    .post(`/routes/${routeId}/day/${index}/layout`, {}, { timeout: 120000 })
    .then((res) => {
      const data = res.data || {};
      ingestPlanDebug('Layout agent (debug)', data);
      return data;
    });
}
