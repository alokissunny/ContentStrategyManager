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

const QUICK_SUMMARY_HEADING = /##\s*4\.?\s*Quick Summary/i;

// Claude is asked for 3 report tables followed by a "Quick Summary" JSON block;
// split those apart so the persisted report stays table-only and the summary
// fields can drive the confirmation screen.
function splitQuickSummary(fullText) {
  const headingMatch = fullText.match(QUICK_SUMMARY_HEADING);
  if (!headingMatch) return { reportMarkdown: fullText.trim(), quickSummary: null };

  const reportMarkdown = fullText.slice(0, headingMatch.index).trim();
  const rest = fullText.slice(headingMatch.index);
  const jsonMatch = rest.match(/```json\s*([\s\S]*?)```/i);
  if (!jsonMatch) return { reportMarkdown, quickSummary: null };

  try {
    return { reportMarkdown, quickSummary: JSON.parse(jsonMatch[1]) };
  } catch (err) {
    return { reportMarkdown, quickSummary: null };
  }
}

async function generateBrandAnalysis(profile) {
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const snapshot = buildSnapshot(profile);
  const prompt = loadPromptTemplate().replace('{{SNAPSHOT_JSON}}', JSON.stringify(snapshot, null, 2));

  console.log(`[brandAnalysis] Requesting analysis from ${model} for @${snapshot.username} (${snapshot.posts.length} posts)`);

  const client = getAnthropicClient();
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const fullText = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  console.log(`[brandAnalysis] Received markdown report for @${snapshot.username} (${fullText.length} chars):\n${fullText}`);

  const { reportMarkdown, quickSummary } = splitQuickSummary(fullText);

  return { markdown: reportMarkdown, quickSummary, model };
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

module.exports = { generateBrandAnalysis, mergeConfirmedSummary };
