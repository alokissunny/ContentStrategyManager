/*
 * Capture conversation — Capture time only.
 *
 * Owns Capture Truth: extract strategy-neutral experience(s) from a note
 * (and optional photos), confirm splits, clarify only when meaning is missing,
 * then hand off ready captures. Strategy, Brand DNA, and competitor
 * intelligence are out of scope here.
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

const TOOL_NAME = 'record_capture_turn';
const UNDERSTAND_TOOL = {
  name: TOOL_NAME,
  description: 'Record this Capture Conversation turn: selection, clarification, or ready captures.',
  input_schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['needs_selection', 'needs_clarification', 'ready'] },
      message: { type: 'string' },
      question: { type: 'string' },
      captureId: { type: 'string' },
      matchedProjectName: { type: 'string' },
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            summary: { type: 'string' },
          },
        },
      },
      captures: { type: 'array', items: { type: 'object' } },
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

function normalizeCandidates(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((c, i) => ({
    id: str(c?.id) || `c${i + 1}`,
    summary: str(c?.summary),
  })).filter((c) => c.summary).slice(0, 10);
}

function normalizeUnderstanding(parsed, { text, askedQuestion, askedAnswer }) {
  const status = str(parsed?.status).toLowerCase();
  const question = str(parsed?.question || parsed?.message);

  if (status === 'needs_selection') {
    const candidates = normalizeCandidates(parsed.candidates);
    if (candidates.length > 1) {
      return {
        action: 'select',
        question: null,
        message: str(parsed.message) || 'Did we correctly identify the ideas you want to work with?',
        candidates,
        captureId: '',
        understanding: null,
        captures: [],
      };
    }
  }

  if (status === 'needs_clarification' && question) {
    return {
      action: 'ask',
      question,
      message: question,
      candidates: [],
      captureId: str(parsed.captureId),
      understanding: null,
      captures: [],
    };
  }

  // Legacy shouldAsk shape, in case a rerun still emits it.
  if (!status && (parsed?.shouldAsk || parsed?.meaningClear === false) && str(parsed?.question)) {
    return {
      action: 'ask',
      question: str(parsed.question),
      message: str(parsed.question),
      candidates: [],
      captureId: '',
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
    candidates: [],
    captureId: '',
    matchedProjectName: str(parsed?.matchedProjectName),
    understanding,
    captures,
  };
}

function buildUserText({
  text, projectName, attachments, turns, confirmedIds, projects,
}) {
  const images = (attachments || []).filter((a) => a.type === 'image');
  const videos = (attachments || []).filter((a) => a.type === 'video');
  const lines = ['Capture Conversation turn. Strategy is out of scope. Capture truth only.'];
  if (projectName) lines.push(`Filing project (context only, not a prompt to steer): ${projectName}`);
  const names = (projects || []).map((p) => str(p.name)).filter(Boolean);
  if (names.length) {
    lines.push('Projects on file (match only these names, or none):');
    names.forEach((n) => lines.push(`- ${n}`));
  }
  const history = Array.isArray(turns) ? turns.filter((t) => str(t?.text)) : [];
  if (history.length) {
    lines.push('');
    lines.push('Conversation so far:');
    history.forEach((t) => {
      const who = String(t.role || '').toLowerCase() === 'assistant' ? 'Bauhly' : 'User';
      lines.push(`${who}: ${str(t.text)}`);
    });
  } else {
    lines.push('');
    lines.push('Latest user note:');
    lines.push(str(text) || '(no written note)');
  }
  const confirmed = Array.isArray(confirmedIds) ? confirmedIds.map(str).filter(Boolean) : [];
  if (confirmed.length) {
    lines.push('');
    lines.push(`User confirmed these ideas: ${confirmed.join(', ')}`);
  }
  lines.push('');
  lines.push(`Attached assets: ${images.length} image(s), ${videos.length} video(s).`);
  if (videos.length && !str(text) && !history.length) {
    lines.push('Video is attached but cannot be watched here. Treat missing visual context as a possible reason to ask what the clip is about — only if the note does not already make the meaning clear.');
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
  const confirmedIds = Array.isArray(input.confirmedIds) ? input.confirmedIds : [];
  const projects = Array.isArray(input.projects) ? input.projects : [];
  const kind = str(input.kind) || 'capture';

  if (!text && attachments.length === 0 && turns.length === 0) {
    const err = new Error('A capture needs a note or a file');
    err.statusCode = 400;
    throw err;
  }

  const userText = buildUserText({
    text, projectName, attachments, turns, confirmedIds, projects,
  });
  const systemPrompt = kind === 'checkin'
    ? `${loadPrompt()}\n\n${fs.readFileSync(path.join(__dirname, '..', '..', 'prompts', 'checkin-understand-prompt.md'), 'utf8')}`
    : loadPrompt();
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

  let parsed;
  let rawOutput = '';
  let usedSystem = systemPrompt;
  try {
    const done = await completeToolCall({
      model,
      system: systemPrompt,
      userParts,
      tool: UNDERSTAND_TOOL,
      retryHint: 'The previous JSON was invalid. Return only one JSON object with status needs_selection, needs_clarification, or ready.',
    });
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
    candidates: result.candidates,
    captureId: result.captureId,
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
