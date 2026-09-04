/*
 * Capture conversation — Capture time only.
 *
 * Owns Capture Truth: extract a strategy-neutral experience from a note
 * (and optional photos), detect internal stories for clarification, preserve
 * one unified Capture for strategy, then hand it off. Never split the source
 * into content captures. Strategy, Brand DNA, and competitor intelligence
 * are out of scope.
 */

const fs = require('fs');
const path = require('path');
const { getObjectBytes, isS3Configured } = require('./s3Client');
const { completeToolCall, conversationModel, hasConversationModel, splitPromptTemplate } = require('./llmComplete');
const { toVisionImage } = require('./visionImage');

const PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'capture-understand-prompt.md');
function loadPrompt() {
  return fs.readFileSync(PROMPT_PATH, 'utf8');
}

const SIGNAL_KEYS = ['happened', 'intent', 'difficulty', 'actionTaken', 'outcome'];
const QUESTION_BUDGET = 4;

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

const CLARIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    question: { type: 'string' },
    answer: { type: 'string' },
  },
};

const VERIFIED_FACT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    fact: { type: 'string' },
    source: { type: 'string' },
  },
};

const INTERNAL_STORY_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    storyId: { type: 'string' },
    territory: { type: 'string' },
    summary: { type: 'string' },
    factIds: { type: 'array', items: { type: 'string' } },
    status: { type: 'string' },
  },
};

const STORY_RELATIONSHIP_SCHEMA = {
  type: 'object',
  properties: {
    storyIds: { type: 'array', items: { type: 'string' } },
    relationship: { type: 'string' },
    summary: { type: 'string' },
  },
};

const CAPTURE_ASSET_SCHEMA = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    summary: { type: 'string' },
    supportsFactIds: { type: 'array', items: { type: 'string' } },
    limitations: { type: 'array', items: { type: 'string' } },
  },
};

const CAPTURE_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    captureId: { type: 'string' },
    project: { type: 'string' },
    originalCapture: { type: 'string' },
    clarifications: { type: 'array', items: CLARIFICATION_SCHEMA },
    clarificationAnswers: { type: 'array', items: CLARIFICATION_SCHEMA },
    captureSummary: { type: 'string' },
    verifiedFacts: { type: 'array', items: VERIFIED_FACT_SCHEMA },
    internalStories: { type: 'array', items: INTERNAL_STORY_SCHEMA },
    storyRelationships: { type: 'array', items: STORY_RELATIONSHIP_SCHEMA },
    assets: { type: 'array', items: CAPTURE_ASSET_SCHEMA },
    status: { type: 'string', enum: ['ready', 'unresolved'] },
  },
};

const TOOL_NAME = 'record_capture_turn';
const UNDERSTAND_TOOL = {
  name: TOOL_NAME,
  description: 'Record this Capture Conversation turn: one follow-up question, or grounded Capture(s) for connected project stories.',
  input_schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['needs_clarification', 'ready'] },
      needsClarification: { type: 'boolean' },
      question: { type: 'string' },
      questions: { type: 'array', items: { type: 'string' }, description: 'Unused. Ask exactly one question per turn via question.' },
      matchedProjectName: { type: 'string' },
      conversationSummary: {
        type: 'string',
        description: 'Optional library card for the whole chat. Prefer captureSummary on the capture; do not also emit summary/whatHappened/intent on the capture.',
      },
      captures: {
        type: 'array',
        description: 'One connected project story per item. Internal stories go in internalStories, not as extra captures. Separate top-level captures only for different projects or unrelated events.',
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

function stringList(value, limit = 24) {
  if (!Array.isArray(value)) return [];
  return value.map(str).filter(Boolean).slice(0, limit);
}

function relationshipsOf(value) {
  if (!Array.isArray(value)) return [];
  return value.map((r) => ({
    from: str(r?.from),
    relationship: str(r?.relationship),
    to: str(r?.to),
  })).filter((r) => r.from || r.to || r.relationship).slice(0, 16);
}

function clarificationAnswersOf(value) {
  if (!Array.isArray(value)) return [];
  return value.map((row) => ({
    question: str(row?.question),
    answer: str(row?.answer),
  })).filter((row) => row.question || row.answer).slice(0, 8);
}

function clarificationsOf(c) {
  const fromNew = clarificationAnswersOf(c?.clarifications);
  if (fromNew.length) return fromNew;
  const fromOld = clarificationAnswersOf(c?.clarificationAnswers);
  if (fromOld.length) return fromOld;
  const question = str(c?.askedQuestion);
  const answer = str(c?.askedAnswer);
  return (question || answer) ? [{ question, answer }] : [];
}

function factText(row) {
  if (row && typeof row === 'object' && !Array.isArray(row)) return str(row.fact || row.summary);
  return str(row);
}

function verifiedFactsOf(value) {
  if (!Array.isArray(value)) return [];
  return value.map((row, i) => {
    const fact = factText(row);
    if (!fact) return null;
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      return {
        id: str(row.id) || `f${i + 1}`,
        fact,
        source: str(row.source) || 'originalCapture',
      };
    }
    return { id: `f${i + 1}`, fact, source: 'originalCapture' };
  }).filter(Boolean).slice(0, 24);
}

