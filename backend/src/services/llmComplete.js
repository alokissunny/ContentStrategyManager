const getAnthropicClient = require('./anthropicClient');
const getOpenAIClient = require('./openaiClient');

function usesCompletionTokens(model) {
  return /gpt-5|terra|o3|o4/i.test(String(model || ''));
}

function isOpenAIModel(model) {
  return /gpt|o1|o3|o4|terra/i.test(String(model || ''));
}

function planTextModel(kind) {
  if (kind === 'day') {
    return process.env.PLAN_DAY_MODEL
      || process.env.PLAN_AGENT_MODEL
      || process.env.OPENAI_MODEL
      || process.env.COMPETITOR_MODEL
      || 'gpt-5.6-terra';
  }
  return process.env.PLAN_AGENT_MODEL
    || process.env.OPENAI_MODEL
    || process.env.COMPETITOR_MODEL
    || 'gpt-5.6-terra';
}

function textOfAnthropic(response) {
  return (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/**
 * Provider-agnostic text completion for plan generation.
 * Returns { text, model, stopReason, usage: { input_tokens, output_tokens } }.
 * stopReason is 'max_tokens' when the output was truncated.
 */
async function completeText({ model, prompt, maxTokens }) {
  const resolved = model || planTextModel();
  if (isOpenAIModel(resolved)) {
    const tokenArg = usesCompletionTokens(resolved)
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens };
    const response = await getOpenAIClient().chat.completions.create({
      model: resolved,
      messages: [{ role: 'user', content: prompt }],
      ...tokenArg,
    });
    const choice = response.choices?.[0] || {};
    const usage = response.usage || {};
    return {
      text: choice.message?.content || '',
      model: resolved,
      stopReason: choice.finish_reason === 'length' ? 'max_tokens' : (choice.finish_reason || ''),
      usage: {
        input_tokens: Number(usage.prompt_tokens || usage.input_tokens) || 0,
        output_tokens: Number(usage.completion_tokens || usage.output_tokens) || 0,
      },
    };
  }

  const response = await getAnthropicClient().messages.create({
    model: resolved,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  return {
    text: textOfAnthropic(response),
    model: resolved,
    stopReason: response.stop_reason || '',
    usage: {
      input_tokens: Number(response.usage?.input_tokens) || 0,
      output_tokens: Number(response.usage?.output_tokens) || 0,
    },
  };
}

module.exports = {
  completeText,
  planTextModel,
  isOpenAIModel,
  usesCompletionTokens,
};
