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
  if (kind === 'quality') {
    return process.env.PLAN_QUALITY_MODEL
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

function conversationModel() {
  return process.env.OPENAI_CAPTURE_MODEL
    || process.env.OPENAI_MODEL
    || process.env.PLAN_AGENT_MODEL
    || process.env.COMPETITOR_MODEL
    || 'gpt-5.6-terra';
}

function hasConversationModel() {
  const model = conversationModel();
  if (isOpenAIModel(model)) return Boolean(process.env.OPENAI_API_KEY);
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function textOfAnthropic(response) {
  return (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function tokenArgFor(model, maxTokens) {
  return usesCompletionTokens(model)
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens };
}

function openaiToolOf(tool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || { type: 'object', properties: {} },
    },
  };
}

function toOpenAIUserContent(parts) {
  const list = Array.isArray(parts) ? parts : [];
  const content = list.map((p) => {
    if (p?.type === 'image' && p.data) {
      const media = p.mediaType || 'image/jpeg';
      return {
        type: 'image_url',
        image_url: { url: `data:${media};base64,${p.data}` },
      };
    }
    if (p?.type === 'text' || p?.text) return { type: 'text', text: String(p.text || '') };
    return null;
  }).filter(Boolean);
  if (content.length === 1 && content[0].type === 'text') return content[0].text;
  return content.length ? content : '';
}

function toAnthropicUserContent(parts) {
  const list = Array.isArray(parts) ? parts : [];
  const content = list.map((p) => {
    if (p?.type === 'image' && p.data) {
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: p.mediaType || 'image/jpeg',
          data: p.data,
        },
      };
    }
    if (p?.type === 'text' || p?.text) return { type: 'text', text: String(p.text || '') };
    return null;
  }).filter(Boolean);
  return content.length ? content : [{ type: 'text', text: '' }];
}

function parseToolArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  const s = String(raw || '').trim();
  if (!s) throw new Error('No tool input or JSON in model response');
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : s;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) return JSON.parse(candidate);
  return JSON.parse(candidate.slice(start, end + 1));
}

function jsonSchemaInstruction(tool) {
  const schema = JSON.stringify(tool?.input_schema || { type: 'object' });
  return [
    'Do not call tools. Return only a JSON object that matches this schema.',
    'Omit optional keys that are empty. Booleans must be true or false.',
    schema,
  ].join('\n');
}

const GPT_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'];
const GPT_VERBOSITY = ['low', 'medium', 'high'];
let gptExtraParamsOk = true;

function envChoice(name, allowed, fallback) {
  const v = String(process.env[name] || '').trim().toLowerCase();
  return allowed.includes(v) ? v : fallback;
}

