/*
 * Capture understanding — Capture time only.
 *
 * Reads a spontaneous note (and optional photos) and decides whether Bauhly
 * already understands the experience well enough to store it, or whether one
 * neutral clarifying question would materially improve that understanding.
 * Strategy, Brand DNA, and competitor intelligence are out of scope here.
 */

const fs = require('fs');
const path = require('path');
const getAnthropicClient = require('./anthropicClient');
const { getObjectBytes, isS3Configured } = require('./s3Client');

const PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'capture-understand-prompt.md');
let systemPrompt;
function loadPrompt() {
  if (!systemPrompt) systemPrompt = fs.readFileSync(PROMPT_PATH, 'utf8');
  return systemPrompt;
}

const SIGNAL_KEYS = ['happened', 'intent', 'difficulty', 'actionTaken', 'outcome'];

const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
function resolveMediaType(contentType, key) {
  const ct = (contentType || '').toLowerCase().split(';')[0].trim();
  if (SUPPORTED_MEDIA_TYPES.includes(ct)) return ct;
  if (ct === 'image/jpg') return 'image/jpeg';
  const ext = (key || '').toLowerCase().split('.').pop();
  const byExt = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
  return byExt[ext] || null;
}

function escapeControlCharsInStrings(s) {
  let out = '';
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === '\\' && inStr) { out += ch; escaped = true; continue; }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr && code < 0x20) {
      if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else out += `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }
    out += ch;
  }
  return out;
}

function parseJsonObject(raw) {
  const fenced = String(raw || '').match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : String(raw || '');
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in model response');
  const slice = candidate.slice(start, end + 1);
  const attempts = [
    slice,
    escapeControlCharsInStrings(slice),
    escapeControlCharsInStrings(slice).replace(/,\s*([}\]])/g, '$1'),
  ];
  let lastErr;
  for (const s of attempts) {
    try {
      return JSON.parse(s);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('No JSON object in model response');
}

const TOOL_NAME = 'record_capture_understanding';
const UNDERSTAND_TOOL = {
  name: TOOL_NAME,
  description: 'Record the strategy-neutral understanding of this Capture, and whether one clarifying question is needed.',
  input_schema: {
    type: 'object',
    properties: {
      signals: {
        type: 'object',
        properties: {
          happened: { type: 'string' },
          intent: { type: 'string' },
          difficulty: { type: 'string' },
          actionTaken: { type: 'string' },
          outcome: { type: 'string' },
        },
        required: ['happened', 'intent', 'difficulty', 'actionTaken', 'outcome'],
      },
      presentSignals: {
        type: 'array',
        items: { type: 'string', enum: SIGNAL_KEYS },
      },
      meaningClear: { type: 'boolean' },
      missingPiece: { type: 'string' },
      shouldAsk: { type: 'boolean' },
      question: { type: 'string' },
      askReason: { type: 'string' },
      summary: { type: 'string' },
    },
    required: ['signals', 'presentSignals', 'meaningClear', 'shouldAsk', 'question', 'summary'],
  },
};

function extractParsed(response) {
  const blocks = response.content || [];
  const tool = blocks.find((b) => b.type === 'tool_use' && (b.name === TOOL_NAME || b.input));
  if (tool && tool.input) {
    if (typeof tool.input === 'object') return tool.input;
    if (typeof tool.input === 'string') return parseJsonObject(tool.input);
  }
  const raw = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!raw) throw new Error('No tool input or JSON in model response');
  return parseJsonObject(raw);
}

function str(v) {
  return v == null ? '' : String(v).trim();
}

function emptyUnderstanding(text) {
  return {
    happened: str(text),
    intent: '',
    difficulty: '',
    actionTaken: '',
    outcome: '',
    summary: str(text),
    presentSignals: str(text) ? ['happened'] : [],
    missingPiece: '',
    askedQuestion: '',
    askedAnswer: '',
    model: '',
    understoodAt: new Date(),
  };
}

function normalizeUnderstanding(parsed, { text, alreadyAsked, askedQuestion, askedAnswer }) {
  const signals = parsed.signals && typeof parsed.signals === 'object' ? parsed.signals : parsed;
  const present = Array.isArray(parsed.presentSignals)
    ? parsed.presentSignals.map(str).filter((k) => SIGNAL_KEYS.includes(k))
    : SIGNAL_KEYS.filter((k) => str(signals[k]));

  let shouldAsk = Boolean(parsed.shouldAsk) && !alreadyAsked;
  let question = str(parsed.question);
  // If the model marked meaning unclear and did write a question, ask it even
  // when shouldAsk was omitted or inconsistent.
  if (!alreadyAsked && parsed.meaningClear === false && question) shouldAsk = true;
  if (shouldAsk && !question) shouldAsk = false;
  if (alreadyAsked) {
    shouldAsk = false;
    question = '';
  }

  const summary = str(parsed.summary) || str(text);

  return {
    action: shouldAsk ? 'ask' : 'ready',
    question: shouldAsk ? question : null,
    understanding: {
      happened: str(signals.happened),
      intent: str(signals.intent),
      difficulty: str(signals.difficulty),
      actionTaken: str(signals.actionTaken),
      outcome: str(signals.outcome),
      summary,
      presentSignals: present,
      missingPiece: str(parsed.missingPiece),
      askedQuestion: alreadyAsked ? str(askedQuestion) : (shouldAsk ? question : ''),
      askedAnswer: alreadyAsked ? str(askedAnswer) : '',
      model: '',
      understoodAt: new Date(),
    },
  };
}

function buildUserText({ text, projectName, attachments, alreadyAsked, askedQuestion, askedAnswer }) {
  const images = (attachments || []).filter((a) => a.type === 'image');
  const videos = (attachments || []).filter((a) => a.type === 'video');
  const lines = ['New Capture — understand this experience. Strategy is out of scope.'];
  if (projectName) lines.push(`Project (filing context only, not a prompt to steer): ${projectName}`);
  lines.push('');
  lines.push('User note:');
  lines.push(str(text) || '(no written note)');
  lines.push('');
  lines.push(`Attached assets: ${images.length} image(s), ${videos.length} video(s).`);
  if (videos.length && !str(text)) {
    lines.push('Video is attached but cannot be watched here. Treat missing visual context as a possible reason to ask what the clip is about — only if the note does not already make the meaning clear.');
  }
  if (alreadyAsked) {
    lines.push('');
    lines.push('A clarifying question was already asked. Do not ask another. Reassess and store.');
    if (askedQuestion) lines.push(`Question asked: ${askedQuestion}`);
    if (askedAnswer) lines.push(`User's answer: ${askedAnswer}`);
  }
  return lines.join('\n');
}

