/*
 * Capture conversation — Capture time only.
 *
 * Owns Capture Truth: extract strategy-neutral experience(s) from a note
 * (and optional photos), split independent stories silently, clarify or deepen
 * only when useful, then hand off ready captures. Never confirm splits with
 * the user. Strategy, Brand DNA, and competitor intelligence are out of scope.
 */

const fs = require('fs');
const path = require('path');
const { getObjectBytes, isS3Configured } = require('./s3Client');
const { completeToolCall, conversationModel, hasConversationModel } = require('./llmComplete');

const PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'capture-understand-prompt.md');
function loadPrompt() {
  return fs.readFileSync(PROMPT_PATH, 'utf8');
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

const CAPTURE_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['ready', 'unresolved'] },
    sourceRef: { type: 'string' },
    originalCapture: { type: 'string' },
    whatHappened: { type: 'string' },
    intent: { type: 'string' },
    tension: { type: 'string' },
    action: { type: 'string' },
    outcome: { type: 'string' },
    distinctSignals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          summary: { type: 'string' },
        },
      },
    },
    relevantAssetContext: { type: 'array', items: { type: 'string' } },
    visualAssetChoice: { type: 'string', enum: ['provided', 'generate', 'none'] },
    captureSummary: { type: 'string' },
    unresolvedGap: { type: 'string' },
    knownLimitation: { type: 'string' },
  },
};

const TOOL_NAME = 'record_capture_turn';
const UNDERSTAND_TOOL = {
  name: TOOL_NAME,
  description: 'Record this Capture Conversation turn: one question, or every independent ready Capture.',
  input_schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['needs_clarification', 'ready'] },
      question: { type: 'string' },
      matchedProjectName: { type: 'string' },
      captures: {
        type: 'array',
        description: 'Every independent Capture from the full conversation (1–10). Never merge independent observations, problems, discoveries, or ideas into one item. An information-rich note usually needs several.',
        items: CAPTURE_ITEM_SCHEMA,
      },
    },
    required: ['status'],
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
    knownLimitation: '',
    visualAssetChoice: '',
    captureStatus: 'ready',
    originalCapture: str(text),
    distinctSignals: [],
    model: '',
    understoodAt: new Date(),
  };
}

const SIGNAL_TYPE_TO_KEY = {
  problem: 'difficulty',
  decision: 'actionTaken',
  lesson: 'outcome',
  opinion: 'happened',
  observation: 'happened',
  discovery: 'outcome',
  question: 'outcome',
};

function mapCaptureRecord(raw, fallbackText) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const happened = str(c.whatHappened || c.happened);
  const intent = str(c.intent);
  const difficulty = str(c.tension || c.difficulty);
  const actionTaken = str(c.action || c.actionTaken);
  const outcome = [str(c.outcome), str(c.openQuestion)].filter(Boolean).join(' ');
  const summary = str(c.captureSummary || c.summary) || happened || str(fallbackText);
  const distinct = Array.isArray(c.distinctSignals)
    ? c.distinctSignals.map((s) => ({
      type: str(s?.type).toLowerCase(),
      summary: str(s?.summary),
    })).filter((s) => s.type || s.summary).slice(0, 8)
    : [];
  const present = distinct
    .map((s) => SIGNAL_TYPE_TO_KEY[s.type])
    .filter((k) => SIGNAL_KEYS.includes(k));
  const filled = SIGNAL_KEYS.filter((k) => str({ happened, intent, difficulty, actionTaken, outcome }[k]));
  return {
    id: str(c.id),
    happened,
    intent,
    difficulty,
    actionTaken,
    outcome,
    summary,
    presentSignals: [...new Set(present.length ? present : filled)],
    missingPiece: str(c.unresolvedGap || c.missingPiece),
    askedQuestion: '',
    askedAnswer: '',
    knownLimitation: str(c.knownLimitation),
    visualAssetChoice: (() => {
      const v = str(c.visualAssetChoice).toLowerCase();
      if (v.startsWith('generate')) return 'generate';
      if (v.startsWith('none')) return 'none';
      if (v.startsWith('provided')) return 'provided';
      return v;
    })(),
    captureStatus: /unresolved/i.test(str(c.status)) ? 'unresolved' : 'ready',
    originalCapture: str(c.originalCapture) || str(fallbackText),
    sourceRef: str(c.sourceRef),
    distinctSignals: distinct,
    relevantAssetContext: Array.isArray(c.relevantAssetContext)
      ? c.relevantAssetContext.map(str).filter(Boolean)
      : [],
    model: '',
    understoodAt: new Date(),
  };
}

