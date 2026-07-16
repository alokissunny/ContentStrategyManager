const fs = require('fs');
const path = require('path');
const getAnthropicClient = require('./anthropicClient');
const getOpenAIClient = require('./openaiClient');

// Competitor discovery can run on OpenAI or Anthropic. Provider + model are
// env-configurable; the default is OpenAI per product requirement.
function competitorProvider() {
  return (process.env.COMPETITOR_PROVIDER || 'openai').toLowerCase();
}

function competitorModel() {
  if (process.env.COMPETITOR_MODEL) return process.env.COMPETITOR_MODEL;
  return competitorProvider() === 'openai' ? 'gpt-5.6-terra' : 'claude-haiku-4-5-20251001';
}

// Provider-agnostic single-prompt completion returning the raw text response.
async function runCompletion(prompt, maxTokens) {
  const model = competitorModel();
  if (competitorProvider() === 'openai') {
    const response = await getOpenAIClient().chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: maxTokens,
    });
    return response.choices?.[0]?.message?.content || '';
  }
  const response = await getAnthropicClient().messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

const PROMPTS_DIR = path.join(__dirname, '..', '..', 'prompts');
const promptCache = {};

function loadPrompt(file) {
  if (!promptCache[file]) {
    promptCache[file] = fs.readFileSync(path.join(PROMPTS_DIR, file), 'utf8');
  }
  return promptCache[file];
}

// Feed the model the profile plus (when available) the confirmed Brand DNA so it
// can reason about region, design style, target client and service offering.
function buildSnapshot(profile, brandDna) {
  return {
    username: profile.username,
    fullName: profile.fullName,
    biography: profile.biography,
    followersCount: profile.followersCount,
    externalUrl: profile.externalUrl,
    brandDna: brandDna || null,
    recentCaptions: (profile.posts || [])
      .slice(0, 12)
      .map((p) => p.caption)
      .filter(Boolean),
  };
}

// Models wrap the JSON differently (```json fences, bare object, or prose
// before it), so pull out the object defensively instead of trusting one shape.
function extractJson(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1]);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1));
  return JSON.parse(text);
}

function normalizeCandidate(raw) {
  if (!raw || !raw.username) return null;
  const username = String(raw.username).replace(/^@/, '').trim().toLowerCase();
  if (!username) return null;
  const followers = Number(raw.estimatedFollowers) || 0;
  return {
    username,
    name: raw.name || '',
    region: raw.region || '',
    designStyle: raw.designStyle || '',
    targetClient: raw.targetClient || '',
    serviceOffering: raw.serviceOffering || '',
    followersCount: followers,
    estimatedFollowers: followers,
    // Follower counts are model estimates now (no live Apify lookup).
    followersVerified: false,
    profilePicUrl: '',
    isVerified: false,
    matchReasons: Array.isArray(raw.matchReasons) ? raw.matchReasons : [],
    exists: null,
  };
}

// Accounts noticeably bigger than the base are "higher reach"; everyone else is
// "similar". We deliberately do NOT surface a separate "smaller" bucket — smaller
// niche peers fold into "similar" so real competitors are never hidden.
const HIGHER_LOWER_MULTIPLE = 1.5;

// Split competitors into just two cohorts and mutate each with its `cohort`.
// Relaxation: if the strict rule leaves "similar" empty (every peer is much
// bigger), the closest higher accounts are demoted into "similar" so the cohort
// isn't shown empty while real competitors exist.
function assignCohorts(competitors, baseFollowers) {
  const sorted = [...competitors].sort((a, b) => b.followersCount - a.followersCount);
  const higher = [];
  const similar = [];
  for (const c of sorted) {
    if (baseFollowers && c.followersCount > baseFollowers * HIGHER_LOWER_MULTIPLE) higher.push(c);
    else similar.push(c);
  }

  // Relax the exact match when "similar" came out empty but peers exist.
  if (similar.length === 0 && higher.length > 0) {
    const relaxCount = Math.max(1, Math.ceil(higher.length / 2));
    const moved = higher.splice(higher.length - relaxCount, relaxCount); // the closest (smallest) higher peers
    similar.push(...moved);
  }

  similar.forEach((c) => { c.cohort = 'similar'; });
  higher.forEach((c) => { c.cohort = 'higher'; });
  return { similar, higher };
}

/**
 * Find competitors for an Instagram profile and group them into follower cohorts.
 *
 * The model lists competitors directly from the account snapshot — no Apify /
 * Instagram scraping is involved, so follower counts are model estimates.
 *
 * @param {object} profile   An InstagramProfile document/snapshot (username, followers, posts…).
 * @param {object} [options]
 * @param {object} [options.brandDna]  Confirmed Brand DNA fields to sharpen the match.
 * @returns {Promise<{ baseRegion, baseFollowers, model, cohorts, competitors }>}
 */
async function findCompetitors(profile, options = {}) {
  const { brandDna = null } = options;
  const model = competitorModel();
  const snapshot = buildSnapshot(profile, brandDna);
  const baseFollowers = profile.followersCount || 0;
  console.log(`[competitorFinder] @${snapshot.username}: using ${competitorProvider()} model ${model} (no Apify)`);

  const prompt = loadPrompt('competitor-listing-prompt.md').replace(
    '{{SNAPSHOT_JSON}}',
    JSON.stringify(snapshot, null, 2)
  );
  const parsed = extractJson(await runCompletion(prompt, 8192));

  let competitors = (parsed.competitors || [])
    .map(normalizeCandidate)
    .filter(Boolean)
    // Guard against the model returning the base account among the competitors.
    .filter((c) => c.username !== profile.username);

  console.log(`[competitorFinder] @${snapshot.username}: ${competitors.length} competitors listed`);

  const cohorts = assignCohorts(competitors, baseFollowers);
  competitors.sort((a, b) => b.followersCount - a.followersCount);

  return { baseRegion: parsed.baseRegion || '', baseFollowers, model, cohorts, competitors };
}

module.exports = { findCompetitors, assignCohorts };
