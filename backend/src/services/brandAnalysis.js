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

module.exports = {
  generateBrandAnalysis,
  mergeConfirmedSummary,
  BRAND_DNA_FIELDS,
  parseBrandDna,
  mergeBrandDna,
};
