const { estimatePlanCostUsd } = require('./weeklyPlan');
const round = n => Math.round(n * 1e6) / 1e6;
function agentCost({ name, model, usage, elapsedMs, status }) {
  const inputTokens = Number(usage?.input_tokens ?? usage?.inputTokens) || 0;
  const outputTokens = Number(usage?.output_tokens ?? usage?.outputTokens) || 0;
  const cachedTokens = Number(usage?.cached_tokens ?? usage?.cachedTokens) || 0;
  return { source: `Podcast — ${name}`, model, elapsedMs, note: usage ? `Estimated API cost using configured model rates. ${status || 'completed'}.` : 'Provider usage unavailable; cost excluded from the estimate.', costUnknown: !usage,
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, estimatedCostUsd: usage ? estimatePlanCostUsd(model, inputTokens, outputTokens, cachedTokens) : 0 } };
}
function transcriptionCost({ model, seconds, elapsedMs, failed }) {
  // Whisper list rate: https://developers.openai.com/api/docs/models/whisper-1
  const override = process.env.PODCAST_TRANSCRIPTION_USD_PER_MINUTE;
  const rate = override != null && override !== '' ? Number(override) : model === 'whisper-1' ? 0.006 : NaN;
  const known = !failed && Number.isFinite(rate) && rate >= 0;
  return { source: 'Podcast — transcription', model, elapsedMs, costUnknown: !known,
    note: known ? `${seconds.toFixed(2)} seconds transcribed × $${rate}/minute (estimate).` : 'Transcription cost unavailable; excluded from the estimate.',
    output: { audioSeconds: seconds, status: failed ? 'failed' : 'completed', ratePerMinute: known ? rate : null },
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: known ? round(seconds / 60 * rate) : 0 } };
}
function podcastDebug(job) {
  const entries = job.costEntries || [];
  const cost = entries.reduce((sum, entry) => {
    for (const key of Object.keys(sum)) sum[key] += entry.usage?.[key] || 0;
    return sum;
  }, { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 });
  cost.estimatedCostUsd = round(cost.estimatedCostUsd);
  const unknown = entries.filter(e => e.costUnknown).length;
  return { agents: [...entries.map((entry, i) => ({ ...entry, id: `podcast:${job.id}:call:${i}` })), {
    id: `podcast:${job.id}:total`, source: 'Podcast generation — estimated cost', model: [...new Set(entries.map(e => e.model).filter(Boolean))].join(' + '),
    usage: cost, elapsedMs: entries.reduce((sum, e) => sum + (e.elapsedMs || 0), 0),
    output: { jobId: job.id, status: job.status, breakdown: entries.map(e => ({ source: e.source, model: e.model, ...e.usage, costUnknown: e.costUnknown })) },
    note: `Estimated AI subtotal: $${cost.estimatedCostUsd.toFixed(4)} · ${job.status}. ${unknown ? `${unknown} call(s) have unavailable costs. ` : ''}Includes reported agent usage and successful transcription estimates; excludes unreported retries, rendering, storage and transfer.`,
  }] };
}
module.exports = { agentCost, transcriptionCost, podcastDebug };
