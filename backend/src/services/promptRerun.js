const getAnthropicClient = require('./anthropicClient');
const getOpenAIClient = require('./openaiClient');
const captureUnderstand = require('./captureUnderstand');
const checkinUnderstand = require('./checkinUnderstand');

const DEFAULT_MAX_TOKENS = 16384;

function usesCompletionTokens(model) {
  return /gpt-5|terra|o3|o4/i.test(String(model || ''));
}

function providerFor(model) {
  const m = String(model || '').toLowerCase();
  if (/gemini|imagen|flash-image|nano.?banana/.test(m)) return 'image';
  if (/gpt|o1|o3|o4|terra/.test(m)) return 'openai';
  if (/claude|sonnet|haiku|opus/.test(m)) return 'anthropic';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return '';
}

function fail(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  throw err;
}

function maxTokens() {
  const n = Number(process.env.DEBUG_RERUN_MAX_TOKENS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_TOKENS;
}

function toolsFor(systemPrompt) {
  const s = String(systemPrompt || '');
  if (s.includes(checkinUnderstand.TOOL_NAME)) {
    return {
      tools: [checkinUnderstand.UNDERSTAND_TOOL],
      tool_choice: { type: 'tool', name: checkinUnderstand.TOOL_NAME },
    };
  }
  if (s.includes(captureUnderstand.TOOL_NAME)) {
    return {
      tools: [captureUnderstand.UNDERSTAND_TOOL],
      tool_choice: { type: 'tool', name: captureUnderstand.TOOL_NAME },
    };
  }
  return {};
}

function outputOfAnthropic(response) {
  const blocks = response.content || [];
  const texts = blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .filter(Boolean);
  const tools = blocks.filter((block) => block.type === 'tool_use' && block.input != null);
  if (tools.length) {
    const payload = tools.length === 1
      ? tools[0].input
      : tools.map((t) => ({ name: t.name, input: t.input }));
    const json = JSON.stringify(payload, null, 2);
    return texts.length ? `${texts.join('\n')}\n\n${json}` : json;
  }
  return texts.join('\n');
}

async function completeAnthropic({ model, systemPrompt, prompt }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    fail('ANTHROPIC_API_KEY is not set.', 503);
  }
  const resolved = model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const params = {
    model: resolved,
    max_tokens: maxTokens(),
    messages: [{ role: 'user', content: prompt }],
    ...toolsFor(systemPrompt),
  };
  if (systemPrompt) params.system = systemPrompt;
  const response = await getAnthropicClient().messages.create(params);
  return { output: outputOfAnthropic(response), model: resolved };
}

async function completeOpenAI({ model, systemPrompt, prompt }) {
  if (!process.env.OPENAI_API_KEY) {
    fail('OPENAI_API_KEY is not set.', 503);
  }
  const resolved = model || process.env.OPENAI_MODEL || process.env.COMPETITOR_MODEL || 'gpt-4.1-mini';
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });
  const tokenArg = usesCompletionTokens(resolved)
    ? { max_completion_tokens: maxTokens() }
    : { max_tokens: maxTokens() };
  const response = await getOpenAIClient().chat.completions.create({
    model: resolved,
    messages,
    ...tokenArg,
  });
  return { output: response.choices?.[0]?.message?.content || '', model: resolved };
}

/**
 * Re-run a captured debug prompt against the same provider/model.
 * `prompt` is the user Input (possibly edited). `systemPrompt` is optional.
 */
async function rerunPrompt({ model, systemPrompt, prompt }) {
  const input = String(prompt || '').trim();
  if (!input) fail('Input is required.', 400);

  const system = String(systemPrompt || '').trim();
  const named = String(model || '').trim();
  const provider = providerFor(named);

  if (provider === 'image') {
    fail('Image models cannot be rerun as a text prompt.', 400);
  }
  if (provider === 'openai') {
    return completeOpenAI({ model: named, systemPrompt: system, prompt: input });
  }
  if (provider === 'anthropic') {
    return completeAnthropic({ model: named, systemPrompt: system, prompt: input });
  }
  fail('AI is not configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY).', 503);
}

module.exports = { rerunPrompt };
