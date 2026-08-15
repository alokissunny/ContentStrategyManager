const getAnthropicClient = require('./anthropicClient');
const getOpenAIClient = require('./openaiClient');

const SYSTEM = `You rewrite Instagram captions for a studio using Bauhly.

Rules:
- Return ONLY the rewritten caption. No preamble, no quotes, no markdown fences.
- Keep the studio's meaning, facts, numbers, names, and claims. Do not invent new ones.
- Keep emojis and hashtags unless the instruction asks to change them.
- Preserve line breaks where they help the caption read.
- Match the instruction closely (shorter, clearer, more expert, warmer, etc.).
- If the current caption is empty, write a first draft from the context — still no invented claims.
- Stay in the studio's voice when a voice note is provided.`;

function hasAnthropic() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
function hasOpenAI() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function anthropicModel() {
  return process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
}
function openaiModel() {
  return process.env.OPENAI_MODEL || process.env.COMPETITOR_MODEL || 'gpt-4.1-mini';
}

function usesCompletionTokens(model) {
  return /gpt-5|terra|o3|o4/i.test(String(model || ''));
}

function cleanCaption(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:\w+)?\n?/, '').replace(/\n?```$/, '').trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

function userPrompt({ caption, instruction, context = {} }) {
  const lines = [];
  if (context.handle) lines.push(`Account: @${String(context.handle).replace(/^@/, '')}`);
  if (context.pillar) lines.push(`This post's pillar: ${context.pillar}`);
  if (context.format) lines.push(`Format: ${context.format}`);
  if (context.focus) lines.push(`This week's focus: ${context.focus}`);
  if (context.direction) lines.push(`Post direction: ${context.direction}`);
  if (context.strategy) lines.push(`Why this post: ${context.strategy}`);
  if (context.voice) lines.push(`How they sound: ${context.voice}`);
  const ctx = lines.length ? `Context:\n${lines.join('\n')}\n\n` : '';
  const body = String(caption || '').trim() || '(empty — write a first draft from the context)';
  return `${ctx}Instruction: ${instruction}\n\nCurrent caption:\n${body}`;
}

async function completeAnthropic(user) {
  const model = anthropicModel();
  const response = await getAnthropicClient().messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
  });
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  return { text, model };
}

async function completeOpenAI(user) {
  const model = openaiModel();
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ];
  const tokenArg = usesCompletionTokens(model)
    ? { max_completion_tokens: 800 }
    : { max_tokens: 800 };
  const response = await getOpenAIClient().chat.completions.create({
    model,
    messages,
    ...tokenArg,
  });
  return { text: response.choices?.[0]?.message?.content || '', model };
}

async function rewriteCaption({ caption, instruction, context } = {}) {
  const ask = String(instruction || '').trim();
  if (!ask) {
    const err = new Error('Tell me what to change — shorter, warmer, sharper opening.');
    err.status = 400;
    throw err;
  }
  if (ask.length > 500) {
    const err = new Error('Keep the instruction under 500 characters.');
    err.status = 400;
    throw err;
  }
  if (!hasAnthropic() && !hasOpenAI()) {
    const err = new Error('AI rewrite is not configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY).');
    err.status = 503;
    throw err;
  }

  const user = userPrompt({ caption, instruction: ask, context });
  const { text, model } = hasAnthropic()
    ? await completeAnthropic(user)
    : await completeOpenAI(user);
  const next = cleanCaption(text);
  if (!next) {
    const err = new Error('Nothing came back — try a more specific instruction.');
    err.status = 502;
    throw err;
  }
  return {
    caption: next,
    unchanged: next === String(caption || '').trim(),
    model,
  };
}

module.exports = { rewriteCaption };
