const fs = require('fs');
const path = require('path');
const getAnthropicClient = require('./anthropicClient');

const PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'brand-analysis-prompt.md');
let promptTemplate;

function loadPromptTemplate() {
  if (!promptTemplate) {
    promptTemplate = fs.readFileSync(PROMPT_PATH, 'utf8');
  }
  return promptTemplate;
}

function buildSnapshot(profile) {
  return {
    username: profile.username,
    fullName: profile.fullName,
    biography: profile.biography,
    followersCount: profile.followersCount,
    followingCount: profile.followingCount,
    postsCount: profile.postsCount,
    isVerified: profile.isVerified,
    externalUrl: profile.externalUrl,
    posts: (profile.posts || []).map((p) => ({
      caption: p.caption,
      likesCount: p.likesCount,
      commentsCount: p.commentsCount,
      timestamp: p.timestamp,
      type: p.type,
    })),
  };
}

const BRAND_PROFILE_HEADING = /##\s*4\.?\s*Brand Profile/i;

// Claude outputs 3 report tables followed by a "Brand Profile" JSON block; split
// those apart so the persisted markdown stays table-only and the structured
// fields populate the Brand profile page + onboarding confirmation.
function splitBrandProfile(fullText) {
  const headingMatch = fullText.match(BRAND_PROFILE_HEADING);
  if (!headingMatch) return { reportMarkdown: fullText.trim(), brandProfile: null };

  const reportMarkdown = fullText.slice(0, headingMatch.index).trim();
  const rest = fullText.slice(headingMatch.index);
  const jsonMatch = rest.match(/```json\s*([\s\S]*?)```/i);
  if (!jsonMatch) return { reportMarkdown, brandProfile: null };

  try {
    return { reportMarkdown, brandProfile: JSON.parse(jsonMatch[1]) };
  } catch (err) {
    return { reportMarkdown, brandProfile: null };
  }
}

async function generateBrandAnalysis(profile) {
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const snapshot = buildSnapshot(profile);
  // Function replacement so `$` sequences in captions are inserted literally.
  const prompt = loadPromptTemplate().replace('{{SNAPSHOT_JSON}}', () => JSON.stringify(snapshot, null, 2));

  console.log(`[brandAnalysis] Requesting analysis from ${model} for @${snapshot.username} (${snapshot.posts.length} posts)`);

  const client = getAnthropicClient();
  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });

  const fullText = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  console.log(`[brandAnalysis] Received markdown report for @${snapshot.username} (${fullText.length} chars):\n${fullText}`);

  const { reportMarkdown, brandProfile } = splitBrandProfile(fullText);

  return { markdown: reportMarkdown, brandProfile, model };
}

const CONFIRMED_HEADING = /##\s*Your Confirmed Summary[\s\S]*$/i;

// Re-applies the user-edited hypothesis onto an already-generated report so the
// saved .md file reflects their corrections instead of Claude's first guess.
function mergeConfirmedSummary(markdown, summary) {
  const base = markdown.replace(CONFIRMED_HEADING, '').trim();
  const section = [
    '## Your Confirmed Summary',
    '',
    `**Who you help:** ${summary.whoYouHelp}`,
    '',
    `**What you offer:** ${summary.whatYouOffer}`,
    '',
    `**How you sound:** ${summary.howYouSound}`,
  ].join('\n');
  return `${base}\n\n${section}\n`;
}

// The 9 sections that make up a user's editable "Brand DNA". The first three
// mirror the AI-generated quick summary; the rest start blank and are filled
// in by hand on the Brand DNA tab.
// The Brand Profile fields shown on the Brand profile page — all inferred from
// the analyzed Instagram page. `inferred: true` fields carry the "Inferred from
// your page" badge (they're never confirmed in onboarding); the rest overlap
// with the onboarding quick-confirm (what you offer / who it's for / your voice).
const BRAND_DNA_FIELDS = [
  { key: 'whatYouOffer', label: 'What you offer', description: 'The product or service this account exists to sell.', inferred: false },
  { key: 'whoYouHelp', label: "Who it's for", description: 'The specific person your content should reach.', inferred: false },
  { key: 'firstProblem', label: 'Their first problem', description: 'What your content should speak to before anything else.', inferred: false },
  { key: 'position', label: 'Your position', description: 'The one-line answer to "why you and not the next account?"', inferred: true },
  { key: 'proof', label: 'Your proof', description: 'What you can honestly point to when someone asks "does it work?"', inferred: true },
  { key: 'howYouSound', label: 'Your voice', description: 'How every caption and hook should sound.', inferred: false },
  { key: 'visualStyle', label: 'Visual language', description: 'The colors, shapes and type your post graphics use.', inferred: true },
  { key: 'neverDo', label: 'Never do', description: 'Topics, tones and tactics the strategist must not suggest.', inferred: true },
];