async function imageContentParts(attachments) {
  if (!isS3Configured()) return [];
  const images = (attachments || []).filter((a) => a && a.type === 'image' && a.key).slice(0, 2);
  const parts = [];
  for (const a of images) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { buffer, contentType } = await getObjectBytes(a.key);
      const mediaType = resolveMediaType(contentType, a.key);
      if (!mediaType) continue;
      parts.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') },
      });
    } catch (err) {
      console.error('[capture] could not load image for understanding', a.key, err.message);
    }
  }
  return parts;
}

/**
 * Understand a draft Capture. Returns { action: 'ask'|'ready', question, understanding }.
 * Never throws for "the model declined to ask" — callers can always store.
 */
async function understandCapture(input = {}) {
  const text = str(input.text);
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  const alreadyAsked = Boolean(input.alreadyAsked);
  const askedQuestion = str(input.askedQuestion);
  const askedAnswer = str(input.askedAnswer);
  const projectName = str(input.projectName);

  if (!text && attachments.length === 0) {
    const err = new Error('A capture needs a note or a file');
    err.statusCode = 400;
    throw err;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    const result = normalizeUnderstanding(
      { shouldAsk: false, summary: text, signals: { happened: text } },
      { text, alreadyAsked, askedQuestion, askedAnswer }
    );
    return result;
  }

  const model = process.env.ANTHROPIC_CAPTURE_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const imageParts = await imageContentParts(attachments);
  const userText = buildUserText({
    text, projectName, attachments, alreadyAsked, askedQuestion, askedAnswer,
  });
  const userContent = [
    ...imageParts,
    { type: 'text', text: userText },
  ];

  const client = getAnthropicClient();
  const request = (messages) => client.messages.create({
    model,
    max_tokens: 1024,
    system: loadPrompt(),
    tools: [UNDERSTAND_TOOL],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages,
  });

  let response = await request([{ role: 'user', content: userContent }]);
  let parsed;
  try {
    parsed = extractParsed(response);
  } catch (err) {
    console.error('[capture] understand parse failed, retrying', err.message);
    response = await request([
      { role: 'user', content: userContent },
      { role: 'assistant', content: response.content || [] },
      {
        role: 'user',
        content: 'The previous tool call was invalid. Call record_capture_understanding again with complete fields. Empty strings for unknowns. shouldAsk must be true or false.',
      },
    ]);
    parsed = extractParsed(response);
  }

  const result = normalizeUnderstanding(parsed, { text, alreadyAsked, askedQuestion, askedAnswer });
  result.understanding.model = model;
  if (result.action === 'ask') {
    console.log('[capture] understand ask:', result.question);
  } else {
    console.log('[capture] understand ready; signals:', (result.understanding.presentSignals || []).join(','));
  }
  return result;
}

function sanitizeUnderstanding(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const present = Array.isArray(raw.presentSignals)
    ? raw.presentSignals.map(str).filter((k) => SIGNAL_KEYS.includes(k))
    : [];
  const understoodAt = raw.understoodAt ? new Date(raw.understoodAt) : new Date();
  return {
    happened: str(raw.happened),
    intent: str(raw.intent),
    difficulty: str(raw.difficulty),
    actionTaken: str(raw.actionTaken),
    outcome: str(raw.outcome),
    summary: str(raw.summary),
    presentSignals: present,
    missingPiece: str(raw.missingPiece),
    askedQuestion: str(raw.askedQuestion),
    askedAnswer: str(raw.askedAnswer),
    model: str(raw.model),
    understoodAt: Number.isNaN(understoodAt.getTime()) ? new Date() : understoodAt,
  };
}

function serializeUnderstanding(u) {
  if (!u) return null;
  return {
    happened: u.happened || '',
    intent: u.intent || '',
    difficulty: u.difficulty || '',
    actionTaken: u.actionTaken || '',
    outcome: u.outcome || '',
    summary: u.summary || '',
    presentSignals: u.presentSignals || [],
    missingPiece: u.missingPiece || '',
    askedQuestion: u.askedQuestion || '',
    askedAnswer: u.askedAnswer || '',
    model: u.model || '',
    understoodAt: u.understoodAt || null,
  };
}

module.exports = {
  understandCapture,
  sanitizeUnderstanding,
  serializeUnderstanding,
  emptyUnderstanding,
  SIGNAL_KEYS,
  imageContentParts,
  extractParsed,
  str,
};
