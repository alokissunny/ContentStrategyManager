const fs = require('fs');
const path = require('path');
const getOpenAIClient = require('./openaiClient');
const { completeText } = require('./llmComplete');

// Competitor discovery runs on OpenAI (COMPETITOR_MODEL, gpt-5.6-terra by default).
function competitorProvider() {
  return 'openai';
}

function competitorModel() {
  return process.env.COMPETITOR_MODEL || 'gpt-5.6-terra';
}

// Provider-agnostic single-prompt completion returning the raw text response.
async function runCompletion(prompt, maxTokens) {
  const model = competitorModel();
  const response = await getOpenAIClient().chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_completion_tokens: maxTokens,
  });
  return response.choices?.[0]?.message?.content || '';
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

// Hard cap on how many competitors we surface / store.
const MAX_COMPETITORS = 5;

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
    () => JSON.stringify(snapshot, null, 2)
  );
  const parsed = extractJson(await runCompletion(prompt, 8192));

  let competitors = (parsed.competitors || [])
    .map(normalizeCandidate)
    .filter(Boolean)
    // Guard against the model returning the base account among the competitors.
    .filter((c) => c.username !== profile.username)
    // Cap the set to the 5 strongest competitors (model returns them strongest-first).
    .slice(0, MAX_COMPETITORS);

  console.log(`[competitorFinder] @${snapshot.username}: ${competitors.length} competitors listed`);

  const cohorts = assignCohorts(competitors, baseFollowers);
  competitors.sort((a, b) => b.followersCount - a.followersCount);

  return { baseRegion: parsed.baseRegion || '', baseFollowers, model, cohorts, competitors };
}

/**
 * Produce a detailed written competitor analysis (Markdown) comparing the base
 * account against its competitors. Uses the Anthropic content model — the same
 * one that writes the Brand DNA report — since this is an analysis document.
 *
 * @returns {Promise<{ analysisMarkdown, model }>}
 */
async function generateCompetitorAnalysis(profile, brandDna, competitors, activity = []) {
  // OpenAI (COMPETITOR_ANALYSIS_MODEL, gpt-5.6-terra by default)
  const model = process.env.COMPETITOR_ANALYSIS_MODEL || 'gpt-5.6-terra';
  const activityByUser = new Map((activity || []).map((a) => [a.username, a]));
  const payload = {
    base: buildSnapshot(profile, brandDna),
    competitors: (competitors || []).map((c) => {
      const a = activityByUser.get(c.username);
      return {
        username: c.username,
        name: c.name,
        region: c.region,
        followersCount: c.followersCount,
        designStyle: c.designStyle,
        targetClient: c.targetClient,
        serviceOffering: c.serviceOffering,
        cohort: c.cohort,
        matchReasons: c.matchReasons,
        // Real 30-day activity scraped from Instagram (metrics + a few sample posts).
        last30Days: a && a.metrics
          ? {
              ...a.metrics,
              samplePosts: (a.posts || []).slice(0, 6).map((p) => ({
                date: p.timestamp,
                type: p.type,
                likes: p.likesCount,
                comments: p.commentsCount,
                caption: (p.caption || '').slice(0, 160),
              })),
            }
          : null,
      };
    }),
  };
  const prompt = loadPrompt('competitor-analysis-report-prompt.md').replace(
    '{{PAYLOAD_JSON}}',
    () => JSON.stringify(payload, null, 2)
  );

  console.log(`[competitorFinder] Generating competitor analysis for @${profile.username} with ${model}`);

  // a reasoning model spends part of its output budget thinking — headroom on top of the report's 8k
  const response = await completeText({ model, prompt, maxTokens: 16000, timeoutMs: 300000 });
  const analysisMarkdown = String(response.text || '').trim();

  return { analysisMarkdown, model };
}

module.exports = { findCompetitors, assignCohorts, generateCompetitorAnalysis };