const BRAND_DNA_HEADING = /##\s*Brand DNA[\s\S]*$/i;

// Parses the "## Brand DNA" section (written as `**Label:** value` lines) back
// into a { key: value } map. Returns {} if the section isn't present yet.
function parseBrandDna(markdown) {
  const match = markdown.match(BRAND_DNA_HEADING);
  if (!match) return {};

  const section = match[0];
  const values = {};
  for (const { key, label } of BRAND_DNA_FIELDS) {
    const lineMatch = section.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*(.*)`, 'i'));
    if (lineMatch) values[key] = lineMatch[1].trim();
  }
  return values;
}

// Replaces (or appends) the "## Brand DNA" section with the given field values.
function mergeBrandDna(markdown, fields) {
  const base = markdown.replace(BRAND_DNA_HEADING, '').trim();
  const lines = ['## Brand DNA', ''];
  BRAND_DNA_FIELDS.forEach(({ key, label }, i) => {
    lines.push(`**${label}:** ${fields[key] || ''}`);
    if (i < BRAND_DNA_FIELDS.length - 1) lines.push('');
  });
  return `${base}\n\n${lines.join('\n')}\n`;
}

/**
 * Merge a free-text studio note into Brand DNA fields via the model.
 * Only changes fields the note actually updates; keeps the rest intact.
 */
async function reviseBrandDnaFromNote(currentFields, note) {
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const keys = BRAND_DNA_FIELDS.map(({ key }) => key);
  const labels = Object.fromEntries(BRAND_DNA_FIELDS.map(({ key, label }) => [key, label]));

  const prompt = [
    'You update a studio\'s Business memory (Brand DNA) from a short note the studio just wrote.',
    'Return ONLY a JSON object with these exact keys (strings). No markdown fences, no commentary.',
    `Keys: ${keys.join(', ')}`,
    `Labels: ${JSON.stringify(labels)}`,
    '',
    'Rules:',
    '- Keep every field that the note does not change, copying the current value verbatim.',
    '- Update or rewrite only the fields the note clearly affects.',
    '- If the note adds new context, weave it into the right field(s) in clear prose (1–3 sentences each).',
    '- Never invent unrelated claims. Prefer the studio\'s wording.',
    '- Empty string is allowed when a field is truly unknown and the note does not fill it.',
    '',
    `Current memory: ${JSON.stringify(currentFields || {}, null, 2)}`,
    `Studio note: ${JSON.stringify(String(note || '').trim())}`,
  ].join('\n');

  const client = getAnthropicClient();
  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not update business memory from that note.');
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('Could not update business memory from that note.');
  }

  const next = {};
  for (const { key } of BRAND_DNA_FIELDS) {
    const incoming = parsed[key];
    if (typeof incoming === 'string') next[key] = incoming.trim();
    else next[key] = String(currentFields?.[key] || '').trim();
  }
  return next;
}

const PLANNING_GAP_KEYS = ['whatYouOffer', 'whoYouHelp', 'firstProblem', 'howYouSound'];
const GAP_FIELD_KEYS = BRAND_DNA_FIELDS.map(({ key }) => key);

const GENERIC_MEMORY = [
  /we'll sharpen as you post/i,
  /core product or service/i,
  /clear, consistent, and recognizable/i,
  /not enough signal/i,
];

function clipPhrase(s, max = 88) {
  let t = String(s || '').replace(/\s+/g, ' ').trim().replace(/[."']+$/, '');
  t = t.replace(/^(you offer|you help|we offer)\s+/i, '');
  if (!t) return '';
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > 40 ? cut.slice(0, at) : cut).replace(/[,;:]+$/, '')}…`;
}

function fieldUnclear(value) {
  const t = String(value || '').trim();
  if (!t) return true;
  if (t.length < 24) return true;
  return GENERIC_MEMORY.some((re) => re.test(t));
}

function heuristicBrandDnaGaps(fields) {
  const f = fields || {};
  const offer = clipPhrase(f.whatYouOffer);
  const audience = clipPhrase(f.whoYouHelp);
  const catalog = {
    whatYouOffer: {
      missing: 'what you offer',
      why: audience
        ? `You know who it’s for (${audience}), but the service itself is still vague — posts will describe work instead of selling it.`
        : 'Without a clear offer, posts describe the work instead of selling it.',
      improves: 'Plans will name the service and the outcome, not a generic pitch.',
      prompt: 'We offer…',
      question: 'What do you actually offer?',
    },
    whoYouHelp: {
      missing: 'who you want to attract',
      why: offer
        ? `The offer is on file (${offer}), but hooks still have no specific person to speak to.`
        : 'Hooks need a specific person. A vague audience reads as advertising.',
      improves: 'Captions will speak to that person — their situation, not a crowd.',
      prompt: 'We want to attract…',
      question: 'Who do you want to attract?',
    },
    firstProblem: {
      missing: 'the first problem you speak to',
      why: offer
        ? `You already describe the offer as ${offer}. Discovery still has no tension to open on for that customer.`
        : 'Discovery posts need a tension. Without it, the week opens soft.',
      improves: offer
        ? 'The opening slide can start on that customer’s hesitation instead of a slogan.'
        : 'The opening slide can start on a real tension instead of a slogan.',
      prompt: 'The first problem we speak to is…',
      question: offer
        ? `When someone first finds you, what problem should we speak to — before we talk about ${offer}?`
        : 'When someone first finds you, what problem should the opening post speak to?',
    },
    howYouSound: {
      missing: 'how you want to sound',
      why: offer
        ? `The offer is clear (${offer}), but captions still have no voice to keep when the direction changes.`
        : 'Tone drifts the moment you ask Bauhly to change direction.',
      improves: 'Every caption will keep the voice you set, including a new direction.',
      prompt: 'We want to sound…',
      question: 'How do you want to sound?',
    },
  };
  return PLANNING_GAP_KEYS
    .filter((key) => fieldUnclear(f[key]))
    .map((key) => ({ key, ...catalog[key] }));
}

function sanitizeBrandDnaGaps(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const allowed = new Set(GAP_FIELD_KEYS);
  const out = [];
  list.forEach((row) => {
    const key = String(row?.key || '').trim();
    if (!allowed.has(key) || seen.has(key)) return;
    const missing = String(row?.missing || '').trim();
    const question = String(row?.question || '').trim();
    const why = String(row?.why || '').trim();
    if (!missing || (!question && !why)) return;
    seen.add(key);
    const asked = question || `What is ${missing}?`;
    out.push({
      key,
      missing,
      why,
      improves: String(row?.improves || '').trim(),
      prompt: String(row?.prompt || '').trim(),
      question: asked.charAt(0).toUpperCase() + asked.slice(1),
    });
  });
  return out.slice(0, 5);
}

/**
 * Gaps the Business memory banner should show — written from this account's
 * current fields. Falls back to a heuristic if the model is down.
 */
async function assessBrandDnaGaps(fields) {
  const current = {};
  for (const { key } of BRAND_DNA_FIELDS) {
    current[key] = String(fields?.[key] || '').trim();
  }
  const fallback = heuristicBrandDnaGaps(current);
  const allEmpty = BRAND_DNA_FIELDS.every(({ key }) => !current[key]);
  if (allEmpty) return [];

  try {
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
    const prompt = [
      'You read a studio\'s Brand DNA / Business memory and decide what is still unclear for planning.',
      'Return ONLY a JSON object: {"gaps":[...]} with no markdown fences.',
      'Each gap: key, missing, why, improves, prompt, question — all strings.',
      `Allowed keys: ${GAP_FIELD_KEYS.join(', ')}`,
      '',
      'Rules:',
      '- Analyse every field. Flag only what is empty, generic, guessed, or too vague for the strategist to write a week from.',
      '- Prefer the planning-critical fields (whatYouOffer, whoYouHelp, firstProblem, howYouSound). Include proof, position, visualStyle, or neverDo only if they would actually weaken the next plan.',
      '- If a field is specific enough, omit it. 1–5 gaps. Prefer fewer, sharper questions.',
      '- question: ONE specific question this studio can answer in a sentence or two. Ground it in what is already known (their offer, quiz, audience, voice). Never ask a generic "what do you offer?" if the offer is already on file — ask the missing piece.',
      '- missing: short noun phrase for the banner.',
      '- why: 1–2 sentences grounded in THIS memory. Mention what is already known.',
      '- improves: one sentence on what plans or captions gain.',
      '- prompt: a first-person starter they can finish.',
      '- Empty gaps array if memory is usable.',
      '',
      `Current memory: ${JSON.stringify(current, null, 2)}`,
    ].join('\n');

    const client = getAnthropicClient();
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;
    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return fallback;
    }
    const assessed = sanitizeBrandDnaGaps(parsed?.gaps);
    const emptyKeys = PLANNING_GAP_KEYS.filter((key) => !current[key]);
    if (!emptyKeys.length) return assessed;
    const extras = fallback.filter((g) => emptyKeys.includes(g.key) && !assessed.some((a) => a.key === g.key));
    return [...assessed, ...extras].slice(0, 5);
  } catch (err) {
    console.warn('[brandDna] gap assessment failed:', err.message);
    return fallback;
  }
}