function unifyFacts(list) {
  const out = [];
  const seen = new Set();
  (list || []).forEach((c) => {
    (c.verifiedFacts || []).forEach((f) => {
      const fact = factText(f);
      if (!fact || seen.has(fact)) return;
      seen.add(fact);
      out.push({
        id: str(f && f.id) || `f${out.length + 1}`,
        fact,
        source: str(f && f.source) || 'originalCapture',
      });
    });
  });
  return out.slice(0, 24);
}

function internalStoriesOf(value) {
  if (!Array.isArray(value)) return [];
  return value.map((s, i) => {
    const id = str(s?.id || s?.storyId) || `s${i + 1}`;
    return {
      id,
      storyId: id,
      territory: str(s?.territory),
      summary: str(s?.summary),
      factIds: stringList(s?.factIds, 16),
      status: str(s?.status),
    };
  }).filter((s) => s.id || s.summary || s.territory).slice(0, 12);
}

function storyRelationshipsOf(value) {
  if (!Array.isArray(value)) return [];
  return value.map((r) => ({
    storyIds: stringList(r?.storyIds, 12),
    relationship: str(r?.relationship || r?.type),
    summary: str(r?.summary),
  })).filter((r) => r.storyIds.length || r.relationship || r.summary).slice(0, 16);
}

function storyRelationshipsFrom(c) {
  const direct = storyRelationshipsOf(c?.storyRelationships);
  if (direct.length) return direct;
  const derived = [];
  (c?.internalStories || []).forEach((s) => {
    (s.relationships || []).forEach((r) => {
      derived.push({
        storyIds: [str(s.id || s.storyId), str(r.targetStoryId)].filter(Boolean),
        relationship: str(r.type || r.relationship),
        summary: '',
      });
    });
  });
  return storyRelationshipsOf(derived);
}

function captureAssetsOf(value) {
  if (!Array.isArray(value)) return [];
  return value.map((a) => ({
    key: str(a?.key),
    summary: str(a?.summary),
    supportsFactIds: stringList(a?.supportsFactIds, 12),
    limitations: stringList(a?.limitations, 8),
  })).filter((a) => a.key || a.summary).slice(0, 8);
}

function possibleInterpretationsOf(value) {
  if (!Array.isArray(value)) return [];
  return value.map((row) => ({
    interpretation: str(row?.interpretation),
    basis: str(row?.basis),
    confidence: str(row?.confidence),
  })).filter((row) => row.interpretation).slice(0, 8);
}

function storyFieldsOf(c) {
  const id = str(c?.id || c?.captureId);
  return {
    captureId: str(c?.captureId) || id,
    project: str(c?.project),
    sourceStoryId: str(c?.sourceStoryId),
    segmentId: str(c?.segmentId),
    relatedSegmentIds: stringList(c?.relatedSegmentIds, 12),
    relationships: relationshipsOf(c?.relationships),
    verifiedFacts: verifiedFactsOf(c?.verifiedFacts),
    openQuestions: stringList(c?.openQuestions, 8),
    storyRelationships: storyRelationshipsFrom(c),
    captureAssets: captureAssetsOf(c?.assets || c?.captureAssets),
  };
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
    observableDetails: [],
    visualLimitations: [],
    captureStatus: 'ready',
    originalCapture: str(text),
    distinctSignals: [],
    captureId: '',
    sourceStoryId: '',
    segmentId: '',
    relatedSegmentIds: [],
    relationships: [],
    verifiedFacts: [],
    openQuestions: [],
    clarificationAnswers: [],
    internalStories: [],
    storyRelationships: [],
    captureAssets: [],
    possibleInterpretations: [],
    model: '',
    understoodAt: new Date(),
  };
}

