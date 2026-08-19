/*
 * Check-in understanding — Planning time.
 *
 * Reads the user's opening turn (and optional photos / a prior answer) and
 * decides whether Bauhly already understands the idea well enough to plan
 * from it, or whether one clarifying question would make the plan specific.
 * Also matches a project on file and whether a supporting asset is worth asking
 * for — so the conversation is not a fixed script of "which project / any
 * photo / anything else".
 */

const fs = require('fs');
const path = require('path');
const getAnthropicClient = require('./anthropicClient');
const {
  SIGNAL_KEYS,
  emptyUnderstanding,
  imageContentParts,
  extractParsed,
  str,
} = require('./captureUnderstand');

const PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'checkin-understand-prompt.md');
let systemPrompt;
function loadPrompt() {
  if (!systemPrompt) systemPrompt = fs.readFileSync(PROMPT_PATH, 'utf8');
  return systemPrompt;
}

const TOOL_NAME = 'record_checkin_understanding';
const UNDERSTAND_TOOL = {
  name: TOOL_NAME,
  description: 'Record what this check-in turn is about, whether one clarifying question is needed, and which project (if any) already owns it.',
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
      ack: { type: 'string' },
      matchedProjectName: { type: 'string' },
      askForAssets: { type: 'boolean' },
    },
    required: [
      'signals', 'presentSignals', 'meaningClear', 'shouldAsk', 'question',
      'summary', 'ack', 'matchedProjectName', 'askForAssets',
    ],
  },
};

function findProject(projects, name) {
  const n = str(name).toLowerCase();
  if (!n) return null;
  const list = Array.isArray(projects) ? projects : [];
  const exact = list.find((p) => str(p.name).toLowerCase() === n);
  if (exact) return exact;
  const contains = list.filter((p) => {
    const pn = str(p.name).toLowerCase();
    return pn && (n.includes(pn) || pn.includes(n));
  });
  return contains.length === 1 ? contains[0] : null;
}

function matchFromText(projects, text) {
  const t = str(text).toLowerCase();
  if (!t) return null;
  const hits = (projects || []).filter((p) => {
    const n = str(p.name).toLowerCase();
    return n.length >= 3 && t.includes(n);
  });
  return hits.length === 1 ? hits[0] : null;
}

function buildUserText({
  text, projects, attachments, alreadyAsked, askedQuestion, askedAnswer,
}) {
  const images = (attachments || []).filter((a) => a.type === 'image');
  const videos = (attachments || []).filter((a) => a.type === 'video');
  const names = (projects || []).map((p) => str(p.name)).filter(Boolean);
  const lines = ['Check-in — understand this turn so the conversation can skip what is already known.'];
  lines.push('');
  lines.push('Projects on file (match only these names, or none):');
  lines.push(names.length ? names.map((n) => `- ${n}`).join('\n') : '(none yet)');
  lines.push('');
  lines.push('User said:');
  lines.push(str(text) || '(no written note)');
  lines.push('');
  lines.push(`Attached assets: ${images.length} image(s), ${videos.length} video(s).`);
  if (videos.length && !str(text)) {
    lines.push('Video is attached but cannot be watched here. Treat missing visual context as a possible reason to ask what the clip is about — only if the note does not already make the meaning clear.');
  }
  if (alreadyAsked) {
    lines.push('');
    lines.push('A clarifying question was already asked. Do not ask another. Reassess and continue.');
    if (askedQuestion) lines.push(`Question asked: ${askedQuestion}`);
    if (askedAnswer) lines.push(`User's answer: ${askedAnswer}`);
  }
  return lines.join('\n');
}