/**
 * Merge structured gap answers into Brand DNA. Each answer is tied to a field
 * key so the update lands in the right memory section.
 */
async function fillBrandDnaFromAnswers(currentFields, answers) {
  const current = {};
  for (const { key } of BRAND_DNA_FIELDS) {
    current[key] = String(currentFields?.[key] || '').trim();
  }
  const rows = (Array.isArray(answers) ? answers : [])
    .map((row) => ({
      key: String(row?.key || '').trim(),
      question: String(row?.question || '').trim(),
      answer: String(row?.answer || '').trim(),
    }))
    .filter((row) => row.answer && GAP_FIELD_KEYS.includes(row.key));
  if (!rows.length) return current;

  const fallback = { ...current };
  rows.forEach((row) => {
    fallback[row.key] = current[row.key]
      ? `${current[row.key]} ${row.answer}`.trim()
      : row.answer;
  });

  try {
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
    const keys = BRAND_DNA_FIELDS.map(({ key }) => key);
    const prompt = [
      'You update a studio\'s Brand DNA / Business memory from answers to specific gap questions.',
      'Return ONLY a JSON object with these exact keys (strings). No markdown fences, no commentary.',
      `Keys: ${keys.join(', ')}`,
      '',
      'Rules:',
      '- Keep every field the answers do not change, copying the current value verbatim.',
      '- Weave each answer into its key, and into any other field it clearly affects.',
      '- Prefer the studio\'s wording. 1–3 sentences per updated field.',
      '- Never invent unrelated claims.',
      '',
      `Current memory: ${JSON.stringify(current, null, 2)}`,
      `Answers: ${JSON.stringify(rows, null, 2)}`,
    ].join('\n');

    const client = getAnthropicClient();
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;
    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return fallback;
    }

    const next = {};
    for (const { key } of BRAND_DNA_FIELDS) {
      const incoming = parsed[key];
      if (typeof incoming === 'string' && incoming.trim()) next[key] = incoming.trim();
      else next[key] = current[key];
    }
    rows.forEach((row) => {
      if (!next[row.key]) next[row.key] = row.answer;
    });
    return next;
  } catch (err) {
    console.warn('[brandDna] fill from answers failed:', err.message);
    return fallback;
  }
}

module.exports = {
  generateBrandAnalysis,
  mergeConfirmedSummary,
  BRAND_DNA_FIELDS,
  PLANNING_GAP_KEYS,
  parseBrandDna,
  mergeBrandDna,
  reviseBrandDnaFromNote,
  fillBrandDnaFromAnswers,
  assessBrandDnaGaps,
  heuristicBrandDnaGaps,
};