function mapCaptureRecord(raw, fallbackText) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const summary = str(c.captureSummary || c.summary);
  const originalCapture = str(c.originalCapture) || str(fallbackText);
  const happened = str(c.whatHappened || c.happened) || summary;
  const intent = str(c.intent);
  const difficulty = str(c.tension || c.difficulty);
  const actionTaken = str(c.action || c.actionTaken);
  const outcome = str(c.outcome);
  const internalStories = internalStoriesOf(c.internalStories);
  const clarifications = clarificationsOf(c);
  const filled = SIGNAL_KEYS.filter((k) => str({ happened, intent, difficulty, actionTaken, outcome }[k]));
  return {
    id: str(c.id || c.captureId),
    ...storyFieldsOf(c),
    happened,
    intent,
    difficulty,
    actionTaken,
    outcome,
    summary: summary || happened || str(fallbackText),
    presentSignals: [...new Set(filled)],
    missingPiece: str(c.unresolvedGap || c.missingPiece),
    askedQuestion: '',
    askedAnswer: '',
    knownLimitation: str(c.knownLimitation),
    visualAssetChoice: '',
    observableDetails: [],
    visualLimitations: [],
    captureStatus: /unresolved/i.test(str(c.status)) ? 'unresolved' : 'ready',
    originalCapture: originalCapture || happened || summary,
    sourceRef: str(c.sourceRef),
    distinctSignals: [],
    clarificationAnswers: clarifications,
    internalStories,
    possibleInterpretations: [],
    project: str(c.project),
    relevantAssetContext: [],
    model: '',
    understoodAt: new Date(),
  };
}

function questionsOf(parsed) {
  const listed = stringList(parsed?.questions, 4);
  if (listed.length) return listed;
  const single = str(parsed?.question || parsed?.message);
  return single ? [single] : [];
}

function formatAskMessage(questions) {
  return questions[0] || '';
}

function wantsClarification(parsed) {
  if (parsed?.needsClarification === true) return true;
  const status = str(parsed?.status).toLowerCase();
  if (status === 'needs_clarification') return true;
  return Boolean(parsed?.shouldAsk || parsed?.meaningClear === false);
}

function storyOrderKey(c) {
  return str(c?.segmentId || c?.captureId || c?.id);
}

function uniqueStrings(lists) {
  const out = [];
  const seen = new Set();
  lists.flat().forEach((v) => {
    const s = str(v);
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  });
  return out;
}

function unifyOriginalCapture(rows, text) {
  const parts = uniqueStrings([text, ...rows.map((r) => r.originalCapture)]);
  if (!parts.length) return '';
  const longest = parts.reduce((a, b) => (a.length >= b.length ? a : b));
  if (parts.every((p) => longest.includes(p))) return longest;
  return parts.join('\n\n');
}

/** Conversation returns one Capture. If the model still emits siblings, fold them. */
function unifyCaptures(rows, text) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return [];
  const first = list[0];
  const summaries = uniqueStrings(list.map((c) => c.summary || c.captureSummary));
  const summary = summaries.join(' · ') || str(text);
  return [{
    ...first,
    originalCapture: unifyOriginalCapture(list, text) || first.originalCapture,
    happened: summary,
    intent: '',
    difficulty: '',
    actionTaken: '',
    outcome: '',
    summary,
    captureSummary: summary,
    distinctSignals: [],
    verifiedFacts: unifyFacts(list),
    openQuestions: uniqueStrings(list.map((c) => c.openQuestions || [])),
    observableDetails: [],
    visualLimitations: [],
    relevantAssetContext: [],
    relatedSegmentIds: [],
    clarificationAnswers: list.flatMap((c) => c.clarificationAnswers || [])
      .filter((row, i, arr) => row && arr.findIndex((x) => x.question === row.question && x.answer === row.answer) === i)
      .slice(0, 8),
    internalStories: list.flatMap((c) => c.internalStories || []).slice(0, 12),
    storyRelationships: list.flatMap((c) => c.storyRelationships || []).slice(0, 16),
    captureAssets: list.flatMap((c) => c.captureAssets || []).slice(0, 8),
    possibleInterpretations: [],
  }];
}

