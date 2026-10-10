import client from './client';
import { ingestPlanDebug } from './posts';
import { addAiDebugEntry } from '../lib/aiDebug';

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

/** Merge answers from the gap interview into Brand DNA. */
export function fillBrandDnaGaps(reportId, answers) {
  return client.post(`/analysis/reports/${reportId}/brand-dna/fill-gaps`, { answers }).then((res) => res.data);
}

/** Full stored snapshot for debug (Mongo Brand DNA + S3 analysis markdown). */
export function getBrandDnaRaw(reportId) {
  return client.get(`/analysis/reports/${reportId}/brand-dna/raw`).then((res) => res.data);
}

/** Read the last 10 Instagram posts and store the account's Brand Voice. */
// The posts step is not a model call — log it as its own row so the summary
// row counts (and costs) only the AI calls.
function ingestBrandVoiceDebug(data) {
  const agents = Array.isArray(data?.debug?.agents) ? data.debug.agents : [];
  const isAi = (a) => !/no AI call/.test(a?.note || '');
  agents.filter((a) => !isAi(a)).forEach((a) => addAiDebugEntry({
    source: a.source,
    model: a.model,
    output: a.output,
    elapsedMs: a.elapsedMs,
    note: a.note,
  }));
  ingestPlanDebug('Brand voice', { ...data, debug: { ...data.debug, agents: agents.filter(isAi) } });
}

export function fetchBrandVoice(reportId) {
  return client.post(`/analysis/reports/${reportId}/brand-voice`)
    .then((res) => {
      // AI debug panel: post fetch + each model call with tokens and cost
      if (res.data?.debug) ingestBrandVoiceDebug(res.data);
      return res.data;
    })
    .catch((err) => {
      if (err.response?.data?.debug) ingestBrandVoiceDebug(err.response.data);
      throw err;
    });
}
