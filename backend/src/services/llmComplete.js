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
  const schema = JSON.stringify(tool?.input_schema || { type: 'object' }, null, 2);
  return [
    'Do not call tools. Return only a JSON object that matches this schema.',
    'Use empty strings for unknowns. Booleans must be true or false.',
    schema,
  ].join('\n');
}

async function completeOpenAIJson({ model, system, userParts, tool, maxTokens, extraUserText = '' }) {
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
  const response = await getOpenAIClient().chat.completions.create({
    model,
    messages,
    ...tokenArgFor(model, maxTokens),
  });
  const text = response.choices?.[0]?.message?.content || '';
  if (!String(text).trim()) throw new Error('Empty model response');
  return { parsed: parseToolArgs(text), model, output: text, system: sys };
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
 * Provider-agnostic text completion for plan generation.
 * Returns { text, model, stopReason, usage: { input_tokens, output_tokens } }.
 * stopReason is 'max_tokens' when the output was truncated.
 */
async function completeText({ model, prompt, maxTokens }) {
  const resolved = model || planTextModel();
  if (isOpenAIModel(resolved)) {
    const response = await getOpenAIClient().chat.completions.create({
      model: resolved,
      messages: [{ role: 'user', content: prompt }],
      ...tokenArgFor(resolved, maxTokens),
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
}) {
  const resolved = model || conversationModel();
  const name = tool.name;

  // gpt-5.6-terra (and similar reasoning models) cannot use function tools on
  // /v1/chat/completions. Ask for the same schema as JSON instead.
  if (isOpenAIModel(resolved)) {
    try {
      return await completeOpenAIJson({
        model: resolved, system, userParts, tool, maxTokens,
      });
    } catch (err) {
      if (!retryHint) throw err;
      return completeOpenAIJson({
        model: resolved, system, userParts, tool, maxTokens, extraUserText: retryHint,
      });
    }
  }

  const client = getAnthropicClient();
  const userContent = toAnthropicUserContent(userParts);
  const request = (msgs) => client.messages.create({
    model: resolved,
    max_tokens: maxTokens,
    system: system || undefined,
    tools: [tool],
    tool_choice: { type: 'tool', name },
    messages: msgs,
  });
  let response = await request([{ role: 'user', content: userContent }]);
  try {
    return { parsed: extractAnthropicToolInput(response, name), model: resolved };
  } catch (err) {
    if (!retryHint) throw err;
    response = await request([
      { role: 'user', content: userContent },
      { role: 'assistant', content: response.content || [] },
      { role: 'user', content: retryHint },
    ]);
    return { parsed: extractAnthropicToolInput(response, name), model: resolved };
  }
}

module.exports = {
  completeText,
  completeToolCall,
  conversationModel,
  hasConversationModel,
  planTextModel,
  isOpenAIModel,
  usesCompletionTokens,
  openaiToolOf,
};
