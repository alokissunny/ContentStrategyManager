import client from './client';
import { addAiDebugEntry, fmtElapsed, fmtCost } from '../lib/aiDebug';
import { getActiveHandle } from '../lib/store';

function usageFrom(agent = {}, fallback = {}) {
  const u = agent.usage && typeof agent.usage === 'object' ? agent.usage : agent;
  const fb = fallback.usage && typeof fallback.usage === 'object' ? fallback.usage : fallback;
  return {
    inputTokens: Number(u.inputTokens ?? fb.inputTokens) || 0,
    outputTokens: Number(u.outputTokens ?? fb.outputTokens) || 0,
    totalTokens: Number(u.totalTokens ?? fb.totalTokens) || 0,
    estimatedCostUsd: Number(u.estimatedCostUsd ?? fb.estimatedCostUsd) || 0,
  };
}

// Fold a plan-generation debug payload into the AI debug panel (per-agent
// prompts/outputs + a summary row). Shared by generate and the on-demand agents.
function ingestPlanDebug(label, data = {}) {
  const debug = data.debug;
  if (!debug) return;
  const elapsedMs = Number(debug.elapsedMs || data.usage?.elapsedMs) || 0;
  const agents = Array.isArray(debug.agents) ? debug.agents : null;
  let genUsage = usageFrom(debug.usage || data.usage || {});
  if (agents?.length && !genUsage.estimatedCostUsd && !genUsage.totalTokens) {
    genUsage = agents.reduce((acc, agent) => {
      const u = usageFrom(agent);
      return {
        inputTokens: acc.inputTokens + u.inputTokens,
        outputTokens: acc.outputTokens + u.outputTokens,
        totalTokens: acc.totalTokens + u.totalTokens,
        estimatedCostUsd: Math.round((acc.estimatedCostUsd + u.estimatedCostUsd) * 1e6) / 1e6,
      };
    }, { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 });
  }
  if (agents?.length) {
    [...agents].reverse().forEach((agent, i) => {
      const usage = usageFrom(agent);
      addAiDebugEntry({
        source: agent.source || `${label} · step ${agents.length - i}`,
        model: agent.model || debug.model,
        prompt: agent.prompt,
        output: agent.output,
        elapsedMs: Number(agent.elapsedMs) || 0,
        note: debug.mode ? `mode: ${debug.mode}` : '',
        ...usage,
        preview: agent.preview,
      });
    });
    const costLabel = fmtCost(genUsage.estimatedCostUsd);
    addAiDebugEntry({
      source: label,
      model: debug.model,
      elapsedMs,
      ...genUsage,
      // an edit's summary row carries what was asked and how it ended
      prompt: debug.instruction || '',
      output: debug.error ? `Error — ${debug.error}` : '',
      note: [
        debug.mode ? `mode: ${debug.mode}` : '',
        debug.error ? 'failed' : '',
        elapsedMs ? `complete generation ${fmtElapsed(elapsedMs)}` : '',
        costLabel ? `~${costLabel} est.` : '',
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
      ...genUsage,
    });
  }
}

// Every planned post for the active handle, oldest date first. Also returns
// `preparing` (true while the background chain is still building the first plan)
// so the Calendar can paint immediately.
// → { posts, preparing, username }
//
// Concurrent callers share one request. React StrictMode runs mount effects
// twice in dev, and the account-switch remount can re-trigger a load, so without
// this the Calendar fires GET /posts twice; the in-flight promise coalesces them.
// Keyed by the active handle + requested window so a soft account switch (or a
// widened calendar range) never shares a previous in-flight request with the
// newly-remounted page. `from`/`to` are optional "YYYY-MM-DD" bounds — omit both
// for the full list. The calendar sends the range it is showing (plus buffer) so
// the payload stays bounded as a handle's history grows.
let postsInflight = null;
let postsInflightKey = null;
export function getPosts({ from, to } = {}) {
  const handle = getActiveHandle();
  const params = {};
  if (from) params.from = from;
  if (to) params.to = to;
  const key = `${handle}|${params.from || ''}|${params.to || ''}`;
  if (postsInflight && postsInflightKey === key) return postsInflight;
  postsInflightKey = key;
  const p = client.get('/posts', { params })
    .then((res) => ({
      posts: res.data.posts || [],
      preparing: Boolean(res.data.preparing),
      username: res.data.username || null,
    }))
    .finally(() => { if (postsInflight === p) postsInflight = null; });
  postsInflight = p;
  return p;
}

// The full render payload for one post (content minus agentTrace and the heavy
// slides.layoutOptions, both fetched on demand). → post | null
// Coalesce concurrent opens of the same post (StrictMode / calendar + editor).
const postInflight = new Map();
export function getPost(id) {
  const key = String(id || '');
  if (!key) return Promise.resolve(null);
  if (postInflight.has(key)) return postInflight.get(key);
  const p = client.get(`/posts/${key}`)
    .then((res) => res.data?.post || null)
    .finally(() => { postInflight.delete(key); });
  postInflight.set(key, p);
  return p;
}

// Fill empty calendar slots with fresh posts from the latest analysis.
// Optional `trigger` is logged server-side. → { posts, count, ... }
export function generatePlan(trigger = 'generate', extras = {}) {
  const body = { trigger };
  const sessionId = String(extras.sessionId || '').trim();
  if (sessionId) body.sessionId = sessionId;
  if (Array.isArray(extras.captureIds) && extras.captureIds.length) {
    body.captureIds = extras.captureIds.map((id) => String(id || '').trim()).filter(Boolean);
  }
  // Fill only the studio's chosen publishing weekdays (Distribute panel), so a
  // fresh post takes the next allowed slot rather than the next calendar day.
  if (extras.mode) body.mode = extras.mode;
  if (Array.isArray(extras.days)) body.days = extras.days;
  return client.post('/posts/generate', body, { timeout: 10 * 60 * 1000 }).then((res) => {
    const data = res.data || {};
    ingestPlanDebug(`Generate posts (${trigger})`, data);
    return data;
  });
}

// Delete every unpublished planned post for the active handle (full calendar).
export function clearUpcoming() {
  return client.delete('/posts').then((res) => res.data);
}

// Reallocate the upcoming movable posts (after today, not published/scheduled)
// onto the chosen publishing weekdays. mode: 'days' (a weekday set) | 'weekly'
// (an even spread). Returns { posts, moved } — the full refreshed calendar.
export function distributePosts(mode, days) {
  return client.post('/posts/distribute', { mode, days }).then((res) => res.data);
}

// The current handle's saved publishing-day rule → { mode, days }.
export function getDistribution() {
  return client.get('/posts/distribution').then((res) => res.data);
}

// Persist the publishing-day rule for the current handle. New posts allocate onto
// these weekdays from now on. Returns the saved { mode, days }.
export function saveDistribution(mode, days) {
  return client.put('/posts/distribution', { mode, days }).then((res) => res.data);
}

// Apply a Shift posts proposal: { [postId]: 'YYYY-MM-DD', ... }.
// Returns { posts, moved } — the full refreshed calendar list.
export function shiftPosts(moves) {
  return client.post('/posts/shift', { moves }).then((res) => res.data);
}

// ── Per-post edits — all thin wrappers over PATCH /posts/:id ────────────────

// Persist slide / caption / notes edits.
export function updatePostContent(id, content) {
  return client.patch(`/posts/${id}`, { content }).then((res) => res.data.post);
}

// Toggle (or set) a post's published state.
export function markPublished(id, published) {
  return client
    .patch(`/posts/${id}`, published === undefined ? {} : { published })
    .then((res) => res.data.post);
}

// Schedule (or unschedule) a post. Pass an ISO string to set the slot, or null
// to clear it. Scheduling stores rendered JPEG keys for the daily job.
export function schedulePost(id, scheduledAt, extras = {}) {
  const body = { scheduledAt };
  if (extras.publishImageKeys !== undefined) body.publishImageKeys = extras.publishImageKeys;
  return client.patch(`/posts/${id}`, body).then((res) => res.data.post);
}

// Re-queue a failed scheduled post for the next daily run.
export function retryScheduled(id) {
  return client.patch(`/posts/${id}`, { scheduleStatus: 'ready' }).then((res) => res.data.post);
}

// Set a post's publish time (24h "HH:MM", '' to clear).
export function setPostTime(id, time) {
  return client.patch(`/posts/${id}`, { time }).then((res) => res.data.post);
}

// "Save for review" — hold the post in the calendar as a draft (true), or
// release that hold (false). Turning it on also clears any pending schedule.
export function setPostReview(id, savedForReview) {
  return client
    .patch(`/posts/${id}`, { savedForReview: Boolean(savedForReview) })
    .then((res) => res.data.post);
}

// Rewrite a post's caption/words. Returns { caption } for the draft — the studio
// still has to press Done to persist it.
export function polishCaption(id, { caption, instruction, kind, role, fills }) {
  return client
    .post(`/posts/${id}/polish-caption`, { caption, instruction, kind, role, fills })
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

// Run the Carousel agent on one post (long — a high-reasoning model can take
// several minutes). Optional themeId rebuilds the carousel in that visual theme.
// Optional referenceImageKey (an uploaded photo's S3 key) rebuilds it instead
// using that photo's look — the server reads it with vision and hands the
// agent a description to design from.
// → { post, layout, ... }
export function runPostLayout(id, { themeId, referenceImageKey } = {}) {
  const body = referenceImageKey ? { referenceImageKey } : (themeId ? { themeId } : {});
  return client.post(`/posts/${id}/layout`, body, { timeout: 540000 }).then((res) => {
    const data = res.data || {};
    ingestPlanDebug('Carousel agent (debug)', data);
    return data;
  });
}

// Editor mode's prompt band: recreate the carousel with an instruction applied.
// `current` is the carousel as the studio sees it (every hand edit baked in,
// each slide's pictures) — the reference the model rebuilds from. The server
// saves the result and returns the post. slideIndex null = every slide.
// → { post, changed: [slideIndex…] }
export function refinePost(id, { instruction, slideIndex, focus, current, visual, visualSlideIndex, layoutIssues, geometry, slideCss, intent } = {}) {
  // one debug-panel group per edit: every step's input and output, then a
  // summary row with the instruction — on failure too
  const label = layoutIssues?.length
    ? `Prompt edit — layout repair (${layoutIssues.length} problem${layoutIssues.length === 1 ? '' : 's'})`
    : `Prompt edit — “${String(instruction || '').slice(0, 60)}${String(instruction || '').length > 60 ? '…' : ''}”`;
  return client
    .post(`/posts/${id}/refine`, { instruction, slideIndex, focus, current, visual, visualSlideIndex, layoutIssues, geometry, slideCss, intent }, { timeout: 540000 })
    .then((res) => {
      const data = res.data || {};
      ingestPlanDebug(label, data);
      return data;
    })
    .catch((err) => {
      const data = err?.response?.data;
      if (data?.debug) ingestPlanDebug(label, data);
      else {
        addAiDebugEntry({
          source: label,
          prompt: String(instruction || ''),
          output: `Error — ${data?.message || err?.message || 'request failed'}`,
          note: 'mode: carousel-refine · failed before the server answered',
        });
      }
      throw err;
    });
}

// The project a post was written from — Add slide files its capture there.
// → { projectId, projectName }
export function getPostProject(id) {
  return client.get(`/posts/${id}/project`).then((r) => r.data || {});
}

// Editor mode › Slide › Add before / Add after: the Add Slide agent writes one
// new slide at `at` (0-based) from the studio's capture + the post's strategy.
// → { post, index (the new slide's 1-based index), visual }
export function addSlideFromCapture(id, { at, capture, current } = {}) {
  const label = `Add slide — “${String(capture?.text || '').slice(0, 60)}${String(capture?.text || '').length > 60 ? '…' : ''}”`;
  return client
    .post(`/posts/${id}/slides`, { at, capture, current }, { timeout: 300000 })
    .then((res) => {
      const data = res.data || {};
      ingestPlanDebug(label, data);
      return data;
    })
    .catch((err) => {
      const data = err?.response?.data;
      if (data?.debug) ingestPlanDebug(label, data);
      else {
        addAiDebugEntry({
          source: label,
          prompt: String(capture?.text || ''),
          output: `Error — ${data?.message || err?.message || 'request failed'}`,
          note: 'mode: add-slide · failed before the server answered',
        });
      }
      throw err;
    });
}

// Run the on-demand Layout Variation agent for ONE slide (Change layout).
// slideIndex is the slide's 1-based data-index. → { options, slideIndex }
export function runSlideLayoutVariations(id, slideIndex) {
  return client
    .post(`/posts/${id}/slide/${slideIndex}/layout-variations`, {}, { timeout: 240000 })
    .then((res) => {
      const data = res.data || {};
      ingestPlanDebug('Layout variations (debug)', data);
      return data;
    });
}

// Run the Animated Carousel Cover agent on the post's hook.
// → { post, cover: { spec, videoKey, videoUrl } }
export function runPostCover(id, visual) {
  return client
    .post(`/posts/${id}/cover`, visual ? { visual } : {}, { timeout: 240000 })
    .then((res) => res.data || {});
}

// Every slide's stored layout options for this post (fetched once when Change
// layout first opens). → [{ index, layoutOptions }]
export function getPostOptions(id) {
  return client.get(`/posts/${id}/options`).then((res) => (Array.isArray(res.data?.slides) ? res.data.slides : []));
}

// The post's raw agent trace (layout/carousel HTML) for the Debug Preview.
export function getPostDebug(id) {
  return client.get(`/posts/${id}/debug`).then((res) => res.data?.agentTrace || {});
}