function normalizeUnderstanding(parsed, { text, askedQuestion, askedAnswer }) {
  const status = str(parsed?.status).toLowerCase();
  const question = str(parsed?.question || parsed?.message);

  // Splits stay internal. A leftover needs_selection payload is never shown.
  if (status === 'needs_clarification' && question) {
    return {
      action: 'ask',
      question,
      message: question,
      understanding: null,
      captures: [],
    };
  }

  if (!status && (parsed?.shouldAsk || parsed?.meaningClear === false) && str(parsed?.question)) {
    return {
      action: 'ask',
      question: str(parsed.question),
      message: str(parsed.question),
      understanding: null,
      captures: [],
    };
  }

  const rows = Array.isArray(parsed?.captures) ? parsed.captures : (parsed?.signals ? [parsed] : []);
  const captures = (rows.length ? rows : [{ originalCapture: text, whatHappened: text, captureSummary: text }])
    .map((row) => mapCaptureRecord(row, text))
    .slice(0, 10);
  const understanding = captures[0] || emptyUnderstanding(text);
  if (askedQuestion) understanding.askedQuestion = str(askedQuestion);
  if (askedAnswer) understanding.askedAnswer = str(askedAnswer);

  return {
    action: 'ready',
    question: null,
    message: '',
    matchedProjectName: str(parsed?.matchedProjectName),
    understanding,
    captures,
  };
}

function fillPrompt(template, vars) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, key) => (
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? '') : `{{${key}}}`
  ));
}

function conversationBlock({ text, projectName, turns, projects }) {
  const lines = [];
  if (projectName) lines.push(`Filing project (context only, not a prompt to steer): ${projectName}`);
  const names = (projects || []).map((p) => str(p.name)).filter(Boolean);
  if (names.length) {
    lines.push('Projects on file (match only these names, or none):');
    names.forEach((n) => lines.push(`- ${n}`));
  }
  const history = Array.isArray(turns) ? turns.filter((t) => str(t?.text)) : [];
  const asked = history.filter((t) => String(t.role || '').toLowerCase() === 'assistant').length;
  const longest = [str(text), ...history.filter((t) => String(t.role || '').toLowerCase() !== 'assistant').map((t) => str(t.text))]
    .reduce((max, n) => Math.max(max, n.length), 0);
  const rich = longest >= 1200;
  if (asked) {
    if (rich && asked < 3) {
      lines.push(`Questions asked so far: ${asked} of 4. This is an information-rich input. Ask the next high-value question about a different independent idea. Do not complete yet.`);
    } else if (asked >= 4) {
      lines.push('Question budget reached (4). Complete now. Preserve remaining unknowns as knownLimitation.');
    } else {
      lines.push(`Questions asked so far: ${asked} of 4. Ask one more only if another independent idea still has an obvious unexplored thread; otherwise complete.`);
    }
  } else if (rich) {
    lines.push('This is an information-rich input. After understanding the whole note, ask the first high-value question rather than completing immediately.');
  }
  if (history.length) {
    history.forEach((t) => {
      const who = String(t.role || '').toLowerCase() === 'assistant' ? 'Bauhly' : 'User';
      lines.push(`${who}: ${str(t.text)}`);
    });
  } else {
    lines.push(str(text) || '(no written note)');
  }
  return lines.filter(Boolean).join('\n') || '(empty)';
}

function attachedAssetsBlock({ text, attachments, turns }) {
  const images = (attachments || []).filter((a) => a.type === 'image');
  const videos = (attachments || []).filter((a) => a.type === 'video');
  const history = Array.isArray(turns) ? turns.filter((t) => str(t?.text)) : [];
  const lines = [`${images.length} image(s), ${videos.length} video(s).`];
  if (videos.length && !str(text) && !history.length) {
    lines.push('Video is attached but cannot be watched here. Treat missing visual context as a possible reason to ask what the clip is about — only if the note does not already make the meaning clear.');
  }
  return lines.join('\n');
}