function gptParamsEnabled() {
  const v = String(process.env.OPENAI_GPT_PARAMS ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

function reasoningEffortFor(kind) {
  if (kind === 'quality') return envChoice('PLAN_QUALITY_REASONING_EFFORT', GPT_EFFORTS, 'low');
  if (kind === 'conversation' || kind === 'capture') {
    return envChoice('CAPTURE_REASONING_EFFORT', GPT_EFFORTS, 'medium');
  }
  if (kind === 'day') return envChoice('PLAN_DAY_REASONING_EFFORT', GPT_EFFORTS, 'medium');
  return envChoice('PLAN_STRATEGIST_REASONING_EFFORT', GPT_EFFORTS, 'medium');
}

function verbosityFor() {
  return envChoice('OPENAI_VERBOSITY', GPT_VERBOSITY, 'low');
}

function gptExtraParams(model, { kind, reasoningEffort, verbosity } = {}) {
  if (!gptExtraParamsOk || !gptParamsEnabled() || !usesCompletionTokens(model)) return {};
  return {
    reasoning_effort: reasoningEffort || reasoningEffortFor(kind),
    verbosity: verbosity || verbosityFor(),
  };
}

function isUnknownParamError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return /unknown parameter|unrecognized|unsupported_parameter|reasoning_effort|verbosity/.test(msg);
}

async function openaiChatCreate(body) {
  try {
    return await getOpenAIClient().chat.completions.create(body);
  } catch (err) {
    if (!gptExtraParamsOk || !isUnknownParamError(err)) throw err;
    gptExtraParamsOk = false;
    console.warn('[llmComplete] model rejected reasoning_effort/verbosity — continuing without them');
    const next = { ...body };
    delete next.reasoning_effort;
    delete next.verbosity;
    return getOpenAIClient().chat.completions.create(next);
  }
}

async function completeOpenAIJson({
  model, system, userParts, tool, maxTokens, extraUserText = '', cacheKey = '',
  kind = 'conversation', reasoningEffort, verbosity,
}) {
  const messages = [];
  const sys = [system, jsonSchemaInstruction(tool)].filter(Boolean).join('\n\n');
  if (sys) messages.push({ role: 'system', content: sys });
  const content = toOpenAIUserContent(userParts);
  if (extraUserText && Array.isArray(content)) {
    messages.push({ role: 'user', content: [...content, { type: 'text', text: extraUserText }] });
  } else if (extraUserText) {
    messages.push({ role: 'user', content: `${content}\n\n${extraUserText}` });
  } else {
    messages.push({ role: 'user', content });
  }
  const response = await openaiChatCreate({
    model,
    messages,
    ...tokenArgFor(model, maxTokens),
    ...gptExtraParams(model, { kind, reasoningEffort, verbosity }),
    ...(promptCacheEnabled() && cacheKey ? { prompt_cache_key: cacheKey } : {}),
  });
  const text = response.choices?.[0]?.message?.content || '';
  if (!String(text).trim()) throw new Error('Empty model response');
  const choice = response.choices?.[0] || {};
  const usage = response.usage || {};
  return {
    parsed: parseToolArgs(text),
    model,
    output: text,
    system: sys,
    finishReason: choice.finish_reason || '',
    usage: {
      input_tokens: Number(usage.prompt_tokens || usage.input_tokens) || 0,
      output_tokens: Number(usage.completion_tokens || usage.output_tokens) || 0,
      cached_tokens: cachedTokensOf(usage),
    },
  };
}

function extractOpenAIToolInput(response, toolName) {
  const msg = response.choices?.[0]?.message || {};
  const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
  const call = calls.find((c) => c.function?.name === toolName) || calls[0];
  if (call?.function?.arguments != null) return parseToolArgs(call.function.arguments);
  if (msg.content) return parseToolArgs(msg.content);
  throw new Error('No tool input or JSON in model response');
}

function extractAnthropicToolInput(response, toolName) {
  const blocks = response.content || [];
  const tool = blocks.find((b) => b.type === 'tool_use' && (b.name === toolName || b.input));
  if (tool && tool.input != null) return parseToolArgs(tool.input);
  const raw = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!raw) throw new Error('No tool input or JSON in model response');
  return parseToolArgs(raw);
}

/**
 * Split a prompt template at the first {{TOKEN}} so the static prefix can be
 * sent as `system` and cached across calls. Dynamic JSON stays in `user`.
 */
function splitPromptTemplate(template) {
  const src = String(template || '');
  const match = src.match(/\{\{[A-Z][A-Z0-9_]*\}\}/);
  if (!match) return { system: '', userTemplate: src };
  return {
    system: src.slice(0, match.index).trim(),
    userTemplate: src.slice(match.index).trim(),
  };
}

