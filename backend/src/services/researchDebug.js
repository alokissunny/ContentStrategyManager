const { estimatePlanCostUsd } = require('./weeklyPlan');
function usageOf(model, usage = {}) {
  const inputTokens = Number(usage.input_tokens) || 0;
  const outputTokens = Number(usage.output_tokens) || 0;
  const cachedTokens = Number(usage.cached_tokens ?? usage.input_tokens_details?.cached_tokens) || 0;
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, cachedTokens, estimatedCostUsd: estimatePlanCostUsd(model, inputTokens, outputTokens, cachedTokens) };
}
function aiLogger(onAiCall) {
  return async (source, args, invoke) => {
    const started = Date.now();
    const entry = { source, model: args.model, systemPrompt: args.system || args.instructions || '', prompt: args.userParts ? JSON.stringify({ content: args.userParts, tool: args.tool }, null, 2) : args.input, note: 'Tentative token cost using app pricing estimates; excludes web-search fees. Not a billing total.' };
    try {
      const result = await invoke();
      const usage = usageOf(result.model || args.model, result.usage);
      onAiCall?.({ ...entry, model: result.model || args.model, output: result.parsed ? JSON.stringify(result.parsed, null, 2) : result.output_text || '', elapsedMs: Date.now() - started, usage });
      return result;
    } catch (error) {
      onAiCall?.({ ...entry, output: `Call failed: ${error.message}`, elapsedMs: Date.now() - started, note: `${entry.note} Usage unavailable for this failed call.`, usage: usageOf(args.model, error.usage) });
      throw error;
    }
  };
}
module.exports = { aiLogger, usageOf };