function captureProjectKey(c) {
  return str(c?.project).toLowerCase();
}

function clearlyDifferentProjects(rows) {
  const names = [...new Set((rows || []).map(captureProjectKey).filter(Boolean))];
  return names.length > 1;
}

function foldConnectedCaptures(rows, text) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (list.length <= 1) return list;
  if (clearlyDifferentProjects(list)) return list.slice(0, 10);
  return unifyCaptures(list, text);
}

function composeSessionSummary(captures, fallbackText) {
  const rows = [...(Array.isArray(captures) ? captures : [])].sort((a, b) => {
    const sa = storyOrderKey(a);
    const sb = storyOrderKey(b);
    if (sa && sb && sa !== sb) return sa.localeCompare(sb, undefined, { numeric: true });
    return 0;
  });
  const parts = rows
    .map((c) => str(c?.summary || c?.captureSummary))
    .filter(Boolean);
  const unique = [...new Set(parts)];
  if (unique.length) return unique.join('\n\n');
  return str(fallbackText);
}

function normalizeUnderstanding(parsed, { text, askedQuestion, askedAnswer }) {
  const questions = questionsOf(parsed);

  // Internal stories stay inside one Capture. Ask every follow-up in one turn.
  if (wantsClarification(parsed) && questions.length) {
    const question = formatAskMessage(questions);
    return {
      action: 'ask',
      question,
      questions,
      message: question,
      understanding: null,
      captures: [],
      conversationSummary: '',
    };
  }

  const rows = Array.isArray(parsed?.captures)
    ? parsed.captures
    : (Array.isArray(parsed?.conversationCaptures)
      ? parsed.conversationCaptures
      : (parsed?.signals ? [parsed] : []));
  const captures = foldConnectedCaptures(
    (rows.length ? rows : [{ originalCapture: text, captureSummary: text }])
      .map((row) => mapCaptureRecord(row, text)),
    text,
  );
  const understanding = captures[0] || emptyUnderstanding(text);
  if (askedQuestion) {
    understanding.askedQuestion = str(askedQuestion);
    const extra = { question: str(askedQuestion), answer: str(askedAnswer) };
    captures.forEach((c) => {
      const answers = Array.isArray(c.clarificationAnswers) ? c.clarificationAnswers : [];
      if (!answers.some((row) => row.question === extra.question)) {
        c.clarificationAnswers = [...answers, extra];
      }
    });
    understanding.clarificationAnswers = captures[0].clarificationAnswers;
  }
  if (askedAnswer) understanding.askedAnswer = str(askedAnswer);
  if (captures.length === 1 && !str(captures[0].originalCapture)) {
    captures[0].originalCapture = str(text);
    understanding.originalCapture = str(text);
  }

  return {
    action: 'ready',
    question: null,
    message: '',
    matchedProjectName: str(parsed?.matchedProjectName),
    conversationSummary: str(parsed?.conversationSummary) || composeSessionSummary(captures, text),
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
  const missedWord = sourceHasTranscriptGap(text, turns);
  if (asked >= QUESTION_BUDGET) {
    lines.push(`Question budget reached (${QUESTION_BUDGET}). Return grounded Capture(s) now. One connected project story per capture. Preserve remaining unknowns as knownLimitation.`);
  } else if (missedWord && asked === 0) {
    lines.push('The source still has a missed spoken word ([?], [unclear], [inaudible], or a similar marker). Ask exactly ONE question to recover that word or phrase before returning ready. This is not a project-filing question.');
  } else if (asked === 0) {
    lines.push(`Ask at most ${QUESTION_BUDGET} questions, one per turn. Ask exactly ONE question only if a non-obvious material gap remains for the Strategist (why, what is wrong now, what will change, constraints, outcome). Do not ask anything the source already said. If nothing non-obvious is missing, return ready. Do not ask about Instagram, posting, or which project to file.`);
  } else {
    lines.push(`Questions asked so far: ${asked} of ${QUESTION_BUDGET}. Ask exactly ONE more only if a non-obvious material gap remains; otherwise return grounded Capture(s). Do not re-ask what they already said. Do not list multiple questions.`);
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
  (attachments || []).forEach((a) => {
    if (!a?.key) return;
    const summary = str(a.analysis?.summary || a.note);
    lines.push(`- key: ${a.key}${summary ? ` — ${summary}` : ''}`);
  });
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
  const { system, userTemplate } = splitPromptTemplate(loadPrompt());
  let user = fillPrompt(userTemplate, { CONVERSATION: conversation, ATTACHED_ASSETS: attachedAssets });
  if (kind === 'checkin') {
    const extras = fs.readFileSync(path.join(__dirname, '..', '..', 'prompts', 'checkin-understand-prompt.md'), 'utf8');
    user = `${String(extras).trim()}\n\n${user}`;
  }
  return { system, user };
}

function captureMaxTokens() {
  const n = Number(process.env.CAPTURE_MAX_TOKENS);
  return Number.isFinite(n) && n > 0 ? n : 8192;
}

function splitIntoContentCaptures(parsed) {
  if (str(parsed?.status).toLowerCase() !== 'ready') return false;
  const rows = Array.isArray(parsed?.captures)
    ? parsed.captures
    : (Array.isArray(parsed?.conversationCaptures) ? parsed.conversationCaptures : []);
  if (rows.length <= 1) return false;
  return !clearlyDifferentProjects(rows);
}

function assistantQuestionCount(turns) {
  return (turns || []).filter((t) => String(t?.role || '').toLowerCase() === 'assistant' && str(t?.text)).length;
}

const TRANSCRIPT_GAP_RE = /\[(?:unclear|inaudible|unintelligible|\?+)\]|\(\s*(?:unclear|inaudible|\?+)\s*\)/i;

function hasTranscriptGap(...parts) {
  return parts.some((part) => TRANSCRIPT_GAP_RE.test(str(part)));
}

function sourceHasTranscriptGap(text, turns) {
  if (hasTranscriptGap(text)) return true;
  return (turns || []).some((t) => {
    if (String(t?.role || '').toLowerCase() === 'assistant') return false;
    return hasTranscriptGap(t?.text);
  });
}

function lastUserText(turns) {
  for (let i = (turns || []).length - 1; i >= 0; i -= 1) {
    if (String(turns[i]?.role || '').toLowerCase() !== 'assistant') return str(turns[i]?.text);
  }
  return '';
}

function userAskedToStop(turns) {
  const text = lastUserText(turns);
  if (/^skip this question/i.test(text)) return false;
  return /\b(that's enough|thats enough|nothing else|no more questions|that's all|thats all|stop asking|continue without guessing)\b/i.test(text);
}

function endedTooSoon(parsed, text, turns) {
  if (wantsClarification(parsed)) return false;
  if (str(parsed?.status).toLowerCase() !== 'ready' && parsed?.needsClarification !== false) return false;
  if (userAskedToStop(turns)) return false;
  const asked = assistantQuestionCount(turns);
  if (asked >= QUESTION_BUDGET) return false;
  return sourceHasTranscriptGap(text, turns) && asked === 0;
}

const USER_JSON_INSTRUCTION = [
  'Return one JSON object with status needs_clarification or ready.',
  'At most 4 clarification questions. No minimum. Ask only non-obvious gaps for the Strategist (why, current problem, what will change, constraints, outcome).',
  'Do not ask anything the source already said. Do not pad the quota with obvious questions.',
  'Each turn: put exactly ONE question in question, or return ready. Do not list multiple questions.',
  'Detect internal stories for clarification and record them in internalStories with factIds. They are not capture boundaries and are not automatically posts.',
  'One connected project story is one capture. Separate top-level captures only for different projects or unrelated events.',
  'When status is ready, pass originalCapture, clarifications, one compact captureSummary, verifiedFacts as {id,fact,source}, internalStories, storyRelationships, and assets once.',
  'Do not also return summary, whatHappened, intent, tension, action, outcome, distinctSignals, or copy facts into each internal story.',
  'captureSummary is navigation only. Never put a fact in it that is not in originalCapture, a clarification, or an asset.',
  'Only verifiedFacts that the user stated or an asset clearly shows.',
].join(' ');

const CONTINUE_QUESTIONS_HINT = [
  'Do not complete yet.',
  'Ask exactly ONE non-obvious question that fills a missing piece for the Strategist.',
  'Do not re-ask what the source already said. Do not ask about Instagram, posting, or which project to file.',
  'Return needsClarification true with exactly ONE question and captures [].',
  'Do not mention story numbers.',
].join(' ');

const TRANSCRIPT_GAP_HINT = [
  'Do not complete yet.',
  'The user source still contains a missed-word marker such as [?], [unclear], or [inaudible].',
  'Return needsClarification true with exactly ONE question that asks them to supply that missing word or phrase.',
  'This is recovering what they said, not asking which project to file under.',
  'captures must be [].',
].join(' ');

const UNIFY_RETRY_HINT = [
  'Re-read the entire conversation.',
  'One connected project, experience or event is one capture.',
  'Record internal stories in internalStories. They are not capture boundaries and are not automatically posts.',
  'Separate top-level captures only for different projects or unrelated events.',
  'originalCapture must be the complete source. Keep clarifications. Do not convert assumptions into verifiedFacts.',
].join(' ');

const FORCE_READY_HINT = [
  'This conversation is already filed. Do not ask any clarification questions.',
  'Return status ready with updated conversationSummary and Capture(s) that reflect the full conversation above,',
  'including every clarification answer. Preserve unknowns only where the user still left them unanswered.',
].join(' ');

async function imageContentParts(attachments) {
  if (!isS3Configured()) return [];
  const images = (attachments || []).filter((a) => a && a.type === 'image' && a.key).slice(0, 2);
  const parts = [];
  for (const a of images) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { buffer, contentType } = await getObjectBytes(a.key);
      const vision = await toVisionImage(buffer, contentType, a.key);
      parts.push({
        type: 'image',
        mediaType: vision.mediaType,
        data: vision.buffer.toString('base64'),
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
  const forceReady = Boolean(input.forceReady);

  if (!text && attachments.length === 0 && turns.length === 0) {
    const err = new Error('A capture needs a note or a file');
    err.statusCode = 400;
    throw err;
  }

  const assembled = assemblePrompt({
    text, projectName, attachments, turns, projects, kind,
  });
  const systemPrompt = assembled.system;
  const userText = [
    assembled.user,
    forceReady ? FORCE_READY_HINT : '',
    USER_JSON_INSTRUCTION,
  ].filter(Boolean).join('\n\n');
  const debugSource = kind === 'checkin' ? 'Check-in conversation' : 'Capture conversation';
  const ctx = { text, askedQuestion, askedAnswer };

  if (!hasConversationModel()) {
    const result = normalizeUnderstanding(
      { status: 'ready', captures: [{ originalCapture: text, captureSummary: text }] },
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
    retryHint: 'The previous JSON was invalid. Return only one JSON object with status needs_clarification or ready. Internal stories belong in internalStories. Separate top-level captures only for different projects or unrelated events.',
    cacheKey: 'igsignal-conversation',
  };

  let parsed;
  let rawOutput = '';
  let usedSystem = systemPrompt;
  try {
    let done = await completeToolCall(callOpts);
    if (endedTooSoon(done.parsed, text, turns)) {
      const asked = assistantQuestionCount(turns);
      const gap = sourceHasTranscriptGap(text, turns) && asked === 0;
      console.warn(`[${kind}] completed after ${asked} question(s)${gap ? ' with a missed-word marker' : ''} — asking again`);
      done = await completeToolCall({
        ...callOpts,
        extraUserText: gap ? TRANSCRIPT_GAP_HINT : CONTINUE_QUESTIONS_HINT,
      });
    }
    if (splitIntoContentCaptures(done.parsed)) {
      console.warn(`[${kind}] returned ${done.parsed?.captures?.length || 0} captures — retrying unified Capture`);
      done = await completeToolCall({ ...callOpts, extraUserText: UNIFY_RETRY_HINT });
    }
    if (forceReady && wantsClarification(done.parsed) && questionsOf(done.parsed).length) {
      console.warn(`[${kind}] asked again during resummarize — forcing ready`);
      done = await completeToolCall({ ...callOpts, extraUserText: FORCE_READY_HINT });
    }
    parsed = done.parsed;
    rawOutput = done.output || '';
    if (done.system) usedSystem = done.system;
    const cached = Number(done.usage?.cached_tokens) || 0;
    const input = Number(done.usage?.input_tokens) || 0;
    if (cached) {
      console.log(`[${kind}] cache hit ${cached}/${input} input tokens`);
    }
  } catch (err) {
    console.error(`[${kind}] understand failed`, err.message);
    const result = normalizeUnderstanding(
      { status: 'ready', captures: [{ originalCapture: text, captureSummary: text }] },
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

  let result = normalizeUnderstanding(parsed, ctx);
  if (forceReady && result.action === 'ask') {
    // Resummarize must never reopen the ladder — fall back to a ready capture from the source text.
    result = normalizeUnderstanding(
      {
        status: 'ready',
        conversationSummary: text,
        captures: [{ originalCapture: text, captureSummary: text }],
      },
      ctx,
    );
  }
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
    observableDetails: Array.isArray(raw.observableDetails)
      ? raw.observableDetails.map(str).filter(Boolean)
      : [],
    visualLimitations: Array.isArray(raw.visualLimitations)
      ? raw.visualLimitations.map(str).filter(Boolean)
      : [],
    captureStatus: str(raw.captureStatus) || 'ready',
    originalCapture: str(raw.originalCapture),
    sourceRef: str(raw.sourceRef),
    distinctSignals: distinct,
    ...storyFieldsOf(raw),
    relevantAssetContext: [],
    clarificationAnswers: clarificationsOf(raw),
    internalStories: internalStoriesOf(raw.internalStories),
    possibleInterpretations: possibleInterpretationsOf(raw.possibleInterpretations),
    model: str(raw.model),
    understoodAt: Number.isNaN(understoodAt.getTime()) ? new Date() : understoodAt,
  };
}

function sanitizeStories(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeUnderstanding).filter(Boolean).slice(0, 10);
}

function serializeStories(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(serializeUnderstanding).filter(Boolean);
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
    observableDetails: Array.isArray(u.observableDetails) ? u.observableDetails : [],
    visualLimitations: Array.isArray(u.visualLimitations) ? u.visualLimitations : [],
    captureStatus: u.captureStatus || '',
    originalCapture: u.originalCapture || '',
    sourceRef: u.sourceRef || '',
    distinctSignals: u.distinctSignals || [],
    captureId: u.captureId || u.id || '',
    project: u.project || '',
    sourceStoryId: u.sourceStoryId || '',
    segmentId: u.segmentId || '',
    relatedSegmentIds: Array.isArray(u.relatedSegmentIds) ? u.relatedSegmentIds : [],
    relationships: Array.isArray(u.relationships) ? u.relationships : [],
    verifiedFacts: Array.isArray(u.verifiedFacts) ? u.verifiedFacts : [],
    openQuestions: Array.isArray(u.openQuestions) ? u.openQuestions : [],
    relevantAssetContext: u.relevantAssetContext || [],
    clarificationAnswers: Array.isArray(u.clarificationAnswers) ? u.clarificationAnswers : [],
    internalStories: Array.isArray(u.internalStories) ? u.internalStories : [],
    storyRelationships: Array.isArray(u.storyRelationships) ? u.storyRelationships : [],
    captureAssets: Array.isArray(u.captureAssets) ? u.captureAssets : [],
    possibleInterpretations: Array.isArray(u.possibleInterpretations) ? u.possibleInterpretations : [],
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
    conversationSummary: result.conversationSummary || '',
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
  sanitizeStories,
  serializeStories,
  composeSessionSummary,
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