function assemblePrompt({
  text, projectName, attachments, turns, projects, kind,
}) {
  const conversation = conversationBlock({ text, projectName, turns, projects });
  const attachedAssets = attachedAssetsBlock({ text, attachments, turns });
  let template = loadPrompt();
  if (kind === 'checkin') {
    const extras = fs.readFileSync(path.join(__dirname, '..', '..', 'prompts', 'checkin-understand-prompt.md'), 'utf8');
    template = template.includes('## Conversation so far')
      ? template.replace('## Conversation so far', `${extras}\n\n## Conversation so far`)
      : `${template}\n\n${extras}`;
  }
  return fillPrompt(template, { conversation, attachedAssets });
}

function captureMaxTokens() {
  const n = Number(process.env.CAPTURE_MAX_TOKENS);
  return Number.isFinite(n) && n > 0 ? n : 16384;
}

function longestUserNote(text, turns) {
  const notes = [str(text)];
  (turns || []).forEach((t) => {
    if (String(t?.role || '').toLowerCase() !== 'assistant') notes.push(str(t?.text));
  });
  return notes.reduce((max, n) => Math.max(max, n.length), 0);
}

function collapsedRichInput(parsed, text, turns) {
  if (str(parsed?.status).toLowerCase() !== 'ready') return false;
  const n = Array.isArray(parsed?.captures) ? parsed.captures.length : 0;
  return n <= 1 && longestUserNote(text, turns) >= 1200;
}

function assistantQuestionCount(turns) {
  return (turns || []).filter((t) => String(t?.role || '').toLowerCase() === 'assistant' && str(t?.text)).length;
}

function endedTooSoon(parsed, text, turns) {
  if (str(parsed?.status).toLowerCase() !== 'ready') return false;
  if (longestUserNote(text, turns) >= 1200 && assistantQuestionCount(turns) < 3) return true;
  return false;
}

const USER_JSON_INSTRUCTION = [
  'Return one JSON object with status needs_clarification or ready.',
  'On an information-rich note with several independent ideas, ask 3–4 short follow-up questions (one per turn) across different ideas before ready.',
  'If the user gave several independent observations, problems, discoveries, decisions, or ideas, ready.captures must contain all of them.',
  'Never merge those into a single Capture summary of the whole message.',
].join(' ');

const CONTINUE_QUESTIONS_HINT = [
  'Do not complete yet.',
  'This information-rich input still has independent ideas that have not been followed up.',
  'Return status needs_clarification with captures [] and ONE short contextual question about a different independent idea than the last question.',
  'Do not mention story numbers or that you are splitting.',
].join(' ');