function normalize(parsed, {
  text, projects, attachments, alreadyAsked, askedQuestion, askedAnswer,
}) {
  const signals = parsed.signals && typeof parsed.signals === 'object' ? parsed.signals : parsed;
  const present = Array.isArray(parsed.presentSignals)
    ? parsed.presentSignals.map(str).filter((k) => SIGNAL_KEYS.includes(k))
    : SIGNAL_KEYS.filter((k) => str(signals[k]));

  let shouldAsk = Boolean(parsed.shouldAsk) && !alreadyAsked;
  let question = str(parsed.question);
  if (!alreadyAsked && parsed.meaningClear === false && question) shouldAsk = true;
  if (shouldAsk && !question) shouldAsk = false;
  if (alreadyAsked) {
    shouldAsk = false;
    question = '';
  }

  const combinedText = [text, alreadyAsked ? askedAnswer : ''].filter(Boolean).join('\n');
  const matched = findProject(projects, parsed.matchedProjectName)
    || matchFromText(projects, combinedText);

  const hasFiles = (attachments || []).length > 0;
  let askForAssets = Boolean(parsed.askForAssets) && !hasFiles;
  if (hasFiles) askForAssets = false;

  const summary = str(parsed.summary) || str(text);
  const ack = str(parsed.ack);

  return {
    action: shouldAsk ? 'ask' : 'ready',
    question: shouldAsk ? question : null,
    ack: shouldAsk ? '' : ack,
    matchedProjectId: matched?.id || matched?._id || null,
    matchedProjectName: matched?.name || '',
    askForAssets,
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

/**
 * Understand a check-in turn. Returns
 * { action: 'ask'|'ready', question, ack, matchedProjectId, matchedProjectName,
 *   askForAssets, understanding }.
 * Never throws for "the model declined" — the conversation can always continue.
 */
async function understandCheckin(input = {}) {
  const text = str(input.text);
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  const projects = Array.isArray(input.projects) ? input.projects : [];
  const alreadyAsked = Boolean(input.alreadyAsked);
  const askedQuestion = str(input.askedQuestion);
  const askedAnswer = str(input.askedAnswer);

  if (!text && attachments.length === 0) {
    const err = new Error('A check-in turn needs a note or a file');
    err.statusCode = 400;
    throw err;
  }

  const fallback = normalize(
    {
      shouldAsk: false,
      summary: text,
      ack: '',
      matchedProjectName: '',
      askForAssets: attachments.length === 0,
      signals: { happened: text, intent: '', difficulty: '', actionTaken: '', outcome: '' },
      presentSignals: text ? ['happened'] : [],
      meaningClear: true,
      question: '',
    },
    { text, projects, attachments, alreadyAsked, askedQuestion, askedAnswer }
  );
  if (!fallback.understanding.happened && text) {
    Object.assign(fallback.understanding, emptyUnderstanding(text));
  }

  if (!process.env.ANTHROPIC_API_KEY) return fallback;

  const model = process.env.ANTHROPIC_CHECKIN_MODEL
    || process.env.ANTHROPIC_CAPTURE_MODEL
    || process.env.ANTHROPIC_MODEL
    || 'claude-sonnet-5';
  const imageParts = await imageContentParts(attachments);
  const userText = buildUserText({
    text, projects, attachments, alreadyAsked, askedQuestion, askedAnswer,
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
    console.error('[checkin] understand parse failed, retrying', err.message);
    response = await request([
      { role: 'user', content: userContent },
      { role: 'assistant', content: response.content || [] },
      {
        role: 'user',
        content: 'The previous tool call was invalid. Call record_checkin_understanding again with complete fields. Empty strings for unknowns. shouldAsk and askForAssets must be true or false.',
      },
    ]);
    parsed = extractParsed(response);
  }

  const result = normalize(parsed, {
    text, projects, attachments, alreadyAsked, askedQuestion, askedAnswer,
  });
  result.understanding.model = model;
  if (result.action === 'ask') {
    console.log('[checkin] understand ask:', result.question);
  } else {
    console.log(
      '[checkin] understand ready; project:', result.matchedProjectName || '(none)',
      'assets:', result.askForAssets,
    );
  }
  return result;
}

module.exports = { understandCheckin };
