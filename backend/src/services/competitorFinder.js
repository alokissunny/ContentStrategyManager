const fs = require('fs');
const path = require('path');
const getAnthropicClient = require('./anthropicClient');
const { scrapeProfile, searchAccountsByHashtags } = require('./instagramScraper');

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

function messageText(response) {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

// Cohort thresholds are expressed as multiples of the base account's follower
// count so the bands scale with account size (a 2k and a 2M account get
// proportionally-sized peer groups).
const SIMILAR_LOWER_MULTIPLE = 0.5;
const HIGHER_LOWER_MULTIPLE = 1.5;

function cohortFor(followers, baseFollowers) {
  if (!baseFollowers) return 'similar';
  if (followers > baseFollowers * HIGHER_LOWER_MULTIPLE) return 'higher';
  if (followers >= baseFollowers * SIMILAR_LOWER_MULTIPLE) return 'similar';
  return 'smaller';
}

// Step 1 — ask a cheap model for the niche + region hashtags real competitors
// post under. This is what grounds discovery in actual Instagram accounts.
async function deriveSearchTerms(client, model, snapshot) {
  const prompt = loadPrompt('competitor-search-terms-prompt.md').replace(
    '{{SNAPSHOT_JSON}}',
    JSON.stringify(snapshot, null, 2)
  );
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });
  const parsed = extractJson(messageText(response));
  const hashtags = (parsed.hashtags || [])
    .map((h) => String(h).replace(/^#/, '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);
  return { hashtags, region: parsed.region || '' };
}

// Step 3 — pull a real profile for each candidate so we have live follower
// counts and bios to rank on. Real accounts occasionally fail to scrape
// (private/blocked); those are dropped rather than shown with fake data.
async function enrichAccounts(candidates) {
  const enriched = await Promise.all(
    candidates.map(async (c) => {
      try {
        const profile = await scrapeProfile(c.username);
        if (!profile || !profile.username) return null;
        return {
          username: c.username,
          fullName: profile.fullName || c.fullName || '',
          biography: profile.biography || '',
          externalUrl: profile.externalUrl || '',
          followersCount: profile.followersCount || 0,
          profilePicUrl: profile.profilePicUrl || '',
          isVerified: Boolean(profile.isVerified),
          postsSeen: c.postsSeen || 0,
        };
      } catch (err) {
        return null;
      }
    })
  );
  return enriched.filter(Boolean);
}

// Step 4 — a cheap model ranks the *real* accounts by how well they match the
// base account and discards off-topic ones (suppliers, magazines, hobbyists…).
async function rankAccounts(client, model, snapshot, accounts) {
  const payload = {
    base: snapshot,
    candidates: accounts.map((a) => ({
      username: a.username,
      fullName: a.fullName,
      biography: a.biography,
      externalUrl: a.externalUrl,
      followersCount: a.followersCount,
    })),
  };
  const prompt = loadPrompt('competitor-ranking-prompt.md').replace(
    '{{PAYLOAD_JSON}}',
    JSON.stringify(payload, null, 2)
  );
  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });
  const parsed = extractJson(messageText(response));
  return parsed.competitors || [];
}

const MAX_CANDIDATES = Number(process.env.COMPETITOR_MAX_CANDIDATES) || 18;

/**
 * Find competitors for an Instagram profile and group them into follower cohorts.
 *
 * Discovery is search-grounded: real accounts are pulled from niche hashtags,
 * enriched with live follower counts, then ranked by a cheap model — so every
 * competitor returned is a real, existing account.
 *
 * @param {object} profile   An InstagramProfile document/snapshot (username, followers, posts…).
 * @param {object} [options]
 * @param {object} [options.brandDna]  Confirmed Brand DNA fields to sharpen the match.
 * @returns {Promise<{ baseRegion, baseFollowers, model, hashtags, cohorts, competitors, droppedCount }>}
 */
async function findCompetitors(profile, options = {}) {
  const { brandDna = null } = options;
  // Discovery is grounded in real accounts, so a low-cost model is all we need
  // to pick hashtags and rank the results.
  const model = process.env.COMPETITOR_MODEL || 'claude-haiku-4-5-20251001';
  const snapshot = buildSnapshot(profile, brandDna);
  const baseFollowers = profile.followersCount || 0;
  const client = getAnthropicClient();

  // 1. Niche + region hashtags.
  const { hashtags, region } = await deriveSearchTerms(client, model, snapshot);
  console.log(`[competitorFinder] @${snapshot.username}: hashtags ${JSON.stringify(hashtags)} (${region})`);
  if (hashtags.length === 0) {
    return { baseRegion: region, baseFollowers, model, hashtags, droppedCount: 0, cohorts: { similar: [], higher: [] }, competitors: [] };
  }

  // 2. Real accounts active on those hashtags.
  const found = (await searchAccountsByHashtags(hashtags))
    .filter((a) => a.username !== profile.username)
    .slice(0, MAX_CANDIDATES);
  console.log(`[competitorFinder] @${snapshot.username}: ${found.length} real accounts from hashtag search`);

  // 3. Live follower counts + bios for each.
  const enriched = await enrichAccounts(found);

  // 4. Rank/match with a cheap model; drop off-topic accounts.
  const ranked = enriched.length ? await rankAccounts(client, model, snapshot, enriched) : [];
  const byUsername = new Map(enriched.map((e) => [e.username, e]));

  let competitors = ranked
    .map((r) => {
      const username = String(r.username || '').replace(/^@/, '').trim().toLowerCase();
      const e = byUsername.get(username);
      if (!e) return null; // The model must reference a real, scraped candidate.
      return {
        username: e.username,
        name: r.name || e.fullName || '',
        region: r.region || region,
        designStyle: r.designStyle || '',
        targetClient: r.targetClient || '',
        serviceOffering: r.serviceOffering || '',
        followersCount: e.followersCount || 0,
        estimatedFollowers: e.followersCount || 0,
        followersVerified: Boolean(e.followersCount),
        profilePicUrl: e.profilePicUrl,
        isVerified: e.isVerified,
        matchReasons: Array.isArray(r.matchReasons) ? r.matchReasons : [],
        exists: true,
      };
    })
    .filter(Boolean);

  const droppedCount = enriched.length - competitors.length;
  console.log(`[competitorFinder] @${snapshot.username}: ${enriched.length} enriched, ${droppedCount} dropped as off-topic, ${competitors.length} kept`);

  competitors = competitors
    .map((c) => ({ ...c, cohort: cohortFor(c.followersCount, baseFollowers) }))
    .sort((a, b) => b.followersCount - a.followersCount);

  const cohorts = {
    similar: competitors.filter((c) => c.cohort === 'similar'),
    higher: competitors.filter((c) => c.cohort === 'higher'),
  };

  return { baseRegion: region, baseFollowers, model, hashtags, droppedCount, cohorts, competitors };
}

module.exports = { findCompetitors, cohortFor };