const SPLIT_RETRY_HINT = [
  'The previous JSON collapsed an information-rich note into one Capture.',
  'Re-read the entire conversation.',
  'Return status ready with captures[] containing every independent observation, problem, discovery, decision, or idea.',
  'Shared research, shared topic, or a later connecting conclusion does not make them one Capture.',
  'originalCapture for each item must be only that item\'s source words, not the whole message.',
].join(' ');

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
        mediaType,
        data: buffer.toString('base64'),
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
  const askedQuestion = str(input.askedQuestion);
  const askedAnswer = str(input.askedAnswer);
  const projectName = str(input.projectName);
  const turns = Array.isArray(input.turns) ? input.turns : [];
  const projects = Array.isArray(input.projects) ? input.projects : [];
  const kind = str(input.kind) || 'capture';

  if (!text && attachments.length === 0 && turns.length === 0) {
    const err = new Error('A capture needs a note or a file');
    err.statusCode = 400;
    throw err;
  }

  const systemPrompt = assemblePrompt({
    text, projectName, attachments, turns, projects, kind,
  });
  const userText = USER_JSON_INSTRUCTION;
  const debugSource = kind === 'checkin' ? 'Check-in conversation' : 'Capture conversation';
  const ctx = { text, askedQuestion, askedAnswer };

  if (!hasConversationModel()) {
    const result = normalizeUnderstanding(
      { status: 'ready', captures: [{ originalCapture: text, whatHappened: text, captureSummary: text }] },
      ctx,
    );
    result.debug = makeUnderstandDebug({
      source: debugSource,
      model: '',
      systemPrompt,
      prompt: userText,
      result,
      note: 'OPENAI_API_KEY missing — model not called',
    });
    return result;
  }

  const model = conversationModel();
  const imageParts = await imageContentParts(attachments);
  const userParts = [
    ...imageParts,
    { type: 'text', text: userText },
  ];
  const callOpts = {
    model,
    system: systemPrompt,
    userParts,
    tool: UNDERSTAND_TOOL,
    maxTokens: captureMaxTokens(),
    retryHint: 'The previous JSON was invalid. Return only one JSON object with status needs_clarification or ready. If several independent stories exist, include all of them in captures.',
  };

  let parsed;
  let rawOutput = '';
  let usedSystem = systemPrompt;
  try {
    let done = await completeToolCall(callOpts);
    if (endedTooSoon(done.parsed, text, turns)) {
      console.warn(`[${kind}] completed after ${assistantQuestionCount(turns)} question(s) on rich input — asking again`);
      done = await completeToolCall({ ...callOpts, extraUserText: CONTINUE_QUESTIONS_HINT });
    }
    if (collapsedRichInput(done.parsed, text, turns)) {
      console.warn(`[${kind}] collapsed rich input into ${done.parsed?.captures?.length || 0} capture(s) — retrying split`);
      done = await completeToolCall({ ...callOpts, extraUserText: SPLIT_RETRY_HINT });
    }
    parsed = done.parsed;
    rawOutput = done.output || '';
    if (done.system) usedSystem = done.system;
  } catch (err) {
    console.error(`[${kind}] understand failed`, err.message);
    const result = normalizeUnderstanding(
      { status: 'ready', captures: [{ originalCapture: text, whatHappened: text, captureSummary: text }] },
      ctx,
    );
    result.debug = makeUnderstandDebug({
      source: debugSource,
      model,
      systemPrompt: usedSystem,
      prompt: userText,
      result,
      note: err.message,
    });
    return result;
  }

  const result = normalizeUnderstanding(parsed, ctx);
  if (result.understanding) result.understanding.model = model;
  (result.captures || []).forEach((c) => { c.model = model; });
  result.debug = makeUnderstandDebug({
    source: debugSource,
    model,
    systemPrompt: usedSystem,
    prompt: userText,
    result,
    parsed,
    rawOutput,
  });
  console.log(
    `[${kind}] understand ${result.action}`
    + (result.question ? `: ${result.question}` : '')
    + (result.captures?.length ? `; captures=${result.captures.length}` : ''),
  );
  return result;
}

function sanitizeUnderstanding(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const present = Array.isArray(raw.presentSignals)
    ? raw.presentSignals.map(str).filter((k) => SIGNAL_KEYS.includes(k))
    : [];
  const understoodAt = raw.understoodAt ? new Date(raw.understoodAt) : new Date();
  const distinct = Array.isArray(raw.distinctSignals)
    ? raw.distinctSignals.map((s) => ({
      type: str(s?.type),
      summary: str(s?.summary),
    })).filter((s) => s.type || s.summary)
    : [];
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
    knownLimitation: str(raw.knownLimitation),
    visualAssetChoice: str(raw.visualAssetChoice),
    captureStatus: str(raw.captureStatus) || 'ready',
    originalCapture: str(raw.originalCapture),
    sourceRef: str(raw.sourceRef),
    distinctSignals: distinct,
    relevantAssetContext: Array.isArray(raw.relevantAssetContext)
      ? raw.relevantAssetContext.map(str).filter(Boolean)
      : [],
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
    knownLimitation: u.knownLimitation || '',
    visualAssetChoice: u.visualAssetChoice || '',
    captureStatus: u.captureStatus || '',
    originalCapture: u.originalCapture || '',
    sourceRef: u.sourceRef || '',
    distinctSignals: u.distinctSignals || [],
    relevantAssetContext: u.relevantAssetContext || [],
    model: u.model || '',
    understoodAt: u.understoodAt || null,
  };
}

function makeUnderstandDebug({ source, model, systemPrompt, prompt, result, parsed, note, rawOutput }) {
  const body = {
    action: result.action,
    question: result.question,
    message: result.message,
    understanding: result.understanding,
    captures: result.captures,
  };
  if (parsed) body.tool = parsed;
  const output = String(rawOutput || '').trim() || JSON.stringify(body, null, 2);
  const system = String(systemPrompt || '').trim();
  const user = String(prompt || '').trim();
  const assembled = [system, user].filter(Boolean).join('\n\n');
  return {
    source,
    model: model || '',
    systemPrompt: system,
    finalPrompt: assembled,
    output,
    note: note || '',
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
  loadPrompt,
  makeUnderstandDebug,
  UNDERSTAND_TOOL,
  TOOL_NAME,
};