function promptCacheEnabled() {
  const v = String(process.env.PLAN_PROMPT_CACHE ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

function cachedTokensOf(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  const details = usage.prompt_tokens_details || usage.input_tokens_details || {};
  return Number(
    details.cached_tokens
    || usage.cache_read_input_tokens
    || usage.cached_tokens
    || 0,
  ) || 0;
}

/**
 * Provider-agnostic text completion for plan generation.
 * Pass `system` (stable instructions) + `user` (per-call data) so OpenAI/Anthropic
 * can cache the prefix. `prompt` remains a fallback for a single user blob.
 * Returns { text, model, stopReason, usage: { input_tokens, output_tokens, cached_tokens } }.
 */
async function completeText({
  model, prompt, system, user, maxTokens, cacheKey, kind, reasoningEffort, verbosity,
}) {
  const resolved = model || planTextModel();
  const userContent = (user != null && String(user).length) ? String(user) : String(prompt || '');
  const sys = String(system || '').trim();

  if (isOpenAIModel(resolved)) {
    const messages = [];
    if (sys) messages.push({ role: 'system', content: sys });
    messages.push({ role: 'user', content: userContent });
    const response = await openaiChatCreate({
      model: resolved,
      messages,
      ...tokenArgFor(resolved, maxTokens),
      ...gptExtraParams(resolved, { kind, reasoningEffort, verbosity }),
      ...(promptCacheEnabled() && cacheKey ? { prompt_cache_key: cacheKey } : {}),
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
        cached_tokens: cachedTokensOf(usage),
      },
    };
  }

  const createArgs = {
    model: resolved,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: userContent }],
  };
  if (sys) {
    createArgs.system = [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }];
  }
  const response = await getAnthropicClient().messages.create(createArgs);
  return {
    text: textOfAnthropic(response),
    model: resolved,
    stopReason: response.stop_reason || '',
    usage: {
      input_tokens: Number(response.usage?.input_tokens) || 0,
      output_tokens: Number(response.usage?.output_tokens) || 0,
      cached_tokens: cachedTokensOf(response.usage),
    },
  };
}

/**
 * Force a structured tool/function call. `userParts` is a list of
 * { type: 'text', text } and { type: 'image', mediaType, data } (base64).
 * `tool` is Anthropic-shaped: { name, description, input_schema }.
 */
async function completeToolCall({
  model,
  system,
  userParts,
  tool,
  maxTokens = 8192,
  retryHint = '',
  extraUserText = '',
  cacheKey = '',
  kind = 'conversation',
  reasoningEffort,
  verbosity,
}) {
  const resolved = model || conversationModel();
  const name = tool.name;

  // gpt-5.6-terra (and similar reasoning models) cannot use function tools on
  // /v1/chat/completions. Ask for the same schema as JSON instead.
  if (isOpenAIModel(resolved)) {
    const run = (tokens, extra) => completeOpenAIJson({
      model: resolved,
      system,
      userParts,
      tool,
      maxTokens: tokens,
      extraUserText: extra,
      cacheKey,
      kind,
      reasoningEffort,
      verbosity,
    });
    try {
      let done = await run(maxTokens, extraUserText);
      if (done.finishReason === 'length') {
        const next = Math.min(Math.max(maxTokens, 1) * 2, 64000);
        if (next > maxTokens) done = await run(next, extraUserText);
      }
      return done;
    } catch (err) {
      if (!retryHint) throw err;
      return run(maxTokens, retryHint);
    }
  }

  const client = getAnthropicClient();
  const userContent = toAnthropicUserContent(userParts);
  const systemBlock = String(system || '').trim();
  const systemArg = systemBlock
    ? (promptCacheEnabled()
      ? [{ type: 'text', text: systemBlock, cache_control: { type: 'ephemeral' } }]
      : systemBlock)
    : undefined;
  const request = (msgs) => client.messages.create({
    model: resolved,
    max_tokens: maxTokens,
    system: systemArg,
    tools: [tool],
    tool_choice: { type: 'tool', name },
    messages: msgs,
  });
  let response = await request([{ role: 'user', content: userContent }]);
  try {
    return {
      parsed: extractAnthropicToolInput(response, name),
      model: resolved,
      usage: {
        input_tokens: Number(response.usage?.input_tokens) || 0,
        output_tokens: Number(response.usage?.output_tokens) || 0,
        cached_tokens: cachedTokensOf(response.usage),
      },
    };
  } catch (err) {
    if (!retryHint) throw err;
    response = await request([
      { role: 'user', content: userContent },
      { role: 'assistant', content: response.content || [] },
      { role: 'user', content: retryHint },
    ]);
    return {
      parsed: extractAnthropicToolInput(response, name),
      model: resolved,
      usage: {
        input_tokens: Number(response.usage?.input_tokens) || 0,
        output_tokens: Number(response.usage?.output_tokens) || 0,
        cached_tokens: cachedTokensOf(response.usage),
      },
    };
  }
}

module.exports = {
  completeText,
  completeToolCall,
  conversationModel,
  hasConversationModel,
  planTextModel,
  splitPromptTemplate,
  isOpenAIModel,
  usesCompletionTokens,
  openaiToolOf,
};
